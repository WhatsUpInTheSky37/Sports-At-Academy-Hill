// Plays one game vs the CPU to the result screen with minimal scripted input, fast-forwarding game time
// deterministically (the real-time loop is stopped and Game.step is driven directly).
// Usage: node scripts/play-idle.mjs <SceneKey> <maxSimSeconds> [holdMs] [baseUrl]
import { chromium } from 'playwright';
const [key, maxSim = '600', holdMs = '350', base = 'http://localhost:4173/?renderer=canvas'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.stack || e.message));
await page.goto(base);
await page.waitForFunction(() => window.__game && window.__game.scene.isActive('MenuScene'), null, { timeout: 20000 });
await page.evaluate((k) => { const g = window.__game; localStorage.removeItem('sports-at-academy-hill-v1'); const m = g.registry.get('__buildMatch')(k, 'single'); g.scene.stop('MenuScene'); g.scene.start(k, { match: m }); }, key);
await page.waitForTimeout(1500);
if (await page.evaluate(() => window.__game.scene.isActive('HowToScene'))) { await page.keyboard.press('Space'); await page.waitForTimeout(500); }
await page.evaluate(() => { const g = window.__game; g.loop.stop(); window.__simT = g.loop.now || performance.now(); });
const ff = (sec) => page.evaluate((s) => { const g = window.__game; const n = Math.round(s / 0.0167); for (let i = 0; i < n; i++) { window.__simT += 16.67; g.step(window.__simT, 16.67); } }, sec);
const clickButton = (sceneKey, label) => page.evaluate(([k, l]) => { const s = window.__game.scene.getScene(k); const btn = s.children.list.find((o) => o.type === 'Container' && o.visible && o.list.some((c) => c.type === 'Text' && c.text === l)); if (!btn) return false; btn.list.find((c) => c.type === 'Zone').emit('pointerup'); return true; }, [sceneKey, label]);
let sim = 0;
const t0 = Date.now();
let done = false;
while (sim < Number(maxSim) && Date.now() - t0 < 900000) {
  if (key === 'PoolScene') {
    const phase = await page.evaluate(() => window.__game.scene.getScene('PoolScene').phase);
    if (phase === 'placing') await clickButton('PoolScene', 'DONE PLACING');
    else if (phase === 'pending') { (await clickButton('PoolScene', 'SOLIDS')) || (await clickButton('PoolScene', 'ACCEPT TABLE')); }
    await ff(0.3);
  }
  await page.keyboard.down('KeyF');
  await ff(Number(holdMs) / 1000);
  await page.keyboard.up('KeyF');
  await ff(0.05);
  if (key === 'HockeyScene' || key === 'WrestlingScene') { await page.keyboard.down('KeyW'); await ff(0.6); await page.keyboard.up('KeyW'); }
  await ff(1.2);
  sim += 2;
  if (await page.evaluate(() => window.__game.scene.isActive('ResultScene'))) { done = true; await ff(1.5); break; }
}
const info = await page.evaluate((k) => { const s = window.__game.scene.getScene(k); const r = window.__game.scene.getScene('ResultScene'); const texts = r.children?.list?.filter((o) => o.type === 'Text').map((o) => o.text).slice(0, 6); return { texts, state: JSON.stringify(s.state ?? s.sim ?? s.game ?? null)?.slice(0, 300), phase: s.phase }; }, key);
await page.screenshot({ path: `smoke-output/play-${key}.png` });
console.log(key, 'result screen:', done, 'sim seconds', sim, 'wall', Math.round((Date.now() - t0) / 1000) + 's', JSON.stringify(info.texts));
if (!done) console.log('phase', info.phase, 'state', info.state);
if (errors.length) console.log('ERRORS', errors.join('\n').slice(0, 1500));
await browser.close();
process.exit(done && !errors.length ? 0 : 1);
