import { render } from 'preact';
import { App } from './app';
import { applyCachedAccent, initSystemAccent } from './state/accent';
import { initNativeHostBridge } from './state/nativeHost';
import { initThemeSync } from './state/prefs';
import { bootstrapStore } from './state/store';
import './styles/app.css';

initNativeHostBridge();
initThemeSync();
applyCachedAccent();
initSystemAccent();
void bootstrapStore();

const root = document.getElementById('app');
if (root) {
  render(<App />, root);
}
