// HORSE smoke: flick to shoot (touch), hold-release (keyboard), CPU turn, in both orientations.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const base = process.argv[2] ?? 'http://localhost:4173/?renderer=canvas';
mkdirSync('smoke-output', { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
let failed = false;
async function session(label, viewport, touch) {
  const page = await browser.newPage({ viewport, hasTouch: touch });
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/logo|404/.test(m.text())) errors.push(`${label} console: ${m.text()}`); });
  await page.goto(base);
  await page.waitForFunction(() => window.__game && window.__game.scene.isActive('MenuScene'), null, { timeout: 20000 });
  await page.evaluate(() => {
    const g = window.__game;
    localStorage.removeItem('sports-at-academy-hill-v1');
    const match = g.registry.get('__buildMatch')('HorseScene', 'single');
    g.scene.getScenes(true).forEach((s) => g.scene.stop(s.scene.key));
    g.scene.start('HorseScene', { match });
  });
  await page.waitForTimeout(1200);
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  await page.evaluate(() => { const g = window.__game; g.loop.stop(); window.__simT = g.loop.now || performance.now(); });
  const step = (n) => page.evaluate((n) => { const g = window.__game; for (let i = 0; i < n; i++) { window.__simT += 16.67; g.step(window.__simT, 16.67); } }, n);
  const info = () => page.evaluate(() => {
    const s = window.__game.scene.getScene('HorseScene');
    return { phase: s.phase, power: +s.power.toFixed(2), aim: +s.aim.x.toFixed(2), shot: s.shot ? { made: s.shot.made, timing: s.shot.timing } : null, shooter: s.state.shooter, letters: [...s.state.letters], scale: +s.shooter.charScale.toFixed(2), headY: Math.round(s.shooter.y - 220 * s.shooter.charScale), rimY: Math.round(s.proj.project(0, s.cfg.rimHeight, 0).sy) };
  });
  await step(20);
  let st = await info();
  console.log(label, 'ready: scale', st.scale, 'head top y', st.headY, 'rim y', st.rimY);
  if (st.scale > 2.0) { console.log('SPRITE TOO BIG'); failed = true; }
  if (st.headY < st.rimY + 10) { console.log('HEAD COVERS THE RIM'); failed = true; }
  await page.screenshot({ path: `smoke-output/horse-${label}-choose.png` });
  const W = viewport.width, H = viewport.height;
  // flick: press mid-court, pull up the sweet length (0.26 H), release
  const x0 = W * 0.4, y0 = H * 0.62;
  if (touch) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
    await step(2);
    for (let k = 1; k <= 5; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + 4 * k, y: y0 - 0.26 * H * (k / 5) }] }); await step(2); }
    st = await info();
    console.log(label, 'mid-flick: phase', st.phase, 'power', st.power, 'aim', st.aim);
    await page.screenshot({ path: `smoke-output/horse-${label}-flick.png` });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.move(x0, y0); await page.mouse.down();
    await step(2);
    for (let k = 1; k <= 5; k++) { await page.mouse.move(x0 + 4 * k, y0 - 0.26 * H * (k / 5)); await step(2); }
    st = await info();
    console.log(label, 'mid-flick: phase', st.phase, 'power', st.power, 'aim', st.aim);
    await page.screenshot({ path: `smoke-output/horse-${label}-flick.png` });
    await page.mouse.up();
  }
  await step(2);
  st = await info();
  console.log(label, 'released: phase', st.phase, 'shot', st.shot, 'power', st.power);
  if (st.phase !== 'flight') { console.log('FLICK DID NOT SHOOT'); failed = true; }
  await step(25);
  await page.screenshot({ path: `smoke-output/horse-${label}-flight.png` });
  // let the result play out and the CPU take its turn
  for (let i = 0; i < 900; i++) { await step(5); st = await info(); if (st.shooter === 0 && (st.phase === 'choose' || st.phase === 'ready') && i > 60) break; }
  console.log(label, 'after CPU: phase', st.phase, 'shooter', st.shooter, 'letters', st.letters);
  // keyboard: hold space ~0.75 s (sweet at 1.1 s * (1/1.62) = 0.68 s) then release
  await page.keyboard.down('Space');
  await step(42);
  st = await info();
  console.log(label, 'holding: phase', st.phase, 'power', st.power);
  await page.keyboard.up('Space');
  await step(2);
  st = await info();
  console.log(label, 'key release: phase', st.phase, 'shot', st.shot);
  if (st.phase !== 'flight') { console.log('KEY HOLD DID NOT SHOOT'); failed = true; }
  await page.close();
}
await session('landscape', { width: 1920, height: 1080 }, false);
await session('portrait', { width: 1080, height: 1920 }, true);
await browser.close();
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1); }
if (failed) process.exit(1);
console.log('horse smoke ok');
