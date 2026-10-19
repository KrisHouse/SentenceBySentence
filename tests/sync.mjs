// Sync tests: properties of the pure merge function, and sync cycles against a mocked GitHub API.
// Never calls real GitHub: every request to api.github.com is answered from an in-memory gist store.
// Run: npm test (or node tests/sync.mjs)
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { TOKEN, FILE, makeGitHub, device as openDevice, local, waitSynced, entry, baseState } from './helpers.mjs';
let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log('ok  ', name); }
  catch (e) { failures++; console.error('FAIL', name, '\n    ', e.message.split('\n').slice(0, 12).join('\n     ')); }
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const device = (gh, opts) => openDevice(browser, gh, opts);

/* ---------- merge function ---------- */
const page = await device(makeGitHub(), { sync: null });
const merge = (a, b) => page.evaluate(([a, b]) => window.__sbsTest.mergeSyncData(a, b), [a, b]);
const book = (o) => ({ name: 'Book', revealed: 0, carryMs: 0, updatedAt: 0, readAtAt: 0, ...o });

await check('merge: union of logs from two devices', async () => {
  const m = await merge({ log: [entry('a', 100), entry('b', 300)] }, { log: [entry('c', 200), entry('a', 100)] });
  assert.deepEqual(m.log.map((e) => e.id), ['a', 'c', 'b']);
});
await check('merge: newer edit of the same session wins', async () => {
  const m = await merge({ log: [entry('a', 100, { task: 'old', updatedAt: 100 })] }, { log: [entry('a', 100, { task: 'renamed', updatedAt: 500 })] });
  assert.equal(m.log[0].task, 'renamed');
});
await check('merge: a tombstone stops a deleted session from coming back', async () => {
  const deviceA = { log: [entry('a', 100), entry('b', 200)] };
  const deviceB = { log: [entry('b', 200)], deletedLog: { a: 900 } };
  const m = await merge(deviceA, deviceB);
  assert.deepEqual(m.log.map((e) => e.id), ['b']);
  assert.equal(m.deletedLog.a, 900);
  // even a later rename on another device doesn't resurrect it
  const m2 = await merge(m, { log: [entry('a', 100, { task: 'x', updatedAt: 5000 })] });
  assert.deepEqual(m2.log.map((e) => e.id), ['b']);
});
await check('merge: removal beats older use, a later re-add beats the removal', async () => {
  const removed = await merge({ books: { b1: book({ revealed: 300, updatedAt: 5 }) } }, { removedBooks: { b1: 10 } });
  assert.equal(removed.books.b1, undefined);
  assert.equal(removed.hiddenBooks.b1.revealed, 300);
  const readded = await merge(removed, { books: { b1: book({ revealed: 3, updatedAt: 20 }) } });
  assert.ok(readded.books.b1, 're-added book is visible');
  assert.equal(readded.hiddenBooks.b1, undefined);
  assert.equal(readded.removedBooks.b1, 10);
});
await check('merge: removal vs re-add is the same in every order (associativity case)', async () => {
  const A = { books: { b1: book({ revealed: 300, updatedAt: 5 }) } };
  const B = { removedBooks: { b1: 10 } };
  const C = { books: { b1: book({ revealed: 3, updatedAt: 20 }) } };
  const r1 = await merge(await merge(A, C), B), r2 = await merge(await merge(A, B), C), r3 = await merge(A, await merge(B, C));
  assert.deepEqual(r1, r2); assert.deepEqual(r2, r3);
});
await check('merge: max revealed carries its own carryMs', async () => {
  const m = await merge({ books: { b1: book({ revealed: 40, carryMs: 59000 }) } }, { books: { b1: book({ revealed: 41, carryMs: 1000 }) } });
  assert.equal(m.books.b1.revealed, 41); assert.equal(m.books.b1.carryMs, 1000);
  const tie = await merge({ books: { b1: book({ revealed: 41, carryMs: 2000 }) } }, { books: { b1: book({ revealed: 41, carryMs: 1000 }) } });
  assert.equal(tie.books.b1.carryMs, 2000);
});
await check('merge: readAt is last writer wins, independent of progress', async () => {
  const m = await merge({ books: { b1: book({ revealed: 90, readAt: 80, readAtAt: 100 }) } }, { books: { b1: book({ revealed: 50, readAt: 12, readAtAt: 200 }) } });
  assert.equal(m.books.b1.readAt, 12); assert.equal(m.books.b1.revealed, 90);
});
await check('merge: name from the newer record; settings last writer wins', async () => {
  const m = await merge(
    { books: { b1: book({ name: 'Old title', updatedAt: 1 }) }, settings: { focusMin: 25, perSec: 60, perUnit: 'min', breakMin: 5, updatedAt: 1 } },
    { books: { b1: book({ name: 'New title', updatedAt: 2 }) }, settings: { focusMin: 45, perSec: 30, perUnit: 'sec', breakMin: 10, updatedAt: 9 } });
  assert.equal(m.books.b1.name, 'New title'); assert.equal(m.settings.focusMin, 45); assert.equal(m.settings.perUnit, 'sec');
});
await check('merge: malformed input is ignored, not trusted', async () => {
  const m = await merge({ log: [null, { id: 5 }, { id: 'ok', start: 1, task: { evil: 1 } }], books: { x: { revealed: 'many' } }, settings: { focusMin: 'x' } }, 'garbage');
  assert.deepEqual(m.log.map((e) => e.id), ['ok']); assert.equal(m.log[0].task, '');
  assert.deepEqual(m.books, {}); assert.equal(m.settings, undefined);
});

