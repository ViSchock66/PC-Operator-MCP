# PC Workspace & Operator MCP (`gemini-pc-mcp`)

Servidor **MCP (Streamable HTTP + OAuth 2.1 + API Keys)** para Windows 11 que conecta **Google Gemini**, **Claude (`claude.ai`)**, **ChatGPT (`chatgpt.com`)** y clientes/scripts locales a tus workspaces en disco, con lectura multimodal (texto, imágenes, PDF texto/visual, DOCX/XLSX/PPTX), skills `SKILL.md`, consolas persistentes, federación de **Antigravity Operator** (Chrome/Firefox/Escritorio) y **Handoff entre modelos 100% bajo solicitud**.

Incluye **URL HTTPS fija** (Tailscale Funnel o Cloudflare Tunnel), **Panel Gráfico local (`/admin`)** e **ícono nativo en la bandeja del sistema**.

> Para detalles técnicos de módulos, endpoints HTTP, persistencia y diseño interno, consulta [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md).

---

## Inicio rápido

1. Haz doble clic en **`Abrir-Panel.bat`** (o ejecuta `npm run panel` / `.\start.ps1 -Gui`).
   - Inicia el daemon oculto (`node src/launcher.js`), levanta el túnel configurado, compila/inicia el ícono de bandeja (`pc-operator-tray.exe`) y abre `http://127.0.0.1:3333/admin`.
   - Puedes cerrar la ventana del panel y reabrirla con `Abrir-Panel.bat` sin apagar el servidor ni el túnel.
   - Para reiniciar el proceso Node tras cambios de código: pulsa **Apagar Daemon & Salir** (barra lateral izquierda de `/admin`) y vuelve a abrir `Abrir-Panel.bat`.
2. Ingresa tu **PIN local** (guardado en `data/config.json` o visible en consola si inicias con `npm run tunnel`).

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

## Conectar modelos (OAuth 2.1 y API Keys)

El servidor soporta **sesiones paralelas aisladas**: puedes tener Gemini, Claude y ChatGPT conectados al mismo tiempo; cada cliente tiene su propio `activeWorkspace` de sesión y su propio puente `OperatorBridge` aislado.

- **Endpoint general (Claude, ChatGPT, clientes MCP estándar):**
  `https://<tu-url-fija>/mcp`
- **Endpoint dedicado Gemini Web (recomendado para `gemini.google.com`):**
  `https://<tu-url-fija>/mcp/gemini` *(y slots paralelos `/mcp/gemini/<slot>`)*
  > **Por qué existe `/mcp/gemini`:** aplica automáticamente el workaround `readOnlyHint: true` (desactivable con `GEMINI_READONLY_ANNOTATIONS=0`) para evitar que Gemini Web revierta permisos *"Permitir siempre"* tras cada llamada, además de exponer metadata RFC 9728 por ruta.
- **Proveedores OAuth incluidos:** Google Gemini (prod/sandbox/test), Claude (`claude.ai`), ChatGPT (`chatgpt.com` / `chat.openai.com`), orígenes personalizados configurables desde `/admin`, registro dinámico (**DCR**) y cliente estático (**ID + Secreto**).
- **API Keys (`gp_key_*`):** generables y revocables desde `/admin` → **Conectores & Auth** para clientes o scripts con `Authorization: Bearer <token>`.

---

## Panel Gráfico Local (`/admin`)

Accesible **solo desde `127.0.0.1`** con PIN (rechaza cualquier acceso vía proxy/túnel con `403`). Organizado en 7 pestañas (atajos de teclado `1`–`7`):

1. **Resumen (`1`):** KPIs en vivo (túnel, sesiones LLM, Operator, demonios), URLs `/mcp` y `/mcp/gemini`, PIN/OAuth y consola de logs SSE con filtros.
2. **Conectores & Auth (`2`):** Proveedores OAuth integrados, orígenes redirect personalizados, generación/revocación de API Keys `gp_key_*` y revocación global de sesiones OAuth.
3. **Túnel & Red (`3`):** Selector de modo (**Tailscale Funnel**, **Cloudflare Tunnel Fijo**, **Cloudflare Quick Tunnel** o **Solo Local**), detección automática de red, puerto y PIN.
4. **Workspaces & Permisos (`4`):** Selector con Explorador de Windows, filtro de carpetas autorizadas, botón **Sincronizar Sesiones** y permisos (`allowWrite`, `allowDelete`, `allowCommands`, `protectSensitiveFiles`, `commandTimeoutMs`, `maxReadBytes`).
5. **Operator & Demonios (`5`):** Activación de **Antigravity Operator**, lista de sesiones paralelas aisladas, switch **Modo Control Total** con auto-apagado por TTL y gestor de consolas persistentes.
6. **Handoff (`6`):** Actividad reciente auto-rastreada por `(modelo, proyecto)` con tiempos relativos, detalle desplegable de comandos/acciones, nota rápida opcional al congelar y botón de 1 clic para copiar el prompt de relevo.
7. **Guía de Conexión (`7`):** Checklist en vivo de preparación y pasos exactos para vincular Claude, Gemini y ChatGPT.

