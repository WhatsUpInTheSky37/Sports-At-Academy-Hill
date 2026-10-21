// Captures the derby batter at stance, load, contact and follow-through in both orientations.
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
for (const [label, viewport] of [['landscape', { width: 1920, height: 1080 }], ['portrait', { width: 1080, height: 1920 }]]) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:4173/?renderer=canvas');
  await page.waitForFunction(() => window.__game && window.__game.scene.isActive('MenuScene'), null, { timeout: 20000 });
  await page.evaluate(() => { const g = window.__game; localStorage.removeItem('sports-at-academy-hill-v1'); const m = g.registry.get('__buildMatch')('DerbyScene', 'single'); g.scene.stop('MenuScene'); g.scene.start('DerbyScene', { match: m }); });
  await page.waitForTimeout(1200);
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  await page.evaluate(() => { const g = window.__game; g.loop.stop(); window.__simT = g.loop.now || performance.now(); });
  const step = (n) => page.evaluate((n) => { const g = window.__game; for (let i = 0; i < n; i++) { window.__simT += 16.67; g.step(window.__simT, 16.67); } }, n);
  await step(80);
  await page.screenshot({ path: `smoke-output/derby-${label}-stance.png` });
  // advance until the pitch is in flight and near the plate
  for (let i = 0; i < 400; i++) { await step(1); const st = await page.evaluate(() => { const s = window.__game.scene.getScene('DerbyScene'); return { phase: s.phase, t: s.pitchT }; }); if (st.phase === 'pitch' && st.t > 1.0) break; }
  await page.screenshot({ path: `smoke-output/derby-${label}-load.png` });
  await page.keyboard.down('KeyF'); await step(2); await page.keyboard.up('KeyF');
  await page.screenshot({ path: `smoke-output/derby-${label}-contact.png` });
  await step(14);
  await page.screenshot({ path: `smoke-output/derby-${label}-follow.png` });
  await step(90);
  await page.screenshot({ path: `smoke-output/derby-${label}-after.png` });
  if (errors.length) console.log(label, 'ERRORS', errors.join('\n'));
  await page.close();
}
await browser.close();
console.log('derby swing shots ok');
