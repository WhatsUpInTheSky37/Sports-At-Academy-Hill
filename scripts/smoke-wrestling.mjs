import { chromium } from 'playwright';
const base = process.argv[2] ?? 'http://localhost:4183/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
async function run(label, viewport, hasTouch) {
  const page = await browser.newPage({ viewport, hasTouch });
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/logo|404/.test(m.text())) errors.push(`${label} console: ${m.text()}`); });
  await page.goto(base);
  await page.waitForFunction(() => window.__game && window.__game.scene.isActive('MenuScene'), null, { timeout: 20000 });
  await page.evaluate(() => {
    const g = window.__game;
    const match = g.registry.get('__buildMatch')('WrestlingScene', 'single');
    g.scene.getScenes(false).filter((s) => s.scene.isActive() || s.scene.isPaused()).forEach((s) => g.scene.stop(s.scene.key));
    g.scene.start('WrestlingScene', { match });
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `smoke-output/wrestling-${label}-howto.png` });
  await page.keyboard.press('Space');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `smoke-output/wrestling-${label}.png` });
  // headless rendering is slow, so fast-forward the scene by calling update() directly between key events
  const ff = (ms) => page.evaluate((ms) => { const s = window.__game.scene.getScene('WrestlingScene'); for (let i = 0; i < ms / 16; i++) s.update(0, 16); }, ms);
  const seen = new Set();
  const note = async () => { const ev = await page.evaluate(() => { const s = window.__game.scene.getScene('WrestlingScene'); return { phase: s.state.phase, grapple: s.state.grapple.active, pin: s.state.pin.active, w: s.state.w.map((w) => [w.state, Math.round(w.stamina), +w.x.toFixed(2)]) }; }); seen.add(ev.phase); return ev; };
  await ff(1500);
  console.log(label, 'after intro', JSON.stringify(await note()));
  await page.keyboard.down('d'); await page.waitForTimeout(150); await ff(400); await page.keyboard.up('d'); await page.waitForTimeout(100);
  await page.keyboard.down('f'); await page.waitForTimeout(100); await ff(50); await page.keyboard.up('f'); await page.waitForTimeout(100);
  console.log(label, 'after grab', JSON.stringify(await note()));
  await page.keyboard.down('g'); await page.waitForTimeout(100); await ff(50); await page.keyboard.up('g'); await page.waitForTimeout(100);
  await ff(600);
  console.log(label, 'after shove', JSON.stringify(await note()));
  await page.screenshot({ path: `smoke-output/wrestling-${label}-play.png` });
  await ff(6000);
  console.log(label, 'later', JSON.stringify(await note()));
  const info = await page.evaluate(() => { const s = window.__game.scene.getScene('WrestlingScene'); return { active: s.scene.isActive(), phase: s.state?.phase, w: s.state?.w.map((w) => [w.state, Math.round(w.stamina)]) }; });
  console.log(label, JSON.stringify(info));
  await page.screenshot({ path: `smoke-output/wrestling-${label}-late.png` });
  await page.close();
}
await run('landscape', { width: 1920, height: 1080 }, false);
await run('portrait', { width: 1080, height: 1920 }, true);
await browser.close();
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1); }
console.log('wrestling smoke ok');
