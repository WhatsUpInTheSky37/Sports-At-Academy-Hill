// Fast-forward + high-score smoke: darts CPU turn should run at FAST_FORWARD speed with the button showing;
// a finished derby match should post to the online board and the HIGH SCORES screen should load.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const base = process.argv[2] ?? 'http://localhost:4173/?renderer=canvas';
const out = 'smoke-output'; mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = []; const notes = [];
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', (e) => errors.push(e.message + '\n' + (e.stack || '').split('\n').slice(1, 6).join('\n')));
page.on('console', (m) => { if (m.type() === 'error' && !/logo|404/.test(m.text())) errors.push('console: ' + m.text()); });
// never pollute the shared board from a smoke run: swallow the POST, let the reads through
await page.route(/supabase\.co\/rest\//, (route) => route.request().method() === 'POST' ? route.fulfill({ status: 201, body: '' }) : route.continue());
await page.goto(base);
await page.waitForFunction(() => window.__game && window.__game.scene.isActive('MenuScene'), null, { timeout: 20000 });
const start = async (key, mode = 'single') => {
  await page.evaluate(([key, mode]) => {
    const g = window.__game; const match = g.registry.get('__buildMatch')(key, mode);
    g.scene.getScenes(false).filter((s) => s.scene.isActive() || s.scene.isPaused()).forEach((s) => g.scene.stop(s.scene.key));
    g.scene.start(key, { match });
  }, [key, mode]);
  await page.waitForTimeout(1200);
  // the how-to card closes itself on Space and resumes the game underneath
  if (await page.evaluate(() => window.__game.scene.isActive('HowToScene'))) await page.keyboard.press('Space');
  await page.waitForTimeout(800);
};
// --- 1. darts: wait for the CPU's turn and check the fast-forward is on
await start('DartsScene');
// throw three darts quickly as the person (F = a button) so the CPU turn arrives
// the CPU turn is over in about a second at 6x, so poll tightly while the person's darts go in
const probe = () => page.evaluate(() => { const s = window.__game.scene.getScene('DartsScene'); return { factor: s.fastFactor(), turnSlot: s.turnSlot, btn: s.ffButton?.visible, label: s.ffButton?.list?.find?.((o) => o.text)?.text, ts: s.time.timeScale }; });
let ff = null;
for (let i = 0; i < 6 && !(ff && ff.factor > 1); i++) {
  await page.keyboard.press('f');
  for (let j = 0; j < 30 && !(ff && ff.factor > 1); j++) { await page.waitForTimeout(50); const f = await probe(); if (f.factor > 1) ff = f; }
  if (!(ff && ff.factor > 1)) ff = await probe();
}
notes.push('darts cpu turn: ' + JSON.stringify(ff));
await page.screenshot({ path: `${out}/ff-darts.png` });
if (!ff || ff.factor <= 1 || !ff.btn) errors.push('darts fast-forward did not engage: ' + JSON.stringify(ff));
// toggle to watch
await page.evaluate(() => { const s = window.__game.scene.getScene('DartsScene'); s.ffWanted = false; s.refreshFastForwardButton(); });
const watch = await page.evaluate(() => { const s = window.__game.scene.getScene('DartsScene'); return { factor: s.fastFactor(), label: s.ffButton?.list?.find?.((o) => o.text)?.text }; });
notes.push('after toggle: ' + JSON.stringify(watch));
if (watch.factor !== 1) errors.push('toggle to watch did not restore speed');
// --- 2. derby: finish a match and see the result card post a score
await start('DerbyScene');
await page.evaluate(() => { const s = window.__game.scene.getScene('DerbyScene'); s.finishMatch({ winnerSlot: 0, summary: 'smoke test', scores: ['3', '1'], points: [3, 1] }); });
let txt = '';
for (let i = 0; i < 40 && !/posted|#\d|not posted/.test(txt); i++) {
  await page.waitForTimeout(300);
  txt = await page.evaluate(() => { const r = window.__game.scene.getScene('ResultScene'); return r && r.scene.isActive() ? r.children.list.filter((o) => o.text).map((o) => o.text).join(' | ') : ''; });
}
notes.push('result card: ' + txt.slice(0, 400));
await page.screenshot({ path: `${out}/result-highscore.png` });
if (!/#\d|posted/.test(txt)) errors.push('result card never reported the online rank: ' + txt.slice(0, 200));
// --- 3. the HIGH SCORES screen
await page.evaluate(() => { const g = window.__game; g.scene.getScenes(false).filter((s) => s.scene.isActive() || s.scene.isPaused()).forEach((s) => g.scene.stop(s.scene.key)); g.scene.start('HighScoresScene', { game: 'derby' }); });
let rows = '';
for (let i = 0; i < 40 && !/\d\./.test(rows) && !/Could not|No scores/.test(rows); i++) {
  await page.waitForTimeout(300);
  rows = await page.evaluate(() => window.__game.scene.getScene('HighScoresScene').children.list.filter((o) => o.text).map((o) => o.text).join(' | '));
}
notes.push('high scores: ' + rows.slice(0, 500));
await page.screenshot({ path: `${out}/highscores.png` });
if (!/1\./.test(rows)) errors.push('high scores screen showed no rows: ' + rows.slice(0, 200));
// portrait too
await page.setViewportSize({ width: 1080, height: 1920 });
await page.waitForTimeout(800);
await page.evaluate(() => { const g = window.__game; g.scene.getScenes(false).filter((s) => s.scene.isActive() || s.scene.isPaused()).forEach((s) => g.scene.stop(s.scene.key)); g.scene.start('HighScoresScene', { game: 'football' }); });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/highscores-portrait.png` });
await page.evaluate(() => { const g = window.__game; g.scene.getScenes(false).filter((s) => s.scene.isActive() || s.scene.isPaused()).forEach((s) => g.scene.stop(s.scene.key)); g.scene.start('MenuScene'); });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/menu-portrait-hs.png` });
await browser.close();
console.log(notes.join('\n'));
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1); }
console.log('highscores smoke ok');
