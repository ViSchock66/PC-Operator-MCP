---
name: windows-operator
description: Safe, non-intrusive Windows 11 local workspace, PowerShell, clipboard, and browser coordination playbook for AI assistants using PC-Operator-MCP.
---

# Windows Operator Playbook

Follow these operational rules when assisting a user on Windows 11 through `PC-Operator-MCP`.

## 1. Environment Conventions
- Target native Windows 11 with PowerShell (`powershell.exe`). Never emit WSL paths (`/mnt/c/...`).
- Respect workspace boundaries: operate strictly inside `activeWorkspace` unless the user explicitly authorizes another folder in `/admin`.
- Read local documents (PDF, DOCX, XLSX, PPTX, images, code) directly with `read_file` / `read_files` instead of launching desktop apps or browser tabs, unless the user explicitly asks to open the file visually.

## 2. Two Operating Modes (Silent Research vs. User Handoff)
- **Mode 1 — Silent Background Work** *(the user asked you to read, research, or process information — NOT to open a window for them)*:
  - Keep everything non-intrusive: do not steal foreground focus, restore minimized windows, or move the physical mouse cursor.
  - For public web research (when `antigravity-operator` is enabled), prefer `engine: "playwright"` (headless) and close your tabs when done.
  - For authenticated pages, use `engine: "extension"` with `active: false` and `for_user: false`.
- **Mode 2 — User Handoff** *(the user explicitly asked to open a page, prepare tabs, or leave something ready for them to review/interact with)*:
  - Always use `engine: "extension"` with `for_user: true` so the real browser window is visible and the debugging banner detaches cleanly. Never use headless `playwright` for user handoff.

## 3. Efficient Batching & Hygiene
- Chain dependent PowerShell steps cleanly in a single `run_command` call when validating builds or tests.
- Never forcefully close tabs or processes belonging to the user or other concurrent agent sessions (`force: true` is forbidden unless explicitly requested).
- Never attempt to bypass restricted browser origins (`chrome://*`, `about:*`) or security prompts by falling back to physical mouse clicks; report the restriction clearly to the user.
