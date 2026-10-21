import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
await page.goto('http://localhost:4173/?renderer=canvas');
await page.waitForFunction(() => window.__game && window.__game.scene.isActive('MenuScene'), null, { timeout: 20000 });
await page.evaluate(() => { const g = window.__game; localStorage.removeItem('sports-at-academy-hill-v1'); const m = g.registry.get('__buildMatch')('FootballScene', 'single'); g.scene.stop('MenuScene'); g.scene.start('FootballScene', { match: m }); });
await page.waitForTimeout(1200);
await page.keyboard.press('Space');
await page.waitForTimeout(1500);
const info = await page.evaluate(() => {
  const s = window.__game.scene.getScene('FootballScene');
  return { started: s.started, phase: s.phase, camY: s.camY, dir: s.dir, athletes: s.athletes.map((a) => ({ team: a.team, x: a.x, y: a.y, sx: a.sprite.x, sy: a.sprite.y, vis: a.sprite.visible, scale: a.sprite.sprite.scale, depth: a.sprite.depth, frame: a.sprite.sprite.frame.name, flip: a.flip, away: a.away })), proj: s.proj.cam };
});
console.log(JSON.stringify(info, null, 1));
await page.screenshot({ path: 'smoke-output/football-dbg.png' });
await browser.close();
