// Darts smoke test. Headless swiftshader renders at ~1 fps, so game time is advanced by stepping
// the active scenes directly (sys.step) instead of waiting on wall-clock time.
import { chromium } from 'playwright';
const base = process.argv[2] ?? 'http://localhost:4186/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
const advance = async (page, ms) => {
  await page.evaluate((ms) => {
    const g = window.__game;
    window.__simT = window.__simT || g.loop.now;
    const frames = Math.ceil(ms / 16.67);
    for (let i = 0; i < frames; i++) {
      window.__simT += 16.67;
      for (const s of g.scene.getScenes(true)) s.sys.step(window.__simT, 16.67);
    }
  }, ms);
  await page.waitForTimeout(250); // let the scene manager process queued scene transitions
};
const info = (page) => page.evaluate(() => {
  const g = window.__game;
  const s = g.scene.getScene('DartsScene');
  return { scores: s.state.scores, turn: s.state.turn, hist: s.state.history, phase: s.phase, winner: s.state.winner, active: g.scene.getScenes(true).map((x) => x.scene.key) };
});
async function run(label, viewport, hasTouch) {
  const page = await browser.newPage({ viewport, hasTouch });
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/logo|404/.test(m.text())) errors.push(`${label} console: ${m.text()}`); });
  await page.goto(base);
  await page.waitForFunction(() => window.__game && window.__game.scene.isActive('MenuScene'), null, { timeout: 20000 });
  await page.evaluate(() => {
    const g = window.__game;
    const match = g.registry.get('__buildMatch')('DartsScene', 'single');
    g.scene.getScenes(false).filter((s) => s.scene.isActive() || s.scene.isPaused()).forEach((s) => g.scene.stop(s.scene.key));
    g.scene.start('DartsScene', { match });
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `smoke-output/darts-${label}-howto.png` });
  await page.keyboard.press('Space');
  await advance(page, 500);
  await page.screenshot({ path: `smoke-output/darts-${label}.png` });
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Space'); await advance(page, 700); }
  await page.screenshot({ path: `smoke-output/darts-${label}-thrown.png` });
  await advance(page, 2000);
  await advance(page, 2500);
  await page.screenshot({ path: `smoke-output/darts-${label}-ai.png` });
  console.log(label, 'after AI darts', JSON.stringify(await info(page)));
  // Play out the whole match: press Space whenever it is the human's turn.
  let state = await info(page);
  for (let i = 0; i < 400 && !state.active.includes('ResultScene'); i++) {
    if (state.turn === 0 && state.phase === 'aim') await page.keyboard.press('Space');
    await advance(page, 900);
    state = await info(page);
  }
  console.log(label, 'final', JSON.stringify(state));
  await page.screenshot({ path: `smoke-output/darts-${label}-result.png` });
  if (!state.active.includes('ResultScene')) errors.push(`${label}: match did not finish`);
  await page.close();
}
await run('landscape', { width: 1920, height: 1080 }, false);
await run('portrait', { width: 1080, height: 1920 }, true);
await browser.close();
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1); }
console.log('darts smoke ok');
