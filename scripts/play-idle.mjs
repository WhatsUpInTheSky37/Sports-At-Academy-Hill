// Plays one game vs the CPU to the result screen with minimal scripted input, fast-forwarding scene time.
// Usage: node scripts/play-idle.mjs <SceneKey> <maxSimSeconds> [holdMs]
import { chromium } from 'playwright';
const [key, maxSim = '600', holdMs = '350'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:4173/?renderer=canvas');
await page.waitForFunction(() => window.__game && window.__game.scene.isActive('MenuScene'), null, { timeout: 20000 });
await page.evaluate((k) => { const g = window.__game; localStorage.removeItem('sports-at-academy-hill-v1'); const m = g.registry.get('__buildMatch')(k, 'single'); g.scene.stop('MenuScene'); g.scene.start(k, { match: m }); window.__simT = 0; }, key);
await page.waitForTimeout(1500);
if (await page.evaluate(() => window.__game.scene.isActive('HowToScene'))) { await page.keyboard.press('Space'); await page.waitForTimeout(500); }
const ff = (sec) => page.evaluate((s) => { const g = window.__game; const n = Math.round(s / 0.0167); for (let i = 0; i < n; i++) { window.__simT += 16.67; for (const sc of g.scene.getScenes(true)) if (sc.sys.settings.status === 5 && sc.scene.key !== 'ResultScene') sc.sys.step(window.__simT, 16.67); } }, sec);
let sim = 0;
const t0 = Date.now();
let done = false;
while (sim < Number(maxSim) && Date.now() - t0 < 900000) {
  await page.keyboard.down('KeyF');
  await ff(Number(holdMs) / 1000);
  await page.keyboard.up('KeyF');
  await ff(0.05);
  if (key === 'HockeyScene' || key === 'WrestlingScene') { await page.keyboard.down('KeyW'); await ff(0.6); await page.keyboard.up('KeyW'); }
  await ff(1.2);
  sim += 2;
  if (await page.evaluate(() => window.__game.scene.isActive('ResultScene'))) { done = true; break; }
}
const info = await page.evaluate((k) => { const s = window.__game.scene.getScene(k); const r = window.__game.scene.getScene('ResultScene'); const texts = r.children?.list?.filter((o) => o.type === 'Text').map((o) => o.text).slice(0, 6); return { texts, state: JSON.stringify(s.state ?? s.sim ?? s.game ?? null)?.slice(0, 300) }; }, key);
await page.screenshot({ path: `smoke-output/play-${key}.png` });
console.log(key, 'result screen:', done, 'sim seconds', sim, 'wall', Math.round((Date.now() - t0) / 1000) + 's', JSON.stringify(info.texts));
if (!done) console.log('state', info.state);
if (errors.length) console.log('ERRORS', errors.join('\n').slice(0, 1000));
await browser.close();
process.exit(done && !errors.length ? 0 : 1);
