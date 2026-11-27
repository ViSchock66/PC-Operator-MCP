# PC-Operator-MCP

> **Language:** **English** · [Español](docs/README.es.md) · [Technical Architecture (ES)](docs/ARQUITECTURA.md)

**Streamable HTTP MCP server (OAuth 2.1 + Bearer API Keys)** for Windows 11 that connects **Google Gemini**, **Claude (`claude.ai`)**, **ChatGPT (`chatgpt.com`)**, and local IDE/CLI agents (**Claude Code**, **Cursor**, **VS Code Copilot**) to your local workspaces — with multimodal file reading (text, images, PDF text/visual, DOCX/XLSX/PPTX), bundled `SKILL.md` playbooks, persistent PowerShell consoles, **pull-only cross-model handoff**, and optional federation with **[Antigravity Operator](https://github.com/ViSchock66/antigravity-operator)** for Chrome, Firefox, and Windows desktop control.

Includes a **fixed HTTPS tunnel** (Tailscale Funnel or Cloudflare Tunnel), a **local bilingual Control Panel (`/admin`, EN/ES)**, and a **native Windows system tray companion**.

---

## Quick Start

1. Install dependencies:
   ```powershell
   npm install
   ```
2. Double-click **`Abrir-Panel.bat`** (or run `npm run panel` / `.\start.ps1 -Gui`).
   - Starts the hidden background daemon (`node src/launcher.js`), brings up your configured HTTPS tunnel, compiles/launches the Windows tray icon (`pc-operator-tray.exe`), and opens `http://127.0.0.1:3333/admin`.
   - Closing the panel window leaves the server and tunnel running; reopen anytime via `Abrir-Panel.bat`.
   - To restart Node after code changes, click **Shut Down Daemon** in the `/admin` sidebar and run `Abrir-Panel.bat` again.
3. Sign in with your **local PIN** (stored in `data/config.json` or printed in the console when launching with `npm run tunnel`).

### CLI Scripts & Flags

| Command | Description |
|---|---|
| `npm run panel` / `Abrir-Panel.bat` | Starts the hidden daemon (if not running) and opens `/admin` in app mode. |
| `npm run tunnel` | Starts server + tunnel + tray with live console output (`node src/launcher.js`). |
| `npm start` | Starts the local HTTP/MCP server only, without tunnel or tray (`node src/index.js`). |
| `.\start.ps1 [-Workspace <path>] [-Pick] [-Gui]` | PowerShell wrapper for `src/launcher.js`. |
| `npm test` | Runs the full test suite (`node --test test/*.test.js`). |

Supported flags (`src/index.js` and `src/launcher.js`): `--port <n>`, `--workspace <path>`, `--pick` / `--pick-workspace`, `--gui`, `--no-tunnel`, `--no-tray`.

---

## Connecting Clients

### 1. Web LLM Connectors (OAuth 2.1 + PKCE)

The server supports **parallel isolated sessions**: Gemini, Claude, and ChatGPT can run simultaneously with independent per-session `activeWorkspace` state and isolated `OperatorBridge` instances.

- **General endpoint (Claude, ChatGPT, standard MCP clients):**
  `https://<your-fixed-url>/mcp`
- **Dedicated Gemini Web endpoint (recommended for `gemini.google.com`):**
  `https://<your-fixed-url>/mcp/gemini` *(and parallel slots `/mcp/gemini/<slot>`)*
  > **Why `/mcp/gemini` exists:** applies Gemini Web UI compatibility annotations (`readOnlyHint: true`, toggleable via `GEMINI_READONLY_ANNOTATIONS=0`) to work around the Gemini Web bug where *"Always allow"* resets after each tool call, and serves route-specific RFC 9728 metadata. **This is a UI compatibility annotation only — it does not restrict tools or enable a read-only mode.**
- **Built-in OAuth 2.1 providers:** Google Gemini (prod/sandbox/test), Claude (`claude.ai`), ChatGPT (`chatgpt.com` / `chat.openai.com`), custom origins via `/admin`, Dynamic Client Registration (**DCR**), and static OAuth client (**ID + Secret**).

### 2. IDE & CLI Clients (Bearer API Keys `gp_key_*`)

Generate a revocable API key in `/admin` → **Connections → Auth & API Keys**, then use your local (`http://127.0.0.1:3333/mcp`) or public HTTPS endpoint:

#### Claude Code (CLI or `.mcp.json`)
```bash
# CLI (OAuth 2.1 or Bearer token)
claude mcp add --transport http pc-operator "http://127.0.0.1:3333/mcp"
```
```json
{
  "mcpServers": {
    "pc-operator": {
      "type": "http",
      "url": "http://127.0.0.1:3333/mcp",
      "headers": {
        "Authorization": "Bearer gp_key_YOUR_TOKEN"
      }
    }
  }
}
```

#### Cursor (`mcp.json`)
```json
{
  "mcpServers": {
    "pc-operator": {
      "url": "http://127.0.0.1:3333/mcp",
      "headers": {
        "Authorization": "Bearer gp_key_YOUR_TOKEN"
      }
    }
  }
}
```

#### VS Code Copilot (`.vscode/mcp.json`)
```json
{
  "servers": {
    "pc-operator": {
      "type": "http",
      "url": "http://127.0.0.1:3333/mcp",
      "headers": {
        "Authorization": "Bearer gp_key_YOUR_TOKEN"
      }
    }
  }
}
```

---

## Local Control Panel (`/admin`)

Accessible **exclusively from `127.0.0.1`** with PIN login (rejects tunneled/proxied requests with `403`). Built with **Vite + Preact + TypeScript** (`web/`, bundled into `src/public/` via `npm run build:web`), styled with Windows 11 Fluent tokens, and live **ES / EN** switching across 7 sections (**Home**, **Connection**, **Workspaces**, **Processes**, **Handoff**, **Activity**, **Settings**).

---

## MCP Tool Inventory (23 Native + 17 Optional Federated)

### Native Tools — Included Out of the Box (23 tools)

#### 1. Workspace, Code, Multimodal Docs & Skills (15 tools)
- **Context & navigation:** `workspace_info`, `list_workspaces`, `select_workspace` *(session-scoped)*, `list_dir`, `find_files`, `search_text`.
- **Multimodal & batch reading:**
  - `read_file`: line-paginated text/code, inline images (`png`, `jpg`, `webp`, `gif`), Office (`docx`, `xlsx`, `pptx`), and **PDF** (text extraction or `renderPages: true` rendered inline as JPEG without opening a browser).
  - `read_files`: batch-read up to 10 files in a single call.
- **Editing & execution:** `write_file`, `edit_file`, `move_path`, `delete_path`, `run_command` *(hidden PowerShell running with your Windows user's full permissions; starts in the active workspace `cwd`, can access paths outside it, configurable timeout)*, `git_harness` (`status`, `diff`, `log`, `branches`).
- **Skills (`use_skill`):** lists and loads `SKILL.md` playbooks in priority order: **active workspace** (`skills/`, `.agents/skills/`) → **bundled repo `skills/`** → **built-in guide** → **Antigravity Operator skills** → **user global `~/.gemini/config/skills`**.

#### 2. Cross-Model Handoff — 100% Pull-Only (3 tools)
Built to seamlessly resume work when a chat runs out of quota without polluting unrelated chats:
- Silently records real work actions in `data/handoffs.json`, partitioned by `(sessionKey, workspace)` with automatic secret redaction (`Bearer`, `gp_key_`, `sk-`, `ghp_`, `AIza*`, `password=`, `token=`).
- `workspace_info` **never** injects hints from other sessions or checkpoints.
- `handoff_save`, `handoff_resume` *(with safe `needsSelection: true` disambiguation across recent projects)*, and `handoff_list`.

#### 3. Persistent Consoles & Daemons — *Full Control Mode* (5 tools)
Require enabling **Full Control Mode** in `/admin` (with TTL auto-expiry and optional unrestricted `cwd`):
- `process_list`, `process_start`, `process_read` (`tailLines` or `fromOffset`), `process_send` (interactive stdin), and `process_stop` (full process tree termination via `taskkill /T /F`).

### Optional Federated Tools — Antigravity Operator (17 tools)

Connect **[Antigravity Operator](https://github.com/ViSchock66/antigravity-operator)** (standalone MIT repository) in `/admin` → **Runtime** to federate browser and Windows desktop automation with per-session isolation (`AG_OPERATOR_SESSION_KEY`):
- **Chrome / Firefox (`operator_chrome_*`, `operator_firefox_*`):** silent mode (`playwright` headless or background `extension`) and user handoff (`for_user: true`).
- **Windows Desktop (`operator_desktop_*`):** screenshots, window enumeration, focus-free UI Automation (`ui_tree`, `ui_action`), visual/DirectX actions (`act`), and cursor overlay.

### Bundled Skills (`skills/`)

This repository ships 5 ready-to-use `SKILL.md` playbooks exposed automatically via `use_skill`:
- `workspace-operator-guide` — master operational playbook for all native tools, multimodal reading, and handoff.
- `windows-operator` — safe Windows 11 local workspace, PowerShell, clipboard, and browser coordination guide.
- `chrome-operator` *(requires [Antigravity Operator](https://github.com/ViSchock66/antigravity-operator))* — silent Chrome automation and clean user handoff.
- `firefox-operator` *(requires [Antigravity Operator](https://github.com/ViSchock66/antigravity-operator))* — silent Firefox WebExtension automation and handoff.
- `desktop-operator` *(requires [Antigravity Operator](https://github.com/ViSchock66/antigravity-operator))* — Windows UIA and DirectX/visual automation playbook.

### Resources & Prompts
- **Resource:** `mcp://workspace-operator/guide` (`guia_uso_mcp`).
- **Prompts:** `como_usar_este_mcp` and `retomar_handoff`.

---

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `MCP_PORT` | `3333` | Local HTTP port (persisted in `data/config.json`). |
| `MCP_PIN` | Generated | Overrides the local authorization PIN. |
| `MCP_PUBLIC_URL` | `""` | Fixed public HTTPS origin (`https://...`) for OAuth / RFC 9728 metadata. |
| `CLOUDFLARE_TUNNEL_TOKEN` | `""` | Enables `cloudflare-named` mode with a fixed tunnel token. |
| `MCP_ACCESS_TOKEN_TTL_SEC` | `2592000` (30d) | OAuth `access_token` lifetime in seconds. |
| `GEMINI_READONLY_ANNOTATIONS` | `1` (enabled) | Set to `0` to disable `readOnlyHint: true` UI compatibility annotations on `/mcp/gemini*` (metadata only — **does not restrict** tools). |

---

## Security Model

- `/mcp`, `/mcp/gemini`, and `/mcp/gemini/:slot` require a valid Bearer token with scope `mcp:tools` (OAuth 2.1 + PKCE or `gp_key_*` API key) and enforce a **CORS origin allowlist** (built-in providers, loopback, configured public URL, and user-approved redirect origins).
- **File tool scope (`read_file`, `read_files`, `write_file`, `edit_file`, `move_path`, `delete_path`, `list_dir`, `find_files`, `search_text`):** strictly bounded to the active workspace; blocks `..`, external symlinks, internal server directories (`src/`, `data/`, `panel/`, etc.), the `antigravity-operator` directory, `.git/config`, `.git/hooks/*`, and sensitive files (`.env`, `.pem`, `.key`, `id_rsa`, etc.) when `protectSensitiveFiles` is enabled.
- **Shell execution (`run_command` and `process_*`):** by design, runs PowerShell with your **current Windows user's full permissions** so agents can operate your local PC and authenticated CLIs. Commands start in the active workspace (`cwd`), but are **not sandboxed** to the workspace or restricted by `protectSensitiveFiles`. By default (`filterSensitiveEnv: true`), common secret environment variables (`*_API_KEY`, `*_TOKEN`, `*SECRET*`, `*PASSWORD*`, `*_PRIVATE_KEY`, `MCP_PIN`, `CLOUDFLARE_TUNNEL_TOKEN`) are stripped from the inherited shell environment (with per-user `envAllowlist` / `envBlocklist` overrides in `/admin`, while leaving `OperatorBridge` untouched). Note that env filtering prevents accidental secret leakage in shell commands, not intentional local file/registry access. Disable `allowCommands` in `/admin` to block shell execution.
- `/admin`, `/admin/api/*`, `/admin/assets/*`, and `/internal/tray/*` only respond on local loopback (`127.0.0.1`), reject proxy/tunnel headers (`403`), block direct `/admin/assets/index.html` and unknown assets (`404`), and require HMAC session cookies or `X-Tray-Token`.
- Commands and errors saved in `data/handoffs.json` are scrubbed for secrets before writing to disk.

---

## License

MIT — see [LICENSE](LICENSE).
