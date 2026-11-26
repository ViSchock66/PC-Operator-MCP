import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SkillCatalog } from './skills.js';

function okJson(data) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }]
  };
}

function failText(error) {
  return {
    isError: true,
    content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }]
  };
}

function registerSafeTool(server, name, config, handler) {
  server.registerTool(name, config, async (args) => {
    try {
      const result = await handler(args || {});
      if (result && typeof result === 'object' && Array.isArray(result.content)) {
        return result;
      }
      return okJson(result);
    } catch (error) {
      return failText(error);
    }
  });
}

function formatDefaultSuffix(defVal) {
  if (defVal === undefined) return '';
  try {
    return ` (default: ${JSON.stringify(defVal)})`;
  } catch {
    return '';
  }
}

function jsonSchemaPropToZod(prop) {
  if (!prop || typeof prop !== 'object') {
    return z.any();
  }

  let schema;
  const unionVariants = Array.isArray(prop.oneOf)
    ? prop.oneOf
    : (Array.isArray(prop.anyOf) ? prop.anyOf : null);

  if (unionVariants && unionVariants.length >= 2) {
    const converted = unionVariants.map((sub) => jsonSchemaPropToZod(sub));
    schema = z.union(converted);
  } else if (Array.isArray(prop.enum) && prop.enum.length > 0 && prop.enum.every((v) => typeof v === 'string')) {
    schema = z.enum(prop.enum);
  } else {
    switch (prop.type) {
      case 'string':
        schema = z.string();
        break;
      case 'integer':
        schema = z.number().int();
        break;
      case 'number':
        schema = z.number();
        break;
      case 'boolean':
        schema = z.boolean();
        break;
      case 'array':
        schema = z.array(prop.items ? jsonSchemaPropToZod(prop.items) : z.any());
        break;
      case 'object':
        if (prop.properties && typeof prop.properties === 'object') {
          schema = z.object(jsonSchemaToZodShape(prop)).passthrough();
        } else {
          schema = z.record(z.string(), z.any());
        }
        break;
      default:
        schema = z.any();
        break;
    }
  }

  // Document default value in description without using Zod .default(), so omitted keys are not
  // artificially injected and forwarded overrides in antigravity-operator keep their native semantics.
  const baseDesc = typeof prop.description === 'string' ? prop.description.trim() : '';
  const defaultSuffix = prop.default !== undefined && !baseDesc.includes('default')
    ? formatDefaultSuffix(prop.default)
    : '';
  const fullDesc = `${baseDesc}${defaultSuffix}`.trim();
  if (fullDesc) {
    schema = schema.describe(fullDesc);
  }
  return schema;
}

export function jsonSchemaToZodShape(inputSchema) {
  const properties = inputSchema?.properties;
  if (!properties || typeof properties !== 'object') {
    return {};
  }
  const requiredSet = new Set(Array.isArray(inputSchema.required) ? inputSchema.required : []);
  const shape = {};
  for (const [key, propDef] of Object.entries(properties)) {
    let fieldSchema = jsonSchemaPropToZod(propDef);
    if (!requiredSet.has(key)) {
      fieldSchema = fieldSchema.optional();
    }
    shape[key] = fieldSchema;
  }
  return shape;
}

const OPERATOR_READ_ONLY_TOOLS = new Set([
  'operator_desktop_screenshot',
  'operator_desktop_list_windows',
  'operator_desktop_ui_tree',
  'operator_chrome_status',
  'operator_chrome_snapshot',
  'operator_firefox_status',
  'operator_firefox_snapshot'
]);

const OPERATOR_NON_DESTRUCTIVE_TOOLS = new Set([
  'operator_desktop_focus_window',
  'operator_desktop_overlay',
  'operator_chrome_open',
  'operator_firefox_open'
]);

function resolveOperatorAnnotations(opTool) {
  const base = opTool?.annotations && typeof opTool.annotations === 'object' ? opTool.annotations : {};
  const isBrowser = opTool.name.includes('chrome') || opTool.name.includes('firefox');

  if (OPERATOR_READ_ONLY_TOOLS.has(opTool.name)) {
    return {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
      ...base
    };
  }

  if (OPERATOR_NON_DESTRUCTIVE_TOOLS.has(opTool.name)) {
    return {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: !isBrowser,
      openWorldHint: isBrowser,
      ...base
    };
  }

  return {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: isBrowser,
    ...base
  };
}

