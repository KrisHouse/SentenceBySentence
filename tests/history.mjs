// History tab tests against fixture logs: summary totals, streak (local days), a session that
// crosses midnight, range and search filters, the chart's empty days, CSV export and the 400px layout.
// Run: npm test (or node tests/history.mjs)
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { page_url, makeGitHub, device as openDevice, baseState } from './helpers.mjs';

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log('ok  ', name); }
  catch (e) { failures++; console.error('FAIL', name, '\n    ', e.message.split('\n').slice(0, 12).join('\n     ')); }
}
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

// Builds the fixture inside the page so "today" and local midnight use the browser's own clock and time zone.
async function withLog(p, spec) {
  await p.evaluate((spec) => {
    const now = new Date(), at = (daysAgo, h, m) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, h, m).getTime();
    const log = spec.map(([daysAgo, h, m, min, task], i) => {
      const start = at(daysAgo, h, m), ms = min * 60000;
      return { id: 'f' + i, start, end: start + ms, ms, planned: 25 * 60000, task, earned: min, bookId: 'sample', bookName: 'Sample', device: 'd_one', updatedAt: start };
    });
    localStorage.setItem('sbs-state-v1', JSON.stringify({ perV2: true, perSec: 60, perUnit: 'min', focusMin: 25, breakMin: 5, log }));
  }, spec);
  await p.reload();
}
const FIXTURE = [
  [0, 10, 0, 30, 'Write'],
  [1, 23, 50, 40, 'Late night'],   // crosses midnight: counts on yesterday, its start date
  [2, 9, 0, 20, 'write '],         // same task as "Write" (case-insensitive, trimmed)
  [10, 14, 0, 60, 'Email'],
  [40, 8, 0, 15, ''],              // blank name -> "Untitled focus"
];
const stat = (p, i) => p.locator('.stat').nth(i).innerText().then((t) => t.replace(/\s+/g, ' ').trim());

const p = await openDevice(browser, makeGitHub(), { state: baseState(), sync: null, hash: '#history' });

await check('summary cards and streak', async () => {
  await withLog(p, FIXTURE);
  assert.equal(await stat(p, 0), 'TODAY 30m 1 session');
  assert.equal(await stat(p, 1), 'LAST 7 DAYS 1h 30m 3 sessions');
  assert.equal(await stat(p, 2), 'LAST 30 DAYS 2h 30m 4 sessions');
  assert.equal(await stat(p, 3), 'ALL TIME 2h 45m 5 sessions');
  assert.equal(await stat(p, 4), 'STREAK 3 days in a row');
});

await check('streak still counts when the run ended yesterday, and breaks on a gap', async () => {
  await withLog(p, FIXTURE.slice(1));
  assert.equal(await stat(p, 4), 'STREAK 2 days in a row');
  await withLog(p, [[2, 9, 0, 20, 'x'], [3, 9, 0, 20, 'x']]);
  assert.equal(await stat(p, 4), 'STREAK 0 days in a row');
});

await check('a session crossing midnight is listed and totalled on its start day', async () => {
  await withLog(p, FIXTURE);
  const heads = await p.locator('.dayhead').allInnerTexts();
  assert.match(heads[0], /^Today\s+30m · 1 session$/);
  assert.match(heads[1], /^Yesterday\s+40m · 1 session$/);
  assert.match(await p.locator('.srow').nth(1).innerText(), /^11:50\s*PM\s*–\s*12:30\s*AM\n/);
});

await check('range filter drives the summary line, chart, top tasks and list', async () => {
  await p.click('[data-r="7"]');
  assert.match(await p.textContent('#hRangeSum'), /Last 7 days: 1h 30m focused · 3 sessions/);
  assert.equal(await p.locator('#hChart .cbar').count() + await p.locator('#hChart .zero').count(), 7, 'one bar per day, empty days at zero');
  assert.equal(await p.locator('#hChart .cbar').count(), 3);
  assert.equal(await p.locator('.srow').count(), 3);
  await p.click('[data-r="all"]');
  assert.equal(await p.locator('.srow').count(), 5);
  const top = await p.locator('#hTop li').allInnerTexts();
  assert.equal(top.length, 4);
  assert.match(top[0], /^Email/);
  assert.ok(top.some((t) => /^Write\s+50m · 2/.test(t)), 'Write and "write " grouped: ' + top.join(' | '));
  assert.ok(top.some((t) => /^Untitled focus/.test(t)));
});

