import addRegular from '@fluentui/svg-icons/icons/add_20_regular.svg?raw';
import arrowBidirectionalFilled from '@fluentui/svg-icons/icons/arrow_bidirectional_up_down_20_filled.svg?raw';
import arrowBidirectionalRegular from '@fluentui/svg-icons/icons/arrow_bidirectional_up_down_20_regular.svg?raw';
import arrowClockwiseRegular from '@fluentui/svg-icons/icons/arrow_clockwise_20_regular.svg?raw';
import arrowSyncRegular from '@fluentui/svg-icons/icons/arrow_sync_20_regular.svg?raw';
import branchRegular from '@fluentui/svg-icons/icons/branch_20_regular.svg?raw';
import checkmarkRegular from '@fluentui/svg-icons/icons/checkmark_20_regular.svg?raw';
import checkmarkCircleFilled from '@fluentui/svg-icons/icons/checkmark_circle_20_filled.svg?raw';
import checkmarkCircleRegular from '@fluentui/svg-icons/icons/checkmark_circle_20_regular.svg?raw';
import chevronDownRegular from '@fluentui/svg-icons/icons/chevron_down_20_regular.svg?raw';
import chevronRightRegular from '@fluentui/svg-icons/icons/chevron_right_20_regular.svg?raw';
import copyRegular from '@fluentui/svg-icons/icons/copy_20_regular.svg?raw';
import deleteRegular from '@fluentui/svg-icons/icons/delete_20_regular.svg?raw';
import dismissCircleFilled from '@fluentui/svg-icons/icons/dismiss_circle_20_filled.svg?raw';
import dismissCircleRegular from '@fluentui/svg-icons/icons/dismiss_circle_20_regular.svg?raw';
import eyeRegular from '@fluentui/svg-icons/icons/eye_20_regular.svg?raw';
import eyeOffRegular from '@fluentui/svg-icons/icons/eye_off_20_regular.svg?raw';
import folderFilled from '@fluentui/svg-icons/icons/folder_20_filled.svg?raw';
import folderRegular from '@fluentui/svg-icons/icons/folder_20_regular.svg?raw';
import globeFilled from '@fluentui/svg-icons/icons/globe_20_filled.svg?raw';
import globeRegular from '@fluentui/svg-icons/icons/globe_20_regular.svg?raw';
import homeFilled from '@fluentui/svg-icons/icons/home_20_filled.svg?raw';
import homeRegular from '@fluentui/svg-icons/icons/home_20_regular.svg?raw';
import infoRegular from '@fluentui/svg-icons/icons/info_20_regular.svg?raw';
import keyRegular from '@fluentui/svg-icons/icons/key_20_regular.svg?raw';
import openRegular from '@fluentui/svg-icons/icons/open_20_regular.svg?raw';
import optionsRegular from '@fluentui/svg-icons/icons/options_20_regular.svg?raw';
import pauseCircleFilled from '@fluentui/svg-icons/icons/pause_circle_20_filled.svg?raw';
import pauseCircleRegular from '@fluentui/svg-icons/icons/pause_circle_20_regular.svg?raw';
import playRegular from '@fluentui/svg-icons/icons/play_20_regular.svg?raw';
import plugConnectedRegular from '@fluentui/svg-icons/icons/plug_connected_20_regular.svg?raw';
import plugDisconnectedRegular from '@fluentui/svg-icons/icons/plug_disconnected_20_regular.svg?raw';
import powerRegular from '@fluentui/svg-icons/icons/power_20_regular.svg?raw';
import pulseFilled from '@fluentui/svg-icons/icons/pulse_20_filled.svg?raw';
import pulseRegular from '@fluentui/svg-icons/icons/pulse_20_regular.svg?raw';
import searchRegular from '@fluentui/svg-icons/icons/search_20_regular.svg?raw';
import settingsFilled from '@fluentui/svg-icons/icons/settings_20_filled.svg?raw';
import settingsRegular from '@fluentui/svg-icons/icons/settings_20_regular.svg?raw';
import shieldLockRegular from '@fluentui/svg-icons/icons/shield_lock_20_regular.svg?raw';
import signOutRegular from '@fluentui/svg-icons/icons/sign_out_20_regular.svg?raw';
import stopRegular from '@fluentui/svg-icons/icons/stop_20_regular.svg?raw';
import warningFilled from '@fluentui/svg-icons/icons/warning_20_filled.svg?raw';
import warningRegular from '@fluentui/svg-icons/icons/warning_20_regular.svg?raw';
import windowConsoleFilled from '@fluentui/svg-icons/icons/window_console_20_filled.svg?raw';
import windowConsoleRegular from '@fluentui/svg-icons/icons/window_console_20_regular.svg?raw';
import {
  siChatbot,
  siClaude,
  siCloudflare,
  siCursor,
  siGooglegemini,
  siTailscale,
} from 'simple-icons';

