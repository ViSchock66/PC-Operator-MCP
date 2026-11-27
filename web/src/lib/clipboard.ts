import { pushToast } from '../ui/Toast';

export async function copyToClipboard(text: string, toastMessage?: string): Promise<boolean> {
  if (!text || text === '--') return false;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  if (toastMessage) {
    pushToast(toastMessage, 'success');
  }
  return true;
}
