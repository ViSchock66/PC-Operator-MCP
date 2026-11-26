import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MAX_SKILL_BYTES = 64 * 1024;

function parseFrontmatter(rawText) {
  const text = String(rawText || '').replace(/^\uFEFF/, '');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) {
    return { name: '', description: '', body: text.trim() };
  }

  const fmBlock = match[1];
  const body = match[2].trim();
  let name = '';
  let description = '';

  const lines = fmBlock.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nameMatch = /^name:\s*(.+)$/.exec(line);
    if (nameMatch) {
      name = nameMatch[1].trim().replace(/^['"]|['"]$/g, '');
      continue;
    }
    const descMatch = /^description:\s*(.*)$/.exec(line);
    if (descMatch) {
      const val = descMatch[1].trim();
      if (val === '>' || val === '>-' || val === '|' || val === '|-') {
        const blockLines = [];
        while (i + 1 < lines.length && (/^\s+/.test(lines[i + 1]) || lines[i + 1].trim() === '')) {
          i += 1;
          blockLines.push(lines[i].trim());
        }
        description = blockLines.filter(Boolean).join(' ').trim();
      } else {
        description = val.replace(/^['"]|['"]$/g, '');
      }
    }
  }

  return { name, description, body };
}

function scanSkillsDirectory(dirPath, source) {
  const found = [];
  if (!dirPath || !fs.existsSync(dirPath)) return found;
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return found;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillFile = path.join(dirPath, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;
    try {
      const stat = fs.statSync(skillFile);
      if (!stat.isFile() || stat.size > MAX_SKILL_BYTES) continue;
      const raw = fs.readFileSync(skillFile, 'utf8');
      const parsed = parseFrontmatter(raw);
      const skillName = (parsed.name || entry.name).trim();
      if (!skillName) continue;
      found.push({
        name: skillName,
        description: parsed.description || `Skill ${skillName} (${source})`,
        source,
        content: parsed.body || raw.trim()
      });
    } catch {
      // Ignore unreadable SKILL.md entries cleanly.
    }
  }
  return found;
}

/**
 * Discovers and serves SKILL.md playbooks from the built-in MCP guide, active workspace,
 * Antigravity Operator plugin, and user global skills folder (read-only).
 */
export class SkillCatalog {
  constructor({ configManager, globalSkillsDir } = {}) {
    this.configManager = configManager;
    this.globalSkillsDir = globalSkillsDir !== undefined
      ? globalSkillsDir
      : path.join(os.homedir(), '.gemini', 'config', 'skills');
  }

  #collect({ harness, builtinGuideText, includeOperatorSkills = true } = {}) {
    const byKey = new Map(); // lower(name) -> skill record
    const register = (skill) => {
      const key = skill.name.toLowerCase();
      if (!byKey.has(key)) {
        byKey.set(key, skill);
      }
    };

    // 1. Active workspace skills (highest priority if workspace overrides a skill)
    try {
      const wsRoot = harness?.getActiveRoot?.();
      if (wsRoot) {
        for (const sub of [path.join(wsRoot, 'skills'), path.join(wsRoot, '.agents', 'skills')]) {
          for (const sk of scanSkillsDirectory(sub, 'workspace')) {
            register(sk);
          }
        }
      }
    } catch {
      // Ignore if workspace root unavailable.
    }

    // 2. Built-in MCP operational guide skill
    if (builtinGuideText) {
      register({
        name: 'workspace-operator-guide',
        description: 'Manual maestro del servidor PC Workspace & Operator MCP: lectura de PDFs (texto + visual sin Chrome), DOCX, imágenes, lotes, sesiones paralelas, demonios persistentes y control silencioso de Chrome/Firefox/Windows.',
        source: 'builtin',
        content: builtinGuideText
      });
    }

    // 3. Antigravity Operator plugin skills (chrome-operator, firefox-operator, desktop-operator)
    const opCfg = this.configManager?.get?.()?.operator;
    if (includeOperatorSkills && opCfg?.enabled && opCfg?.serverPath) {
      const opSkillsDir = path.resolve(path.dirname(opCfg.serverPath), '..', 'skills');
      for (const sk of scanSkillsDirectory(opSkillsDir, 'operator')) {
        register(sk);
      }
    }

    // 4. User global skills (e.g. cv-workflow, windows-operator)
    if (this.globalSkillsDir) {
      for (const sk of scanSkillsDirectory(this.globalSkillsDir, 'global')) {
        register(sk);
      }
    }

    return Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  useSkill({ name, harness, builtinGuideText, includeOperatorSkills = true } = {}) {
    const all = this.#collect({ harness, builtinGuideText, includeOperatorSkills });
    const query = typeof name === 'string' ? name.trim() : '';

    if (!query) {
      return {
        count: all.length,
        tip: 'Llama use_skill({ name: "<nombre>" }) para cargar las instrucciones completas (SKILL.md) antes de ejecutar esa tarea.',
        skills: all.map((s) => ({
          name: s.name,
          source: s.source,
          description: s.description
        }))
      };
    }

    const qLower = query.toLowerCase();
    const exact = all.find((s) => s.name.toLowerCase() === qLower);
    if (exact) {
      return exact;
    }

    const partial = all.filter((s) => s.name.toLowerCase().includes(qLower));
    if (partial.length === 1) {
      return partial[0];
    }

    throw new Error(
      `Skill no encontrada: "${query}". Skills disponibles: ${all.map((s) => s.name).join(', ') || '(ninguna)'}`
    );
  }
}
