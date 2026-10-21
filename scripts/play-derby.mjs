// Plays a full derby match against the CPU by pressing SPACE on a timer; verifies the result screen appears.
import { chromium } from 'playwright';
const base = process.argv[2] ?? 'http://localhost:4173/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(base);
await page.waitForFunction(() => window.__game && window.__game.scene.isActive('MenuScene'), null, { timeout: 20000 });
await page.evaluate(() => { const g = window.__game; const m = g.registry.get('__buildMatch')('DerbyScene', 'single'); g.scene.stop('MenuScene'); g.scene.start('DerbyScene', { match: m }); });
await page.waitForTimeout(1500);
await page.keyboard.press('Space'); // dismiss how-to
const t0 = Date.now();
let done = false;
while (Date.now() - t0 < 240000) {
  await page.keyboard.press('Space');
  await page.waitForTimeout(700);
  if (await page.evaluate(() => window.__game.scene.isActive('ResultScene'))) { done = true; break; }
}
const info = await page.evaluate(() => { const s = window.__game.scene.getScene('DerbyScene'); return { scores: s.state?.scores, outs: s.state?.outs, winner: s.state?.winner, round: s.state?.round }; });
await page.screenshot({ path: 'smoke-output/derby-result.png' });
console.log('result screen:', done, JSON.stringify(info), 'elapsed', Math.round((Date.now() - t0) / 1000) + 's');
if (errors.length) console.log('ERRORS', errors.join('\n'));
await browser.close();
process.exit(done && !errors.length ? 0 : 1);