// Randomized fixtures that deliberately collide: shared ids, equal timestamps, ties.
function rng(seed) { return () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }; }
function randomDoc(r) {
  const pick = (a) => a[Math.floor(r() * a.length)], n = (k) => Math.floor(r() * k);
  const doc = { log: [], deletedLog: {}, books: {}, removedBooks: {}, devices: {} };
  for (let i = 0; i < 6; i++) doc.log.push(entry(pick(['a', 'b', 'c', 'd', 'e']), pick([100, 200]), { task: pick(['x', 'y', 'z']), updatedAt: pick([1, 2, 3]), earned: n(3) }));
  for (let i = 0; i < 2; i++) doc.deletedLog[pick(['a', 'b', 'q'])] = pick([5, 6]);
  for (const id of ['b1', 'b2', 'b3']) if (r() < .7) doc.books[id] = book({ name: pick(['N1', 'N2']), revealed: n(4), carryMs: n(3) * 1000, updatedAt: pick([1, 2, 3, 4]), readAt: n(5), readAtAt: pick([1, 2]) });
  if (r() < .5) doc.removedBooks[pick(['b1', 'b2'])] = pick([2, 3]);
  if (r() < .7) doc.settings = { focusMin: pick([25, 45]), perSec: pick([30, 60]), perUnit: pick(['min', 'sec']), breakMin: 5, updatedAt: pick([1, 2]) };
  doc.devices[pick(['d1', 'd2'])] = pick(['Mac · Safari', 'Windows · Chrome']);
  return doc;
}
await check('merge: commutative, associative and idempotent on 150 random triples', async () => {
  const r = rng(42), triples = Array.from({ length: 150 }, () => [randomDoc(r), randomDoc(r), randomDoc(r)]);
  const bad = await page.evaluate((triples) => {
    const m = window.__sbsTest.mergeSyncData, s = (x) => JSON.stringify(x), out = [];
    triples.forEach(([a, b, c], i) => {
      const ab = m(a, b);
      if (s(ab) !== s(m(b, a))) out.push(i + ': not commutative');
      if (s(m(ab, c)) !== s(m(a, m(b, c)))) out.push(i + ': not associative');
      if (s(m(a, ab)) !== s(ab)) out.push(i + ': merge(a, merge(a,b)) != merge(a,b)');
      if (s(m(ab, ab)) !== s(ab)) out.push(i + ': merge(m,m) != m');
    });
    return out;
  }, triples);
  assert.deepEqual(bad, []);
});
await page.context().close();

