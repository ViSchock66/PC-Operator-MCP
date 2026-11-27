import { useState } from 'preact/hooks';
import { t } from '../i18n';
import { copyToClipboard } from '../lib/clipboard';
import { IconButton } from './Button';

export function CopyValue({
  value,
  secret = false,
  toastMessage,
  copyLabel,
  class: className = '',
}: {
  value: string;
  secret?: boolean;
  toastMessage?: string;
  copyLabel?: string;
  class?: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const display = secret && !revealed ? '••••••••' : value || '--';
  const canCopy = Boolean(value && value !== '--');

  const handleCopy = async () => {
    if (!canCopy) return;
    await copyToClipboard(value, toastMessage || t('common.copied'));
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div class={`flex min-w-0 items-center gap-1 ${className}`}>
      <span
        class="min-w-0 truncate rounded bg-control px-2.5 py-1 font-mono text-[13px] leading-5 text-fg select-all"
        title={secret && !revealed ? undefined : value}
      >
        {display}
      </span>
      {secret ? (
        <IconButton
          icon={revealed ? 'eye_off' : 'eye'}
          label={revealed ? t('common.hide') : t('common.show')}
          onClick={() => setRevealed(!revealed)}
        />
      ) : null}
      <IconButton
        icon={copied ? 'checkmark' : 'copy'}
        label={copyLabel || t('common.copy')}
        disabled={!canCopy}
        onClick={handleCopy}
      />
    </div>
  );
}
