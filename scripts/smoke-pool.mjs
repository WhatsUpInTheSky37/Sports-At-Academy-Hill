// Pool smoke test: boots PoolScene in both orientations, plays a break, lets the AI take turns.
// Headless software GL runs at a few fps, so shots in flight are fast-forwarded with runToRest().
import { chromium } from 'playwright';
const base = process.argv[2] ?? 'http://localhost:4182/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
const snap = (page) => page.evaluate(() => {
  const s = window.__game.scene.getScene('PoolScene');
  return { phase: s.phase, turn: s.state.turn, shots: s.state.shots, active: s.state.balls.filter((b) => b.active).length, msg: s.state.message, groups: s.state.groups, pending: s.state.pending, winner: s.state.winner, struck: s.simStruck, sub: s.scoreboardSub?.text };
});
async function run(label, viewport, hasTouch) {
  const page = await browser.newPage({ viewport, hasTouch });
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/logo|404/.test(m.text())) errors.push(`${label} console: ${m.text()}`); });
  await page.goto(base);
  await page.waitForFunction(() => window.__game && window.__game.scene.isActive('MenuScene'), null, { timeout: 20000 });
  await page.evaluate(() => {
    const g = window.__game;
    const match = g.registry.get('__buildMatch')('PoolScene', 'single');
    g.scene.getScenes(true).forEach((s) => g.scene.stop(s.scene.key));
    g.scene.start('PoolScene', { match });
  });
  await page.waitForTimeout(1500);
  await page.keyboard.press('Space'); // dismiss how-to
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `smoke-output/pool-${label}-aim.png` });
  await page.keyboard.press('Space'); // break
  let shotsSeen = 0;
  let afterBreakShot = false;
  for (let i = 0; i < 200; i++) {
    await page.waitForTimeout(500);
    const s = await snap(page);
    if (s.phase === 'rolling' && s.struck) {
      await page.evaluate(() => { const sc = window.__game.scene.getScene('PoolScene'); sc.sim.runToRest(); });
    }
    if (s.shots !== shotsSeen) { shotsSeen = s.shots; console.log(label, 'shot', s.shots, JSON.stringify({ turn: s.turn, active: s.active, msg: s.msg, groups: s.groups, pending: s.pending })); }
    if (s.shots >= 1 && !afterBreakShot && s.phase !== 'rolling') { afterBreakShot = true; await page.screenshot({ path: `smoke-output/pool-${label}-after-break.png` }); }
    // if it is the human's turn and they are aiming, take a shot; if placing, finish placing
    if (s.phase === 'pending' && s.pending && s.turn === 0) { await page.screenshot({ path: `smoke-output/pool-${label}-pending.png` }); await page.mouse.click(viewport.width / 2 - 200, viewport.height / 2 + 40); }
    if (s.phase === 'placing') await page.evaluate(() => window.__game.scene.getScene('PoolScene').finishPlacing());
    else if (s.phase === 'aiming' && s.turn === 0) { await page.waitForTimeout(300); await page.keyboard.press('Space'); }
    if (s.shots >= 6 || s.winner !== null) break;
  }
  const final = await snap(page);
  console.log(label, 'final', JSON.stringify(final));
  await page.screenshot({ path: `smoke-output/pool-${label}-later.png` });
  if (final.shots < 3) errors.push(`${label}: only ${final.shots} shots were completed`);
  await page.close();
}
await run('landscape', { width: 1920, height: 1080 }, false);
await run('portrait', { width: 1080, height: 1920 }, true);
await browser.close();
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1); }
console.log('pool smoke ok');