/* ---------- sync cycles against the mocked API ---------- */
await check('connect: creates the secret gist and pushes local sessions; token never leaves the header', async () => {
  const gh = makeGitHub();
  const p = await device(gh, { state: baseState({ log: [entry('s_local', Date.now() - 864e5)] }) });
  const { sync } = await waitSynced(p);
  assert.equal(sync.lastError, null);
  assert.ok(sync.gistId, 'gist id stored');
  const post = gh.requests.find((r) => r.method === 'POST');
  assert.ok(post, 'created a gist');
  const created = JSON.parse(post.body);
  assert.equal(created.public, false); assert.equal(created.description, 'Sentence by Sentence sync');
  const doc = gh.doc();
  assert.deepEqual(doc.log.map((e) => e.id), ['s_local']);
  assert.ok(gh.gists[sync.gistId].files[FILE].content.includes('\n "app"'), 'pretty-printed with 1-space indent');
  for (const r of gh.requests) {
    assert.equal(r.auth, 'Bearer ' + TOKEN);
    assert.ok(!(r.body || '').includes(TOKEN), 'token not in any request body');
  }
  const st = await local(p);
  assert.ok(!JSON.stringify(st.state).includes(TOKEN), 'token not in sbs-state-v1');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

await check('connect: finds the existing gist on a second device and merges both ways', async () => {
  const gh = makeGitHub();
  gh.gists.g9 = { id: 'g9', description: 'other', files: { 'notes.txt': { content: 'hi' } } };
  gh.gists.g7 = { id: 'g7', description: 'Sentence by Sentence sync', files: { [FILE]: { content: JSON.stringify({
    app: 'sentence-by-sentence', schema: 1, updatedAt: 1, log: [entry('s_remote', Date.now() - 2 * 864e5)], deletedLog: {},
    books: { sample: book({ name: 'The Keeper at Gannet Rock (sample)', revealed: 5, carryMs: 1000, updatedAt: 50, readAt: 2, readAtAt: 50 }) },
    removedBooks: {}, devices: { d_other: 'Mac · Safari' } }) } } };
  const p = await device(gh, { state: baseState({ log: [entry('s_local', Date.now() - 864e5)] }) });
  const { state, sync } = await waitSynced(p);
  assert.equal(sync.gistId, 'g7');
  assert.ok(!gh.requests.some((r) => r.method === 'POST'), 'no new gist');
  assert.deepEqual(state.log.map((e) => e.id).sort(), ['s_local', 's_remote']);
  assert.equal(state.books.sample.revealed, 5);
  assert.equal(state.devices.d_other, 'Mac · Safari');
  const doc = gh.doc('g7');
  assert.deepEqual(doc.log.map((e) => e.id).sort(), ['s_local', 's_remote']);
  assert.equal(Object.keys(doc.devices).length, 2);
  // A second sync with nothing new must not write.
  const patches = gh.requests.filter((r) => r.method === 'PATCH').length;
  const t = Date.now(); await p.reload(); await waitSynced(p, t);
  assert.equal(gh.requests.filter((r) => r.method === 'PATCH').length, patches, 'no push when nothing changed');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

await check('sync off: no requests to GitHub at all', async () => {
  const gh = makeGitHub();
  const p = await device(gh, { state: baseState(), sync: null });
  await p.waitForTimeout(800);
  assert.equal(gh.requests.length, 0);
  await p.context().close();
});

await browser.close();
if (failures) { console.error(`${failures} sync test(s) failed`); process.exitCode = 1; } else console.log('PASS');