const OPERATOR_DESCRIPTION_HINTS = {
  operator_chrome_open:
    'REGLAS: NO uses esto para leer PDFs/DOCX/imágenes locales (usa read_file con renderPages=true). Modo 1 silencioso: engine="playwright" (web pública) o engine="extension" con active=false, for_user=false (sesión personal). Modo 2 entregar pestañas al usuario: SIEMPRE for_user=true y engine="extension" (nunca playwright).',
  operator_firefox_open:
    'REGLAS: NO uses esto para leer PDFs/DOCX/imágenes locales (usa read_file con renderPages=true). Modo 1 silencioso: engine="playwright" (web pública) o engine="extension" con active=false, for_user=false (sesión personal). Modo 2 entregar pestañas al usuario: SIEMPRE for_user=true y engine="extension" (nunca playwright).',
  operator_chrome_act:
    'Agrupa varias acciones en una sola llamada, pasa siempre tu tab_id. En flujos multi-paso prepara con active=false y en el paso final usa for_user=true (o acción handoff) si vas a entregar la pestaña al usuario (desconecta el banner amarillo automáticamente).',
  operator_firefox_act:
    'Agrupa varias acciones en una sola llamada y pasa siempre tu tab_id. Si vas a entregar la pestaña al usuario, termina con for_user=true o acción handoff.',
  operator_chrome_close_tab:
    'Cierra solo pestañas creadas por esta sesión aislada. NUNCA pases force=true salvo petición explícita del usuario.',
  operator_firefox_close_tab:
    'Cierra solo pestañas creadas por esta sesión aislada. NUNCA pases force=true salvo petición explícita del usuario.',
  operator_desktop_ui_tree:
    'Vía preferida y 100% silenciosa (sin robar foco) para inspeccionar botones/campos de apps nativas Windows antes de actuar con operator_desktop_ui_action.',
  operator_desktop_ui_action:
    'Opera controles Windows vía UI Automation sin robar foco ni mover el cursor físico mientras allow_mouse_fallback=false (defecto).',
  operator_desktop_act:
    'Mueve el cursor físico y puede robar foco: úsalo solo para UI visual/canvas/juegos 3D o con confirmación del usuario. Coordenadas por defecto en coord_space="image" (escala del último screenshot). Si devuelve status="aborted", detente y avisa.'
};

function enrichOperatorDescription(opTool) {
  const base = (opTool.description || `Herramienta federada de antigravity-operator: ${opTool.name}`).trim();
  const hint = OPERATOR_DESCRIPTION_HINTS[opTool.name];
  return hint ? `${base} ${hint}` : base;
}

