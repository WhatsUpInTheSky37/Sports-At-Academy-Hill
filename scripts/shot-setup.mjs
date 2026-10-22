// Screenshots of the setup screen (football team picker, all-time QB, a regular game) and the records screen.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const base = process.argv[2] ?? 'http://localhost:4173/?renderer=canvas';
mkdirSync('smoke-output', { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
for (const [label, viewport] of [['landscape', { width: 1920, height: 1080 }], ['portrait', { width: 1080, height: 1920 }]]) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  await page.waitForFunction(() => window.__game && window.__game.scene.isActive('MenuScene'), null, { timeout: 20000 });
  const open = (key, data) => page.evaluate(([key, data]) => { const g = window.__game; g.scene.getScenes(false).filter((s) => s.scene.isActive() || s.scene.isPaused()).forEach((s) => g.scene.stop(s.scene.key)); g.scene.start(key, data); }, [key, data]);
  await open('SetupScene', { gameId: 'football' });
  await page.waitForTimeout(600);
  await page.evaluate(() => { const s = window.__game.scene.getScene('SetupScene'); s.fmt = '3v3'; s.teams = [['will', 'dan'], ['jimmy']]; s.render(); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `smoke-output/setup-${label}-football-3v3.png` });
  await page.evaluate(() => { const s = window.__game.scene.getScene('SetupScene'); s.fmt = '3v3qb'; s.teams = [['will', 'dan', 'bryan'], ['jimmy', 'vinnie', 'ben']]; s.qb = 'billy'; s.render(); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `smoke-output/setup-${label}-football-qb.png` });
  await open('SetupScene', { gameId: 'derby' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `smoke-output/setup-${label}-derby.png` });
  await open('RecordsScene', {});
  await page.waitForTimeout(600);
  await page.screenshot({ path: `smoke-output/records-${label}.png` });
  if (errors.length) { console.log('ERRORS', errors); process.exit(1); }
  await page.close();
}
await browser.close();
console.log('setup shots ok');
