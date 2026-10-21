// Verifies that pushing "up" (W key) moves the human wrestler away from the camera (z increases, screen y decreases).
import { chromium } from 'playwright';
const base = process.argv[2] ?? 'http://localhost:4173/?renderer=canvas';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(base);
await page.waitForFunction(() => window.__game && window.__game.scene.isActive('MenuScene'), null, { timeout: 20000 });
await page.evaluate(() => {
  const g = window.__game;
  const match = g.registry.get('__buildMatch')('WrestlingScene', 'local');
  g.scene.getScenes(false).filter((s) => s.scene.isActive() || s.scene.isPaused()).forEach((s) => g.scene.stop(s.scene.key));
  g.scene.start('WrestlingScene', { match });
});
await page.waitForTimeout(1200);
await page.keyboard.press('Space');
await page.waitForFunction(() => { const s = window.__game.scene.getScene('WrestlingScene'); return s && s.started && s.running; }, null, { timeout: 15000 });
await page.evaluate(() => { const g = window.__game; g.loop.stop(); window.__simT = g.loop.now || performance.now(); });
const step = (n) => page.evaluate((n) => { const g = window.__game; for (let i = 0; i < n; i++) { window.__simT += 16.67; g.step(window.__simT, 16.67); } }, n);
const info = () => page.evaluate(() => { const s = window.__game.scene.getScene('WrestlingScene'); const w = s.state.w[0]; const p = s.screenOf(0); return { x: +w.x.toFixed(2), z: +w.z.toFixed(2), sy: Math.round(p.y), state: w.state, grapple: s.state.grapple.active }; });
await step(90);
const a = await info();
// S first (toward the camera, away from the opponent), then W, all before the CPU can close in
await page.keyboard.down('s'); await step(25); await page.keyboard.up('s');
const b = await info();
await page.keyboard.down('w'); await step(25); await page.keyboard.up('w');
const c = await info();
console.log('start', a, '\nafter S', b, '\nafter W', c);
let ok = true;
if (!(b.z < a.z && b.sy > a.sy)) { console.log('FAIL: S should move toward camera (down the screen)'); ok = false; }
if (!(c.z > b.z && c.sy < b.sy)) { console.log('FAIL: W should move away from camera (up the screen)'); ok = false; }
if (errors.length) { console.log('errors', errors); ok = false; }
await browser.close();
console.log(ok ? 'wrestling axis ok' : 'wrestling axis FAILED');
process.exit(ok ? 0 : 1);
