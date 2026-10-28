<div align="center">

# 🌐 Browser Agent Bridge

[![Version](https://img.shields.io/badge/version-1.9.1-blue.svg)](https://github.com/prover0721/browser-agent-bridge)
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
| `browser_snapshot` | Extract structured DOM interactive elements with IDs and Snapshot ID (In-viewport pruning & modal prioritization) |
| `browser_click` / `browser_type` | Click / type into target elements; supports `snapshot_id` revision matching |
| `browser_press` / `browser_scroll` | Dispatch keyboard keys / scroll page with pixel and percentage progression |
| `browser_navigate` | Navigate current or designated tab to a target URL |
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

## Key Architectural Advantages

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

Full suite of **34 automated end-to-end and unit tests** covering download tracking, network sniffing, batch form filling, navigation controls, zero-F12 cookies extraction, rich text (Quill/WangEditor paragraph retention & word counter sync) & complex dialogs, bookmark search & navigation, file injection, Shadow DOM traversal, modal grouping, conditional waiting, session isolation, background windows, and snapshot invalidation.

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
ℹ tests 34 | pass 34 | fail 0
```

## License

[MIT](./LICENSE)