---

## Inventario de Herramientas MCP

### 1. Workspace, Código, Documentos y Skills (15 tools)
- **Contexto y navegación:** `workspace_info`, `list_workspaces`, `select_workspace` *(solo cambia tu sesión)*, `list_dir`, `find_files`, `search_text`.
- **Lectura multimodal y por lotes:**
  - `read_file`: código/texto paginado por líneas, imágenes inline (`png`, `jpg`, `webp`, `gif`), Office (`docx`, `xlsx`, `pptx`) y **PDF** (extracción de texto o `renderPages: true` a JPEG inline sin abrir Chrome).
  - `read_files`: lee hasta 10 archivos en una sola llamada.
- **Edición y ejecución:** `write_file`, `edit_file`, `move_path`, `delete_path`, `run_command` (PowerShell oculto con timeout configurable), `git_harness` (`status`, `diff`, `log`, `branches`).
- **Skills integradas:** `use_skill` lista y carga playbooks `SKILL.md` (del workspace activo, guía integrada `workspace-operator-guide`, skills de Operator y skills globales del usuario).

### 2. Handoff entre Modelos — 100% Bajo Solicitud (3 tools)
Pensado para uso diario si un chat se queda sin cuota a mitad de camino, **sin ensuciar chats normales**:
- El servidor registra silenciosamente en `data/handoffs.json` cada acción real de trabajo (`write_file`, `edit_file`, `read_file`, `run_command`, etc.), **particionado por `(sessionKey, workspace)`** y con **redacción automática de secretos** (`Bearer`, `gp_key_`, `sk-`, `password=`, `token=`).
- `workspace_info` **nunca** inyecta pistas de otras sesiones ni checkpoints.
- `handoff_save`: guarda un checkpoint explícito (resumen, objetivo, completado, pendiente, archivos clave) solo cuando el usuario lo pide.
- `handoff_resume`: recupera un checkpoint o rastro automático (archivos modificados, `git diff --stat`, comandos y procesos vivos) y alinea el workspace. Acepta `id`, `trailKey`, `workspace` o `fromClient`; si hay ambigüedad entre varios proyectos recientes, devuelve `needsSelection: true` sin tocar el workspace.
- `handoff_list`: lista checkpoints guardados y rastros recientes por `(modelo, proyecto)` con su antigüedad en minutos.

### 3. Demonios y Consolas Persistentes (5 tools — *Modo Control Total*)
Requieren activar el switch **Modo Control Total** en `/admin` (con temporizador TTL de auto-apagado y opción de `cwd` libre):
- `process_list`, `process_start`, `process_read` (por `tailLines` o `fromOffset`), `process_send` (stdin interactivo) y `process_stop` (detiene todo el árbol con `taskkill /T /F`).

### 4. Antigravity Operator Federado (17 tools opcionales)
Si el plugin `antigravity-operator` está habilitado en `/admin`, el servidor federa con aislamiento por sesión (`AG_OPERATOR_SESSION_KEY`):
- **Chrome / Firefox (`operator_chrome_*`, `operator_firefox_*`):** modo silencioso (`playwright` headless o `extension` en segundo plano) y entrega de pestañas al usuario (`for_user: true`).
- **Escritorio Windows (`operator_desktop_*`):** capturas, listado de ventanas, árbol UI Automation sin foco (`ui_tree`, `ui_action`), control visual/3D (`act`) y overlay.

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
| `GEMINI_READONLY_ANNOTATIONS` | `1` (activo) | En `0` desactiva el workaround `readOnlyHint: true` para clientes Gemini. |

---

## Seguridad

- `/mcp`, `/mcp/gemini` y `/mcp/gemini/:slot` exigen Bearer token válido con scope `mcp:tools` (OAuth 2.1 + PKCE o API Key).
- Enjaulado estricto dentro del workspace activo: bloquea `..`, symlinks externos, el directorio interno del propio servidor (`src/`, `data/`, `panel/`, etc.), la carpeta de `antigravity-operator`, `.git/config`, `.git/hooks/*` y archivos sensibles (`.env`, `.pem`, `.key`, `id_rsa`, etc.).
- `/admin`, `/admin/api/*` y `/internal/tray/*` solo responden a loopback local (`127.0.0.1`), rechazan cabeceras de proxy/túnel (`403`) y exigen autenticación por cookie firmada o `trayToken`.
- Los comandos y errores guardados en `data/handoffs.json` pasan por redacción de secretos antes de escribirse a disco.
