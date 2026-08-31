// content.js - Browser Agent Content Script
(function () {
  if (window.__BROWSER_AGENT_INITIALIZED__) return;
  window.__BROWSER_AGENT_INITIALIZED__ = true;

  console.log('[BrowserAgent] Content script injected.');

  // DOM 元素缓存表：ID -> HTMLElement
  const elementMap = new Map();
  let nextElementId = 1;

  // 敏感字段检测正则
  const SENSITIVE_REGEX = /password|pwd|cvv|cvc|cardnumber|creditcard|secret|token/i;

  /**
   * 判断元素是否在页面上真实可见
   */
  function isElementVisible(el) {
    if (!el || !(el instanceof HTMLElement)) return false;
    if (el.offsetParent === null && el.tagName !== 'BODY' && getComputedStyle(el).position !== 'fixed') {
      return false;
    }
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
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
    if (style.cursor === 'pointer' && el.childElementCount <= 2 && el.innerText.trim().length > 0) {
      return true;
    }

    return false;
  }

  /**
   * 收集并提取页面的结构化快照
   */
  function extractSnapshot() {
    elementMap.clear();
    nextElementId = 1;

    const allElements = document.querySelectorAll('*');
    const interactiveList = [];

    allElements.forEach((el) => {
      if (isInteractiveElement(el)) {
        // 避免父子元素重复提取（如果父元素已经是 button 且子元素只是 span，则只提取父元素）
        const parent = el.parentElement;
        if (parent && isInteractiveElement(parent) && ['button', 'a', 'select'].includes(parent.tagName.toLowerCase())) {
          return;
        }

        const id = nextElementId++;
        elementMap.set(id, el);
        el.setAttribute('data-agent-id', id.toString());

        const tagName = el.tagName.toLowerCase();
        const role = el.getAttribute('role') || '';
        const type = el.getAttribute('type') || '';
        const placeholder = el.getAttribute('placeholder') || '';
        const ariaLabel = el.getAttribute('aria-label') || '';
        const name = el.getAttribute('name') || '';
        const href = el.getAttribute('href') || '';
        
        let text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
        if (text.length > 80) {
          text = text.substring(0, 80) + '...';
        }

        let value = '';
        const isPassword = type.toLowerCase() === 'password' || 
                           SENSITIVE_REGEX.test(name) || 
                           SENSITIVE_REGEX.test(el.id || '') || 
                           SENSITIVE_REGEX.test(placeholder);

        if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
          if (isPassword) {
            value = el.value ? '••••' : '';
          } else {
            value = el.value || '';
            if (value.length > 50) value = value.substring(0, 50) + '...';
          }
        }

        // 构建单个元素的描述
        let desc = `[${id}] ${tagName.toUpperCase()}`;
        if (type) desc += `(type="${type}")`;
        if (role) desc += `(role="${role}")`;
        if (ariaLabel) desc += ` [aria="${ariaLabel}"]`;
        if (placeholder) desc += ` [placeholder="${placeholder}"]`;
        if (text && text !== placeholder) desc += `: "${text}"`;
        if (value) desc += ` (value="${value}")`;
        if (href && href !== '#' && !href.startsWith('javascript:')) {
          desc += ` (href="${href}")`;
        }

        interactiveList.push(desc);
      }
    });

    const header = [
      `[URL]: ${window.location.href}`,
      `[Title]: ${document.title}`,
      `[Interactive Elements Count]: ${interactiveList.length}`,
      '------------------------------------------------------------'
    ].join('\n');

    return header + '\n' + (interactiveList.length > 0 ? interactiveList.join('\n') : '(当前页面未检测到可交互元素)');
  }

  /**
   * 执行点击操作
   */
  function executeClick(id) {
    const el = elementMap.get(Number(id));
    if (!el) {
      return { success: false, error: `未找到 ID 为 [${id}] 的元素，请先调用 browser_snapshot 获取最新元素列表。` };
    }

    try {
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      el.focus();

      // 派发标准鼠标事件序列
      const rect = el.getBoundingClientRect();
      const clientX = rect.left + rect.width / 2;
      const clientY = rect.top + rect.height / 2;
      const eventOpts = { bubbles: true, cancelable: true, view: window, clientX, clientY };

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
   * 执行输入操作
   */
  function executeType(id, text, clearFirst = true) {
    const el = elementMap.get(Number(id));
    if (!el) {
      return { success: false, error: `未找到 ID 为 [${id}] 的输入元素。` };
    }

    try {
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      el.focus();

      if (el.isContentEditable) {
        if (clearFirst) el.innerText = '';
        el.innerText += text;
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      } else if ('value' in el) {
        if (clearFirst) {
          el.value = '';
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
        
        // 兼容 React 等劫持 value 属性的前端框架
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value'
        )?.set || Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          'value'
        )?.set;

        const targetValue = (clearFirst ? '' : el.value) + text;

        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(el, targetValue);
        } else {
          el.value = targetValue;
        }

        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }

      return { success: true, message: `已在元素 [${id}] 输入内容: "${text}"` };
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
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        }
      }

      return { success: true, message: `已触发按键: ${key}` };
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
  function executeGetText(id) {
    if (id !== undefined && id !== null) {
      const el = elementMap.get(Number(id));
      if (!el) return { success: false, error: `未找到 ID 为 [${id}] 的元素` };
      return { success: true, text: el.innerText || el.textContent || '' };
    }
    
    // 默认返回当前划选文本或正文主体
    const selection = window.getSelection()?.toString().trim();
    if (selection) {
      return { success: true, text: `[用户划选文本]:\n${selection}` };
    }
    return { success: true, text: document.body.innerText || '' };
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
      case 'SNAPSHOT': {
        const snapshot = extractSnapshot();
        sendResponse({ success: true, data: snapshot });
        break;
      }
      case 'CLICK': {
        const res = executeClick(payload.id);
        sendResponse(res);
        break;
      }
      case 'TYPE': {
        const res = executeType(payload.id, payload.text, payload.clearFirst);
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
        const res = executeGetText(payload?.id);
        sendResponse(res);
        break;
      }
      default:
        sendResponse({ success: false, error: `未知的 Action: ${action}` });
    }

    return true; // 保持异步消息通道开启
  });
})();