await check('search filters by task name, case-insensitively', async () => {
  await p.fill('#hSearch', 'WRITE');
  assert.equal(await p.locator('.srow').count(), 2);
  assert.match(await p.textContent('#hRangeSum'), /50m focused · 2 sessions/);
  await p.fill('#hSearch', 'nothing like this');
  assert.match(await p.textContent('#hList'), /No sessions match/);
  await p.fill('#hSearch', '');
});

await check('CSV export: header and one row per shown session', async () => {
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#csvBtn')]);
  assert.equal(dl.suggestedFilename(), 'sentence-by-sentence-history.csv');
  const lines = fs.readFileSync(await dl.path(), 'utf8').replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(lines[0], 'date,start,end,task,focused_min,planned_min,sentences,story,device');
  assert.equal(lines.length, 1 + 5);
  assert.match(lines.find((l) => l.includes('Late night')), /,23:50,00:30,Late night,40\.0,25\.0,40,Sample,/);
  await p.fill('#hSearch', 'write');
  const [dl2] = await Promise.all([p.waitForEvent('download'), p.click('#csvBtn')]);
  assert.equal(fs.readFileSync(await dl2.path(), 'utf8').trim().split('\r\n').length, 1 + 2);
  await p.fill('#hSearch', '');
});

await check('rename in place (Enter saves, Esc cancels) and delete with confirmation', async () => {
  const row = () => p.locator('.srow').first();
  await row().locator('[data-act=rename]').click();
  await p.fill('.rename-in', 'Discarded'); await p.press('.rename-in', 'Escape');
  assert.match(await row().innerText(), /Write/);
  const before = Date.now();
  await row().locator('[data-act=rename]').click();
  await p.fill('.rename-in', 'Write, revised'); await p.press('.rename-in', 'Enter');
  assert.match(await row().innerText(), /Write, revised/);
  const e = await p.evaluate(() => JSON.parse(localStorage.getItem('sbs-state-v1')).log.find((x) => x.id === 'f0'));
  assert.ok(e.updatedAt >= before, 'rename bumps updatedAt');
  await row().locator('[data-act=del]').click();
  await p.click('[data-act=keep]');
  assert.equal(await p.locator('.srow').count(), 5);
  await row().locator('[data-act=del]').click();
  await p.click('[data-act=really]');
  assert.equal(await p.locator('.srow').count(), 4);
  const st = await p.evaluate(() => JSON.parse(localStorage.getItem('sbs-state-v1')));
  assert.ok(st.deletedLog.f0, 'tombstone recorded');
});

await check('empty state links back to Focus', async () => {
  await withLog(p, []);
  assert.match(await p.textContent('#hList'), /No sessions yet/);
  await p.click('#hList a[href="#focus"]');
  await p.waitForSelector('#viewFocus', { state: 'visible', timeout: 2000 });
  await p.click('#tabHistory');
});

await check('400px wide: no sideways page scroll, summary in 2 columns', async () => {
  await withLog(p, FIXTURE);
  await p.setViewportSize({ width: 400, height: 800 });
  await p.click('[data-r="90"]');
  const { sw, cw, cols } = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
    cols: getComputedStyle(document.getElementById('hStats')).gridTemplateColumns.split(' ').length }));
  assert.equal(sw, cw); assert.equal(cols, 2);
  await p.setViewportSize({ width: 1200, height: 800 });
});

await check('switching tabs keeps a running session going', async () => {
  await p.click('#tabFocus'); await p.click('#go');
  await p.click('#tabHistory'); await p.waitForTimeout(1200);
  assert.match(await p.textContent('#liveChip'), /^Focusing · \d+:\d\d$/);
  await p.click('#liveChip');
  await p.waitForSelector('#viewFocus', { state: 'visible', timeout: 2000 });
  const run = await p.evaluate(() => JSON.parse(localStorage.getItem('sbs-run-v1')));
  assert.equal(run.mode, 'focus'); assert.equal(run.running, true);
  assert.deepEqual(p.errors, []);
});

await browser.close();
if (failures) { console.error(`${failures} history test(s) failed`); process.exitCode = 1; } else console.log('PASS');
