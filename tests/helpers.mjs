// Shared helpers for the sync and history tests: an in-memory GitHub gist API and "devices"
// (browser contexts with their own localStorage). Nothing here ever talks to real GitHub.
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

export const page_url = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.html')).href;
export const TOKEN = 'ghp_test_token_never_leaks';
export const FILE = 'sentence-by-sentence.json';

// One shared store, so several browser contexts can act as several devices.
export function makeGitHub() {
  const gh = { gists: {}, requests: [], seq: 0, fail: null };
  gh.install = async (ctx) => {
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await ctx.route('https://api.github.com/**', async (route) => {
      const req = route.request(), url = new URL(req.url()), method = req.method();
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, accept, content-type, x-github-api-version',
        'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS', 'access-control-expose-headers': 'x-ratelimit-remaining, x-ratelimit-reset, retry-after' };
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const body = req.postData();
      gh.requests.push({ method, path: url.pathname + url.search, auth: req.headers()['authorization'], body });
      if (gh.fail) {
        const f = gh.fail(req, url);
        if (f === 'abort') return route.abort('internetdisconnected');
        if (f) return route.fulfill({ status: f.status, headers: { ...cors, ...(f.headers || {}) }, contentType: 'application/json', body: JSON.stringify({ message: f.message || 'error' }) });
      }
      const json = (status, data) => route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(data) });
      if (req.headers()['authorization'] !== 'Bearer ' + TOKEN) return json(401, { message: 'Bad credentials' });
      const view = (g) => ({ id: g.id, description: g.description, public: g.public,
        files: Object.fromEntries(Object.entries(g.files).map(([n, f]) => [n, { filename: n, truncated: false, content: f.content }])) });
      if (url.pathname === '/gists' && method === 'GET') {
        const page = +(url.searchParams.get('page') || 1), per = +(url.searchParams.get('per_page') || 30);
        return json(200, Object.values(gh.gists).slice((page - 1) * per, page * per).map(view));
      }
      if (url.pathname === '/gists' && method === 'POST') {
        const b = JSON.parse(body), id = 'g' + (++gh.seq);
        gh.gists[id] = { id, description: b.description, public: b.public, files: Object.fromEntries(Object.entries(b.files).map(([n, f]) => [n, { content: f.content }])) };
        return json(201, view(gh.gists[id]));
      }
      const m = url.pathname.match(/^\/gists\/([^/]+)$/);
      if (m && !gh.gists[m[1]]) return json(404, { message: 'Not Found' });
      if (m && method === 'GET') return json(200, view(gh.gists[m[1]]));
      if (m && method === 'PATCH') {
        const b = JSON.parse(body);
        for (const [n, f] of Object.entries(b.files)) gh.gists[m[1]].files[n] = { content: f.content };
        return json(200, view(gh.gists[m[1]]));
      }
      return json(404, { message: 'Not Found' });
    });
  };
  gh.doc = (id) => JSON.parse(gh.gists[id || Object.keys(gh.gists)[0]].files[FILE].content);
  return gh;
}

// A device = a browser context with its own localStorage.
export async function device(browser, gh, { state, sync = { token: TOKEN }, viewport = { width: 1200, height: 800 }, hash = '#selftest' } = {}) {
  const ctx = await browser.newContext({ viewport });
  await gh.install(ctx);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.goto(page_url + hash);
  await page.evaluate(([state, sync]) => {
    localStorage.clear();
    if (state) localStorage.setItem('sbs-state-v1', JSON.stringify(state));
    if (sync) localStorage.setItem('sbs-sync-v1', JSON.stringify(sync));
  }, [state, sync]);
  await page.reload();
  return page;
}
export const local = (page) => page.evaluate(() => ({ state: JSON.parse(localStorage.getItem('sbs-state-v1')), sync: JSON.parse(localStorage.getItem('sbs-sync-v1')) }));
export async function waitSynced(page, since = 0) {
  await page.waitForFunction((since) => {
    const s = JSON.parse(localStorage.getItem('sbs-sync-v1') || '{}');
    return (s.lastSyncAt || 0) > since || (s.lastError && s.lastError.at > since);
  }, since, { timeout: 10000 });
  return local(page);
}
export const entry = (id, start, extra = {}) => ({ id, start, end: start + 1500000, ms: 1500000, planned: 1500000, task: 'Task ' + id, earned: 25, bookId: 'sample', bookName: 'Sample', device: 'd_x', updatedAt: start, ...extra });
export const baseState = (extra = {}) => ({ perV2: true, perSec: 60, perUnit: 'min', focusMin: 25, breakMin: 5, log: [], ...extra });

