import { render } from 'preact';
import '@fontsource-variable/inter';
import './styles/tokens.css';
import './styles/base.css';
import { App } from './app/App';
import { initProfile } from './app/store';
import { registerServiceWorker } from './app/pwa';

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
}

void boot();
