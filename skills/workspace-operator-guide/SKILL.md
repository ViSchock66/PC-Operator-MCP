---
name: workspace-operator-guide
description: Master operational guide for PC-Operator-MCP on Windows 11 — workspace-scoped file tools, full-user PowerShell commands, multimodal PDF/Office/image reading, batch reads, parallel isolated sessions, persistent consoles, opt-in cross-model handoff, and optional Antigravity Operator federation.
---

# PC-Operator-MCP — Operational Guide

Use this guide whenever working through `PC-Operator-MCP` on Windows 11.

## 1. Workspace & File Operations (Built-in Tools)
- Start with `workspace_info` (or `list_dir` / `find_files`) to inspect `activeWorkspace`, enabled permissions, and Git status.
- **Paths:** All workspace tools accept paths **relative** to `activeWorkspace`. When an optional `operator_*` tool needs a local path (such as `upload_file` or a screenshot target), construct the absolute path from `activeWorkspace`.
- **Smart Multimodal Reading (`read_file`):**
  - Reads code/text paginated by line range (`startLine`, `endLine`).
  - Returns **inline images** (`png`, `jpg`, `webp`, `gif`), **Office documents** (`docx`, `xlsx`, `pptx`), and **PDFs**.
  - To visually inspect PDF layout, margins, or typography, call `read_file({ path, renderPages: true, pages: "1-2" })`. This renders pages directly in Windows without opening a browser.
- **Batch Reading (`read_files`):** Read up to 10 text, PDF, or Office files in a single round-trip.
- **Editing & Shell:** Use `edit_file` (after `read_file`) for targeted patches, `write_file` for full writes, `git_harness` for Git inspection, and `run_command` for hidden PowerShell execution (starts in `activeWorkspace`, but runs with the current Windows user's full permissions and can access paths outside the workspace; `protectSensitiveFiles` only covers file tools).
- **Parallel Isolated Sessions:** Each connected model/client maintains its own `activeWorkspace` override (`select_workspace` only affects the calling session).

## 2. Opt-in Cross-Model Handoff (`handoff_*`)
- **Strict Pull-Only Rule:** Never invoke `handoff_resume`, `handoff_list`, or `handoff_save` proactively in normal chats.
- Call `handoff_resume(...)` **only** when the user explicitly asks to continue work from another chat/model or pastes a handoff prompt. If it returns `needsSelection: true`, ask the user which project to resume instead of guessing.
- Call `handoff_save(...)` **only** when the user explicitly asks to create a checkpoint before switching models.

## 3. Persistent Daemons & Interactive Consoles (`process_*`)
- Requires enabling **Full Control Mode** in the local `/admin` panel (with optional TTL auto-shutoff).
- Use `process_start` for dev servers, long builds, or interactive CLIs that exceed `run_command` timeouts; read logs via `process_read`, send stdin via `process_send`, list via `process_list`, and cleanly terminate the process tree via `process_stop`.

## 4. Optional Federated Tools (`operator_*`)
If the optional **Antigravity Operator** bridge is enabled in `/admin`, load the matching skill (`chrome-operator`, `firefox-operator`, or `desktop-operator`) via `use_skill` before automating browsers or Windows desktop apps.
