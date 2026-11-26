---
name: firefox-operator
description: Non-intrusive Mozilla Firefox automation via Antigravity Operator (WebExtension + Native Messaging + Playwright headless fallback) with same-origin iframe support and clean user handoff.
---

# Firefox Operator (`operator_firefox_*`)

> **Prerequisite:** These tools (`operator_firefox_*`) are **optional federated tools** provided by the separate `antigravity-operator` plugin and its Firefox WebExtension. Enable and configure the bridge in `/admin` before using them.

## 1. Choosing the Right Mode
- **Never** open local PDFs, Office files, or images in Firefox just to read them — use `read_file` / `read_files`.
- **Mode 1 — Silent Agent Research** *(internal reading/automation; user did NOT ask to view the tab)*:
  - Public/stateless pages: `operator_firefox_open({ url, engine: "playwright", active: false, for_user: false })` and close tabs when finished.
  - Pages needing the user's authenticated Firefox session: `operator_firefox_open({ url, engine: "extension", active: false, for_user: false })`.
- **Mode 2 — User Handoff** *(user asks to open Firefox or leave tabs ready for review/interaction)*:
  - Always use `engine: "extension"` and pass `for_user: true` (or `{ type: "handoff", active: true }` in `operator_firefox_act`) on the final step.
  - Never use `engine: "playwright"` when delivering tabs to the user.

## 2. Batching & Tab Hygiene
- Group multi-step interactions inside a single `operator_firefox_act` call and always pass your tracked `tab_id`.
- Never close tabs owned by the user or other concurrent sessions (`force: true` is forbidden unless explicitly ordered).
- Do not attempt to bypass restricted origins (`about:*`, `addons.mozilla.org`) using desktop clicks; report the restriction to the user.
