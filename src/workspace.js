import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { buildSanitizedShellEnv } from './shellEnv.js';

const execFileAsync = promisify(execFile);

const DEFAULT_IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.venv',
  'venv',
  'dist',
  'build',
  '.next',
  '__pycache__',
  'target',
  '.backups'
]);

const SENSITIVE_BASENAME_RE = /^(?:\.env(?:\.(?!example$|template$|sample$).+)?|id_rsa(?:\.pub)?|id_ed25519(?:\.pub)?|.*\.(?:pem|key|pfx|p12))$/i;

const IMAGE_MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
};

const OFFICE_EXTS = new Set(['.docx', '.xlsx', '.pptx']);

function normalizeCompare(p) {
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

export function isSubPath(parentReal, childReal) {
  const rel = path.relative(normalizeCompare(parentReal), normalizeCompare(childReal));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function globToRegExp(glob) {
  const normalized = glob.replace(/\\/g, '/').trim();
  let regexStr = '^';
  let i = 0;
  while (i < normalized.length) {
    const ch = normalized[i];
    if (ch === '*') {
      if (normalized[i + 1] === '*') {
        if (normalized[i + 2] === '/') {
          regexStr += '(?:.*/)?';
          i += 3;
          continue;
        }
        regexStr += '.*';
        i += 2;
        continue;
      }
      regexStr += '[^/]*';
      i += 1;
    } else if (ch === '?') {
      regexStr += '[^/]';
      i += 1;
    } else if ('\\.^$+{}()|[]'.includes(ch)) {
      regexStr += `\\${ch}`;
      i += 1;
    } else {
      regexStr += ch;
      i += 1;
    }
  }
  regexStr += '$';
  return new RegExp(regexStr, 'i');
}

function isLikelyBinary(buffer) {
  const sampleLen = Math.min(buffer.length, 8192);
  for (let i = 0; i < sampleLen; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

export function parsePageRange(spec, totalPages, maxPages = 20) {
  const total = Math.max(0, Number(totalPages) || 0);
  if (total === 0) return [];
  const cap = Math.max(1, Number(maxPages) || 20);

  if (!spec || typeof spec !== 'string' || !spec.trim()) {
    const out = [];
    for (let p = 1; p <= Math.min(total, cap); p++) out.push(p);
    return out;
  }

  const set = new Set();
  for (const part of spec.split(',')) {
    const token = part.trim();
    if (!token) continue;
    const rangeMatch = /^(\d+)\s*-\s*(\d+)$/.exec(token);
    if (rangeMatch) {
      const a = Math.max(1, Number(rangeMatch[1]));
      const b = Math.min(total, Number(rangeMatch[2]));
      const start = Math.min(a, b);
      const end = Math.max(a, b);
      for (let p = start; p <= Math.min(end, total); p++) {
        set.add(p);
        if (set.size >= cap) break;
      }
    } else if (/^\d+$/.test(token)) {
      const p = Number(token);
      if (p >= 1 && p <= total) set.add(p);
    }
    if (set.size >= cap) break;
  }
  return Array.from(set).sort((a, b) => a - b).slice(0, cap);
}

const PY_EXTRACT_PDF = `
import json, os, sys
from pypdf import PdfReader

pdf_path = os.environ["MCP_PDF_PATH"]
spec = os.environ.get("MCP_PDF_PAGES", "").strip()
max_chars = int(os.environ.get("MCP_PDF_MAX_CHARS", "80000"))
max_pages = int(os.environ.get("MCP_PDF_MAX_PAGES", "20"))

reader = PdfReader(pdf_path)
total = len(reader.pages)

def pick_pages(spec_str, total_pages, cap):
    if total_pages <= 0:
        return []
    if not spec_str:
        return list(range(1, min(total_pages, cap) + 1))
    picked = set()
    for token in spec_str.split(","):
        token = token.strip()
        if not token:
            continue
        if "-" in token:
            parts = token.split("-", 1)
            if parts[0].strip().isdigit() and parts[1].strip().isdigit():
                a = max(1, int(parts[0].strip()))
                b = min(total_pages, int(parts[1].strip()))
                for p in range(min(a, b), min(max(a, b), total_pages) + 1):
                    picked.add(p)
                    if len(picked) >= cap:
                        break
        elif token.isdigit():
            p = int(token)
            if 1 <= p <= total_pages:
                picked.add(p)
        if len(picked) >= cap:
            break
    return sorted(picked)[:cap]

chosen = pick_pages(spec, total, max_pages)
pages_out = []
used = 0
truncated = len(chosen) < total and not spec
for p in chosen:
    txt = reader.pages[p - 1].extract_text() or ""
    if used + len(txt) > max_chars:
        room = max(0, max_chars - used)
        txt = txt[:room]
        truncated = True
    pages_out.append({"page": p, "text": txt})
    used += len(txt)
    if used >= max_chars:
        truncated = True
        break

meta = {}
try:
    if reader.metadata:
        for k, v in reader.metadata.items():
            if v:
                meta[str(k).lstrip("/")] = str(v)[:200]
except Exception:
    pass

print(json.dumps({
    "totalPages": total,
    "pagesRead": [x["page"] for x in pages_out],
    "truncated": truncated,
    "metadata": meta,
    "pages": pages_out
}, ensure_ascii=False))
`;

const PY_EXTRACT_OFFICE = `
import json, os, re, zipfile
import xml.etree.ElementTree as ET

file_path = os.environ["MCP_OFFICE_PATH"]
ext = os.environ["MCP_OFFICE_EXT"].lower()
max_chars = int(os.environ.get("MCP_OFFICE_MAX_CHARS", "80000"))

def local_tag(tag):
    return tag.split("}", 1)[-1] if "}" in tag else tag

lines = []
with zipfile.ZipFile(file_path, "r") as zf:
    names = zf.namelist()
    if ext == ".docx":
        def read_docx_xml(member):
            root = ET.fromstring(zf.read(member))
            out = []
            def walk_block(node):
                for child in list(node):
                    t = local_tag(child.tag)
                    if t == "p":
                        txt = "".join(
                            (c.text or "") if local_tag(c.tag) == "t" else ("\\t" if local_tag(c.tag) == "tab" else ("\\n" if local_tag(c.tag) in ("br", "cr") else ""))
                            for c in child.iter()
                        ).strip()
                        if txt:
                            out.append(txt)
                    elif t == "tbl":
                        for tr in child:
                            if local_tag(tr.tag) != "tr":
                                continue
                            cells = []
                            for tc in tr:
                                if local_tag(tc.tag) != "tc":
                                    continue
                                cell_parts = []
                                for p in tc.iter():
                                    if local_tag(p.tag) == "p":
                                        pt = "".join((c.text or "") for c in p.iter() if local_tag(c.tag) == "t").strip()
                                        if pt:
                                            cell_parts.append(pt)
                                cells.append(" ".join(cell_parts))
                            if any(cells):
                                out.append(" | ".join(cells))
                    else:
                        walk_block(child)
            body = None
            for child in root:
                if local_tag(child.tag) == "body":
                    body = child
                    break
            walk_block(body if body is not None else root)
            return out

        headers = sorted(n for n in names if re.match(r"^word/header\\d*\\.xml$", n))
        footers = sorted(n for n in names if re.match(r"^word/footer\\d*\\.xml$", n))
        for h in headers:
            hlines = read_docx_xml(h)
            if hlines:
                lines.append("[Encabezado] " + " | ".join(hlines))
        if "word/document.xml" in names:
            lines.extend(read_docx_xml("word/document.xml"))
        for f in footers:
            flines = read_docx_xml(f)
            if flines:
                lines.append("[Pie de página] " + " | ".join(flines))

    elif ext == ".pptx":
        slides = sorted(
            (n for n in names if re.match(r"^ppt/slides/slide\\d+\\.xml$", n)),
            key=lambda s: int(re.search(r"(\\d+)", s).group(1))
        )
        for idx, sname in enumerate(slides, 1):
            root = ET.fromstring(zf.read(sname))
            slide_texts = [el.text.strip() for el in root.iter() if local_tag(el.tag) == "t" and el.text and el.text.strip()]
            if slide_texts:
                lines.append(f"--- Slide {idx} ---")
                lines.extend(slide_texts)

    elif ext == ".xlsx":
        shared = []
        if "xl/sharedStrings.xml" in names:
            sroot = ET.fromstring(zf.read("xl/sharedStrings.xml"))
            for si in sroot:
                if local_tag(si.tag) == "si":
                    shared.append("".join((t.text or "") for t in si.iter() if local_tag(t.tag) == "t"))
        sheets = sorted(n for n in names if re.match(r"^xl/worksheets/sheet\\d+\\.xml$", n))
        for idx, sh in enumerate(sheets, 1):
            lines.append(f"--- Hoja {idx} ({os.path.basename(sh)}) ---")
            root = ET.fromstring(zf.read(sh))
            for row in root.iter():
                if local_tag(row.tag) != "row":
                    continue
                vals = []
                for c in row:
                    if local_tag(c.tag) != "c":
                        continue
                    ctype = c.attrib.get("t", "")
                    val = ""
                    if ctype == "inlineStr":
                        val = "".join((t.text or "") for t in c.iter() if local_tag(t.tag) == "t")
                    else:
                        v_el = next((x for x in c if local_tag(x.tag) == "v"), None)
                        if v_el is not None and v_el.text is not None:
                            if ctype == "s" and v_el.text.isdigit() and int(v_el.text) < len(shared):
                                val = shared[int(v_el.text)]
                            else:
                                val = v_el.text
                    vals.append(val)
                if any(v.strip() for v in vals):
                    lines.append(" | ".join(vals))

full_text = "\\n".join(lines)
truncated = len(full_text) > max_chars
print(json.dumps({
    "totalChars": len(full_text),
    "truncated": truncated,
    "content": full_text[:max_chars]
}, ensure_ascii=False))
`;

const PS_RENDER_PDF_WINRT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -AssemblyName System.Drawing
[void][Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
[void][Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType=WindowsRuntime]
[void][Windows.Data.Pdf.PdfPageRenderOptions, Windows.Data.Pdf, ContentType=WindowsRuntime]
[void][Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime]
[void][Windows.UI.Colors, Windows.UI, ContentType=WindowsRuntime]

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
$asTaskAction = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' })[0]
function AwaitOp($op, $resultType) {
  $t = $asTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($op))
  $t.Wait()
  return $t.Result
}
function AwaitAct($act) {
  $t = $asTaskAction.Invoke($null, @($act))
  $t.Wait()
}

$pdfPath = $env:MCP_PDF_PATH
$pagesCsv = $env:MCP_PDF_PAGES
$maxWidth = [int]$env:MCP_PDF_MAX_WIDTH
$quality = [long]$env:MCP_PDF_QUALITY

$file = AwaitOp ([Windows.Storage.StorageFile]::GetFileFromPathAsync($pdfPath)) ([Windows.Storage.StorageFile])
$doc = AwaitOp ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
$totalPages = [int]$doc.PageCount

$pageNums = @()
if ($pagesCsv -and $pagesCsv.Trim().Length -gt 0) {
  foreach ($tok in $pagesCsv.Split(',')) {
    $n = 0
    if ([int]::TryParse($tok.Trim(), [ref]$n) -and $n -ge 1 -and $n -le $totalPages) {
      $pageNums += $n
    }
  }
}
if ($pageNums.Count -eq 0 -and $totalPages -gt 0) {
  $end = [Math]::Min($totalPages, 2)
  $pageNums = 1..$end
}

$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1
$encParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
$encParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, $quality)

$rendered = @()
foreach ($pNum in $pageNums) {
  $page = $doc.GetPage([uint32]($pNum - 1))
  $stream = $null
  $netStream = $null
  $img = $null
  $ms = $null
  try {
    $opts = New-Object Windows.Data.Pdf.PdfPageRenderOptions
    $opts.DestinationWidth = [uint32]$maxWidth
    $opts.BackgroundColor = [Windows.UI.Colors]::White
    $stream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
    AwaitAct ($page.RenderToStreamAsync($stream, $opts))
    $netStream = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream)
    $img = [System.Drawing.Image]::FromStream($netStream)
    $ms = New-Object System.IO.MemoryStream
    $img.Save($ms, $codec, $encParams)
    $bytes = $ms.ToArray()
    $rendered += @{
      page = $pNum
      width = $img.Width
      height = $img.Height
      bytes = $bytes.Length
      imageBase64 = [Convert]::ToBase64String($bytes)
    }
  } finally {
    if ($ms) { $ms.Dispose() }
    if ($img) { $img.Dispose() }
    if ($netStream) { $netStream.Dispose() }
    if ($stream) { $stream.Dispose() }
    if ($page) { $page.Dispose() }
  }
}

Write-Output (ConvertTo-Json @{ totalPages = $totalPages; renderedPages = $rendered } -Depth 4 -Compress)
`;

/**
 * Tracks per-client workspace overrides and recent activity so parallel LLM clients
 * (Claude, Gemini, ChatGPT, API Keys) can switch workspaces independently without colliding.
 */
export class ClientSessionStore {
  constructor() {
    this.sessions = new Map(); // sessionKey -> { sessionKey, clientLabel, activeWorkspaceOverride, lastSeenAt, lastTool, toolCalls }
  }

  touch(sessionKey, { clientLabel, tool } = {}) {
    if (!sessionKey) return null;
    const key = String(sessionKey);
    let rec = this.sessions.get(key);
    if (!rec) {
      rec = {
        sessionKey: key,
        clientLabel: clientLabel || key,
        activeWorkspaceOverride: null,
        lastSeenAt: new Date().toISOString(),
        lastTool: tool || null,
        toolCalls: 0
      };
      this.sessions.set(key, rec);
    }
    if (clientLabel && clientLabel !== 'MCP') {
      rec.clientLabel = String(clientLabel);
    }
    rec.lastSeenAt = new Date().toISOString();
    if (tool) {
      rec.lastTool = tool;
      rec.toolCalls += 1;
    }
    return rec;
  }

  getWorkspaceOverride(sessionKey) {
    if (!sessionKey) return null;
    return this.sessions.get(String(sessionKey))?.activeWorkspaceOverride || null;
  }

  setWorkspaceOverride(sessionKey, workspacePath, clientLabel) {
    const rec = this.touch(sessionKey, { clientLabel });
    if (rec) {
      rec.activeWorkspaceOverride = workspacePath || null;
    }
    return rec;
  }

  clearWorkspaceOverride(sessionKey) {
    const rec = this.sessions.get(String(sessionKey));
    if (rec) rec.activeWorkspaceOverride = null;
  }

  clearAllOverrides() {
    let cleared = 0;
    for (const rec of this.sessions.values()) {
      if (rec.activeWorkspaceOverride) {
        rec.activeWorkspaceOverride = null;
        cleared += 1;
      }
    }
    return cleared;
  }

  list(defaultWorkspace) {
    return Array.from(this.sessions.values()).map((rec) => ({
      sessionKey: rec.sessionKey,
      clientLabel: rec.clientLabel,
      activeWorkspace: rec.activeWorkspaceOverride || defaultWorkspace || '',
      workspaceScope: rec.activeWorkspaceOverride ? 'session' : 'global',
      lastSeenAt: rec.lastSeenAt,
      lastTool: rec.lastTool,
      toolCalls: rec.toolCalls
    }));
  }
}

/**
 * Provides workspace-scoped file tools (with path checks and protectSensitiveFiles),
 * multimodal document/image reading, search, git, and full-user PowerShell command
 * execution starting in the active workspace (with optional per-client session isolation).
 */
export class WorkspaceHarness {
  constructor(configManager, options = {}) {
    this.configManager = configManager;
    this.sessionStore = options.sessionStore || null;
    this.handoffManager = options.handoffManager || null;
    this.sessionKey = options.sessionKey || null;
    this.clientLabel = options.clientLabel || null;
  }

  forSession(sessionKey, clientLabel) {
    return new WorkspaceHarness(this.configManager, {
      sessionStore: this.sessionStore,
      handoffManager: this.handoffManager,
      sessionKey,
      clientLabel
    });
  }

  getActiveRoot() {
    const cfg = this.configManager.get();
    if (this.sessionKey && this.sessionStore) {
      const override = this.sessionStore.getWorkspaceOverride(this.sessionKey);
      if (override) {
        const stillAllowed = cfg.allowedWorkspaces.some((w) => w.toLowerCase() === override.toLowerCase());
        if (stillAllowed && fs.existsSync(override)) {
          return fs.realpathSync(override);
        }
        this.sessionStore.clearWorkspaceOverride(this.sessionKey);
      }
    }
    return fs.realpathSync(cfg.activeWorkspace);
  }

  getPermissions() {
    return this.configManager.get().permissions;
  }

  resolveSafePath(inputPath = '.', { mustExist = false, forWrite = false } = {}) {
    if (typeof inputPath !== 'string' || inputPath.includes('\0')) {
      throw new Error('Ruta inválida.');
    }

    const rootReal = this.getActiveRoot();
    const cleaned = inputPath.trim() === '' ? '.' : inputPath.trim();
    const candidate = path.isAbsolute(cleaned)
      ? path.resolve(cleaned)
      : path.resolve(rootReal, cleaned);

    if (!isSubPath(rootReal, candidate)) {
      throw new Error(`Acceso denegado: '${inputPath}' sale fuera del workspace activo (${rootReal}).`);
    }

    // Protect server configuration/secrets folder even if a parent directory is mounted.
    const dataReal = fs.existsSync(this.configManager.dataDir)
      ? fs.realpathSync(this.configManager.dataDir)
      : path.resolve(this.configManager.dataDir);
    if (isSubPath(dataReal, candidate)) {
      throw new Error('Acceso denegado: la carpeta interna de credenciales del servidor MCP está protegida.');
    }

    if (fs.existsSync(candidate)) {
      const targetReal = fs.realpathSync(candidate);
      if (!isSubPath(rootReal, targetReal)) {
        throw new Error(`Acceso denegado: el enlace simbólico apunta fuera del workspace (${rootReal}).`);
      }
      if (isSubPath(dataReal, targetReal)) {
        throw new Error('Acceso denegado: la carpeta interna de credenciales del servidor MCP está protegida.');
      }
      this.#checkSensitiveGuard(rootReal, targetReal, { forWrite });
      return { rootReal, fullPath: targetReal, relPath: path.relative(rootReal, targetReal) || '.' };
    }

    if (mustExist) {
      throw new Error(`No existe la ruta: ${path.relative(rootReal, candidate) || cleaned}`);
    }

    // Verify nearest existing ancestor does not escape via symlink/junction.
    let probe = path.dirname(candidate);
    while (!fs.existsSync(probe)) {
      const parent = path.dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
    if (fs.existsSync(probe)) {
      const ancestorReal = fs.realpathSync(probe);
      if (!isSubPath(rootReal, ancestorReal)) {
        throw new Error(`Acceso denegado: ruta padre fuera del workspace (${rootReal}).`);
      }
    }

    this.#checkSensitiveGuard(rootReal, candidate, { forWrite });
    return { rootReal, fullPath: candidate, relPath: path.relative(rootReal, candidate) || '.' };
  }

  #checkSensitiveGuard(rootReal, fullPath, { forWrite }) {
    if (!this.getPermissions().protectSensitiveFiles) return;
    const relPosix = path.relative(rootReal, fullPath).replace(/\\/g, '/');
    const base = path.basename(fullPath);

    if (forWrite && (relPosix === '.git/config' || relPosix.startsWith('.git/hooks/'))) {
      throw new Error(`Escritura bloqueada por seguridad en ruta sensible de Git: ${relPosix}`);
    }
    if (SENSITIVE_BASENAME_RE.test(base)) {
      throw new Error(`Acceso bloqueado en tools de archivos por 'protectSensitiveFiles' (${base}). Esta protección solo cubre herramientas de archivos (no limita run_command/process_*); puedes desactivarla en /admin si lo necesitas.`);
    }
  }

  async workspaceInfo() {
    const cfg = this.configManager.get();
    const rootReal = this.getActiveRoot();
    const hasSessionOverride = Boolean(this.sessionKey && this.sessionStore?.getWorkspaceOverride(this.sessionKey));
    let git = { isRepo: false };
    if (fs.existsSync(path.join(rootReal, '.git'))) {
      try {
        const branchOut = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: rootReal, timeout: 5000 });
        const statusOut = await execFileAsync('git', ['status', '--short'], { cwd: rootReal, timeout: 5000 });
        const statusLines = statusOut.stdout.trim() ? statusOut.stdout.trim().split(/\r?\n/) : [];
        git = {
          isRepo: true,
          branch: branchOut.stdout.trim(),
          dirtyCount: statusLines.length,
          statusPreview: statusLines.slice(0, 20)
        };
      } catch {
        git = { isRepo: true, error: 'No se pudo consultar git.' };
      }
    }

    return {
      activeWorkspace: rootReal,
      workspaceScope: hasSessionOverride ? 'session' : 'global',
      defaultWorkspace: cfg.activeWorkspace,
      allowedWorkspaces: cfg.allowedWorkspaces,
      permissions: cfg.permissions,
      git,
      capabilities: {
        readFileFormats: ['text/code', 'image (png/jpg/webp/gif inline)', 'pdf (texto + renderPages visual sin Chrome)', 'docx/xlsx/pptx (texto)'],
        batchReadTool: 'read_files (hasta 10 archivos en 1 sola llamada)',
        skillsTool: 'use_skill (lista y carga skills SKILL.md: chrome-operator, firefox-operator, desktop-operator, cv-workflow, windows-operator, workspace-operator-guide y skills del workspace)',
        handoffTools: Boolean(this.handoffManager),
        parallelSessionIsolation: true
      },
      quickGuide: [
        'Usa read_file (y read_file con renderPages=true para auditar visualmente PDFs) o read_files en lote; NUNCA abras PDFs/imágenes locales con operator_chrome_open.',
        'Rutas de workspace son relativas a activeWorkspace; para operator_* (ej. upload_file) usa rutas absolutas combinando activeWorkspace.',
        'Navegador Operator: Modo 1 silencioso -> engine="playwright" (web pública) o engine="extension" con active=false (sesión personal); Modo 2 entregar pestañas al usuario -> for_user=true y engine="extension" (nunca playwright).',
        'Desktop Operator: primero UIA sin foco (list_windows -> ui_tree -> ui_action con allow_mouse_fallback=false) antes de operator_desktop_act.'
      ]
    };
  }

  listWorkspaces() {
    const cfg = this.configManager.get();
    return {
      activeWorkspace: this.getActiveRoot(),
      defaultWorkspace: cfg.activeWorkspace,
      allowedWorkspaces: cfg.allowedWorkspaces
    };
  }

  selectWorkspace(targetPath) {
    if (this.sessionKey && this.sessionStore) {
      const match = this.configManager.resolveAllowedWorkspace(targetPath);
      this.sessionStore.setWorkspaceOverride(this.sessionKey, match, this.clientLabel);
      return {
        activeWorkspace: match,
        workspaceScope: 'session',
        message: `Workspace de esta sesión cambiado a: ${match} (sin afectar a otros clientes paralelos).`
      };
    }

    const next = this.configManager.selectWorkspace(targetPath);
    return {
      activeWorkspace: next,
      workspaceScope: 'global',
      message: `Workspace activo cambiado a: ${next}`
    };
  }

  listDir({ path: dirPath = '.', depth = 2, includeIgnored = false } = {}) {
    const { rootReal, fullPath } = this.resolveSafePath(dirPath, { mustExist: true });
    const stat = fs.statSync(fullPath);
    if (!stat.isDirectory()) {
      throw new Error(`No es una carpeta: ${dirPath}`);
    }

    const maxDepth = Math.max(1, Math.min(Number(depth) || 2, 5));
    const entries = [];
    const maxEntries = 300;

    const walk = (currentDir, currentDepth) => {
      if (entries.length >= maxEntries) return;
      const items = fs.readdirSync(currentDir, { withFileTypes: true });
      items.sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      for (const item of items) {
        if (entries.length >= maxEntries) break;
        if (!includeIgnored && DEFAULT_IGNORED_DIRS.has(item.name)) continue;

        const abs = path.join(currentDir, item.name);
        const rel = path.relative(rootReal, abs).replace(/\\/g, '/');
        const isDir = item.isDirectory();
        let size = undefined;
        if (!isDir && item.isFile()) {
          try {
            size = fs.statSync(abs).size;
          } catch {
            size = undefined;
          }
        }
        entries.push({ path: rel, type: isDir ? 'dir' : 'file', ...(size !== undefined ? { size } : {}) });
        if (isDir && currentDepth < maxDepth) {
          walk(abs, currentDepth + 1);
        }
      }
    };

    walk(fullPath, 1);
    return {
      root: rootReal,
      base: path.relative(rootReal, fullPath).replace(/\\/g, '/') || '.',
      truncated: entries.length >= maxEntries,
      entries
    };
  }

  findFiles({ pattern = '*', path: startPath = '.', includeIgnored = false, maxResults = 150 } = {}) {
    const { rootReal, fullPath } = this.resolveSafePath(startPath, { mustExist: true });
    const limit = Math.max(1, Math.min(Number(maxResults) || 150, 500));
    const hasSlash = pattern.includes('/') || pattern.includes('\\');
    const matcher = globToRegExp(hasSlash ? pattern : `**/${pattern}`);
    const matches = [];

    const walk = (dir) => {
      if (matches.length >= limit) return;
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        if (matches.length >= limit) break;
        if (!includeIgnored && DEFAULT_IGNORED_DIRS.has(item.name)) continue;
        const abs = path.join(dir, item.name);
        if (item.isDirectory()) {
          walk(abs);
        } else if (item.isFile()) {
          const relFromStart = path.relative(fullPath, abs).replace(/\\/g, '/');
          const relFromRoot = path.relative(rootReal, abs).replace(/\\/g, '/');
          if (matcher.test(relFromStart) || matcher.test(item.name)) {
            matches.push(relFromRoot);
          }
        }
      }
    };

    walk(fullPath);
    return {
      pattern,
      count: matches.length,
      truncated: matches.length >= limit,
      files: matches
    };
  }

  searchText({ query, path: startPath = '.', isRegex = false, caseSensitive = false, filePattern, maxMatches = 80 } = {}) {
    if (!query || typeof query !== 'string') {
      throw new Error('Debes indicar el texto o patrón a buscar (query).');
    }
    const { rootReal, fullPath } = this.resolveSafePath(startPath, { mustExist: true });
    const limit = Math.max(1, Math.min(Number(maxMatches) || 80, 200));
    const fileMatcher = filePattern
      ? globToRegExp(filePattern.includes('/') ? filePattern : `**/${filePattern}`)
      : null;

    const flags = caseSensitive ? 'g' : 'gi';
    const regex = isRegex
      ? new RegExp(query, flags)
      : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);

    const matches = [];
    const scanFile = (absFile) => {
      if (matches.length >= limit) return;
      const rel = path.relative(rootReal, absFile).replace(/\\/g, '/');
      if (fileMatcher && !fileMatcher.test(rel) && !fileMatcher.test(path.basename(absFile))) return;
      let stat;
      try {
        stat = fs.statSync(absFile);
      } catch {
        return;
      }
      if (!stat.isFile() || stat.size > 1024 * 1024) return;
      const buf = fs.readFileSync(absFile);
      if (isLikelyBinary(buf)) return;

      const lines = buf.toString('utf8').split(/\r?\n/);
      for (let idx = 0; idx < lines.length; idx++) {
        if (matches.length >= limit) break;
        const line = lines[idx];
        regex.lastIndex = 0;
        const m = regex.exec(line);
        if (m) {
          matches.push({
            file: rel,
            line: idx + 1,
            column: m.index + 1,
            text: line.length > 300 ? `${line.slice(0, 300)}...` : line
          });
        }
      }
    };

    const stat = fs.statSync(fullPath);
    if (stat.isFile()) {
      scanFile(fullPath);
    } else {
      const walk = (dir) => {
        if (matches.length >= limit) return;
        for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
          if (matches.length >= limit) break;
          if (DEFAULT_IGNORED_DIRS.has(item.name)) continue;
          const abs = path.join(dir, item.name);
          if (item.isDirectory()) walk(abs);
          else if (item.isFile()) scanFile(abs);
        }
      };
      walk(fullPath);
    }

    return {
      query,
      count: matches.length,
      truncated: matches.length >= limit,
      matches
    };
  }

  async #extractPdfText(fullPath, { pages, maxChars, maxPages = 20 }) {
    try {
      const { stdout } = await execFileAsync('python', ['-c', PY_EXTRACT_PDF], {
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
          MCP_PDF_PATH: fullPath,
          MCP_PDF_PAGES: typeof pages === 'string' ? pages : '',
          MCP_PDF_MAX_CHARS: String(maxChars),
          MCP_PDF_MAX_PAGES: String(maxPages)
        },
        timeout: 25000,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true
      });
      return JSON.parse(stdout.trim());
    } catch (err) {
      const detail = err?.stderr ? String(err.stderr).trim() : (err?.message || String(err));
      throw new Error(`No se pudo extraer texto del PDF (requiere Python + pypdf): ${detail.slice(0, 300)}`);
    }
  }

  async #renderPdfPagesVisual(fullPath, { pages, maxWidth = 1000, quality = 82 }) {
    if (process.platform !== 'win32') {
      throw new Error('El renderizado visual nativo de PDF (renderPages=true) solo está disponible en Windows.');
    }
    const safeWidth = Math.max(400, Math.min(Number(maxWidth) || 1000, 1600));
    const safeQuality = Math.max(40, Math.min(Number(quality) || 82, 95));

    // Resolve requested page numbers up to 4 pages per call so payload stays crisp and fast.
    let pagesCsv = '';
    if (typeof pages === 'string' && pages.trim()) {
      const parsed = parsePageRange(pages, 500, 4);
      pagesCsv = parsed.join(',');
    }

    try {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', PS_RENDER_PDF_WINRT],
        {
          env: {
            ...process.env,
            MCP_PDF_PATH: fullPath,
            MCP_PDF_PAGES: pagesCsv,
            MCP_PDF_MAX_WIDTH: String(safeWidth),
            MCP_PDF_QUALITY: String(safeQuality)
          },
          timeout: 30000,
          maxBuffer: 24 * 1024 * 1024,
          windowsHide: true
        }
      );
      const parsed = JSON.parse(stdout.trim());
      const rendered = Array.isArray(parsed.renderedPages)
        ? parsed.renderedPages
        : (parsed.renderedPages ? [parsed.renderedPages] : []);
      return {
        totalPages: Number(parsed.totalPages) || 0,
        renderedPages: rendered
      };
    } catch (err) {
      const detail = err?.stderr ? String(err.stderr).trim() : (err?.message || String(err));
      throw new Error(`No se pudo renderizar el PDF visualmente con Windows WinRT: ${detail.slice(0, 300)}`);
    }
  }

  async #extractOfficeText(fullPath, ext, maxChars) {
    try {
      const { stdout } = await execFileAsync('python', ['-c', PY_EXTRACT_OFFICE], {
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
          MCP_OFFICE_PATH: fullPath,
          MCP_OFFICE_EXT: ext,
          MCP_OFFICE_MAX_CHARS: String(maxChars)
        },
        timeout: 20000,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true
      });
      return JSON.parse(stdout.trim());
    } catch (err) {
      const detail = err?.stderr ? String(err.stderr).trim() : (err?.message || String(err));
      throw new Error(`No se pudo extraer texto de ${ext} (requiere Python): ${detail.slice(0, 300)}`);
    }
  }

  async readFile({ path: filePath, startLine = 1, endLine, pages, renderPages = false, maxWidth, quality } = {}) {
    const { fullPath, relPath } = this.resolveSafePath(filePath, { mustExist: true });
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) {
      throw new Error(`La ruta no es un archivo: ${relPath}`);
    }

    const relPosix = relPath.replace(/\\/g, '/');
    const ext = path.extname(fullPath).toLowerCase();
    const maxBytes = this.getPermissions().maxReadBytes;

    // 1. Native image support -> return inline MCP image content block
    if (IMAGE_MIME_BY_EXT[ext]) {
      const maxImgBytes = Math.max(maxBytes * 8, 8 * 1024 * 1024);
      if (stat.size > maxImgBytes) {
        throw new Error(`La imagen '${relPosix}' pesa ${stat.size} bytes y supera el límite seguro (${maxImgBytes} bytes).`);
      }
      const buf = fs.readFileSync(fullPath);
      const mimeType = IMAGE_MIME_BY_EXT[ext];
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ path: relPosix, type: 'image', mimeType, bytes: stat.size }, null, 2)
          },
          {
            type: 'image',
            data: buf.toString('base64'),
            mimeType
          }
        ]
      };
    }

    // 2. Native PDF support -> fast text extraction OR silent WinRT visual page rendering (zero browser!)
    if (ext === '.pdf') {
      const maxPdfBytes = Math.max(maxBytes * 16, 25 * 1024 * 1024);
      if (stat.size > maxPdfBytes) {
        throw new Error(`El PDF '${relPosix}' pesa ${stat.size} bytes y supera el límite seguro (${maxPdfBytes} bytes).`);
      }
      if (renderPages) {
        const rendered = await this.#renderPdfPagesVisual(fullPath, { pages, maxWidth, quality });
        const meta = {
          path: relPosix,
          type: 'pdf_visual',
          bytes: stat.size,
          totalPages: rendered.totalPages,
          renderedPages: rendered.renderedPages.map((p) => ({
            page: p.page,
            width: p.width,
            height: p.height,
            bytes: p.bytes
          })),
          tip: rendered.totalPages > rendered.renderedPages.length
            ? 'Pasa pages="3-4" para inspeccionar páginas adicionales (máx. 4 por llamada). Para texto completo usa renderPages=false.'
            : 'Para extraer el texto exacto del PDF usa read_file con renderPages=false.'
        };
        const content = [{ type: 'text', text: JSON.stringify(meta, null, 2) }];
        for (const p of rendered.renderedPages) {
          if (p.imageBase64) {
            content.push({
              type: 'image',
              data: p.imageBase64,
              mimeType: 'image/jpeg'
            });
          }
        }
        return { content };
      }

      const extracted = await this.#extractPdfText(fullPath, {
        pages,
        maxChars: Math.min(maxBytes, 120000),
        maxPages: 20
      });
      return {
        path: relPosix,
        type: 'pdf',
        bytes: stat.size,
        ...extracted,
        tip: 'Si necesitas auditar diseño visual, márgenes o espaciado del PDF, llama read_file con renderPages=true (sin abrir Chrome).'
      };
    }

    // 3. Native Office OOXML (.docx, .xlsx, .pptx) text extraction
    if (OFFICE_EXTS.has(ext)) {
      const maxOfficeBytes = Math.max(maxBytes * 16, 25 * 1024 * 1024);
      if (stat.size > maxOfficeBytes) {
        throw new Error(`El documento '${relPosix}' pesa ${stat.size} bytes y supera el límite seguro.`);
      }
      const extracted = await this.#extractOfficeText(fullPath, ext, Math.min(maxBytes, 120000));
      return {
        path: relPosix,
        type: ext.slice(1),
        bytes: stat.size,
        ...extracted
      };
    }

    // 4. Plain text / source code
    if (stat.size > maxBytes * 8) {
      throw new Error(`El archivo pesa ${stat.size} bytes y supera el límite seguro de lectura.`);
    }

    const buf = fs.readFileSync(fullPath);
    if (isLikelyBinary(buf)) {
      throw new Error(`'${relPosix}' parece ser un archivo binario no soportado directamente (${stat.size} bytes).`);
    }

    const lines = buf.toString('utf8').split(/\r?\n/);
    const totalLines = lines.length;
    const from = Math.max(1, Math.floor(Number(startLine) || 1));
    const requestedEnd = endLine ? Math.floor(Number(endLine)) : from + 499;
    const to = Math.min(totalLines, Math.max(from, requestedEnd));

    const numbered = [];
    let byteBudget = 0;
    let actualEnd = from - 1;
    let truncated = false;

    for (let i = from; i <= to; i++) {
      const lineStr = `${i}: ${lines[i - 1]}`;
      if (byteBudget + lineStr.length + 1 > maxBytes && numbered.length > 0) {
        truncated = true;
        break;
      }
      numbered.push(lineStr);
      byteBudget += lineStr.length + 1;
      actualEnd = i;
    }

    return {
      path: relPosix,
      type: 'text',
      totalLines,
      startLine: from,
      endLine: actualEnd,
      truncated: truncated || to < totalLines,
      content: numbered.join('\n')
    };
  }

  async readFiles({ paths, maxLinesPerFile = 250, maxTotalBytes } = {}) {
    if (!Array.isArray(paths) || paths.length === 0) {
      throw new Error('Debes pasar un arreglo "paths" con entre 1 y 10 rutas relativas.');
    }
    const list = paths.slice(0, 10);
    const maxLines = Math.max(20, Math.min(Number(maxLinesPerFile) || 250, 1000));
    const budget = Math.max(
      4096,
      Math.min(Number(maxTotalBytes) || (this.getPermissions().maxReadBytes * 2), 262144)
    );

    let usedBytes = 0;
    let budgetTruncated = false;
    const files = [];

    for (const rawPath of list) {
      if (usedBytes >= budget) {
        budgetTruncated = true;
        files.push({
          path: String(rawPath),
          ok: false,
          error: 'Omitido por límite de bytes del lote; léelo en otra llamada.'
        });
        continue;
      }

      try {
        const { fullPath, relPath } = this.resolveSafePath(String(rawPath), { mustExist: true });
        const relPosix = relPath.replace(/\\/g, '/');
        const stat = fs.statSync(fullPath);
        if (!stat.isFile()) {
          files.push({ path: relPosix, ok: false, error: 'La ruta no es un archivo.' });
          continue;
        }

        const ext = path.extname(fullPath).toLowerCase();
        const remaining = Math.max(1024, budget - usedBytes);

        if (IMAGE_MIME_BY_EXT[ext]) {
          files.push({
            path: relPosix,
            ok: true,
            type: 'image',
            mimeType: IMAGE_MIME_BY_EXT[ext],
            bytes: stat.size,
            note: 'Usa read_file sobre esta ruta para recibir la imagen inline.'
          });
          continue;
        }

        if (ext === '.pdf') {
          const extracted = await this.#extractPdfText(fullPath, {
            pages: '',
            maxChars: Math.min(remaining, 32000),
            maxPages: 6
          });
          const textJoined = extracted.pages.map((p) => `[Página ${p.page}]\n${p.text}`).join('\n\n');
          usedBytes += Buffer.byteLength(textJoined, 'utf8');
          files.push({
            path: relPosix,
            ok: true,
            type: 'pdf',
            totalPages: extracted.totalPages,
            pagesRead: extracted.pagesRead,
            truncated: extracted.truncated,
            content: textJoined
          });
          continue;
        }

        if (OFFICE_EXTS.has(ext)) {
          const extracted = await this.#extractOfficeText(fullPath, ext, Math.min(remaining, 32000));
          usedBytes += Buffer.byteLength(extracted.content, 'utf8');
          files.push({
            path: relPosix,
            ok: true,
            type: ext.slice(1),
            truncated: extracted.truncated,
            content: extracted.content
          });
          continue;
        }

        const buf = fs.readFileSync(fullPath);
        if (isLikelyBinary(buf)) {
          files.push({ path: relPosix, ok: false, error: `Archivo binario no legible como texto (${stat.size} bytes).` });
          continue;
        }

        const allLines = buf.toString('utf8').split(/\r?\n/);
        const to = Math.min(allLines.length, maxLines);
        const numbered = [];
        let fileBytes = 0;
        let truncated = to < allLines.length;
        for (let i = 1; i <= to; i++) {
          const lineStr = `${i}: ${allLines[i - 1]}`;
          if (fileBytes + lineStr.length + 1 > remaining && numbered.length > 0) {
            truncated = true;
            break;
          }
          numbered.push(lineStr);
          fileBytes += lineStr.length + 1;
        }
        const content = numbered.join('\n');
        usedBytes += Buffer.byteLength(content, 'utf8');
        files.push({
          path: relPosix,
          ok: true,
          type: 'text',
          totalLines: allLines.length,
          linesRead: numbered.length,
          truncated,
          content
        });
      } catch (err) {
        files.push({
          path: String(rawPath),
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }

    return {
      requested: paths.length,
      processed: list.length,
      cappedAt10: paths.length > 10,
      budgetTruncated,
      files
    };
  }

  writeFile({ path: filePath, content, append = false, createDirs = true } = {}) {
    if (!this.getPermissions().allowWrite) {
      throw new Error('La escritura está desactivada actualmente en el panel local (/admin).');
    }
    if (typeof content !== 'string') {
      throw new Error('El parámetro content debe ser texto.');
    }

    const { fullPath, relPath } = this.resolveSafePath(filePath, { mustExist: false, forWrite: true });
    if (createDirs) {
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    }
    if (append) {
      fs.appendFileSync(fullPath, content, 'utf8');
    } else {
      fs.writeFileSync(fullPath, content, 'utf8');
    }
    const stat = fs.statSync(fullPath);
    return {
      path: relPath.replace(/\\/g, '/'),
      action: append ? 'appended' : 'written',
      bytes: stat.size
    };
  }

  editFile({ path: filePath, target, replacement, replaceAll = false } = {}) {
    if (!this.getPermissions().allowWrite) {
      throw new Error('La escritura está desactivada actualmente en el panel local (/admin).');
    }
    if (typeof target !== 'string' || target.length === 0) {
      throw new Error('El parámetro target no puede estar vacío.');
    }
    if (typeof replacement !== 'string') {
      throw new Error('El parámetro replacement debe ser texto.');
    }

    const { fullPath, relPath } = this.resolveSafePath(filePath, { mustExist: true, forWrite: true });
    const original = fs.readFileSync(fullPath, 'utf8');

    const applyEdit = (haystack, needle, repl) => {
      const parts = haystack.split(needle);
      const count = parts.length - 1;
      if (count === 0) return null;
      if (count > 1 && !replaceAll) {
        throw new Error(
          `El bloque target aparece ${count} veces en '${relPath}'. Incluye más contexto alrededor o pasa replaceAll: true.`
        );
      }
      return {
        updated: replaceAll ? parts.join(repl) : `${parts[0]}${repl}${parts.slice(1).join(needle)}`,
        replacements: replaceAll ? count : 1
      };
    };

    let result = applyEdit(original, target, replacement);
    if (!result && original.includes('\r\n')) {
      // Handle Windows CRLF files cleanly when the model submits LF line endings.
      const normalizedOriginal = original.replace(/\r\n/g, '\n');
      const normalizedTarget = target.replace(/\r\n/g, '\n');
      const normalizedReplacement = replacement.replace(/\r\n/g, '\n');
      const lfResult = applyEdit(normalizedOriginal, normalizedTarget, normalizedReplacement);
      if (lfResult) {
        result = {
          updated: lfResult.updated.replace(/\n/g, '\r\n'),
          replacements: lfResult.replacements
        };
      }
    }

    if (!result) {
      throw new Error(`No se encontró el texto target en '${relPath}'. Lee el archivo primero para verificar la coincidencia exacta.`);
    }

    fs.writeFileSync(fullPath, result.updated, 'utf8');
    return {
      path: relPath.replace(/\\/g, '/'),
      replacements: result.replacements,
      bytes: Buffer.byteLength(result.updated, 'utf8')
    };
  }

  movePath({ source, destination } = {}) {
    if (!this.getPermissions().allowWrite) {
      throw new Error('La escritura/movimiento está desactivada en el panel local (/admin).');
    }
    const src = this.resolveSafePath(source, { mustExist: true, forWrite: true });
    const dst = this.resolveSafePath(destination, { mustExist: false, forWrite: true });
    if (src.relPath === '.') {
      throw new Error('No puedes mover la raíz del workspace.');
    }
    fs.mkdirSync(path.dirname(dst.fullPath), { recursive: true });
    fs.renameSync(src.fullPath, dst.fullPath);
    return {
      from: src.relPath.replace(/\\/g, '/'),
      to: dst.relPath.replace(/\\/g, '/')
    };
  }

  deletePath({ path: targetPath, recursive = false } = {}) {
    if (!this.getPermissions().allowDelete) {
      throw new Error('El borrado está desactivado actualmente en el panel local (/admin).');
    }
    const { fullPath, relPath } = this.resolveSafePath(targetPath, { mustExist: true, forWrite: true });
    if (relPath === '.') {
      throw new Error('Operación bloqueada: no se puede borrar la raíz del workspace.');
    }
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      fs.rmSync(fullPath, { recursive: Boolean(recursive), force: false });
    } else {
      fs.unlinkSync(fullPath);
    }
    return {
      deleted: relPath.replace(/\\/g, '/'),
      type: stat.isDirectory() ? 'dir' : 'file'
    };
  }

  async runCommand({ command, cwd = '.', timeoutMs } = {}) {
    if (!this.getPermissions().allowCommands) {
      throw new Error('La ejecución de comandos está desactivada actualmente en el panel local (/admin).');
    }
    if (!command || typeof command !== 'string') {
      throw new Error('Debes indicar el comando a ejecutar.');
    }

    const fc = this.configManager.get().fullControl || {};
    const fcActive = Boolean(fc.enabled && (!fc.expiresAt || Date.parse(fc.expiresAt) > Date.now()));
    const allowFreeCwd = Boolean(fcActive && fc.allowUnrestrictedCwd);

    let fullPath;
    let relPath;
    if (allowFreeCwd && cwd && path.isAbsolute(String(cwd))) {
      const target = path.resolve(String(cwd));
      if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
        throw new Error(`El directorio de trabajo no existe: ${target}`);
      }
      fullPath = fs.realpathSync(target);
      relPath = fullPath;
    } else {
      const safe = this.resolveSafePath(cwd, { mustExist: true });
      fullPath = safe.fullPath;
      relPath = safe.relPath;
      if (!fs.statSync(fullPath).isDirectory()) {
        throw new Error(`El directorio de trabajo no es una carpeta: ${relPath}`);
      }
    }

    const defaultTimeout = this.getPermissions().commandTimeoutMs || 30000;
    const maxTimeout = fcActive ? 300000 : 120000;
    const effectiveTimeout = Math.max(1000, Math.min(Number(timeoutMs) || defaultTimeout, maxTimeout));
    const shellExe = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
    const shellArgs = process.platform === 'win32'
      ? ['-NoProfile', '-NonInteractive', '-Command', command]
      : ['-lc', command];

    return new Promise((resolve) => {
      const child = spawn(shellExe, shellArgs, {
        cwd: fullPath,
        windowsHide: true,
        env: buildSanitizedShellEnv(process.env, this.getPermissions())
      });

      const maxOut = 32768;
      let stdout = '';
      let stderr = '';
      let stdoutTruncated = false;
      let stderrTruncated = false;
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, effectiveTimeout);

      child.stdout.on('data', (chunk) => {
        if (stdout.length < maxOut) {
          const text = chunk.toString('utf8');
          const room = maxOut - stdout.length;
          stdout += text.slice(0, room);
          if (text.length > room) stdoutTruncated = true;
        } else {
          stdoutTruncated = true;
        }
      });

      child.stderr.on('data', (chunk) => {
        if (stderr.length < maxOut) {
          const text = chunk.toString('utf8');
          const room = maxOut - stderr.length;
          stderr += text.slice(0, room);
          if (text.length > room) stderrTruncated = true;
        } else {
          stderrTruncated = true;
        }
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          cwd: relPath.replace(/\\/g, '/'),
          exitCode: code,
          timedOut,
          stdout: stdoutTruncated ? `${stdout}\n...[stdout truncado]` : stdout,
          stderr: stderrTruncated ? `${stderr}\n...[stderr truncado]` : stderr
        });
      });
    });
  }

  async gitHarness({ action = 'status', path: targetPath, count = 10 } = {}) {
    const rootReal = this.getActiveRoot();
    let args;
    switch (action) {
      case 'status':
        args = ['status', '--short', '--branch'];
        break;
      case 'diff':
        args = targetPath
          ? ['diff', '--', this.resolveSafePath(targetPath, { mustExist: false }).relPath]
          : ['diff', '--stat'];
        break;
      case 'log': {
        const limit = Math.max(1, Math.min(Number(count) || 10, 30));
        args = ['log', `-n${limit}`, '--oneline', '--decorate'];
        break;
      }
      case 'branches':
        args = ['branch', '-a'];
        break;
      default:
        throw new Error(`Acción git no soportada: ${action}. Usa: status, diff, log o branches.`);
    }

    try {
      const { stdout, stderr } = await execFileAsync('git', args, {
        cwd: rootReal,
        timeout: 10000,
        maxBuffer: 256 * 1024
      });
      return {
        action,
        output: stdout.slice(0, 32768),
        stderr: stderr.trim() || undefined
      };
    } catch (err) {
      throw new Error(`Git error: ${err.stderr || err.message}`);
    }
  }
}
