import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
for (const [label, viewport] of [['landscape', { width: 1920, height: 1080 }], ['portrait', { width: 1080, height: 1920 }]]) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:4173/?renderer=canvas');
  await page.waitForFunction(() => window.__game && window.__game.scene.isActive('MenuScene'), null, { timeout: 20000 });
  const go = async (fn, name, wait = 1500) => { await page.evaluate(fn); await page.waitForTimeout(wait); await page.screenshot({ path: `smoke-output/${label}-${name}.png` }); };
  await page.evaluate(() => localStorage.removeItem('sports-at-academy-hill-v1'));
  await page.reload();
  await page.waitForFunction(() => window.__game && window.__game.scene.isActive('MenuScene'), null, { timeout: 20000 });
  await go(() => { const g = window.__game; const m = g.registry.get('__buildMatch')('DerbyScene', 'local'); g.scene.stop('MenuScene'); g.scene.start('DerbyScene', { match: m }); }, 'HowToScene');
  await page.keyboard.press('Space');
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `smoke-output/${label}-PauseScene.png` });
  await page.keyboard.press('Escape');
  await go(() => { const g = window.__game; const m = g.registry.get('__buildMatch')('DerbyScene', 'single'); g.scene.getScene('DerbyScene').scene.launch('ResultScene', { parent: 'DerbyScene', match: m, result: { winnerSlot: 1, summary: '6 - 4 home runs', scores: ['4 HR', '6 HR'] } }); g.scene.pause('DerbyScene'); }, 'ResultScene');
  await go(() => { const g = window.__game; g.scene.scenes.forEach((s) => g.scene.stop(s.scene.key)); const match = g.registry.get('__buildMatch')('DerbyScene', 'single'); const state = { events: ['derby','horse','pool','wrestling','hockey','football','darts'], index: 4, points: [4,0], results: [0,0,0,0], clinchedBy: 0, clinchAnnounced: false }; g.scene.start('ChampionshipScene', { state, match: { ...match, championship: state } }); }, 'Clinch', 1800);
  await go(() => { const g = window.__game; g.scene.scenes.forEach((s) => g.scene.stop(s.scene.key)); const match = g.registry.get('__buildMatch')('DerbyScene', 'single'); const state = { events: ['derby','horse','pool','wrestling','hockey','football','darts'], index: 7, points: [4,3], results: [0,0,0,0,1,1,1], clinchedBy: 0, clinchAnnounced: true }; g.scene.start('ChampionshipScene', { state, match: { ...match, championship: state } }); }, 'Champion', 2500);
  if (errors.length) console.log(label, 'ERRORS', errors.join('\n'));
  await page.close();
}
await browser.close();
console.log('done');
