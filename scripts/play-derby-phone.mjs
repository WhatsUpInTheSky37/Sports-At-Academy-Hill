// Plays the derby as an iPhone (tap-hit taps) through the batter switch, watching for stalls and errors.
import { chromium, devices } from 'playwright';
const base = process.argv[2] ?? 'http://localhost:4173/?renderer=canvas';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message + '\n' + (e.stack || '').split('\n').slice(1, 5).join('\n')));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(base);
await page.waitForFunction(() => window.__game && window.__game.scene.isActive('MenuScene'), null, { timeout: 20000 });
await page.evaluate(() => {
  const g = window.__game; localStorage.removeItem('sports-at-academy-hill-v1');
  const m = g.registry.get('__buildMatch')('DerbyScene', 'single'); g.scene.stop('MenuScene'); g.scene.start('DerbyScene', { match: m });
  // frame-gap monitor
  window.__maxGap = 0; let last = performance.now();
  const tick = () => { const n = performance.now(); if (n - last > window.__maxGap) { window.__maxGap = n - last; window.__maxGapAt = n; } last = n; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});
await page.waitForTimeout(1500);
await page.keyboard.press('Space');
const t0 = Date.now();
let switched = false, done = false, lastBatter = 0, switchedAt = 0;
while (Date.now() - t0 < 180000) {
  const st = await page.evaluate(() => { const s = window.__game.scene.getScene('DerbyScene'); return { phase: s.phase, batter: s.state?.batter, outs: s.state?.outs, scores: s.state?.scores, t: s.pitchT, center: s.aimCenter, maxGap: Math.round(window.__maxGap), result: window.__game.scene.isActive('ResultScene') }; });
  if (st.result) { done = true; console.log('result screen reached', JSON.stringify(st)); break; }
  if (st.batter !== lastBatter) { lastBatter = st.batter; switched = true; switchedAt = Date.now(); console.log('SWITCHED to batter', st.batter, JSON.stringify(st)); }
  if (st.phase === 'pitch' && st.batter === 0 && st.t > 0.72) {
    // swing early on purpose (outs come fast, so the switch comes fast); map logical px to the letterboxed canvas
    const r = await page.evaluate(() => { const b = window.__game.canvas.getBoundingClientRect(); return { l: b.left, t: b.top, w: b.width, h: b.height }; });
    await page.touchscreen.tap(r.l + st.center.x / 1080 * r.w, r.t + (st.center.y + 30) / 1920 * r.h);
  }
  if (switched && Date.now() - switchedAt > 45000) { console.log('45 s after the switch, still running fine', JSON.stringify(st)); break; }
  if (st.maxGap > 4000) { console.log('STALL', JSON.stringify(st)); break; }
  await page.waitForTimeout(60);
}
const fin = await page.evaluate(() => ({ maxGap: Math.round(window.__maxGap), at: Math.round(window.__maxGapAt) }));
console.log('switched', switched, 'done', done, 'max frame gap ms', fin.maxGap, 'elapsed', Math.round((Date.now() - t0) / 1000) + 's');
if (errors.length) console.log('ERRORS\n' + errors.join('\n'));
await browser.close();
