// Verifies the X button in a game shows the confirm card and that MAIN MENU returns to the menu.
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:4173/?renderer=canvas');
await page.waitForFunction(() => window.__game && window.__game.scene.isActive('MenuScene'), null, { timeout: 20000 });
for (const key of ['DerbyScene', 'PoolScene', 'WrestlingScene']) {
  await page.evaluate((k) => { const g = window.__game; g.scene.scenes.forEach((s) => g.scene.stop(s.scene.key)); const m = g.registry.get('__buildMatch')(k, 'single'); g.scene.start(k, { match: m }); }, key);
  await page.waitForTimeout(1500);
  if (await page.evaluate(() => window.__game.scene.isActive('HowToScene'))) { await page.keyboard.press('Space'); await page.waitForTimeout(400); }
  await page.evaluate((k) => { const s = window.__game.scene.getScene(k); s.exitGame(); }, key);
  await page.waitForTimeout(500);
  const confirm = await page.evaluate(() => window.__game.scene.isActive('ConfirmExitScene'));
  if (key === 'DerbyScene') await page.screenshot({ path: 'smoke-output/exit-confirm.png' });
  await page.evaluate(() => { const s = window.__game.scene.getScene('ConfirmExitScene'); const btn = s.children.list.find((o) => o.type === 'Container' && o.list.some((c) => c.type === 'Text' && c.text === 'MAIN MENU')); btn.list.find((c) => c.type === 'Zone').emit('pointerup'); });
  await page.waitForTimeout(800);
  const menu = await page.evaluate(() => window.__game.scene.isActive('MenuScene') && !window.__game.scene.isActive('ConfirmExitScene'));
  console.log(key, 'confirm shown:', confirm, 'back at menu:', menu);
}
if (errors.length) console.log('ERRORS', errors.join('\n'));
await browser.close();
