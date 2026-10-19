// Smoke test: sentences unlock during focus without moving the reading view,
// and the reading position is restored after a reload.
// Run: npm install && npx playwright install chromium && npm test
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const page_url = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.html')).href;
const fail = (msg) => { console.error('FAIL:', msg); process.exitCode = 1; };

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(page_url);
await page.selectOption('#perUnit', 'sec');
await page.fill('#perIn', '1');
await page.dispatchEvent('#perIn', 'input');
await page.click('#go');
await page.waitForTimeout(28000);

const scrollTop = () => page.evaluate(() => document.getElementById('sheet').scrollTop);
await page.evaluate(() => { document.getElementById('sheet').scrollTop = 400; });
const before = await scrollTop();
await page.waitForTimeout(4000);
const during = await scrollTop();
await page.click('#stop');
await page.waitForTimeout(500);
const after = await scrollTop();
const unlocked = await page.evaluate(() => document.querySelectorAll('#prose .s').length);
await page.waitForTimeout(600); // let the debounced position save run
await page.reload();
await page.waitForTimeout(500);
const reloaded = await scrollTop();

console.log({ unlocked, before, during, after, reloaded });
if (unlocked < 20) fail(`expected ~26 sentences unlocked, got ${unlocked}`);
if (during !== before) fail('reading view moved while sentences unlocked');
if (after !== before) fail('reading view moved after stopping');
if (Math.abs(reloaded - before) > 40) fail(`position not restored after reload (${before} -> ${reloaded})`);
if (errors.length) fail('page errors: ' + errors.join('; '));
if (!process.exitCode) console.log('PASS');
await browser.close();
