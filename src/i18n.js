export const SUPPORTED_LANGUAGES = ['en', 'es'];
export const DEFAULT_LANGUAGE = 'en';

export function normalizeLanguage(raw, fallback = DEFAULT_LANGUAGE) {
  const val = String(raw || '').trim().toLowerCase();
  if (val === 'es' || val.startsWith('es-')) return 'es';
  if (val === 'en' || val.startsWith('en-')) return 'en';
  return SUPPORTED_LANGUAGES.includes(fallback) ? fallback : DEFAULT_LANGUAGE;
}

const MESSAGES = {
  en: {
    login: {
      htmlLang: 'en',
      title: 'PC-Operator-MCP — Sign In',
      badge: 'LOCAL',
      subtitle: 'Local-only access on 127.0.0.1',
      description: 'Enter your local authorization PIN to open the control panel, OAuth/API connectors, operator bridge, and workspaces.',
      pinLabelHtml: 'Local PIN (stored in <code>data/config.json</code>)',
      pinPlaceholder: 'e.g. 9B2A781B',
      submit: 'Open Control Panel',
      invalidPin: 'Invalid PIN. Check data/config.json or your terminal output.'
    },
    consent: {
      htmlLang: 'en',
      title: 'Authorize PC-Operator-MCP',
      heading: 'Authorize PC-Operator-MCP Access',
      subtitle: 'OAuth 2.1 · Local Consent',
      requestIntroPrefix: 'requests access to your local MCP server (callback:',
      requestIntroSuffix: ').',
      activeWorkspace: 'Active workspace:',
      enabledCapabilities: 'Enabled capabilities:',
      pinLabel: 'Enter your local PIN (visible in /admin or your terminal):',
      pinPlaceholder: 'Authorization PIN',
      deny: 'Cancel',
      allow: 'Authorize',
      invalidPin: 'Invalid PIN. Check your PIN in the /admin panel or console.',
      expired: 'Authorization request expired or invalid. Please retry from your MCP client.',
      deniedByUser: 'Authorization cancelled by user.',
      capabilities: {
        read: 'Read and search files inside authorized workspaces',
        write: 'Create, edit, and move files',
        delete: 'Delete files inside the workspace',
        commands: 'Run commands inside the workspace',
        operator: 'Browser (Chrome/Firefox) and Windows Desktop automation (Operator)'
      }
    },
    dialog: {
      pickFolderTitle: 'Select a workspace folder for PC-Operator-MCP'
    }
  },
  es: {
    login: {
      htmlLang: 'es',
      title: 'PC-Operator-MCP — Acceso',
      badge: 'LOCAL',
      subtitle: 'Acceso exclusivo en 127.0.0.1',
      description: 'Ingresa tu PIN de autorización para abrir el panel de control, proveedores OAuth/API, operator y workspaces.',
      pinLabelHtml: 'PIN local (guardado en <code>data/config.json</code>)',
      pinPlaceholder: 'Ej: 9B2A781B',
      submit: 'Entrar al Panel',
      invalidPin: 'PIN incorrecto. Revisa data/config.json o la salida de consola.'
    },
    consent: {
      htmlLang: 'es',
      title: 'Autorizar PC-Operator-MCP',
      heading: 'Autorizar acceso a PC-Operator-MCP',
      subtitle: 'OAuth 2.1 · Consentimiento local',
      requestIntroPrefix: 'solicita conectarse a tu servidor MCP local (callback:',
      requestIntroSuffix: ').',
      activeWorkspace: 'Workspace activo:',
      enabledCapabilities: 'Capacidades habilitadas:',
      pinLabel: 'Ingresa tu PIN local (visible en el panel /admin o en la consola):',
      pinPlaceholder: 'PIN de autorización',
      deny: 'Cancelar',
      allow: 'Autorizar',
      invalidPin: 'PIN incorrecto. Revisa el PIN en tu panel /admin o en la consola.',
      expired: 'Solicitud de autorización expirada o inválida. Vuelve a intentarlo desde tu cliente MCP.',
      deniedByUser: 'Autorización cancelada por el usuario.',
      capabilities: {
        read: 'Lectura y búsqueda de archivos en workspaces autorizados',
        write: 'Creación, edición y movimiento de archivos',
        delete: 'Borrado dentro del workspace',
        commands: 'Ejecución de comandos en el workspace',
        operator: 'Control de navegador (Chrome/Firefox) y escritorio Windows (Operator)'
      }
    },
    dialog: {
      pickFolderTitle: 'Selecciona la carpeta de workspace para PC-Operator-MCP'
    }
  }
};

export function getServerMessages(lang) {
  const code = normalizeLanguage(lang);
  return MESSAGES[code] || MESSAGES.en;
}
