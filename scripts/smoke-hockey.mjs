// Hockey shootout smoke: skate in, tap the net, check the attempt resolves; then rematch and check the
// players are still there. Screenshots to smoke-output/hockey-*.png in both orientations.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const base = process.argv[2] ?? 'http://localhost:4173/?renderer=canvas';
mkdirSync('smoke-output', { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
let failed = false;
async function run(label, viewport, hasTouch) {
  const page = await browser.newPage({ viewport, hasTouch });
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/logo|404/.test(m.text())) errors.push(`${label} console: ${m.text()}`); });
  await page.goto(base);
  await page.waitForFunction(() => window.__game && window.__game.scene.isActive('MenuScene'), null, { timeout: 20000 });
  await page.evaluate(() => {
    const g = window.__game;
    localStorage.removeItem('sports-at-academy-hill-v1');
    const match = g.registry.get('__buildMatch')('HockeyScene', 'single');
    g.scene.getScenes(true).forEach((s) => g.scene.stop(s.scene.key));
    g.scene.start('HockeyScene', { match });
  });
  await page.waitForTimeout(1200);
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  await page.evaluate(() => { const g = window.__game; g.loop.stop(); window.__simT = g.loop.now || performance.now(); });
  const step = (n) => page.evaluate((n) => { const g = window.__game; for (let i = 0; i < n; i++) { window.__simT += 16.67; g.step(window.__simT, 16.67); } }, n);
  const info = () => page.evaluate(() => {
    const s = window.__game.scene.getScene('HockeyScene');
    return { phase: s.phase, shooter: s.state.shooter, taken: [...s.state.taken], goals: [...s.state.goals], z: s.shooter.z, zoom: s.zoom, shot: s.shot && s.shot.outcome, sprites: [s.shooterSprite.visible && s.shooterSprite.active, s.goalieSprite.visible && s.goalieSprite.active], results: s.state.results.map((r) => r.outcome) };
  });
  await step(80);
  await page.screenshot({ path: `smoke-output/hockey-${label}-start.png` });
  // skate in toward the net (keyboard)
  await page.keyboard.down('w'); await page.keyboard.down('d');
  await step(70);
  await page.keyboard.up('d');
  await step(60);
  await page.keyboard.up('w');
  await step(10);
  let st = await info();
  console.log(label, 'after skating: phase', st.phase, 'z', st.z.toFixed(2), 'zoom', st.zoom.toFixed(2));
  await page.screenshot({ path: `smoke-output/hockey-${label}-skate.png` });
  // tap the top-left corner of the net on screen
  const corner = await page.evaluate(() => {
    const s = window.__game.scene.getScene('HockeyScene');
    const p = s.proj.project(-s.cfg.goalW / 2 + 0.25, s.cfg.goalH - 0.22, s.cfg.netZ);
    return s.toScreen(p.sx, p.sy);
  });
  if (hasTouch) await page.touchscreen.tap(corner.x, corner.y); else await page.mouse.click(corner.x, corner.y);
  await step(3);
  st = await info();
  console.log(label, 'after tap: phase', st.phase, 'outcome', st.shot);
  if (st.phase !== 'shot' && st.phase !== 'result') { console.log('TAP DID NOT SHOOT'); failed = true; }
  await step(12);
  await page.screenshot({ path: `smoke-output/hockey-${label}-shot.png` });
  await step(40);
  await page.screenshot({ path: `smoke-output/hockey-${label}-result.png` });
  // run until the CPU has taken its attempt
  for (let i = 0; i < 1200; i++) { await step(5); st = await info(); if (st.taken[1] >= 1 && st.phase === 'skate') break; }
  console.log(label, 'attempts taken', st.taken, 'results', st.results, 'sprites', st.sprites);
  if (st.taken[1] < 1) { console.log('CPU NEVER SHOT'); failed = true; }
  // rematch: restart the scene and confirm both sprites render (regression: players vanished on rematch)
  await page.evaluate(() => { const s = window.__game.scene.getScene('HockeyScene'); s.restartMatch(); });
  await step(90);
  await page.keyboard.press('Space');
  await step(80);
  const re = await page.evaluate(() => {
    const s = window.__game.scene.getScene('HockeyScene');
    const w = s.world.list;
    return { phase: s.phase, shooterIn: w.includes(s.shooterSprite), goalieIn: w.includes(s.goalieSprite), active: [s.shooterSprite.active, s.goalieSprite.active], alpha: [s.shooterSprite.alpha, s.goalieSprite.alpha], taken: [...s.state.taken] };
  });
  console.log(label, 'rematch', re);
  if (!re.shooterIn || !re.goalieIn || !re.active[0] || !re.active[1] || re.taken[0] !== 0) { console.log('REMATCH LOST THE PLAYERS'); failed = true; }
  await page.screenshot({ path: `smoke-output/hockey-${label}-rematch.png` });
  await page.close();
}
await run('landscape', { width: 1920, height: 1080 }, false);
await run('portrait', { width: 1080, height: 1920 }, true);
await browser.close();
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1); }
if (failed) process.exit(1);
console.log('hockey smoke ok');
