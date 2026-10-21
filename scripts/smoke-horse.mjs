// HORSE smoke: starts HorseScene in both orientations, takes shots, screenshots to smoke-output/horse-*.png
import { chromium } from 'playwright';
const base = process.argv[2] ?? 'http://localhost:4181/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const errors = [];
async function session(label, viewport, touch) {
  const page = await browser.newPage({ viewport, hasTouch: touch });
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/logo|404/.test(m.text())) errors.push(`${label} console: ${m.text()}`); });
  await page.goto(base);
  await page.waitForFunction(() => window.__game && window.__game.scene.isActive('MenuScene'), null, { timeout: 20000 });
  await page.evaluate(() => {
    const g = window.__game;
    const match = g.registry.get('__buildMatch')('HorseScene', 'single');
    g.scene.getScenes(true).forEach((s) => g.scene.stop(s.scene.key));
    g.scene.start('HorseScene', { match });
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `smoke-output/horse-${label}-howto.png` });
  await page.keyboard.press('Space');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `smoke-output/horse-${label}-choose.png` });
  // cycle spots with keys
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `smoke-output/horse-${label}-spot2.png` });
  // hold and release shoot near perfect (perfectAt 0.62 * 1200ms = 744ms)
  await page.keyboard.down('Space');
  await page.waitForTimeout(740);
  await page.keyboard.up('Space');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `smoke-output/horse-${label}-flight.png` });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `smoke-output/horse-${label}-after.png` });
  // let the AI play its turn(s): poll the game clock until a second shot has been taken
  await page.waitForFunction(() => { const s = window.__game.scene.getScene('HorseScene'); return s.state.shotsTaken >= 2; }, null, { timeout: 60000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `smoke-output/horse-${label}-ai.png` });
  // wait until it is the human's turn again, then tap a chalk spot (touch) or press a key and shoot late
  await page.waitForFunction(() => { const s = window.__game.scene.getScene('HorseScene'); return s.phase === 'choose' || s.phase === 'ready'; }, null, { timeout: 60000 });
  if (touch) {
    const z = await page.evaluate(() => { const s = window.__game.scene.getScene('HorseScene'); const zone = s.spotZones[0]; const c = s.scale.canvas.getBoundingClientRect(); const sx = c.width / s.scale.width; return zone ? { x: c.left + zone.x * sx, y: c.top + zone.y * sx } : null; });
    if (z) await page.touchscreen.tap(z.x, z.y);
    await page.waitForTimeout(400);
  }
  await page.keyboard.down('Space');
  await page.waitForTimeout(950);
  await page.keyboard.up('Space');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `smoke-output/horse-${label}-shot2.png` });
  const info = await page.evaluate(() => {
    const s = window.__game.scene.getScene('HorseScene');
    return { phase: s.phase, state: s.state };
  });
  console.log(label, JSON.stringify(info));
  await page.close();
}
await session('landscape', { width: 1920, height: 1080 }, false);
await session('portrait', { width: 1080, height: 1920 }, true);
await browser.close();
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1); }
console.log('horse smoke ok');
