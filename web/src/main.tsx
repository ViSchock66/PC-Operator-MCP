import { render } from 'preact';
import { App } from './app';
import { initThemeSync } from './state/prefs';
import { bootstrapStore } from './state/store';
import './styles/app.css';

initThemeSync();
void bootstrapStore();

const root = document.getElementById('app');
if (root) {
  render(<App />, root);
}
