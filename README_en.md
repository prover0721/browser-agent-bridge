<div align="center">

# 🌐 Browser Agent Bridge

[![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)](https://github.com/prover0721/browser-agent-bridge)
[![Node](https://img.shields.io/badge/node-%3E%3D20.19-brightgreen.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

[简体中文](./README.md) | **English**

</div>

Connect AI Agents (Antigravity, ChatGPT/Codex, Claude Code, Cursor, etc.) to your active Chrome/Edge browser via a local Model Context Protocol (MCP) server and Manifest V3 extension. Enables low-latency, zero-screenshot browser automation, full-page DOM inspection, automated file uploading, and authenticated session reuse.

## Requirements

- Chrome / Edge version 116 or later.
- Node.js 20.19+ (20.x), 22.13+ (22.x), or 24+; Node.js 24 LTS recommended.
- Any AI agent or client supporting stdio MCP (Antigravity, ChatGPT Codex, Claude Code, Cursor, Windsurf, Cline, etc.).

## Installation & Setup

1. Clone the repository and build the bridge server:

   ```bash
   cd bridge-server
   npm ci
   npm run build
   ```

2. Open `edge://extensions/` or `chrome://extensions/`, enable **Developer mode**, and click **Load unpacked**. Select the `browser-extension` directory.

3. Add the bridge server to your agent's MCP configuration (e.g. `antigravity_mcp_config.json`, `~/.codex/config.toml`, or Cursor settings):

   ```json
   {
     "mcpServers": {
       "browser_bridge": {
         "command": "node",
         "args": ["C:/path/to/browser-agent-bridge/bridge-server/dist/index.js"],
         "env": { "BRIDGE_PORT": "3088" }
       }
     }
   }
   ```

4. Start your MCP client or run the background script (`一键启动服务(后台静默).vbs`). Open Edge or Chrome. The extension automatically connects to the local bridge on `ws://127.0.0.1:3088/ws` with zero token pairing required. Multiple agent processes automatically connect through the shared Master/Relay architecture.

## Available Tools & API

| Tool | Purpose |
| --- | --- |
| `browser_get_active_tab` / `browser_list_tabs` | Inspect controlled tab state / list all open browser tabs |
| `browser_create_window` / `browser_close_window` | Create / close a dedicated background AI workspace window |
| `browser_create_tab` / `browser_close_tab` | Create / close a browser tab |
| `browser_bind_tab` / `browser_unbind_tab` | Pin / unpin session commands to a specific target tab |
| `browser_switch_tab` | Switch controlled tab silently; set `focused: true` to reveal |
| `browser_snapshot` | Extract structured DOM interactive elements with IDs and Snapshot ID (In-viewport pruning, modal prioritization, `ignore_dialog: true` bypass, and `diff_only: true` incremental snapshot) |
| `browser_click` | **【v2.0+ Recommended】Click Element (by ID/Text/Selector & CDP Trusted)**: Clicks target elements by `element_id`, text (`text: "Edit"`), or CSS selector (`selector`); supports `trusted: true` native CDP events and `humanlike: true` delay; returns immediate action feedback (Toast/validation errors/navigation) |
| `browser_type` | **【v2.0+ Recommended】Type Input (with Trusted CDP & Readonly Unlock)**: Types into target elements; supports `trusted: true` native CDP keystrokes, automatic readonly datepicker unlocking, and immediate action feedback |
| `browser_hover` | **【v1.9.3+ Recommended】Mouse Hover Action**: Hovers over elements or cards to trigger React/Vue conditional hover buttons (e.g. BOSS Zhipin "Edit", "Add", "Sync") |
| `browser_press` / `browser_scroll` | Dispatch keyboard keys / scroll page with pixel and percentage progression |
| `browser_drag` | **【v2.0+ Recommended】Humanized Drag & Slider Captcha Bypass**: Simulates hand-drawn ease-out cubic speed curve and micro-jitter, specifically built to conquer Aliyun WAF, 51job, YingJieSheng, and Geetest slide verification ("请按住滑块，拖动到最右边") via CDP hardware-level trusted input |
| `browser_screenshot` | **【v2.0+ Recommended】Targeted Visual Screenshot & Crop**: Captures viewport image, supporting targeted cropping of elements (CAPTCHAs, charts) by `element_id` or `selector` |
| `browser_set_guard` | **【v2.0+ Recommended】Navigation Security Guardrail**: Enforces domain allowlists (`domain_lock: ["*.zhipin.com", "yingjiesheng.com"]`) to block unexpected navigation and phishing |
| `browser_navigate` | Navigate current or designated tab to a target URL (protected by security guardrails) |
| `browser_get_text` | Extract element text, selected text, or page body text (up to 20,000 chars) |
| `browser_wait` | Static pause for specified duration (0–30s) |
| `browser_wait_for` | **【v1.5+ Recommended】Smart conditional wait**: Millisecond-level DOM observer waiting for selector or text state |
| `browser_upload_file` | **【v1.6+ Recommended】Automated file upload**: Directly injects local files into page upload inputs without OS dialogs |
| `browser_list_bookmarks` | **【v1.7+ Recommended】Bookmark Search**: Recursively queries all bookmark trees (Bookmarks Bar, Other Bookmarks, nested folders) |
| `browser_open_bookmark` | **【v1.7+ Recommended】One-Click Open Bookmark**: Fuzzy matches candidate bookmarks and opens in isolated AI workspace or active tab |
| `browser_get_cookies` | **【v1.8+ Recommended】Zero-F12 Cookies Extraction**: Directly reads all cookies (including `HttpOnly` and `Secure` session tokens) without opening DevTools |
| `browser_get_storage` | **【v1.8+ Recommended】Zero-F12 Storage Export**: Extracts full `localStorage` and `sessionStorage` key-value pairs |
| `browser_evaluate` | **【v1.8+ Recommended】Zero-F12 Console JS Eval**: Evaluates read-only JavaScript expressions in page context to inspect global variables |
| `browser_wait_for_download` | **【v1.9+ Recommended】Download Tracking**: Monitors triggered downloads and resolves the absolute local filesystem path |
| `browser_get_downloads` | **【v1.9+ Recommended】Download History Query**: Queries recent downloads, local file paths, MIME types, and progress status |
| `browser_get_network_logs` | **【v1.9+ Recommended】DevTools Network Sniffer**: Captures async Fetch/XHR requests and response JSON payloads without DOM parsing |
| `browser_fill_form` | **【v1.9+ Recommended】Batch Form Filling**: Fills multiple form inputs/textareas in a single operation with React/Vue event sync |
| `browser_go_back` / `browser_go_forward` / `browser_reload` | **【v1.9+ Recommended】Navigation Controls**: Navigates history backward, forward, or forces cache-bypassed reloads |
| `browser_reload_extension` | **【v1.9.2+ Recommended】Auto / Hot Reload Extension**: Executes `chrome.runtime.reload()` and synchronizes active page reload, bypassing manual `chrome://extensions` visits |

## Key Architectural Advantages

- **CDP Native Trusted Input & Complex Form Bypass (v2.0.0 Milestone)**:
  - **CDP Native Hardware-Level Trusted Input (`trusted: true`)**: Harnesses `chrome.debugger` (Chrome DevTools Protocol) to dispatch low-level `Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`, and `Input.insertText`. Generated events natively carry `event.isTrusted === true`, conquering restrictive datepickers and custom dropdowns on platforms like **YingJieSheng (应届生求职网)** and banking portals that reject synthetic scripts.
  - **Humanized Physics Drag & Slide Captcha Solver (`browser_drag`)**: Specifically designed to conquer Aliyun WAF, 51job, and Geetest slide verification ("请按住滑块，拖动到最右边"). Automatically detects slider buttons and track widths, simulating cubic bezier speed curves and micro-jitters to pass verification instantly.
  - **Stealth 2.0 Fingerprint Evasion & CDP Auto-Detach**: Properly defines `webdriver: false` on `Navigator.prototype` (ensuring `hasOwnProperty('webdriver') === false`), mocks internal Chrome runtime properties (`chrome.csi`, `chrome.app`, `chrome.loadTimes`), and automatically detaches the CDP debugger after 600ms of inactivity.
  - **Custom Datepicker Readonly Unlocking & Main-World Event Spoofing**: Automatically unsets temporary `readonly` flags on simulated calendar inputs before dispatching native input chains, accompanied by main-world prototype spoofing for `isTrusted` as a redundant fallback.
  - **Closed-Loop Action Feedback**: `browser_click` and `browser_type` automatically capture and return in-flight UI feedback (Toasts, floating notification badges, field-level validation errors, and URL redirection states), reducing redundant full-page snapshots.
  - **Targeted Visual Screenshot & Crop (`browser_screenshot`)**: High-fidelity viewport capture with element-level bounding box cropping (`element_id` or `selector`), feeding clean visual inputs directly to Multimodal LLMs.
  - **Incremental Diff Snapshot (`diff_only: true`)**: Generates compact DOM diffs compared to the preceding snapshot, slashing token usage by 90% during multi-turn repetitive tasks.
  - **Navigation Security Guardrail (`browser_set_guard`)**: Restricts browser navigation to strict domain allowlists, preventing unintended redirects or phishing traps.

- **Background Visibility Spoofing & Anti-Ghost Dialog (v1.9.5 New)**:
  - **Main-World Page Visibility Spoofing & Timer Keep-Alive**: Overrides `document.visibilityState` to `'visible'`, `document.hidden` to `false`, and `document.hasFocus()` to return `true`, paired with in-background silent AudioContext keep-alive. Neutralizes Chromium's background 0 FPS freezing and timer alignment throttling, eliminating unnamed/stuck SPA hydration and persistent skeleton loading masks.
  - **Anti-Ghost Dialog Filter & `ignore_dialog` Direct Bypass**: Prunes false-positive layout containers (like `.chat-conversation`); discards zero-dimension and empty skeleton dialogs; replaces disruptive "Restricted Mask" labeling with normal content blocks, and introduces `ignore_dialog: true` to bypass any popup overlays unconditionally.
  - **Desktop Viewport Normalization (1440x900) & Tab Auto-Muting**: Automatically standardizes AI background workspace windows to a 1440x900 desktop resolution, avoiding small-window responsive hamburger menu collapses, and silences all background AI tabs (`muted: true`) to prevent unsolicited audio playback.

- **Semantic Action Revealer & Direct Text/Selector Clicking (v1.9.4 New)**:
  - **SyntheticEvent & Native-less Action Pass-Through**: In modern React applications like BOSS Zhipin, event listeners are bound via root SyntheticEvents and buttons are styled `<span>` or `<div>` elements without static `cursor: pointer` or native `onclick`. The snapshot collector now identifies semantic action keywords ("编辑", "添加", "同步", "删除", "修改", etc.) and action classes, bypassing cursor/onclick checks to guarantee these critical actions are captured.
  - **Snapshot Global Hover Force-Reveal CSS**: Dynamically injects an isolated high-priority stylesheet during snapshot capture to break CSS `:hover` isolation and force-reveal conditionally hidden action buttons.
  - **Direct Text-Based & Selector-Based Clicking (`browser_click`)**: In addition to numeric `element_id`, AI agents can directly target buttons by text (`text: "编辑"` or `text: "同步至在线简历"`) or CSS selectors (`selector`), automatically traversing 4 levels of parent hover emulation before dispatching click events.

- **React Floating Actions & Hover Revealer (v1.9.3 New)**:
  - **Snapshot Smart Hover Pre-Scan (`reveal_hover: true`)**: `browser_snapshot` automatically dispatches lightweight pointer/mouse hover event chains to candidate cards and list containers (`.resume-item`, `.card`, etc.), prompting React's `onMouseEnter` to mount conditionally rendered floating action buttons (such as BOSS Zhipin's "Edit", "Add", and "Sync" buttons) and labels them with `[hover]` for immediate clicking.
  - **Explicit Hover Tool (`browser_hover`)**: Provides targeted hover simulation by `element_id`, `selector`, or contained `text` to trigger dropdowns and persistent floating popups.
  - **Relaxed Hover Visibility Detection**: Retains elements styled with `visibility: hidden` or `opacity: 0` that carry action semantics, preventing hover buttons from being falsely pruned before interaction.

- **Automated Hot-Reload & Developer Self-Healing (v1.9.2 New)**:
  - **File-Watcher Hot Reload**: The bridge server monitors all files within `browser-extension/` using `fs.watch`. Any saved edits trigger a WebSocket broadcast within 300ms, triggering instantaneous `chrome.runtime.reload()` inside the browser.
  - **Agent Reload Tool (`browser_reload_extension`)**: Enables AI agents or developers to programmatically reload the extension and optionally refresh active pages (`reload_tabs: true`) to prevent orphaned content script errors (`Extension context invalidated`).
  - **Sidepanel Reload Shortcut**: Includes an inline "🔄 重载扩展" button in the side panel dashboard for quick manual reloads.

- **Iframe Penetration & Anti-Paste Unblocking (v1.9.1 New)**:
  - **All-Frames Penetration (`all_frames: true`)**: Manifest scripts automatically inject into all sub-frames and nested iframes (such as online test platforms, XueXiTong, WenJuanXing, and UEditor frames), resolving iframe isolation blindspots.
  - **Main-World Anti-Paste / Anti-Copy Neutralization**: Non-invasively attaches capturing-phase listeners and overrides `onpaste`/`oncopy`/`oncut`/`oncontextmenu` property getters in the Main World, neutralizing exam and learning platforms from blocking paste actions (`preventDefault()`).

- **Rich-Text Editor Paragraph Preservation & Word Counter Sync (v1.9.1 Hardening)**:
  - **DOM Structure & Paragraph Retention**: Ceased destructive `textContent = ''` wipes on `contenteditable` targets. Retains and ensures root paragraph containers (`<p><br></p>` for Quill, WangEditor, Slate, ProseMirror) with collapsed Selection/Range positioning inside paragraphs before text insertion.
  - **Full Keyboard & Input Event Pipeline**: Dispatches complete `beforeinput`, `input`, `keydown`, `keypress`, `keyup`, and `change` events, ensuring character counters (such as BOSS Zhipin "字数: 0 / 1000") and reactive frameworks update reliably.

- **Closed-Loop File Flows: Download Tracking (`browser_wait_for_download` / `browser_get_downloads`)**:
  Listens natively via `chrome.downloads` for tasks triggered by clicking "Export Excel", "Download Resume", or "Save PDF". Resolves the absolute local filesystem path (e.g. `C:\Users\...\Downloads\report.xlsx`) upon completion, pairing with `browser_upload_file` for complete bidirectional file workflows.

- **DevTools Network Sniffer (`browser_get_network_logs`)**:
  Non-invasively wraps in-page `window.fetch` and `XMLHttpRequest`, buffering API request metadata and raw JSON response bodies. Enables AI agents to read clean structured backend data directly, bypassing heavy pagination and viewport DOM consumption.

- **Batch Form Filling (`browser_fill_form`)**:
  Accepts an array of fields and values to fill entire complex forms in a single round-trip, simulating native typing and keeping virtual DOM state synchronized.

- **Zero-F12 Cookie & Storage Extraction (`browser_get_cookies` / `browser_get_storage`)**:
  Leverages native `chrome.cookies` permissions in the Service Worker to bypass standard web page security boundaries (`document.cookie` cannot access `HttpOnly` cookies). AI Agents can instantaneously retrieve sensitive session tokens (such as `__Secure-1PSID` and `__Secure-1PSIDTS` for Gemini/Google or GitHub/ChatGPT auth cookies) without manual inspection or DevTools.

- **Complex Dialogs & Rich Text (`contenteditable`) Hardening**:
  - **Rich Text & Chat Dialog Support**: Automatically detects `contenteditable="true"` containers (like BOSS Zhipin, WeChat Web, Quill, Slate, ProseMirror) as `EDITABLE(DIV)` with placeholder extraction.
  - **Native Document Typing**: Simulates real human typing via `document.execCommand('insertText')` and `beforeinput` events, ensuring React and Vue virtual DOM state trees stay synchronized so that "Send" buttons light up automatically.
  - **Textless Icon & Close Button Detection**: Recognizes action buttons containing SVG or icon fonts without text (e.g. `✕` close buttons and send icons).
  - **Broadened Dialog Selectors**: Fully matches BOSS Zhipin (`.boss-dialog`, `.chat-conversation`), Arco Design, Naive UI, TDesign, and modern SaaS popup containers.

- **Bookmark Search & One-Click Navigation (`browser_list_bookmarks` / `browser_open_bookmark`)**:
  Extension background service worker integrates natively with `chrome.bookmarks` API, providing instantaneous recursive traversal of all bookmark folders (including "Bookmarks bar", "Other bookmarks", "Mobile bookmarks", and arbitrary nested directories). Matches by keyword query (title, URL, or folder name) and immediately launches the website in an isolated AI window or specified tab without touching the DOM.

- **Zero-Dialog Automated File Upload (`browser_upload_file`)**:
  Solves the browser security sandbox limitation where synthetic JS clicks cannot trigger the native OS file picker. The Node.js server streams the local file into the browser, and the content script leverages HTML5 `DataTransfer` and `File` APIs to directly inject the file into `<input type="file">`, triggering native `input` and `change` events.

- **In-Viewport Token Reduction**:
  `browser_snapshot` calculates bounding rectangles against viewport coordinates, returning only actionable elements currently visible on screen. Prunes empty decorative nodes, saving 80%+ tokens while reporting scroll progression.

- **Shadow DOM & Same-Origin Iframe Traversal**:
  The DOM traversal engine recursively penetrates open `shadowRoot` trees and same-origin `iframe`s, ensuring complete visibility across modern Web Components (Shoelace, Lit, YouTube controls, etc.).

- **Active Modal / Dialog Prioritization**:
  Automatically detects top-level modal dialogs (Element UI `.el-dialog`, Ant Design `.ant-modal`, native `<dialog>`), partitioning elements so the agent focuses on active modal interactions before background content.

- **Dedicated AI Workspace Window Isolation**:
  Autonomous background tasks can run in an isolated browser window (`isolate_window: true`), preserving the user's primary browsing window and preventing focus theft.

- **Multi-Agent Shared Relay**:
  Dual-mode master/relay architecture allows Antigravity, ChatGPT (Codex), and other agents to concurrently connect to port 3088 with isolated sessions and non-conflicting tab bindings.

## Security Boundaries & Limitations

- The bridge server listens strictly on `127.0.0.1`. Web page origin verification and strict path routing are enforced on `/ws` and `/agent` endpoints.
- Audit logs record tool names and tab IDs only; sensitive values, URLs, and form inputs are never logged. Passwords, verification codes, and credit card fields are automatically masked.
- Synthetic DOM events are used for interactions. Protected browser pages (`chrome://`, `edge://`, web store) cannot be scripted. File uploads are capped at 20MB per file.

## Development & Testing

Run inside the `bridge-server` directory:

```bash
npm ci
npm run build
npm test
npm audit
```

Full suite of **42 automated end-to-end and unit tests** covering background visibility spoofing, audio keep-alive, anti-ghost dialog filtering, ignore_dialog modal bypass, 1440x900 desktop viewport normalization, tab auto-muting, semantic action pass-through, direct text/selector clicking, download tracking, network sniffing, batch form filling, navigation controls, zero-F12 cookies extraction, extension hot-reloading & tab synchronization, React conditional hover mounting & hover action revealer, rich text (Quill/WangEditor paragraph retention & word counter sync) & complex dialogs, bookmark search & navigation, file injection, Shadow DOM traversal, modal grouping, conditional waiting, session isolation, background windows, and snapshot invalidation.

```text
✔ connects without pairing and rejects webpage origins
✔ relay IDs and sessions are isolated
✔ label wrapping radio button is identified as RADIO and toggles on click
✔ active dialog groups modal elements and isolates background elements
✔ shadowRoot elements are traversed and exposed in snapshot
✔ browser_wait_for resolves immediately when selector already exists
✔ browser_upload_file injects file into target input and triggers change
✔ browser_list_bookmarks traverses all folders including bookmarks bar and other bookmarks
✔ browser_open_bookmark opens matched bookmark in isolated AI window or existing tab
✔ boss-dialog contenteditable is recognized as EDITABLE and icon buttons are interactive
✔ browser_get_cookies extracts sensitive and HttpOnly cookies by name
✔ content script handles GET_STORAGE and EVALUATE without opening F12
✔ browser_fill_form batches multiple input fields in a single execution
✔ browser_get_network_logs filters captured Fetch/XHR entries
✔ browser_wait_for_download and browser_get_downloads track downloaded local files
✔ browser navigation controls (go_back, go_forward, reload) execute successfully
✔ rich-text editor (Quill / Boss Zhipin style) retains paragraph structure and updates word counter
✔ browser_reload_extension reloads extension and synchronizes active tab
✔ browser_hover triggers React conditional hover actions and snapshot reveals them
✔ hover action buttons with visibility: hidden are revealed as [hover] in snapshot
✔ semantic action buttons (span/div without cursor:pointer or onclick) are captured and clickable by text
✔ browser_snapshot with ignore_dialog: true bypasses dialog isolation
✔ empty dialog container without interactive elements is ignored as ghost modal
✔ network-interceptor spoofs visibilityState and hasFocus
✔ ensureAiWindow specifies 1440x900 desktop dimensions and mutes background tabs
✔ action feedback loop captures toast and validation errors on click and type
✔ custom readonly datepicker input (yingjiesheng style) has readonly stripped and triggers onchange
✔ browser_snapshot with diff_only: true returns incremental changes
✔ browser_screenshot captures viewport and returns element rect
✔ browser_set_guard blocks navigation outside domain allowlist
✔ browser_click and browser_type with trusted: true dispatches via CDP debugger
✔ browser_drag dispatches humanized CDP drag events for slider verification
✔ content script detects slider verification and executes drag
ℹ tests 50 | pass 50 | fail 0
```

## License

[MIT](./LICENSE)