export function buildMcpServerInstructions({ hasOperator = false, hasProcessManager = false, hasHandoff = false } = {}) {
  const sections = [
    '# Guía de uso — PC Workspace & Operator MCP (Windows 11)',
    '',
    '## 1. Archivos, Código, PDFs, DOCX e Imágenes (Workspace Tools)',
    '- Empieza con `workspace_info` (o `list_dir` / `find_files`) para conocer la ruta absoluta `activeWorkspace`, permisos y estado Git.',
    '- **Rutas:** todas las tools del workspace usan rutas **relativas** a `activeWorkspace`. Si una tool `operator_*` necesita una ruta local (ej. `upload_file` o `screenshot.path`), arma la ruta absoluta usando `activeWorkspace`.',
    '- **Lectura inteligente:** `read_file` lee directamente código/texto (500 líneas por defecto), **imágenes inline** (PNG/JPG/WEBP/GIF), **DOCX/XLSX/PPTX** y **PDFs**. Para revisar visualmente márgenes, diseño o espaciado de un PDF usa `read_file({ path, renderPages: true, pages: "1-2" })`: renderiza en Windows sin abrir Chrome ni ventanas.',
    '- **Lectura por lotes:** usa `read_files` para leer hasta 10 archivos (texto/PDF/DOCX) en UNA sola llamada y evitar rondas innecesarias.',
    '- **Edición:** usa `edit_file` (tras `read_file`) para parches exactos; `write_file` para crear/sobrescribir; `run_command` corre PowerShell oculto dentro del workspace.',
    '- **Skills integradas (`use_skill`):** este MCP incluye skills `SKILL.md` reutilizables (`chrome-operator`, `firefox-operator`, `desktop-operator`, `cv-workflow`, `windows-operator`, `workspace-operator-guide` y skills del workspace). Llama `use_skill()` sin argumentos para listarlas o `use_skill({ name })` para cargar sus instrucciones exactas.',
    '- **Sesiones paralelas aisladas:** tu sesión tiene su propio workspace activo (`select_workspace` solo cambia tu sesión sin interrumpir a otros modelos conectados en paralelo).'
  ];

  if (hasHandoff) {
    sections.push(
      '',
      '## 1A. Handoff entre Modelos (100% Bajo Solicitud)',
      '- **REGLA ESTRICTA DE AISLAMIENTO:** NUNCA llames a `handoff_resume`, `handoff_list` ni `handoff_save` por iniciativa propia en chats normales ni asumas que el usuario quiere continuar otro chat.',
      '- Usa `handoff_resume(...)` **ÚNICAMENTE** cuando el usuario te pida explícitamente retomar trabajo de otro chat/modelo (o pegue un prompt de relevo). Si devuelve `needsSelection: true`, NO adivines: pregunta brevemente cuál proyecto retomar.',
      '- Usa `handoff_save(...)` **ÚNICAMENTE** cuando el usuario te pida guardar un relevo/checkpoint para cambiar de chat. El servidor ya registra en silencio las herramientas ejecutadas ante cortes bruscos de cuota.'
    );
  }

  if (hasProcessManager) {
    sections.push(
      '',
      '## 1B. Gestor de Demonios / Consolas Persistentes (`process_*`)',
      '- Requiere que el usuario encienda el switch **"Modo Control Total / Consola Persistente"** en el panel `/admin` (pestaña Workspaces & Operator).',
      '- Usa `process_start` para dev servers, builds largos o CLIs interactivos que superen el límite de `run_command`; consulta logs con `process_read` (usando `fromOffset` o `tailLines`), envía comandos con `process_send`, lista con `process_list` y detén limpiamente todo el árbol con `process_stop`.'
    );
  }

  if (hasOperator) {
    sections.push(
      '',
      '## 2. Navegador Personal y Headless (`operator_chrome_*` / `operator_firefox_*`)',
      '- **PROHIBIDO** abrir PDFs, DOCX o imágenes locales en Chrome/Firefox para leerlos: usa `read_file` / `read_files`.',
      '- **Modo 1 — Trabajo interno silencioso** (solo investigar/leer/scrapear sin que el usuario pida ver pestañas):',
      '  - Web pública sin login: `engine: "playwright"`, `active: false`, `for_user: false` (100% invisible) y cierra tus pestañas con `close_tab` al terminar.',
      '  - Web con sesión del usuario (Gmail, LinkedIn, portales): `engine: "extension"`, `active: false`, `for_user: false` (auto-inicia el navegador minimizado si estaba cerrado).',
      '- **Modo 2 — Entrega / Handoff al usuario** (el usuario pide "ábreme", "déjame pestañas listas", "para yo revisar/interactuar"):',
      '  - **SIEMPRE `engine: "extension"` + `for_user: true`** (PROHIBIDO `playwright`, es headless e invisible).',
      '  - Si hay varios pasos previos (filtrar, rellenar formularios), opera con `active: false` y en el último paso pasa `for_user: true` (o acción `{ type: "handoff", active: true }`) para asegurar ventana visible y quitar el banner de depuración (`detach: true`).',
      '- **Higiene de pestañas:** tu sesión tiene su propio puente Operator aislado (`ownedTabs` y Playwright separados). Guarda y pasa siempre tu `tab_id`. NUNCA pases `force: true` en `close_tab` salvo orden explícita. No intentes burlar `chrome://*` o `about:*` con `operator_desktop_act`.',
      '',
      '## 3. Escritorio Windows (`operator_desktop_*`)',
      '- Para apps nativas usa primero inspección y UIA sin robar foco: `operator_desktop_list_windows` → `operator_desktop_ui_tree` → `operator_desktop_ui_action` (mantén `allow_mouse_fallback: false`).',
      '- Reserva `operator_desktop_act`, `operator_desktop_focus_window` y `allow_mouse_fallback: true` para interfaces visuales/canvas/juegos 3D o cuando el usuario pida control físico. En `operator_desktop_act`, `coord_space: "image"` coincide con el último screenshot.',
      '- Si una acción devuelve `status: "aborted"` (kill-switch del usuario), detente de inmediato y avisa antes de continuar.'
    );
  }

  return sections.join('\n');
}

/**
 * Creates an McpServer instance wired to the workspace harness tools, embedded usage guidance,
 * and optional federated Antigravity Operator tools (isolated per client session).
 */
