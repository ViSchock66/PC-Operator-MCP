---
name: chrome-operator
description: Non-intrusive Google Chrome automation via Antigravity Operator (MV3 extension + Playwright headless fallback) with iframe support, file uploads, multi-agent tab isolation, and clean user handoff.
---

# Chrome Operator (`operator_chrome_*`)

> **Prerequisite:** These tools (`operator_chrome_*`) are **optional federated tools** provided by the separate `antigravity-operator` plugin and its MV3 Chrome extension. Enable and configure the bridge in `/admin` before using them.

## 1. Choosing the Right Mode
- **Never** open local PDFs, Office files, or images in Chrome just to read them — use `read_file` (with `renderPages: true` for visual PDF inspection).
- **Mode 1 — Silent Agent Research** *(internal reading/automation; user did NOT ask to view the tab)*:
  - Public/stateless sites: `operator_chrome_open({ url, engine: "playwright", active: false, for_user: false })`. Close tabs with `operator_chrome_close_tab` when finished.
  - Sites requiring the user's logged-in Chrome session: `operator_chrome_open({ url, engine: "extension", active: false, for_user: false })`. If Chrome is closed, the extension engine auto-launches it minimized cleanly.
- **Mode 2 — User Handoff** *(user asks to open a site or leave tabs ready to review/interact)*:
  - Always use `engine: "extension"` and finish with `for_user: true` (or `{ type: "handoff", active: true }` inside `operator_chrome_act`).
  - Never use `engine: "playwright"` for Mode 2 (headless tabs are invisible to the user).
  - For multi-step preparation (filtering, filling forms), operate with `active: false` and pass `for_user: true` on the final step so the main window becomes visible and the debugger banner detaches cleanly (`detach: true`).

## 2. Batching & Multi-Agent Hygiene
- Combine actions (`click_element`, `click_text`, `type`, `upload_file`, `handle_dialog`, `scroll`, `wait`) in a single `operator_chrome_act` call and always pass your own `tab_id`.
- Each connected MCP session receives an isolated bridge (`ownedTabs` per session). Never pass `force: true` to `operator_chrome_close_tab` unless explicitly requested by the user.
- Do not try to bypass restricted origins (`chrome://*`) with desktop automation; report the restriction instead.
