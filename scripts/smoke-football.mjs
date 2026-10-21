// Football smoke: tap to hike, press-hold on the field to throw there (touch), swipe to throw, keyboard hike + hold.
// Screenshots to smoke-output/football-*.png in both orientations.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const base = process.argv[2] ?? 'http://localhost:4173/?renderer=canvas';
mkdirSync('smoke-output', { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
let failed = false;
async function run(viewport, label, hasTouch) {
  const page = await browser.newPage({ viewport, hasTouch });
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/logo|404/.test(m.text())) errors.push(`${label} console: ${m.text()}`); });
  await page.goto(base);
  await page.waitForFunction(() => window.__game && window.__game.scene.isActive('MenuScene'), null, { timeout: 20000 });
  await page.evaluate(() => {
    const g = window.__game;
    localStorage.removeItem('sports-at-academy-hill-v1');
    const match = g.registry.get('__buildMatch')('FootballScene', 'single');
    g.scene.getScenes(false).filter((s) => s.scene.isActive() || s.scene.isPaused()).forEach((s) => g.scene.stop(s.scene.key));
    g.scene.start('FootballScene', { match });
  });
  await page.waitForTimeout(1200);
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  await page.evaluate(() => { const g = window.__game; g.loop.stop(); window.__simT = g.loop.now || performance.now(); });
  const step = (n) => page.evaluate((n) => { const g = window.__game; for (let i = 0; i < n; i++) { window.__simT += 16.67; g.step(window.__simT, 16.67); } }, n);
  const info = () => page.evaluate(() => {
    const s = window.__game.scene.getScene('FootballScene');
    return { phase: s.phase, charging: s.charging, passUsed: s.passUsed, pass: s.pass ? { to: s.pass.to, dur: s.pass.duration } : null, holder: s.holder ? s.holder.team : null, down: s.state.down, los: s.state.lineOfScrimmage, scores: [...s.state.scores], faces: s.athletes.map((a) => a.sprite.sprite.frame.name), scales: s.athletes.map((a) => +a.sprite.charScale.toFixed(2)) };
  });
  await step(30);
  let st = await info();
  console.log(label, 'pre-snap faces', st.faces, 'scales', st.scales);
  if (st.scales.some((x) => x > 1.2)) { console.log('SPRITES TOO BIG'); failed = true; }
  if (!(st.faces[2].startsWith('idle') && st.faces[3].startsWith('idle'))) { console.log('DEFENDERS NOT FACING THE OFFENCE'); failed = true; }
  await page.screenshot({ path: `smoke-output/football-${label}-presnap.png` });
  // tap the field to hike
  const W = viewport.width, H = viewport.height;
  const fieldPt = { x: W * 0.55, y: H * 0.5 };
  if (hasTouch) await page.touchscreen.tap(fieldPt.x, fieldPt.y); else await page.mouse.click(fieldPt.x, fieldPt.y);
  await step(3);
  st = await info();
  console.log(label, 'after tap: phase', st.phase);
  if (st.phase !== 'live') { console.log('TAP DID NOT HIKE'); failed = true; }
  await step(30);
  // press-hold on the field ~0.7 s then release: throw to that spot
  const spot = { x: W * 0.62, y: H * 0.42 };
  if (hasTouch) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: spot.x, y: spot.y }] });
    await step(42);
    await page.screenshot({ path: `smoke-output/football-${label}-charging.png` });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.move(spot.x, spot.y); await page.mouse.down();
    await step(42);
    await page.screenshot({ path: `smoke-output/football-${label}-charging.png` });
    await page.mouse.up();
  }
  await step(2);
  st = await info();
  console.log(label, 'after hold-release: passUsed', st.passUsed, 'pass', st.pass);
  if (!st.passUsed) { console.log('HOLD DID NOT THROW'); failed = true; }
  await step(20);
  await page.screenshot({ path: `smoke-output/football-${label}-pass.png` });
  // play out until the next pre-snap, then test a swipe throw
  for (let i = 0; i < 600; i++) { await step(4); st = await info(); if (st.phase === 'pre' && st.holder === 0) break; }
  console.log(label, 'next play: down', st.down, 'los', st.los.toFixed(1));
  if (st.phase === 'pre' && st.holder === 0) {
    if (hasTouch) await page.touchscreen.tap(fieldPt.x, fieldPt.y); else await page.mouse.click(fieldPt.x, fieldPt.y);
    await step(20);
    if (hasTouch) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: W * 0.5, y: H * 0.5 }] });
      await step(2);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: W * 0.6, y: H * 0.35 }] });
      await step(2);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.move(W * 0.5, H * 0.5); await page.mouse.down(); await step(2); await page.mouse.move(W * 0.6, H * 0.35, { steps: 3 }); await step(2); await page.mouse.up();
    }
    await step(2);
    st = await info();
    console.log(label, 'after swipe: passUsed', st.passUsed, 'pass', st.pass);
    if (!st.passUsed) { console.log('SWIPE DID NOT THROW'); failed = true; }
    await step(15);
    await page.screenshot({ path: `smoke-output/football-${label}-swipe.png` });
  }
  await page.close();
}
await run({ width: 1920, height: 1080 }, 'landscape', false);
await run({ width: 1080, height: 1920 }, 'portrait', true);
await browser.close();
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1); }
if (failed) process.exit(1);
console.log('football smoke ok');