export function createWorkspaceMcpServer(harness, options = {}) {
  const operatorTools = Array.isArray(options.operatorTools) ? options.operatorTools : [];
  const operatorBridge = options.operatorBridge;
  const processManager = options.processManager || null;
  const handoffManager = options.handoffManager || null;
  const skillCatalog = options.skillCatalog || new SkillCatalog({ configManager: harness?.configManager });
  const sessionKey = options.sessionKey || harness?.sessionKey || 'default';
  const clientLabel = options.clientLabel || harness?.clientLabel || 'MCP';
  const hasOperator = Boolean(operatorBridge && operatorTools.length > 0);
  const hasProcessManager = Boolean(processManager);
  const hasHandoff = Boolean(handoffManager);
  const instructions = buildMcpServerInstructions({ hasOperator, hasProcessManager, hasHandoff });

  const server = new McpServer(
    {
      name: 'gemini-pc-workspace-mcp',
      version: '0.3.0'
    },
    {
      instructions
    }
  );

  // Workaround for Gemini Web MCP bug: tools with readOnlyHint=false revert from
  // 'Always allow' back to 'Always ask' after every invocation. Keep real annotations
  // for Claude/ChatGPT/other clients, and expose readOnlyHint=true only for Google/Gemini
  // (disable anytime with GEMINI_READONLY_ANNOTATIONS=0).
  const isGeminiClient = options.isGeminiClient !== undefined
    ? Boolean(options.isGeminiClient)
    : /^google\b|gemini/i.test(String(clientLabel || '').trim());
  const forceGeminiReadOnly =
    options.geminiReadOnlyAnnotations !== undefined
      ? Boolean(options.geminiReadOnlyAnnotations)
      : process.env.GEMINI_READONLY_ANNOTATIONS !== '0';

  const normalizeConfigForClient = (config) => {
    if (!isGeminiClient || !forceGeminiReadOnly || !config || typeof config !== 'object') {
      return config;
    }
    return {
      ...config,
      annotations: {
        ...(config.annotations || {}),
        ...(config.title ? { title: config.title } : {}),
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    };
  };

  const onToolEvent = options.onToolEvent;
  const origRegisterTool = server.registerTool.bind(server);
  server.registerTool = (name, config, handler) => {
    const effectiveConfig = normalizeConfigForClient(config);
    if (!onToolEvent) {
      return origRegisterTool(name, effectiveConfig, handler);
    }
    return origRegisterTool(name, effectiveConfig, async (args, extra) => {
      const started = Date.now();
      const res = await handler(args, extra);
      onToolEvent({
        tool: name,
        args: args || {},
        ok: !res?.isError,
        durationMs: Date.now() - started,
        error: res?.isError ? res?.content?.[0]?.text : undefined
      });
      return res;
    });
  };

  // Expose the operational guide as both an MCP Resource and an MCP Prompt for clients that inspect them.
  server.registerResource(
    'guia_uso_mcp',
    'mcp://workspace-operator/guide',
    {
      title: 'Guía Operativa — PC Workspace & Operator MCP',
      description: 'Reglas de uso combinado de Workspace (texto, imágenes, PDFs, DOCX, batch) y Antigravity Operator (Chrome/Firefox Modo 1 silencioso vs Modo 2 entrega, Desktop UIA).',
      mimeType: 'text/markdown'
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/markdown',
          text: instructions
        }
      ]
    })
  );

  server.registerPrompt(
    'como_usar_este_mcp',
    {
      title: 'Cómo usar PC Workspace + Antigravity Operator',
      description: 'Inyecta el manual rápido de buenas prácticas para operar archivos locales, PDFs/DOCX/imágenes, Chrome/Firefox y Windows sin estorbar ni bloquear sesiones.'
    },
    async () => ({
      description: 'Guía rápida para operar el servidor PC Workspace & Operator MCP.',
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: instructions
          }
        }
      ]
    })
  );

  registerSafeTool(
    server,
    'workspace_info',
    {
      title: 'Info del Workspace',
      description: 'Muestra el workspace activo de tu sesión (ruta absoluta), workspaces autorizados, permisos, resumen Git y guía rápida de capacidades (PDF, DOCX, imágenes, batch, skills y Operator).',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    () => harness.workspaceInfo()
  );

  registerSafeTool(
    server,
    'use_skill',
    {
      title: 'Listar o Cargar Skill (SKILL.md)',
      description: 'Lista todas las skills integradas del MCP (chrome-operator, firefox-operator, desktop-operator, cv-workflow, windows-operator, workspace-operator-guide y skills del workspace) o carga el manual completo SKILL.md de una skill específica por nombre.',
      inputSchema: {
        name: z.string().optional().describe('Nombre de la skill a cargar (ej. "chrome-operator", "cv-workflow", "desktop-operator", "workspace-operator-guide"). Omítelo para listar todas las skills disponibles.')
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    ({ name }) => skillCatalog.useSkill({
      name,
      harness,
      builtinGuideText: instructions,
      includeOperatorSkills: hasOperator
    })
  );

  registerSafeTool(
    server,
    'list_workspaces',
    {
      title: 'Listar Workspaces Autorizados',
      description: 'Lista todas las carpetas autorizadas en el PC a las que puedes cambiar en tu sesión con select_workspace.',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    () => harness.listWorkspaces()
  );

  registerSafeTool(
    server,
    'select_workspace',
    {
      title: 'Cambiar Workspace Activo',
      description: 'Cambia el workspace activo solo para TU sesión paralela (sin interrumpir a otros modelos conectados) a una carpeta listada en list_workspaces.',
      inputSchema: {
        path: z.string().describe('Ruta exacta de la carpeta autorizada (obtenida desde list_workspaces).')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    ({ path }) => harness.selectWorkspace(path)
  );

  registerSafeTool(
    server,
    'list_dir',
    {
      title: 'Listar Directorio',
      description: 'Lista archivos y subcarpetas dentro del workspace activo con tamaños.',
      inputSchema: {
        path: z.string().optional().describe('Ruta relativa dentro del workspace (por defecto ".").'),
        depth: z.number().int().min(1).max(5).optional().describe('Profundidad de recorrido (1 a 5, por defecto 2).'),
        includeIgnored: z.boolean().optional().describe('Si es true, incluye node_modules, .git, dist, etc.')
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    (args) => harness.listDir(args)
  );

  registerSafeTool(
    server,
    'find_files',
    {
      title: 'Buscar Archivos',
      description: 'Busca archivos dentro del workspace activo usando patrón glob (ej. "*.pdf", "*.docx", "src/**/*.js").',
      inputSchema: {
        pattern: z.string().optional().describe('Patrón glob (ej. "*.pdf", "*.py", "src/**/*.ts"). Por defecto "*".'),
        path: z.string().optional().describe('Subcarpeta inicial (por defecto ".").'),
        includeIgnored: z.boolean().optional().describe('Incluir carpetas ignoradas como node_modules/.git.'),
        maxResults: z.number().int().min(1).max(500).optional().describe('Máximo de archivos a devolver (por defecto 150).')
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    (args) => harness.findFiles(args)
  );

  registerSafeTool(
    server,
    'search_text',
    {
      title: 'Buscar Texto en Código',
      description: 'Busca texto o expresiones regulares dentro de los archivos de texto del workspace activo.',
      inputSchema: {
        query: z.string().describe('Texto o expresión regular a buscar.'),
        path: z.string().optional().describe('Archivo o subcarpeta donde buscar (por defecto ".").'),
        isRegex: z.boolean().optional().describe('Si es true, interpreta query como RegExp.'),
        caseSensitive: z.boolean().optional().describe('Distinguir mayúsculas y minúsculas.'),
        filePattern: z.string().optional().describe('Filtrar archivos por glob (ej. "*.js").'),
        maxMatches: z.number().int().min(1).max(200).optional().describe('Máximo de coincidencias (por defecto 80).')
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    (args) => harness.searchText(args)
  );

  registerSafeTool(
    server,
    'read_file',
    {
      title: 'Leer Archivo (Texto, Imagen, PDF o DOCX)',
      description: 'Lee archivos del workspace: código/texto (500 líneas por defecto), imágenes PNG/JPG/WEBP/GIF inline, DOCX/XLSX/PPTX (texto) y PDFs (texto o renderPages=true para ver imágenes JPEG de páginas sin abrir Chrome).',
      inputSchema: {
        path: z.string().describe('Ruta del archivo relativa al workspace.'),
        startLine: z.number().int().min(1).optional().describe('Solo texto/código: línea inicial (1-indexed, defecto 1).'),
        endLine: z.number().int().min(1).optional().describe('Solo texto/código: línea final inclusiva (defecto startLine + 499).'),
        pages: z.string().optional().describe('Solo PDF: rango de páginas a leer/renderizar (ej. "1", "1-3", "1,3").'),
        renderPages: z.boolean().optional().describe('Solo PDF en Windows: si es true, renderiza las páginas a imágenes JPEG inline (máx. 4 por llamada) sin abrir ventanas ni Chrome para auditar diseño visual/márgenes.'),
        maxWidth: z.number().int().min(400).max(1600).optional().describe('Solo PDF con renderPages=true: ancho en px (defecto 1000).'),
        quality: z.number().int().min(40).max(95).optional().describe('Solo PDF con renderPages=true: calidad JPEG 40-95 (defecto 82).')
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    (args) => harness.readFile(args)
  );

  registerSafeTool(
    server,
    'read_files',
    {
      title: 'Leer Múltiples Archivos en Lote',
      description: 'Lee hasta 10 archivos (texto/código, PDF texto o DOCX/XLSX/PPTX) en UNA sola llamada para auditar o comparar documentos rápidamente reduciendo rondas de herramientas.',
      inputSchema: {
        paths: z.array(z.string()).min(1).max(10).describe('Lista de 1 a 10 rutas relativas al workspace.'),
        maxLinesPerFile: z.number().int().min(20).max(1000).optional().describe('Máximo de líneas por archivo de texto (defecto 250).'),
        maxTotalBytes: z.number().int().min(4096).max(262144).optional().describe('Presupuesto máximo total de bytes del lote.')
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    (args) => harness.readFiles(args)
  );

  registerSafeTool(
    server,
    'write_file',
    {
      title: 'Escribir o Crear Archivo',
      description: 'Crea un archivo nuevo o sobrescribe/anexa contenido a un archivo dentro del workspace activo.',
      inputSchema: {
        path: z.string().describe('Ruta relativa dentro del workspace.'),
        content: z.string().describe('Contenido completo (o a anexar si append=true).'),
        append: z.boolean().optional().describe('Si es true, agrega al final del archivo en lugar de sobrescribir.'),
        createDirs: z.boolean().optional().describe('Crear carpetas padre automáticamente (por defecto true).')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    (args) => harness.writeFile(args)
  );

  registerSafeTool(
    server,
    'edit_file',
    {
      title: 'Editar Fragmento de Archivo',
      description: 'Reemplaza un bloque exacto de texto en un archivo del workspace sin reescribir todo el archivo.',
      inputSchema: {
        path: z.string().describe('Ruta relativa del archivo a editar.'),
        target: z.string().describe('Texto exacto existente a reemplazar (lee primero con read_file).'),
        replacement: z.string().describe('Nuevo texto de reemplazo.'),
        replaceAll: z.boolean().optional().describe('Si es true, reemplaza todas las ocurrencias.')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    (args) => harness.editFile(args)
  );

  registerSafeTool(
    server,
    'move_path',
    {
      title: 'Mover o Renombrar',
      description: 'Mueve o renombra un archivo o carpeta dentro del workspace activo.',
      inputSchema: {
        source: z.string().describe('Ruta origen relativa al workspace.'),
        destination: z.string().describe('Ruta destino relativa al workspace.')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    (args) => harness.movePath(args)
  );

  registerSafeTool(
    server,
    'delete_path',
    {
      title: 'Borrar Archivo o Carpeta',
      description: 'Elimina un archivo o carpeta dentro del workspace activo (nunca la raíz del workspace).',
      inputSchema: {
        path: z.string().describe('Ruta relativa a eliminar.'),
        recursive: z.boolean().optional().describe('Necesario en true para borrar carpetas con contenido.')
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
    },
    (args) => harness.deletePath(args)
  );

  registerSafeTool(
    server,
    'run_command',
    {
      title: 'Ejecutar Comando en Workspace',
      description: 'Ejecuta un comando de terminal (PowerShell oculto en Windows) dentro del workspace activo para tests, builds o scripts. NO uses comandos para leer archivos/PDFs/DOCX si read_file/read_files ya lo resuelve.',
      inputSchema: {
        command: z.string().describe('Comando a ejecutar en el directorio del workspace.'),
        cwd: z.string().optional().describe('Subcarpeta relativa dentro del workspace (por defecto ".").'),
        timeoutMs: z.number().int().min(1000).max(120000).optional().describe('Timeout en ms (1000 a 120000).')
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
    },
    (args) => harness.runCommand(args)
  );

  registerSafeTool(
    server,
    'git_harness',
    {
      title: 'Inspección Git',
      description: 'Consulta rápida de Git en el workspace activo: status, diff, log o branches.',
      inputSchema: {
        action: z.enum(['status', 'diff', 'log', 'branches']).optional().describe('Acción git (por defecto status).'),
        path: z.string().optional().describe('Archivo opcional para action=diff.'),
        count: z.number().int().min(1).max(30).optional().describe('Cantidad de commits para action=log.')
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    (args) => harness.gitHarness(args)
  );

  // Cross-model handoff tools (explicit checkpoints + automatic session tool-trail recovery)
  if (handoffManager) {
    server.registerPrompt(
      'retomar_handoff',
      {
        title: 'Retomar Handoff de otro Modelo/Chat',
        description: 'Instruye al nuevo chat a llamar a handoff_resume() para recuperar el último checkpoint, archivos tocados, comandos y workspace activo.'
      },
      async () => ({
        description: 'Retoma el último trabajo guardado o auto-rastreado en el servidor MCP.',
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: 'Estoy cambiando de chat/modelo para continuar el trabajo anterior. Llama primero a `handoff_resume()` (y si hace falta `handoff_list()`) para alinear tu workspace, ver qué archivos fueron modificados, qué comandos corrieron, qué procesos siguen vivos y continuar exactamente donde quedó.'
            }
          }
        ]
      })
    );

    registerSafeTool(
      server,
      'handoff_save',
      {
        title: 'Guardar Handoff entre Modelos',
        description: 'SOLO bajo petición explícita del usuario: guarda un checkpoint de relevo (resumen, objetivo, completado, pendiente y archivos clave) para que otro chat/modelo retome después.',
        inputSchema: {
          title: z.string().optional().describe('Título corto de la tarea actual.'),
          summary: z.string().optional().describe('Resumen claro del contexto actual y decisiones tomadas.'),
          currentGoal: z.string().optional().describe('Objetivo inmediato que estabas resolviendo.'),
          completedSteps: z.array(z.string()).optional().describe('Lista de pasos ya completados.'),
          pendingTasks: z.array(z.string()).optional().describe('Lista de pasos pendientes o próximos pasos exactos.'),
          relevantFiles: z.array(z.string()).optional().describe('Rutas clave relativas al workspace.'),
          notes: z.string().optional().describe('Notas técnicas, errores vistos o advertencias para el siguiente modelo.'),
          targetClient: z.string().optional().describe('Modelo/cliente destino sugerido (ej. "Gemini", "Claude", "ChatGPT").')
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
      },
      (args) => handoffManager.saveCheckpoint({
        ...args,
        sessionKey,
        clientLabel,
        activeWorkspace: harness.getActiveRoot()
      })
    );

    registerSafeTool(
      server,
      'handoff_resume',
      {
        title: 'Retomar Handoff / Sesión Anterior',
        description: 'SOLO bajo petición explícita del usuario: recupera un checkpoint o rastro automático de otro chat/modelo (archivos modificados, git diff stat, comandos y procesos vivos) y alinea el workspace. Si hay varios proyectos ambiguos devuelve needsSelection=true sin cambiar el workspace.',
        inputSchema: {
          id: z.string().optional().describe('ID específico de checkpoint (ej. hoff_a1b2c3d4).'),
          trailKey: z.string().optional().describe('Clave específica de rastro (obtenida desde handoff_list o del prompt de /admin).'),
          workspace: z.string().optional().describe('Filtro opcional por nombre de carpeta o ruta de workspace (ej. "gemini-pc-mcp").'),
          fromClient: z.string().optional().describe('Filtro opcional por cliente/modelo origen (ej. "claude", "gemini", "chatgpt").'),
          autoSelectWorkspace: z.boolean().optional().describe('Si es true (defecto), alinea automáticamente el workspace de tu sesión al del handoff.')
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
      },
      (args) => handoffManager.resumeHandoff({
        id: args.id,
        trailKey: args.trailKey,
        workspace: args.workspace,
        fromClient: args.fromClient,
        currentSessionKey: sessionKey,
        currentClientLabel: clientLabel,
        harness,
        autoSelectWorkspace: args.autoSelectWorkspace !== false
      })
    );

    registerSafeTool(
      server,
      'handoff_list',
      {
        title: 'Listar Handoffs y Rastros Recientes',
        description: 'SOLO bajo petición explícita del usuario: lista checkpoints guardados y rastros automáticos recientes separados por (modelo, workspace) con su antigüedad en minutos.',
        inputSchema: {
          includeResumed: z.boolean().optional().describe('Incluir checkpoints ya retomados (defecto true).'),
          workspace: z.string().optional().describe('Filtrar opcionalmente por nombre o ruta de workspace.')
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
      },
      (args) => handoffManager.listHandoffs({
        includeResumed: args.includeResumed !== false,
        workspace: args.workspace || ''
      })
    );
  }

  // Persistent background daemons / interactive consoles (gated by Modo Control Total in /admin)
  if (processManager) {
    registerSafeTool(
      server,
      'process_list',
      {
        title: 'Listar Demonios / Procesos',
        description: 'Lista los procesos/consolas persistentes en segundo plano y muestra si el switch "Modo Control Total" está activo.',
        inputSchema: {
          includeExited: z.boolean().optional().describe('Incluir procesos ya terminados recientemente (defecto true).')
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
      },
      (args) => processManager.listProcesses(args)
    );

    registerSafeTool(
      server,
      'process_read',
      {
        title: 'Leer Logs de Proceso',
        description: 'Lee stdout/stderr de un proceso/demonio persistente usando tailLines o fromOffset incremental.',
        inputSchema: {
          id: z.string().describe('ID del proceso (ej. proc_a1b2c3d4) obtenido desde process_start o process_list.'),
          tailLines: z.number().int().min(1).max(500).optional().describe('Últimas N líneas a devolver (defecto 80).'),
          fromOffset: z.number().int().min(0).optional().describe('Cursor nextOffset devuelto en la lectura anterior para leer solo lo nuevo.')
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
      },
      (args) => processManager.readProcessOutput(args)
    );

    registerSafeTool(
      server,
      'process_start',
      {
        title: 'Iniciar Demonio / Consola Persistente',
        description: 'Lanza un proceso o servidor en segundo plano (PowerShell/CLI) que sobrevive más allá de 120s. Requiere activar "Modo Control Total" en /admin.',
        inputSchema: {
          command: z.string().describe('Comando a lanzar en segundo plano (ej. "npm run dev", "python server.py", "powershell").'),
          name: z.string().optional().describe('Etiqueta corta legible para identificar el proceso en /admin.'),
          cwd: z.string().optional().describe('Subcarpeta relativa al workspace (o ruta absoluta si cwd libre está activo en Modo Control Total).'),
          waitMs: z.number().int().min(0).max(10000).optional().describe('Tiempo inicial de espera para capturar logs de arranque (defecto 800 ms).')
        },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
      },
      (args) => processManager.startProcess({
        ...args,
        harness,
        sessionKey,
        clientLabel
      })
    );

    registerSafeTool(
      server,
      'process_send',
      {
        title: 'Enviar Entrada a Consola Viva',
        description: 'Escribe texto/comandos al stdin de un proceso interactivo en ejecución y devuelve la salida nueva.',
        inputSchema: {
          id: z.string().describe('ID del proceso en ejecución.'),
          input: z.string().describe('Texto o comando a enviar por stdin.'),
          appendNewline: z.boolean().optional().describe('Agregar salto de línea al final (defecto true).'),
          waitMs: z.number().int().min(0).max(5000).optional().describe('Espera breve para recoger respuesta (defecto 400 ms).')
        },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
      },
      (args) => processManager.sendProcessInput(args)
    );

    registerSafeTool(
      server,
      'process_stop',
      {
        title: 'Detener Demonio / Proceso',
        description: 'Detiene un proceso en segundo plano y todo su árbol de procesos hijos (taskkill /T /F en Windows).',
        inputSchema: {
          id: z.string().describe('ID del proceso a detener.')
        },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
      },
      (args) => processManager.stopProcess(args)
    );
  }

  // Federated Antigravity Operator tools (Chrome, Firefox, Playwright, Windows Desktop/UIA/DXGI)
  if (hasOperator) {
    for (const opTool of operatorTools) {
      if (!opTool?.name) continue;
      registerSafeTool(
        server,
        opTool.name,
        {
          title: opTool.title || opTool.name,
          description: enrichOperatorDescription(opTool),
          inputSchema: jsonSchemaToZodShape(opTool.inputSchema),
          annotations: resolveOperatorAnnotations(opTool)
        },
        (args) => operatorBridge.callTool(opTool.name, args)
      );
    }
  }

  return server;
}
