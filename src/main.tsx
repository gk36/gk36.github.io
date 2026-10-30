import { render } from 'preact';
import '@fontsource-variable/inter';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';
import { App } from './app/App';
import { initProfile } from './app/store';
import { registerServiceWorker } from './app/pwa';
import { initSync } from './app/sync';

registerServiceWorker();

async function boot() {
  const root = document.getElementById('app');
  if (!root) return;
  try {
    await initProfile();
  } catch (e) {
    console.error(e);
    root.textContent = 'CARBMAXX could not open its local database. If you are in a private window, storage may be blocked.';
    return;
  }
  render(<App />, root);
  void initSync();
  // Starter recipes, once per device (their own chunk: they are built with the meal-idea library).
  void import('./data/examples').then((m) => m.seedExamples()).catch((e: unknown) => console.error('starter recipes', e));
}

void boot();
