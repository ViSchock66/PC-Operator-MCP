# PC-Operator-MCP

> **Idioma:** [English](../README.md) · **Español** · [Arquitectura Técnica](ARQUITECTURA.md)

Servidor **MCP (Streamable HTTP + OAuth 2.1 + API Keys)** para Windows 11 que conecta **Google Gemini**, **Claude (`claude.ai`)**, **ChatGPT (`chatgpt.com`)** y clientes IDE/CLI locales (**Claude Code**, **Cursor**, **VS Code Copilot**) a tus workspaces en disco — con lectura multimodal (texto, imágenes, PDF texto/visual, DOCX/XLSX/PPTX), skills `SKILL.md` incluidas, consolas PowerShell persistentes, **handoff entre modelos 100% bajo solicitud** y federación opcional de **[Antigravity Operator](https://github.com/ViSchock66/antigravity-operator)** para controlar Chrome, Firefox y el escritorio de Windows.

Incluye **URL HTTPS fija** (Tailscale Funnel o Cloudflare Tunnel), **Panel Gráfico local bilingüe (`/admin`, EN/ES)** e **ícono nativo en la bandeja del sistema**.

---

## Inicio rápido

1. Instala dependencias:
   ```powershell
   npm install
   ```
2. Haz doble clic en **`Abrir-Panel.bat`** (o ejecuta `npm run panel` / `.\start.ps1 -Gui`).
   - Inicia el daemon oculto (`node src/launcher.js`), levanta el túnel configurado, compila/inicia el ícono de bandeja (`pc-operator-tray.exe`) y abre `http://127.0.0.1:3333/admin`.
   - Puedes cerrar la ventana del panel y reabrirla con `Abrir-Panel.bat` sin apagar el servidor ni el túnel.
   - Para reiniciar el proceso Node tras cambios de código: pulsa **Apagar Daemon / Shut Down Daemon** (barra lateral izquierda de `/admin`) y vuelve a abrir `Abrir-Panel.bat`.
3. Ingresa tu **PIN local** (guardado en `data/config.json` o visible en consola si inicias con `npm run tunnel`).

### Scripts y flags CLI

| Comando | Descripción |
|---|---|
| `npm run panel` / `Abrir-Panel.bat` | Arranca el daemon oculto (si no corre) y abre `/admin` en modo app. |
| `npm run tunnel` | Inicia el servidor + túnel + bandeja con salida en consola (`node src/launcher.js`). |
| `npm start` | Inicia solo el servidor HTTP/MCP local sin túnel ni bandeja (`node src/index.js`). |
| `.\start.ps1 [-Workspace <ruta>] [-Pick] [-Gui]` | Wrapper PowerShell hacia `src/launcher.js`. |
| `npm test` | Ejecuta toda la suite de pruebas (`node --test test/*.test.js`). |

Flags soportados por `src/index.js` y `src/launcher.js`: `--port <n>`, `--workspace <ruta>`, `--pick` / `--pick-workspace`, `--gui`, `--no-tunnel`, `--no-tray`.

---

## Conectar clientes

### 1. Conectores Web LLM (OAuth 2.1 + PKCE)

El servidor soporta **sesiones paralelas aisladas**: puedes tener Gemini, Claude y ChatGPT conectados al mismo tiempo; cada cliente tiene su propio `activeWorkspace` de sesión y su propio puente `OperatorBridge` aislado.

- **Endpoint general (Claude, ChatGPT, clientes MCP estándar):**
  `https://<tu-url-fija>/mcp`
- **Endpoint dedicado Gemini Web (recomendado para `gemini.google.com`):**
  `https://<tu-url-fija>/mcp/gemini` *(y slots paralelos `/mcp/gemini/<slot>`)*
  > **Por qué existe `/mcp/gemini`:** aplica automáticamente anotaciones de compatibilidad para Gemini Web (`readOnlyHint: true`, desactivable con `GEMINI_READONLY_ANNOTATIONS=0`) para evitar el bug donde Gemini Web revierte *"Permitir siempre"* tras cada llamada, además de exponer metadata RFC 9728 por ruta. **Es solo una anotación de compatibilidad y no restringe herramientas ni activa modo solo lectura.**
- **Proveedores OAuth incluidos:** Google Gemini (prod/sandbox/test), Claude (`claude.ai`), ChatGPT (`chatgpt.com` / `chat.openai.com`), orígenes personalizados configurables desde `/admin`, registro dinámico (**DCR**) y cliente estático (**ID + Secreto**).

### 2. Clientes IDE y CLI (API Keys Bearer `gp_key_*`)

Genera una API key revocable en `/admin` → **Connections → Auth & API Keys** y úsala con tu endpoint local (`http://127.0.0.1:3333/mcp`) o tu URL HTTPS fija:

#### Claude Code (CLI o `.mcp.json`)
```bash
# CLI (OAuth 2.1 o Bearer token)
claude mcp add --transport http pc-operator "http://127.0.0.1:3333/mcp"
```
```json
{
  "mcpServers": {
    "pc-operator": {
      "type": "http",
      "url": "http://127.0.0.1:3333/mcp",
      "headers": {
        "Authorization": "Bearer gp_key_TU_TOKEN"
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
        "Authorization": "Bearer gp_key_TU_TOKEN"
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
        "Authorization": "Bearer gp_key_TU_TOKEN"
      }
    }
  }
}
```

---

## Panel Gráfico Local (`/admin`)

Accesible **solo desde `127.0.0.1`** con PIN (rechaza cualquier acceso vía proxy/túnel con `403`). Incluye cambio de idioma **EN / ES en vivo** y está organizado en **5 vistas modulares** (atajos de teclado `1`–`5`):

1. **Resumen / Overview (`1`):** Tarjeta de estado, KPIs en vivo (túnel, sesiones LLM, Operator, demonios), Conexión Rápida (URLs `/mcp`, `/mcp/gemini`, PIN y OAuth estático), salud de red y consola de logs SSE con filtros.
2. **Workspaces (`2`):** Lista de carpetas autorizadas, selector nativo de Windows, botón **Sincronizar Sesiones** y permisos en vivo (`allowWrite`, `allowDelete`, `allowCommands`, `protectSensitiveFiles`, `commandTimeoutMs`, `maxReadBytes`).
3. **Conexiones / Connections (`3`):** Organizado en 3 sub-pestañas:
   - **Túnel & Dominio:** Tailscale Funnel (recomendado), Cloudflare Named Tunnel, Cloudflare Quick Tunnel o Solo Local + autodetección de red.
   - **Auth & API Keys:** Generación/revocación de `gp_key_*`, proveedores OAuth 2.1 y orígenes personalizados, puerto, PIN y revocación global de sesiones.
   - **Guía de Conexión:** Checklist en vivo y snippets listos para copiar (Claude Code, Cursor, VS Code Copilot, HTTP/curl y conectores web).
4. **Ejecución / Runtime (`4`):** Activación de **Antigravity Operator**, monitor de sesiones aisladas, switch **Modo Control Total** con TTL automático y gestor de consolas persistentes.
5. **Handoff (`5`):** Actividad reciente auto-rastreada por `(modelo, proyecto)`, detalle desplegable de comandos/acciones, nota rápida opcional al congelar y botón de 1 clic para copiar el prompt de relevo.

---

## Inventario de Herramientas MCP (23 Nativas + 17 Federadas Opcionales)

### Herramientas Nativas — Incluidas de serie (23 tools)

#### 1. Workspace, Código, Documentos Multimodales y Skills (15 tools)
- **Contexto y navegación:** `workspace_info`, `list_workspaces`, `select_workspace` *(solo cambia tu sesión)*, `list_dir`, `find_files`, `search_text`.
- **Lectura multimodal y por lotes:**
  - `read_file`: código/texto paginado por líneas, imágenes inline (`png`, `jpg`, `webp`, `gif`), Office (`docx`, `xlsx`, `pptx`) y **PDF** (extracción de texto o `renderPages: true` a JPEG inline sin abrir navegador).
  - `read_files`: lee hasta 10 archivos en una sola llamada.
- **Edición y ejecución:** `write_file`, `edit_file`, `move_path`, `delete_path`, `run_command` *(PowerShell oculto con permisos completos del usuario de Windows; arranca en el workspace activo pero puede acceder fuera de él, con timeout configurable)*, `git_harness` (`status`, `diff`, `log`, `branches`).
- **Skills (`use_skill`):** lista y carga playbooks `SKILL.md` por prioridad: **workspace activo** (`skills/`, `.agents/skills/`) → **carpeta `skills/` incluida en el repo (`bundled`)** → **guía integrada (`builtin`)** → **skills de Operator** → **skills globales del usuario (`~/.gemini/config/skills`)**.

#### 2. Handoff entre Modelos — 100% Bajo Solicitud (3 tools)
Pensado para retomar trabajo si un chat se queda sin cuota, **sin ensuciar chats normales**:
- Registra silenciosamente en `data/handoffs.json` cada acción real, **particionado por `(sessionKey, workspace)`** y con **redacción automática de secretos** (`Bearer`, `gp_key_`, `sk-`, `ghp_`, `AIza*`, `password=`, `token=`).
- `workspace_info` **nunca** inyecta pistas de otras sesiones ni checkpoints.
- `handoff_save`, `handoff_resume` *(con desambiguación segura `needsSelection: true`)* y `handoff_list`.

#### 3. Demonios y Consolas Persistentes — *Modo Control Total* (5 tools)
Requieren activar **Modo Control Total** en `/admin` (con TTL de auto-apagado y opción de `cwd` libre):
- `process_list`, `process_start`, `process_read` (`tailLines` o `fromOffset`), `process_send` (stdin interactivo) y `process_stop` (detiene todo el árbol con `taskkill /T /F`).

### Herramientas Federadas Opcionales — Antigravity Operator (17 tools)

Conecta **[Antigravity Operator](https://github.com/ViSchock66/antigravity-operator)** (repositorio standalone MIT) en `/admin` → **Runtime** para federar automatización de navegador y escritorio con aislamiento por sesión (`AG_OPERATOR_SESSION_KEY`):
- **Chrome / Firefox (`operator_chrome_*`, `operator_firefox_*`):** modo silencioso (`playwright` headless o `extension` en segundo plano) y entrega de pestañas al usuario (`for_user: true`).
- **Escritorio Windows (`operator_desktop_*`):** capturas, listado de ventanas, árbol UI Automation sin foco (`ui_tree`, `ui_action`), control visual/3D (`act`) y overlay.

### Skills Incluidas (`skills/`)

El repositorio incluye 5 playbooks `SKILL.md` expuestos automáticamente mediante `use_skill`:
- `workspace-operator-guide` — manual maestro para todas las tools nativas, lectura multimodal y handoff.
- `windows-operator` — guía segura para operar workspaces de Windows 11, PowerShell, portapapeles y navegador.
- `chrome-operator` *(requiere [Antigravity Operator](https://github.com/ViSchock66/antigravity-operator))* — automatización silenciosa de Chrome y handoff limpio.
- `firefox-operator` *(requiere [Antigravity Operator](https://github.com/ViSchock66/antigravity-operator))* — automatización silenciosa de Firefox y handoff.
- `desktop-operator` *(requiere [Antigravity Operator](https://github.com/ViSchock66/antigravity-operator))* — guía de UI Automation y control visual/DirectX en Windows.

### Resources y Prompts MCP
- **Resource:** `mcp://workspace-operator/guide` (`guia_uso_mcp`).
- **Prompts:** `como_usar_este_mcp` y `retomar_handoff`.

---

## Variables de entorno

| Variable | Defecto | Uso |
|---|---|---|
| `MCP_PORT` | `3333` | Puerto HTTP local (se persiste en `data/config.json`). |
| `MCP_PIN` | Generado | Sobrescribe el PIN de autorización local. |
| `MCP_PUBLIC_URL` | `""` | Origen público HTTPS (`https://...`) usado en metadata OAuth/RFC 9728. |
| `CLOUDFLARE_TUNNEL_TOKEN` | `""` | Activa modo `cloudflare-named` con token de túnel fijo. |
| `MCP_ACCESS_TOKEN_TTL_SEC` | `2592000` (30d) | Duración de los `access_token` OAuth. |
| `GEMINI_READONLY_ANNOTATIONS` | `1` (activo) | En `0` desactiva las anotaciones de compatibilidad `readOnlyHint: true` para clientes Gemini (solo metadato de UI; **no restringe** herramientas ni activa modo solo lectura). |

---

## Seguridad

- `/mcp`, `/mcp/gemini` y `/mcp/gemini/:slot` exigen Bearer token válido con scope `mcp:tools` (OAuth 2.1 + PKCE o API Key) y validan orígenes contra un **allowlist de CORS** (proveedores integrados, loopback, URL pública configurada y orígenes redirect autorizados).
- **Alcance de las herramientas de archivos (`read_file`, `read_files`, `write_file`, `edit_file`, `move_path`, `delete_path`, `list_dir`, `find_files`, `search_text`):** restringidas al workspace activo; bloquean `..`, symlinks externos, el directorio interno del servidor (`src/`, `data/`, `panel/`, etc.), la carpeta de `antigravity-operator`, `.git/config`, `.git/hooks/*` y archivos sensibles (`.env`, `.pem`, `.key`, `id_rsa`, etc.) cuando `protectSensitiveFiles` está activo.
- **Consola (`run_command` y `process_*`):** por diseño, ejecutan PowerShell con los **permisos completos del usuario actual de Windows** para operar el PC y sus herramientas/sesiones. Arrancan en el workspace activo como directorio inicial (`cwd`), pero **no están enjauladas** al workspace ni limitadas por `protectSensitiveFiles`. Si deseas impedir ejecución de consola, desactiva `allowCommands` en `/admin`.
- `/admin`, `/admin/api/*`, `/admin/assets/*` e `/internal/tray/*` solo responden a loopback local (`127.0.0.1`), rechazan cabeceras de proxy/túnel (`403`), bloquean `/admin/assets/index.html` y assets inexistentes (`404`) y exigen autenticación por cookie firmada o `X-Tray-Token`.
- Los comandos y errores guardados en `data/handoffs.json` pasan por redacción de secretos antes de escribirse a disco.

---

## Licencia

MIT — ver [LICENSE](../LICENSE).