export type FluentIconName =
  | 'home'
  | 'globe'
  | 'folder'
  | 'window_console'
  | 'arrow_bidirectional_up_down'
  | 'pulse'
  | 'settings'
  | 'checkmark_circle'
  | 'pause_circle'
  | 'warning'
  | 'dismiss_circle'
  | 'arrow_clockwise'
  | 'arrow_sync'
  | 'copy'
  | 'checkmark'
  | 'eye'
  | 'eye_off'
  | 'chevron_right'
  | 'chevron_down'
  | 'add'
  | 'delete'
  | 'open'
  | 'plug_connected'
  | 'plug_disconnected'
  | 'branch'
  | 'search'
  | 'play'
  | 'stop'
  | 'shield_lock'
  | 'key'
  | 'power'
  | 'sign_out'
  | 'info'
  | 'options';

const REGULAR_ICONS: Record<FluentIconName, string> = {
  home: homeRegular,
  globe: globeRegular,
  folder: folderRegular,
  window_console: windowConsoleRegular,
  arrow_bidirectional_up_down: arrowBidirectionalRegular,
  pulse: pulseRegular,
  settings: settingsRegular,
  checkmark_circle: checkmarkCircleRegular,
  pause_circle: pauseCircleRegular,
  warning: warningRegular,
  dismiss_circle: dismissCircleRegular,
  arrow_clockwise: arrowClockwiseRegular,
  arrow_sync: arrowSyncRegular,
  copy: copyRegular,
  checkmark: checkmarkRegular,
  eye: eyeRegular,
  eye_off: eyeOffRegular,
  chevron_right: chevronRightRegular,
  chevron_down: chevronDownRegular,
  add: addRegular,
  delete: deleteRegular,
  open: openRegular,
  plug_connected: plugConnectedRegular,
  plug_disconnected: plugDisconnectedRegular,
  branch: branchRegular,
  search: searchRegular,
  play: playRegular,
  stop: stopRegular,
  shield_lock: shieldLockRegular,
  key: keyRegular,
  power: powerRegular,
  sign_out: signOutRegular,
  info: infoRegular,
  options: optionsRegular,
};

const FILLED_ICONS: Partial<Record<FluentIconName, string>> = {
  home: homeFilled,
  globe: globeFilled,
  folder: folderFilled,
  window_console: windowConsoleFilled,
  arrow_bidirectional_up_down: arrowBidirectionalFilled,
  pulse: pulseFilled,
  settings: settingsFilled,
  checkmark_circle: checkmarkCircleFilled,
  pause_circle: pauseCircleFilled,
  warning: warningFilled,
  dismiss_circle: dismissCircleFilled,
};

function normalizeSvg(raw: string): string {
  return raw
    .replace(/\s(width|height)="[^"]*"/g, '')
    .replace(/fill="(?!none)[^"]*"/g, 'fill="currentColor"')
    .replace('<svg ', '<svg width="100%" height="100%" fill="currentColor" ');
}

export interface IconProps {
  name: FluentIconName;
  filled?: boolean;
  size?: number;
  class?: string;
}

export function Icon({ name, filled = false, size = 16, class: className = '' }: IconProps) {
  const raw = (filled ? FILLED_ICONS[name] : undefined) ?? REGULAR_ICONS[name];
  const html = normalizeSvg(raw);
  return (
    <span
      aria-hidden="true"
      class={`inline-flex shrink-0 items-center justify-center ${className}`}
      style={{ width: `${size}px`, height: `${size}px` }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export type BrandName = 'tailscale' | 'cloudflare' | 'claude' | 'gemini' | 'chatgpt' | 'cursor';

const BRAND_PATHS: Record<BrandName, string> = {
  tailscale: siTailscale.path,
  cloudflare: siCloudflare.path,
  claude: siClaude.path,
  gemini: siGooglegemini.path,
  chatgpt: siChatbot.path,
  cursor: siCursor.path,
};

export function BrandIcon({
  name,
  size = 16,
  class: className = '',
}: {
  name: BrandName;
  size?: number;
  class?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="currentColor"
      width={size}
      height={size}
      class={`shrink-0 ${className}`}
    >
      <path d={BRAND_PATHS[name]} />
    </svg>
  );
}
