// content.js - Browser Agent Content Script
(function () {
  if (window.__BROWSER_AGENT_INITIALIZED__) return;
  window.__BROWSER_AGENT_INITIALIZED__ = true;

  console.log('[BrowserAgent] Content script injected.');

  // DOM 元素缓存表：ID -> HTMLElement
  const elementMap = new Map();
  let nextElementId = 1;
  let snapshotId = null;

  // 敏感字段检测正则
  const SENSITIVE_REGEX = /password|pwd|cvv|cvc|cardnumber|creditcard|secret|token/i;

  /**
   * 判断元素是否在页面上真实可见
   */
  function isElementVisible(el) {
    if (!el || !(el instanceof HTMLElement)) return false;
    if (el.offsetParent === null && el.tagName !== 'BODY') {
      const style = window.getComputedStyle(el);
      // 兼容 fixed/sticky 元素或在活动 dialog 容器内部的元素
      if (style.position !== 'fixed' && style.position !== 'sticky' && !el.closest('dialog, [role="dialog"], .el-dialog, .ant-modal, .modal')) {
        return false;
      }
    }
    const style = window.getComputedStyle(el);
    if (style.display === 'none') {
      return false;
    }
    if (style.visibility === 'hidden') {
      // 兼容 hover 操作按钮（如 BOSS直聘 等系统的编辑、添加、同步、删除按钮，常态 visibility: hidden，hover 父级才 visible）
      const text = (el.innerText || el.textContent || '').trim();
      const cls = typeof el.className === 'string' ? el.className.toLowerCase() : '';
      const isAction = ['button', 'a'].includes(el.tagName.toLowerCase()) ||
        el.getAttribute('role') === 'button' ||
        /btn|button|op|action|edit|add|sync|delete/i.test(cls) ||
        /编辑|添加|同步|删除|修改|上传|下载|查看/i.test(text);
      const rect = el.getBoundingClientRect();
      if (isAction && rect.width > 0 && rect.height > 0) {
        el.__isHoverAction = true;
      } else {
        return false;
      }
    }
    // 特殊情况：对于 radio / checkbox，许多 UI 组件库（如 Element UI）会设置 opacity: 0，但其父 label 是可见且可交互的
    // 另外：hover 才显示的操作按钮（如 BOSS 简历页的「编辑 / 同步至在线简历」）常态 opacity: 0，
    // 它们占据真实布局、可点击，只是不透明度为 0。此处不再一律判为不可见，
    // 交给下面的 getBoundingClientRect 尺寸判断，避免漏掉这类 hover 按钮。
    if (parseFloat(style.opacity) === 0) {
      if ((el.tagName === 'INPUT' && (el.type === 'radio' || el.type === 'checkbox')) || el.matches?.('input[type="radio"], input[type="checkbox"]')) {
        const parentLabel = el.closest('label');
        if (parentLabel && isElementVisible(parentLabel)) {
          return true;
        }
      }
      const oRect = el.getBoundingClientRect();
      if (oRect.width <= 0 || oRect.height <= 0) {
        return false;
      }
      // 仍然过滤掉祖先整体隐藏（display:none / visibility:hidden）的情况
      const oStyle = window.getComputedStyle(el);
      if (oStyle.display === 'none' || (oStyle.visibility === 'hidden' && !el.__isHoverAction)) {
        return false;
      }
      el.__isHoverAction = true;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      if (el.tagName === 'INPUT' && (el.type === 'radio' || el.type === 'checkbox')) {
        const parentLabel = el.closest('label');
        if (parentLabel) {
          const lRect = parentLabel.getBoundingClientRect();
          if (lRect.width > 0 && lRect.height > 0) return true;
        }
      }
      return false;
    }
    return true;
  }

  /**
   * 判断是否是可交互的目标元素
   */
  function isInteractiveElement(el) {
    if (!isElementVisible(el)) return false;

    const tagName = el.tagName.toLowerCase();
    if (['a', 'button', 'input', 'select', 'textarea', 'option'].includes(tagName)) {
      return true;
    }

    if (tagName === 'label') {
      const hasInput = !!el.querySelector('input, select, textarea');
      const hasFor = !!(el.htmlFor && document.getElementById(el.htmlFor));
      const style = window.getComputedStyle(el);
      if (hasInput || hasFor || style.cursor === 'pointer') {
        return true;
      }
    }

    const role = el.getAttribute('role');
    const interactiveRoles = [
      'button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem',
      'menuitemcheckbox', 'menuitemradio', 'combobox', 'option', 'searchbox', 'textbox'
    ];
    if (role && interactiveRoles.includes(role.toLowerCase())) {
      return true;
    }

    if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
      return true;
    }

    const tabIndex = el.getAttribute('tabindex');
    if (tabIndex !== null && parseInt(tabIndex, 10) >= 0) {
      return true;
    }

    if (el.onclick || el.getAttribute('onclick')) {
      return true;
    }

    const style = window.getComputedStyle(el);
    if (style.cursor === 'pointer') {
      const text = (el.innerText || el.textContent || '').trim();
      const ariaLabel = el.getAttribute('aria-label') || '';
      const title = el.getAttribute('title') || '';
      const cls = el.className && typeof el.className === 'string' ? el.className.toLowerCase() : '';
      const hasActionSemantics = !!(ariaLabel || title || /btn|button|close|icon|send|action|submit|item|tab|switch/i.test(cls));
      const hasIconChild = el.querySelector('svg, i, img') !== null;
      if (el.childElementCount <= 4 && (text.length > 0 || hasActionSemantics || hasIconChild)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 判断元素是否在当前浏览器视口（屏幕可见范围）内
   */
  function isElementInViewport(el) {
    if (!el || !(el instanceof HTMLElement)) return false;
    const rect = el.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const vw = window.innerWidth || document.documentElement.clientWidth;
    return (
      rect.top < vh &&
      rect.bottom > 0 &&
      rect.left < vw &&
      rect.right > 0 &&
      rect.width > 2 &&
      rect.height > 2
    );
  }

  /**
   * 递归遍历收集所有 DOM 元素（穿透 Shadow DOM 与同源 Iframe）
   */
  function collectAllElements(root = document, results = [], depth = 0) {
    if (!root || depth > 10) return results;
    let elements;
    try {
      elements = root.querySelectorAll('*');
    } catch {
      return results;
    }

    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      results.push(el);

      // 递归穿透开放式 Shadow DOM
      if (el.shadowRoot) {
        collectAllElements(el.shadowRoot, results, depth + 1);
      }

      // 递归穿透同源 iframe / frame
      if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') {
        try {
          const doc = el.contentDocument || el.contentWindow?.document;
          if (doc && doc !== root) {
            collectAllElements(doc, results, depth + 1);
          }
        } catch {}
      }
    }
    return results;
  }

  /**
   * 查找当前页面可见的活动弹窗 (Dialog / Modal)
   */
  function findActiveDialog() {
    const dialogSelectors = [
      'dialog[open]',
      '[role="dialog"]:not([aria-hidden="true"])',
      '[role="alertdialog"]:not([aria-hidden="true"])',
      '.el-dialog__wrapper:not([style*="display: none"]) .el-dialog:not([style*="display: none"])',
      '.el-dialog:not([style*="display: none"])',
      '.ant-modal:not([style*="display: none"])',
      '.modal.show',
      '.modal.in',
      '.layui-layer:not([style*="display: none"])',
      '.boss-dialog:not([style*="display: none"])',
      '.dialog-wrap:not([style*="display: none"])',
      '.dialog-container:not([style*="display: none"])',
      '.chat-conversation:not([style*="display: none"])',
      '.arco-modal:not([style*="display: none"])',
      '.arco-drawer:not([style*="display: none"])',
      '.n-modal:not([style*="display: none"])',
      '.n-dialog:not([style*="display: none"])',
      '.t-dialog:not([style*="display: none"])',
      '.ivu-modal:not([style*="display: none"])',
      '[class*="modal-box"]:not([style*="display: none"])',
      '[class*="dialog-box"]:not([style*="display: none"])'
    ];
    for (const sel of dialogSelectors) {
      try {
        const list = document.querySelectorAll(sel);
        for (let i = list.length - 1; i >= 0; i--) {
          const d = list[i];
          if (isElementVisible(d)) {
            return d;
          }
        }
      } catch {}
    }
    return null;
  }

  /**
   * 收集并提取页面的结构化快照（支持视口优先智能降噪、弹窗置顶与 Shadow DOM 穿透）
   */
  function extractSnapshot(options = {}) {
    elementMap.clear();
    snapshotId = crypto.randomUUID();

    const viewportOnly = options.viewport_only !== false; // 默认开启视口过滤
    const maxElements = Math.min(500, Math.max(1, Number(options.max_elements) || 50));

    const activeDialog = findActiveDialog();
    let dialogTitle = '';
    if (activeDialog) {
      const titleEl = activeDialog.querySelector('.el-dialog__title, .ant-modal-title, .arco-modal-title, .dialog-title, .modal-title, .chat-title, .title, [role="heading"], h1, h2, h3, h4, header');
      dialogTitle = titleEl ? (titleEl.innerText || titleEl.textContent || '').trim() : '活动弹窗';
    }

    // 智能悬停扫描：针对卡片/列表容器自动派发轻量 hover 唤醒，
    // 让 React 的 onMouseEnter 自动挂载条件浮层按钮（如 BOSS直聘 .resume-item 的「编辑/添加/同步」）
    const revealHover = options.reveal_hover !== false;
    if (revealHover) {
      try {
        const hoverTargets = document.querySelectorAll(
          '.resume-item, .history-item, .annex-item, .section-item, [class*="resume-"], [class*="section-"], [class*="item-box"], [class*="card"], li, tr'
        );
        const eventOpts = { bubbles: true, cancelable: true, view: window };
        for (const target of hoverTargets) {
          target.dispatchEvent(new PointerEvent('pointerover', eventOpts));
          target.dispatchEvent(new MouseEvent('mouseover', eventOpts));
          target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, cancelable: true, view: window }));
        }
      } catch {}
    }

    const allElements = collectAllElements(document);
    const dialogList = [];
    const inViewportList = [];
    const offscreenList = [];

    allElements.forEach((el) => {
      if (isInteractiveElement(el)) {
        // 避免父子元素重复提取（如果父元素已经是 button/select/label，则避免重复提取其内部非控件子节点）
        // 注意：<a> 不在此列——很多站点的 <a> 只是容器，内部每个 <span> 才是真正的操作按钮
        // （如 BOSS 简历附件行的「预览 / 下载 / 重命名 / 编辑 / 同步至在线简历 / 删除」），
        // 若把 a 也当作父级剪枝，这些子操作就永远抓不到。
        const parent = el.parentElement;
        if (parent && isInteractiveElement(parent) && ['button', 'select', 'label'].includes(parent.tagName.toLowerCase())) {
          return;
        }

        const tagName = el.tagName.toLowerCase();
        const isEditable = el.isContentEditable || el.getAttribute('contenteditable') === 'true';
        let role = el.getAttribute('role') || '';
        let type = el.getAttribute('type') || '';
        const placeholder = (el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || el.getAttribute('aria-placeholder') || '').slice(0, 300);
        const autocomplete = el.getAttribute('autocomplete') || '';
        const ariaLabel = (el.getAttribute('aria-label') || '').slice(0, 300);
        const titleAttr = (el.getAttribute('title') || '').slice(0, 300);
        const name = (el.getAttribute('name') || '').slice(0, 300);
        const href = (el.getAttribute('href') || '').slice(0, 300);
        
        let text = el.matches('input, textarea, select') ? '' : (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
        if (text.length > 80) {
          text = text.substring(0, 80) + '...';
        }

        // 自定义单选/复选框增强：识别 label 或 input[type=radio|checkbox]
        let isRadioOrCheckbox = false;
        let isChecked = false;
        let controlType = '';

        if (tagName === 'label') {
          const innerInput = el.querySelector('input[type="radio"], input[type="checkbox"]');
          if (innerInput) {
            isRadioOrCheckbox = true;
            controlType = innerInput.type.toUpperCase();
            isChecked = innerInput.checked;
          }
        } else if (tagName === 'input' && (type === 'radio' || type === 'checkbox')) {
          isRadioOrCheckbox = true;
          controlType = type.toUpperCase();
          isChecked = el.checked;
          if (!text && el.labels && el.labels.length > 0) {
            text = (el.labels[0].innerText || el.labels[0].textContent || '').trim().replace(/\s+/g, ' ');
          }
        }

        // 剪枝降噪：无文本且无任何有效属性的空 a/div/span/label 节点过滤
        const hasIconOrAction = !!(el.querySelector('svg, img') || role || /btn|button|close|send|icon|action/i.test(el.className && typeof el.className === 'string' ? el.className : ''));
        const hasSemantics = !!(ariaLabel || placeholder || titleAttr || name || (href && href !== '#' && !href.startsWith('javascript:')) || isRadioOrCheckbox || isEditable || hasIconOrAction);
        if (['a', 'div', 'span', 'i', 'p', 'label'].includes(tagName) && !text && !hasSemantics) {
          return;
        }

        const id = nextElementId++;
        elementMap.set(id, el);
        el.setAttribute('data-agent-id', id.toString());

        let value = '';
        const isPassword = type.toLowerCase() === 'password' || 
                           SENSITIVE_REGEX.test(name) || 
                           SENSITIVE_REGEX.test(el.id || '') || 
                           SENSITIVE_REGEX.test(placeholder) || /^(cc-|current-password|new-password|one-time-code)/i.test(autocomplete);

        if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
          if (isPassword) {
            value = el.value ? '••••' : '';
          } else {
            value = el.value || '';
            if (value.length > 50) value = value.substring(0, 50) + '...';
          }
        }

        const inViewport = isElementInViewport(el);

        // 构建单个元素的描述
        let desc = `[${id}] `;
        if (isRadioOrCheckbox) {
          desc += controlType;
          if (isChecked) desc += ' [checked]';
        } else if (isEditable) {
          desc += `EDITABLE(${tagName.toUpperCase()})`;
        } else {
          desc += tagName.toUpperCase();
          if (type) desc += `(type="${type}")`;
        }

        if (el.__isHoverAction) desc += ' [hover]';
        if (role) desc += `(role="${role}")`;
        if (ariaLabel) desc += ` [aria="${ariaLabel}"]`;
        if (titleAttr && titleAttr !== ariaLabel) desc += ` [title="${titleAttr}"]`;
        if (placeholder) desc += ` [placeholder="${placeholder}"]`;
        if (text && text !== placeholder) desc += `: "${text}"`;
        if (value) desc += ` (value="${value}")`;
        if (href && href !== '#' && !href.startsWith('javascript:')) {
          desc += ` (href="${href}")`;
        }
        if (!text && !placeholder && !value) {
          if (el.querySelector('svg, img')) {
            const cls = typeof el.className === 'string' ? el.className : '';
            if (/close/i.test(cls)) desc += ' [icon:close]';
            else if (/send/i.test(cls)) desc += ' [icon:send]';
            else desc += ' [icon]';
          }
        }

        const inDialog = activeDialog && (activeDialog.contains(el) || activeDialog === el);

        if (inDialog) {
          dialogList.push(desc);
        } else if (inViewport) {
          inViewportList.push(desc);
        } else {
          offscreenList.push(desc);
        }
      }
    });

    const scrollY = Math.round(window.scrollY);
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const scrollPercent = Math.min(100, Math.round((scrollY / maxScroll) * 100));

    const totalCount = dialogList.length + inViewportList.length + offscreenList.length;

    const header = [
      `[Snapshot]: ${snapshotId}`,
      `[URL]: ${window.location.href}`,
      `[Title]: ${document.title}`,
      `[Scroll]: 垂直位置 ${scrollY}px (滚动进度约 ${scrollPercent}%)`,
      `[Elements]: ${activeDialog ? `弹窗内 ${dialogList.length} 个 / ` : ''}视口内 ${inViewportList.length} 个 / 全页共 ${totalCount} 个 (当前模式: ${viewportOnly ? '视口优先瘦身' : '全页完整模式'})`,
      '------------------------------------------------------------'
    ].join('\n');

    let contentOutput = '';

    if (activeDialog && dialogList.length > 0) {
      contentOutput += `=== 【当前活动弹窗: ${dialogTitle}】 ===\n` + dialogList.join('\n') + '\n\n';
      contentOutput += `=== 【底层遮罩页面 (操作受限)】 ===\n`;
    }

    if (viewportOnly) {
      const remainingLimit = Math.max(10, maxElements - dialogList.length);
      const displayList = inViewportList.slice(0, remainingLimit);
      contentOutput += displayList.length > 0 
        ? displayList.join('\n') 
        : '(当前屏幕视口内未检测到额外可交互元素)';

      if (offscreenList.length > 0) {
        contentOutput += `\n\n>>> [Token 瘦身提示]: 屏幕外仍有 ${offscreenList.length} 个元素已省略。如需操作下方内容，请调用 browser_scroll 向下滚动，或在 browser_snapshot 中传入 viewport_only: false。`;
      }
    } else {
      contentOutput += (inViewportList.length > 0 ? inViewportList.slice(0, maxElements).join('\n') : '(无)') +
        `\n\n=== 【屏幕外滚动可见元素】 ===\n` + 
        (offscreenList.length > 0 ? offscreenList.slice(0, Math.max(0, maxElements - inViewportList.length - dialogList.length)).join('\n') : '(无)');
    }

    return header + '\n' + contentOutput;
  }

  /**
   * 执行点击操作
   */
  function resolveElement(id, expectedSnapshot) {
    if (expectedSnapshot && expectedSnapshot !== snapshotId) throw new Error('快照已过期，请重新获取');
    const el = elementMap.get(Number(id));
    if (!el || !el.isConnected || !isElementVisible(el)) throw new Error('元素已失效，请重新获取快照');
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') throw new Error('元素不可用');
    return el;
  }

  function executeClick(id, expectedSnapshot) {
    const el = elementMap.get(Number(id));
    if (!el) {
      return { success: false, error: `未找到 ID 为 [${id}] 的元素，请先调用 browser_snapshot 获取最新元素列表。` };
    }

    try {
      resolveElement(id, expectedSnapshot);
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      el.focus();

      // 联动处理自定义单选/复选框（如果点击的是 label 且内部包裹了 radio/checkbox）
      if (el.tagName === 'LABEL') {
        const innerInput = el.querySelector('input[type="radio"], input[type="checkbox"]');
        if (innerInput && !innerInput.disabled) {
          innerInput.focus();
          if (innerInput.type === 'radio') {
            innerInput.checked = true;
          } else {
            innerInput.checked = !innerInput.checked;
          }
          innerInput.dispatchEvent(new Event('input', { bubbles: true }));
          innerInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }

      // 派发标准鼠标事件序列
      const rect = el.getBoundingClientRect();
      const clientX = rect.left + rect.width / 2;
      const clientY = rect.top + rect.height / 2;
      const eventOpts = { bubbles: true, cancelable: true, view: window, clientX, clientY };

      // 先补一条 hover 事件链：很多站点（如 BOSS 简历页）的操作按钮只有在父级 hover 后
      // 才挂上事件处理器或被移到可点击层，直接派发 click 会「点了没反应」。
      try {
        let hoverNode = el;
        for (let depth = 0; hoverNode && depth < 4; depth++) {
          hoverNode.dispatchEvent(new PointerEvent('pointerover', eventOpts));
          hoverNode.dispatchEvent(new MouseEvent('mouseover', eventOpts));
          hoverNode.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, cancelable: true, view: window, clientX, clientY }));
          hoverNode.dispatchEvent(new MouseEvent('mousemove', eventOpts));
          hoverNode = hoverNode.parentElement;
        }
      } catch {}

      el.dispatchEvent(new PointerEvent('pointerdown', eventOpts));
      el.dispatchEvent(new MouseEvent('mousedown', eventOpts));
      el.dispatchEvent(new PointerEvent('pointerup', eventOpts));
      el.dispatchEvent(new MouseEvent('mouseup', eventOpts));
      el.dispatchEvent(new MouseEvent('click', eventOpts));

      return { success: true, message: `已成功点击元素 [${id}] (${el.tagName})` };
    } catch (err) {
      return { success: false, error: `点击元素 [${id}] 失败: ${err.message}` };
    }
  }

  /**
   * 执行鼠标悬停 (Hover) 操作
   */
  function executeHover(payload, expectedSnapshot) {
    let el = null;
    let id = payload?.element_id ?? (typeof payload === 'number' ? payload : payload?.id);
    let selector = payload?.selector;
    let text = payload?.text;

    if (id !== undefined && id !== null) {
      if (expectedSnapshot && expectedSnapshot !== snapshotId) {
        return { success: false, error: '快照已过期，请重新获取' };
      }
      el = elementMap.get(Number(id));
      if (!el) {
        return { success: false, error: `未找到 ID 为 [${id}] 的元素，请先调用 browser_snapshot 获取最新元素列表。` };
      }
    } else if (selector) {
      el = document.querySelector(selector);
      if (!el) {
        return { success: false, error: `未通过选择器 "${selector}" 找到目标元素` };
      }
    } else if (text) {
      // 通过包含文本模糊查找卡片或区块
      const all = document.querySelectorAll('*');
      for (const node of all) {
        if ((node.innerText || node.textContent || '').includes(text) && node.childElementCount <= 10) {
          el = node;
          break;
        }
      }
      if (!el) {
        return { success: false, error: `未找到包含文本 "${text}" 的目标元素` };
      }
    } else {
      return { success: false, error: '请提供 element_id、selector 或 text 参数' };
    }

    try {
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      const rect = el.getBoundingClientRect();
      const clientX = rect.left + rect.width / 2;
      const clientY = rect.top + rect.height / 2;
      const eventOpts = { bubbles: true, cancelable: true, view: window, clientX, clientY };

      // 向上派发至多 4 层父级 hover，再聚焦并派发目标节点的完整指针/鼠标 hover 事件链
      try {
        let hoverNode = el;
        for (let depth = 0; hoverNode && depth < 4; depth++) {
          hoverNode.dispatchEvent(new PointerEvent('pointerover', eventOpts));
          hoverNode.dispatchEvent(new MouseEvent('mouseover', eventOpts));
          hoverNode.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, cancelable: true, view: window, clientX, clientY }));
          hoverNode.dispatchEvent(new MouseEvent('mousemove', eventOpts));
          hoverNode = hoverNode.parentElement;
        }
      } catch {}

      el.dispatchEvent(new PointerEvent('pointerover', eventOpts));
      el.dispatchEvent(new MouseEvent('mouseover', eventOpts));
      el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, cancelable: true, view: window, clientX, clientY }));
      el.dispatchEvent(new PointerEvent('pointermove', eventOpts));
      el.dispatchEvent(new MouseEvent('mousemove', eventOpts));

      const tagName = el.tagName;
      const label = (el.innerText || el.textContent || '').trim().slice(0, 30);
      return {
        success: true,
        message: `已将鼠标悬停在元素 ${tagName} [${label ? `"${label}"` : (id || selector)}] 上，已成功触发 hover 响应`
      };
    } catch (err) {
      return { success: false, error: `悬停失败: ${err.message}` };
    }
  }

  /**
   * 执行输入操作
   */
  function executeType(id, text, clearFirst = true, expectedSnapshot) {
    const el = elementMap.get(Number(id));
    if (!el) {
      return { success: false, error: `未找到 ID 为 [${id}] 的输入元素。` };
    }

    try {
      resolveElement(id, expectedSnapshot);
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      el.focus();

      if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
        // 富文本编辑器（Quill, WangEditor, Slate, ProseMirror, UEditor 等）
        // 关键防护 1: 避免 el.textContent = '' 彻底摧毁编辑器的段落结构（如 Quill 必须依赖内部的 <p><br></p>）
        if (clearFirst) {
          try {
            const sel = window.getSelection();
            if (sel) {
              const range = document.createRange();
              range.selectNodeContents(el);
              sel.removeAllRanges();
              sel.addRange(range);
              document.execCommand('delete', false, null);
            }
          } catch {}
          // 兜底：如果选区删除后完全变空（没有子节点），为富文本结构恢复段落占位，防止 Delta/AST 崩溃
          if (!el.firstElementChild) {
            const p = document.createElement('p');
            p.appendChild(document.createElement('br'));
            el.appendChild(p);
          }
        }

        // 关键防护 2: 将光标定位到段落内部，确保 document.execCommand 在段落容器内执行
        let targetBlock = el.querySelector('p, div') || el;
        try {
          const sel = window.getSelection();
          if (sel) {
            const range = document.createRange();
            range.selectNodeContents(targetBlock);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
          }
        } catch {}

        let inserted = false;
        try {
          inserted = document.execCommand('insertText', false, text);
        } catch {}

        // 尝试通过编辑器挂载实例同步（如 Quill / WangEditor）
        try {
          const quillInst = el.__quill || el.closest('.ql-container')?.__quill || window.Quill?.find?.(el);
          if (quillInst && typeof quillInst.setText === 'function') {
            if (clearFirst) {
              quillInst.setText(text);
            } else {
              const len = quillInst.getLength();
              quillInst.insertText(Math.max(0, len - 1), text);
            }
            inserted = true;
          }
        } catch {}

        if (!inserted) {
          // 降级兜底：在保持段落或直接内容填充的同时，确保 JSDOM 和常规 contenteditable 都包含文本
          try {
            if (targetBlock && targetBlock !== el) {
              const br = targetBlock.querySelector('br');
              if (br) br.remove();
              targetBlock.textContent = (clearFirst ? '' : (targetBlock.textContent || '')) + text;
            }
          } catch {}
          if (!el.textContent || !el.textContent.includes(text)) {
            el.textContent = (clearFirst ? '' : (el.textContent || '')) + text;
          }
          if (el.innerText !== undefined && (!el.innerText || !el.innerText.includes(text))) {
            el.innerText = (clearFirst ? '' : (el.innerText || '')) + text;
          }
        }

        // 关键防护 3: 派发全套事件链 (beforeinput, input, keydown, keypress, keyup, change)
        // 确保 BOSS直聘、各类在线表单的「字数统计: 0 / 1000」或前端框架的 watch 侦听到更新
        const keyOpts = { key: text.slice(-1) || 'a', code: 'KeyA', bubbles: true, cancelable: true, view: window };
        try {
          el.dispatchEvent(new KeyboardEvent('keydown', keyOpts));
          el.dispatchEvent(new KeyboardEvent('keypress', keyOpts));
        } catch {}

        try {
          el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
        } catch {}
        try {
          el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
        } catch {}
        el.dispatchEvent(new Event('input', { bubbles: true }));

        try {
          el.dispatchEvent(new KeyboardEvent('keyup', keyOpts));
        } catch {}
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else if ('value' in el) {
        if (clearFirst) {
          el.value = '';
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
        
        // 兼容 React 等劫持 value 属性的前端框架
        const prototype = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
          : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

        const targetValue = (clearFirst ? '' : el.value) + text;

        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(el, targetValue);
        } else {
          el.value = targetValue;
        }

        const keyOpts = { key: text.slice(-1) || 'a', code: 'KeyA', bubbles: true, cancelable: true, view: window };
        try {
          el.dispatchEvent(new KeyboardEvent('keydown', keyOpts));
          el.dispatchEvent(new KeyboardEvent('keypress', keyOpts));
        } catch {}

        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
        el.dispatchEvent(new Event('input', { bubbles: true }));

        try {
          el.dispatchEvent(new KeyboardEvent('keyup', keyOpts));
        } catch {}
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        return { success: false, error: "目标元素不可输入" };
      }

      return { success: true, message: `已填写元素 [${id}]` };
    } catch (err) {
      return { success: false, error: `输入失败: ${err.message}` };
    }
  }

  /**
   * 执行键盘按键
   */
  function executePress(key) {
    try {
      const activeEl = document.activeElement || document.body;
      const opts = { key, code: key, bubbles: true, cancelable: true, view: window };
      
      activeEl.dispatchEvent(new KeyboardEvent('keydown', opts));
      activeEl.dispatchEvent(new KeyboardEvent('keypress', opts));
      activeEl.dispatchEvent(new KeyboardEvent('keyup', opts));

      if (key === 'Enter' && activeEl.tagName === 'INPUT') {
        const form = activeEl.form;
        if (form) {
          form.requestSubmit();
        }
      }

      return { success: true, message: `已派发按键事件: ${key}（合成事件，不保证浏览器默认行为）` };
    } catch (err) {
      return { success: false, error: `按键失败: ${err.message}` };
    }
  }

  /**
   * 页面滚动
   */
  function executeScroll(direction = 'down', amount = 500) {
    try {
      let deltaY = 0;
      if (direction === 'down') deltaY = amount;
      else if (direction === 'up') deltaY = -amount;
      else if (direction === 'top') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return { success: true, message: '已滚动到页面顶部' };
      } else if (direction === 'bottom') {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        return { success: true, message: '已滚动到页面底部' };
      }

      window.scrollBy({ top: deltaY, left: 0, behavior: 'smooth' });
      return { success: true, message: `已向 ${direction} 滚动 ${amount}px` };
    } catch (err) {
      return { success: false, error: `滚动失败: ${err.message}` };
    }
  }

  /**
   * 提取页面或元素文本
   */
  function executeGetText(id, expectedSnapshot) {
    if (id !== undefined && id !== null) {
      if (expectedSnapshot && expectedSnapshot !== snapshotId) return { success: false, error: '快照已过期' };
      const el = elementMap.get(Number(id));
      if (!el || !el.isConnected) return { success: false, error: `未找到 ID 为 [${id}] 的元素` };
      if (el.matches('input, textarea, select, [contenteditable]')) return { success: true, text: '[表单内容已隐藏]' };
      return { success: true, text: (el.innerText || el.textContent || '').slice(0, 20000) };
    }
    
    // 默认返回当前划选文本或正文主体
    const selection = window.getSelection()?.toString().trim();
    if (selection) {
      return { success: true, text: `[用户划选文本]:\n${selection}` };
    }
    const body = document.body.cloneNode(true);
    body.querySelectorAll('input, textarea, select, [contenteditable], script, style').forEach(el => el.remove());
    return { success: true, text: (body.textContent || '').slice(0, 20000) };
  }

  /**
   * 智能条件等待（支持选择器、文本内容与状态检测）
   */
  function executeWaitFor(options = {}) {
    const selector = options.selector;
    const text = options.text;
    const state = options.state || 'visible';
    const timeoutMs = Math.max(100, Math.min(60000, (Number(options.timeout_seconds) || 10) * 1000));

    return new Promise((resolve) => {
      const startTime = Date.now();

      function check() {
        if (selector) {
          const el = document.querySelector(selector);
          const isVis = el ? isElementVisible(el) : false;
          return state === 'visible' ? isVis : !isVis;
        }
        if (text) {
          const bodyText = (document.body?.innerText || document.body?.textContent || '');
          const hasText = bodyText.includes(text);
          return state === 'visible' ? hasText : !hasText;
        }
        return true;
      }

      if (check()) {
        resolve({ success: true, message: `条件已满足 (耗时 ${Date.now() - startTime}ms)` });
        return;
      }

      let observer = null;
      let timer = null;
      let interval = null;

      function cleanup() {
        if (observer) observer.disconnect();
        if (timer) clearTimeout(timer);
        if (interval) clearInterval(interval);
      }

      timer = setTimeout(() => {
        cleanup();
        resolve({
          success: false,
          error: `等待超时 (${timeoutMs / 1000}s): 目标未达到预期状态 [selector=${selector || ''}, text=${text || ''}, state=${state}]`
        });
      }, timeoutMs);

      const onMutation = () => {
        if (check()) {
          const elapsed = Date.now() - startTime;
          cleanup();
          resolve({ success: true, message: `条件已满足 (耗时 ${elapsed}ms)` });
        }
      };

      try {
        if (typeof MutationObserver !== 'undefined') {
          observer = new MutationObserver(onMutation);
          observer.observe(document.documentElement || document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true
          });
        }
      } catch (e) {}

      interval = setInterval(onMutation, 100);
    });
  }

  /**
   * 执行文件上传注入（通过 HTML5 DataTransfer 与 File API，免弹窗全自动）
   */
  function executeUploadFile(payload) {
    const { id, filename, mimeType, base64, snapshot_id } = payload;
    try {
      if (!base64 || !filename) {
        return { success: false, error: '缺少文件数据或文件名' };
      }

      // 1. 将 base64 解码为 Uint8Array
      let binaryString;
      if (typeof atob === 'function') {
        binaryString = atob(base64);
      } else if (typeof Buffer !== 'undefined') {
        binaryString = Buffer.from(base64, 'base64').toString('binary');
      } else {
        binaryString = '';
      }
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // 2. 构造原生 DOM File 对象与 DataTransfer
      const FileConstructor = typeof File !== 'undefined' ? File : (typeof window !== 'undefined' && window.File ? window.File : null);
      let file;
      if (FileConstructor) {
        try {
          file = new FileConstructor([bytes], filename, { type: mimeType || 'application/octet-stream' });
        } catch {
          file = { name: filename, size: bytes.length, type: mimeType || 'application/octet-stream' };
        }
      } else {
        file = { name: filename, size: bytes.length, type: mimeType || 'application/octet-stream' };
      }

      const DTConstructor = typeof DataTransfer !== 'undefined' ? DataTransfer : (typeof window !== 'undefined' && window.DataTransfer ? window.DataTransfer : null);
      const dt = DTConstructor ? new DTConstructor() : { items: { add: () => {} }, files: [file] };
      if (dt.items && typeof dt.items.add === 'function') {
        try { dt.items.add(file); } catch {}
      }

      // 3. 定位目标 input[type="file"]
      let targetInput = null;
      let targetContainer = null;

      if (id !== undefined && id !== null) {
        const el = elementMap.get(Number(id));
        if (el) {
          targetContainer = el;
          if (el.tagName === 'INPUT' && el.type === 'file') {
            targetInput = el;
          } else {
            // 在指定元素内部、父级容器内部或相邻区域智能查找 input[type="file"]
            targetInput = el.querySelector('input[type="file"]') ||
                          el.closest('.el-upload, .upload, .ant-upload, form, div')?.querySelector('input[type="file"]');
          }
        }
      }

      // 降级兜底：查找当前活动弹窗内或整个页面中的 input[type="file"]
      if (!targetInput) {
        const activeDialog = findActiveDialog();
        if (activeDialog) {
          targetInput = activeDialog.querySelector('input[type="file"]');
        }
      }
      if (!targetInput) {
        targetInput = document.querySelector('input[type="file"]');
      }

      if (!targetInput) {
        // 如果页面未采用原生 input[type=file]，尝试直接派发 drop 事件到容器元素
        if (targetContainer) {
          targetContainer.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: dt }));
          targetContainer.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
          targetContainer.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
          return { success: true, message: `已派发拖拽 Drop 事件将文件 [${filename}] 注入目标元素` };
        }
        return { success: false, error: '未在页面中找到可接收文件的 input[type="file"] 或目标容器' };
      }

      // 4. 将文件赋予 input.files 并触发标准事件
      try {
        targetInput.files = dt.files;
      } catch {
        try {
          Object.defineProperty(targetInput, 'files', {
            value: dt.files,
            writable: true,
            configurable: true
          });
        } catch {}
      }
      targetInput.dispatchEvent(new Event('input', { bubbles: true }));
      targetInput.dispatchEvent(new Event('change', { bubbles: true }));

      // 5. 如果旁边有用于展示文件名的只读文本框（如常见表单结构），协助更新展示
      const parentForm = targetInput.closest('.el-dialog, form, .el-upload, div');
      if (parentForm) {
        const textInputs = parentForm.querySelectorAll('input[type="text"]');
        for (const ti of textInputs) {
          if (ti.disabled || ti.readOnly || ti.placeholder?.includes('选择') || ti.placeholder?.includes('文件')) {
            ti.value = filename;
            ti.dispatchEvent(new Event('input', { bubbles: true }));
            ti.dispatchEvent(new Event('change', { bubbles: true }));
            break;
          }
        }
      }

      return { success: true, message: `已成功注入文件 [${filename}] (${(len / 1024).toFixed(1)} KB) 并触发上传响应` };
    } catch (err) {
      return { success: false, error: `文件上传注入失败: ${err.message}` };
    }
  }

  // 监听来自网络嗅探器 (network-interceptor.js) 的动态请求日志
  const networkLogs = [];
  const MAX_STORED_LOGS = 100;
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === '__BROWSER_AGENT_NETWORK_LOG__' && event.data.entry) {
      networkLogs.push(event.data.entry);
      if (networkLogs.length > MAX_STORED_LOGS) {
        networkLogs.shift();
      }
    }
  });

  /**
   * 批量表单填充
   */
  function executeFillForm(fields, snapshot_id) {
    if (!Array.isArray(fields) || fields.length === 0) {
      return { success: false, error: 'fields 必须是非空数组' };
    }
    const results = [];
    let successCount = 0;
    for (const item of fields) {
      const id = item.element_id ?? item.id;
      const text = item.value ?? item.text ?? '';
      const clearFirst = item.clear_first !== false;
      const res = executeType(id, String(text), clearFirst, snapshot_id);
      results.push({
        element_id: id,
        success: res.success,
        error: res.error || null
      });
      if (res.success) successCount++;
    }
    return {
      success: successCount > 0,
      filled_count: successCount,
      total_fields: fields.length,
      results,
      message: `已批量填写 ${successCount}/${fields.length} 个字段`
    };
  }

  /**
   * 获取捕获的动态网络请求日志
   */
  function executeGetNetworkLogs(options = {}) {
    const { url_pattern, method, status_code, limit = 20 } = options;
    let list = [...networkLogs];
    if (url_pattern && typeof url_pattern === 'string') {
      const pat = url_pattern.toLowerCase();
      list = list.filter(item => item.url && item.url.toLowerCase().includes(pat));
    }
    if (method && typeof method === 'string') {
      const m = method.toUpperCase();
      list = list.filter(item => item.method === m);
    }
    if (status_code !== undefined && status_code !== null) {
      const code = Number(status_code);
      list = list.filter(item => item.status === code);
    }
    const max = Math.min(100, Math.max(1, Number(limit) || 20));
    // 返回最新请求列表（按时间倒序）
    const sliced = list.slice(-max).reverse();
    return {
      success: true,
      total_captured: networkLogs.length,
      filtered_count: sliced.length,
      logs: sliced
    };
  }

  // 划选监听，自动通知 background/sidepanel
  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection()?.toString().trim();
    if (sel && sel.length > 0) {
      chrome.runtime.sendMessage({ type: 'SELECTION_CHANGED', text: sel }).catch(() => {});
    }
  });

  // 监听来自 Background Service Worker 的指令
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const { action, payload } = request;

    switch (action) {
      case 'PING': {
        sendResponse({ success: true });
        break;
      }
      case 'SNAPSHOT': {
        const snapshot = extractSnapshot(payload || {});
        sendResponse({ success: true, data: snapshot });
        break;
      }
      case 'CLICK': {
        const res = executeClick(payload.id, payload.snapshot_id);
        sendResponse(res);
        break;
      }
      case 'HOVER': {
        const res = executeHover(payload, payload?.snapshot_id);
        sendResponse(res);
        break;
      }
      case 'TYPE': {
        const res = executeType(payload.id, payload.text, payload.clearFirst, payload.snapshot_id);
        sendResponse(res);
        break;
      }
      case 'PRESS': {
        const res = executePress(payload.key);
        sendResponse(res);
        break;
      }
      case 'SCROLL': {
        const res = executeScroll(payload.direction, payload.amount);
        sendResponse(res);
        break;
      }
      case 'GET_TEXT': {
        const res = executeGetText(payload?.id, payload?.snapshot_id);
        sendResponse(res);
        break;
      }
      case 'WAIT_FOR': {
        executeWaitFor(payload || {}).then(res => sendResponse(res));
        break;
      }
      case 'UPLOAD_FILE': {
        const res = executeUploadFile(payload || {});
        sendResponse(res);
        break;
      }
      case 'GET_STORAGE': {
        try {
          const type = payload?.type || 'all';
          const keys = Array.isArray(payload?.keys) ? payload.keys : null;
          const result = {};
          if (type === 'all' || type === 'local') {
            const local = {};
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i);
              if (k && (!keys || keys.includes(k))) {
                local[k] = localStorage.getItem(k);
              }
            }
            result.localStorage = local;
          }
          if (type === 'all' || type === 'session') {
            const session = {};
            for (let i = 0; i < sessionStorage.length; i++) {
              const k = sessionStorage.key(i);
              if (k && (!keys || keys.includes(k))) {
                session[k] = sessionStorage.getItem(k);
              }
            }
            result.sessionStorage = session;
          }
          sendResponse({ success: true, data: result });
        } catch (e) {
          sendResponse({ success: false, error: `获取存储失败: ${e.message}` });
        }
        break;
      }
      case 'EVALUATE': {
        try {
          const expr = payload?.expression;
          if (typeof expr !== 'string' || !expr.trim()) {
            sendResponse({ success: false, error: '未提供可执行的 JS 表达式' });
            break;
          }
          // 注意：content script 运行在隔离世界，裸 eval 不受页面 CSP 限制；
          // 而 window.eval 会被页面的 script-src 拦截（BOSS 等站点常见）。
          // 因此优先用裸 eval，失败再退回 window.eval。
          let evalResult;
          let evalError = null;
          try {
            // eslint-disable-next-line no-eval
            evalResult = eval(expr);
          } catch (e1) {
            try {
              evalResult = window.eval(expr);
            } catch (e2) {
              evalError = e2;
            }
          }
          if (evalError) throw evalError;
          let serialized;
          if (evalResult === undefined) {
            serialized = 'undefined';
          } else if (typeof evalResult === 'function') {
            serialized = evalResult.toString();
          } else {
            try {
              serialized = JSON.parse(JSON.stringify(evalResult));
            } catch {
              serialized = String(evalResult);
            }
          }
          sendResponse({ success: true, data: serialized, result: serialized });
        } catch (e) {
          sendResponse({ success: false, error: `执行表达式错误: ${e.message}` });
        }
        break;
      }
      case 'FILL_FORM': {
        const res = executeFillForm(payload?.fields || [], payload?.snapshot_id);
        sendResponse(res);
        break;
      }
      case 'GET_NETWORK_LOGS': {
        const res = executeGetNetworkLogs(payload || {});
        sendResponse(res);
        break;
      }
      default:
        sendResponse({ success: false, error: `未知的 Action: ${action}` });
    }

    return true; // 保持异步消息通道开启
  });
})();
