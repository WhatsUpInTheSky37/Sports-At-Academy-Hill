import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
for (const [label, viewport] of [['landscape', { width: 1920, height: 1080 }], ['portrait', { width: 1080, height: 1920 }]]) {
  const page = await browser.newPage({ viewport });
  await page.goto('http://localhost:4173/?renderer=canvas');
  await page.waitForFunction(() => window.__game && window.__game.scene.isActive('MenuScene'), null, { timeout: 20000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `smoke-output/${label}-menu.png` });
  await page.close();
}
await browser.close();
console.log('menu shots ok');
