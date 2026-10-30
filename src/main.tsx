import { render } from 'preact';
import '@fontsource-variable/inter';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';
import { App } from './app/App';
import { initProfile } from './app/store';
import { registerServiceWorker } from './app/pwa';
import { initSync } from './app/sync';
import { db, EXAMPLES_SEEDED_KEY } from './data/db';

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
  // Starter recipes, once per device. Their chunk carries the meal-idea library and the food table,
  // so it is only fetched until they have been added.
  void db().settings.get(EXAMPLES_SEEDED_KEY)
    .then((done) => (done ? 0 : import('./data/examples').then((m) => m.seedExamples())))
    .catch((e: unknown) => console.error('starter recipes', e));
}

void boot();
