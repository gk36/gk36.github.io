import { expect, test, type Browser, type BrowserContext, type BrowserContextOptions, type Route, type TestInfo } from '@playwright/test';
import { eatenKcal, logFood, main, onboardFresh, watchErrors } from './helpers';

const DB = 'https://carbmaxx-default-rtdb.europe-west1.firebasedatabase.app';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

interface Rec { u: string; r: number; s: number; j: string }

/** Stand-in for Firebase Auth + Realtime Database, enforcing the rules in docs/firebase-rules-v2.json. */
class FakeFirebase {
  users = new Map<string, { uid: string; password: string }>();
  data: Record<string, Record<string, Record<string, Rec>>> = {};
  clock = 1;

  async attach(ctx: BrowserContext) {
    await ctx.route('https://identitytoolkit.googleapis.com/**', (r) => this.auth(r));
    await ctx.route(`${DB}/**`, (r) => this.db(r));
  }

  private json(route: Route, status: number, body: unknown) {
    return route.fulfill({ status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }

  private async auth(route: Route) {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    if (url.searchParams.get('key') !== 'test-key') return this.json(route, 400, { error: { message: 'API key not valid' } });
    const { email, password } = req.postDataJSON() as { email: string; password: string };
    let user = this.users.get(email);
    if (url.pathname.endsWith(':signUp')) {
      if (user) return this.json(route, 400, { error: { message: 'EMAIL_EXISTS' } });
      user = { uid: `uid-${this.users.size + 1}`, password };
      this.users.set(email, user);
    } else if (!user || user.password !== password) {
      return this.json(route, 400, { error: { message: 'INVALID_LOGIN_CREDENTIALS' } });
    }
    return this.json(route, 200, { localId: user.uid, email, idToken: `tok-${user.uid}`, refreshToken: `rt-${user.uid}`, expiresIn: '3600' });
  }

  private async db(route: Route) {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const m = /^\/v2\/users\/([^/]+)(?:\/([^/]+))?\.json$/.exec(url.pathname);
    const tokenUid = url.searchParams.get('auth')?.replace(/^tok-/, '');
    if (!m || !tokenUid || tokenUid !== decodeURIComponent(m[1]!)) return this.json(route, 401, { error: 'Permission denied' });
    const uid = tokenUid;
    if (req.method() === 'GET') {
      const after = Number(url.searchParams.get('startAt') ?? '0');
      const rows = Object.fromEntries(Object.entries(this.data[uid]?.[m[2]!] ?? {}).filter(([, r]) => r.s >= after));
      return this.json(route, 200, Object.keys(rows).length ? rows : null);
    }
    const body = req.postDataJSON() as Record<string, Omit<Rec, 's'>>;
    for (const [path, rec] of Object.entries(body)) {
      const [table, id] = path.split('/');
      const cur = this.data[uid]?.[table!]?.[id!];
      if (cur && !(rec.u > cur.u || (rec.u === cur.u && rec.r >= cur.r))) return this.json(route, 401, { error: 'Permission denied' });
    }
    const s = ++this.clock;
    for (const [path, rec] of Object.entries(body)) {
      const [table, id] = path.split('/');
      ((this.data[uid] ??= {})[table!] ??= {})[id!] = { u: rec.u, r: rec.r, j: rec.j, s };
    }
    return this.json(route, 200, body);
  }
}

async function device(browser: Browser, server: FakeFirebase, info: TestInfo) {
  const u = info.project.use as BrowserContextOptions & { baseURL?: string };
  const ctx = await browser.newContext({
    baseURL: u.baseURL ?? 'http://localhost:4173/app/', timezoneId: 'Europe/Athens', locale: 'en-GB', serviceWorkers: 'block',
    ...(u.viewport ? { viewport: u.viewport } : {}), ...(u.userAgent ? { userAgent: u.userAgent } : {}),
    ...(u.deviceScaleFactor ? { deviceScaleFactor: u.deviceScaleFactor } : {}), ...(u.isMobile ? { isMobile: true, hasTouch: true } : {}),
  });
  await ctx.addInitScript(() => { localStorage.setItem('carbmaxx_sync_api_key', 'test-key'); });
  await server.attach(ctx);
  const page = await ctx.newPage();
  return { ctx, page, errors: watchErrors(page) };
}

test('acceptance I: one account on two devices — edits sync both ways; another account can read nothing', async ({ browser }, info) => {
  test.setTimeout(120_000);
  const server = new FakeFirebase();

  // Device A: set up, log lunch, create the account.
  const A = await device(browser, server, info);
  await onboardFresh(A.page);
  await logFood(A.page, 'rice cooked', /White rice.*cooked/i, '200', { unit: 'g' });
  const kcalA = await eatenKcal(A.page);
  await A.page.goto('./#/settings');
  const syncA = main(A.page).getByRole('region', { name: 'Sync across devices' });
  await syncA.getByRole('textbox', { name: 'Email' }).fill('me@example.com');
  await syncA.getByLabel('Password').fill('correct horse');
  await syncA.getByRole('button', { name: 'Create account' }).click();
  await expect(syncA.getByRole('status')).toContainText('Synced just now');
  await expect(A.page.getByRole('link', { name: 'Synced' })).toBeVisible();

  // Device B: brand new — signs in from the welcome screen and skips setup.
  const B = await device(browser, server, info);
  await B.page.goto('./');
  await B.page.getByText('Already use CARBMAXX on another device?').click();
  await B.page.getByRole('textbox', { name: 'Email' }).fill('me@example.com');
  await B.page.getByLabel('Password').fill('correct horse');
  await B.page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(main(B.page).getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
  await expect.poll(() => eatenKcal(B.page)).toBe(kcalA);

  // An edit on B reaches A.
  await logFood(B.page, 'banana', /Banana/, '1');
  const kcalB = await eatenKcal(B.page);
  expect(kcalB).toBeGreaterThan(kcalA);
  await B.page.goto('./#/settings');
  await main(B.page).getByRole('button', { name: 'Sync now' }).click();
  await expect(main(B.page).getByRole('region', { name: 'Sync across devices' }).getByRole('status')).toContainText('Synced');
  await A.page.goto('./#/settings');
  await main(A.page).getByRole('button', { name: 'Sync now' }).click();
  await expect(syncA.getByRole('status')).toContainText('Synced');
  await A.page.goto('./#/today');
  await expect.poll(() => eatenKcal(A.page)).toBe(kcalB);

  // Another account: its own empty space, and no way into the first one.
  const C = await device(browser, server, info);
  await onboardFresh(C.page);
  await C.page.goto('./#/settings');
  const syncC = main(C.page).getByRole('region', { name: 'Sync across devices' });
  await syncC.getByRole('textbox', { name: 'Email' }).fill('someone-else@example.com');
  await syncC.getByLabel('Password').fill('another secret');
  await syncC.getByRole('button', { name: 'Create account' }).click();
  await expect(syncC.getByRole('status')).toContainText('Synced');
  await C.page.goto('./#/today');
  expect(await eatenKcal(C.page)).toBe(0);
  const status = await C.page.evaluate(async (db) => (await fetch(`${db}/v2/users/uid-1/entries.json?auth=tok-uid-2`)).status, DB);
  expect(status).toBe(401);
  // A wrong password is refused with a plain message.
  await C.page.goto('./#/settings');
  await main(C.page).getByRole('button', { name: 'Sign out' }).click();
  await syncC.getByRole('textbox', { name: 'Email' }).fill('me@example.com');
  await syncC.getByLabel('Password').fill('wrong');
  await syncC.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(syncC.getByRole('alert')).toHaveText('Email or password is wrong.');

  for (const d of [A, B, C]) {
    // The deliberate 401s above are logged by the browser as failed requests.
    expect(d.errors().filter((e) => !/status of 40[01]/.test(e))).toEqual([]);
    await d.ctx.close();
  }

});
