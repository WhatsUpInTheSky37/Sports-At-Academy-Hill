// Screenshots the character art: setup screen, result screen, and the raw sprite sheets.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const base = process.argv[2] ?? 'http://localhost:4187/?renderer=canvas';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(base);
await page.waitForFunction(() => window.__game && window.__game.scene.isActive('MenuScene'), null, { timeout: 20000 });
await page.waitForTimeout(500);
await page.screenshot({ path: 'smoke-output/chars-menu.png' });
await page.evaluate(() => { const g = window.__game; g.scene.stop('MenuScene'); g.scene.start('SetupScene', { gameId: 'derby' }); });
await page.waitForTimeout(1200);
await page.screenshot({ path: 'smoke-output/chars-setup.png' });
await page.evaluate(() => { const g = window.__game; const m = g.registry.get('__buildMatch')('DerbyScene', 'single'); g.scene.stop('SetupScene'); g.scene.start('DerbyScene', { match: m }); });
await page.waitForTimeout(1500);
if (await page.evaluate(() => window.__game.scene.isActive('HowToScene'))) { await page.keyboard.press('Space'); await page.waitForTimeout(400); }
await page.evaluate(() => { const g = window.__game; const m = g.registry.get('__buildMatch')('DerbyScene', 'single'); const d = g.scene.getScene('DerbyScene'); d.scene.launch('ResultScene', { parent: 'DerbyScene', match: m, result: { winnerSlot: 0, summary: '6 - 4 home runs', scores: ['6 HR', '4 HR'] } }); d.scene.bringToTop('ResultScene'); d.scene.pause(); });
await page.waitForTimeout(1200);
await page.screenshot({ path: 'smoke-output/chars-result.png' });
for (const id of ['will', 'vinnie', 'bryan', 'ben']) {
  const data = await page.evaluate((k) => window.__game.textures.get('char-' + k).getSourceImage().toDataURL(), id);
  writeFileSync(`smoke-output/sheet-${id}.png`, Buffer.from(data.split(',')[1], 'base64'));
}
if (errors.length) console.log('ERRORS', errors.join('\n'));
await browser.close();
console.log('chars smoke ok');
