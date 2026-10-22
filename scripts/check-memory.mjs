// Boots the game as an iPhone (and as a desktop) and reports texture memory on the menu and after each game.
import { chromium, devices } from 'playwright';
const base = process.argv[2] ?? 'http://localhost:4173/?renderer=canvas';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const measure = () => ({
  mb: +(Object.values(window.__game.textures.list).reduce((sum, t) => { const src = t.source && t.source[0]; return sum + (src ? src.width * src.height * 4 : 0); }, 0) / 1e6).toFixed(0),
  textures: Object.keys(window.__game.textures.list).length,
  sheet: (() => { const t = window.__game.textures.get('char-will'); return t.source[0].width + 'x' + t.source[0].height; })(),
});
async function run(label, ctxOpts) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  await page.waitForFunction(() => window.__game && window.__game.scene.isActive('MenuScene'), null, { timeout: 20000 });
  await page.waitForTimeout(500);
  const out = [`menu ${JSON.stringify(await page.evaluate(measure))}`];
  for (const key of ['DerbyScene', 'HorseScene', 'HockeyScene', 'FootballScene', 'PoolScene', 'WrestlingScene', 'DartsScene']) {
    // football is measured in its heaviest form: 3 on 3 with an all-time QB, all seven kids on the field
    await page.evaluate((key) => { const g = window.__game; const extra = key === 'FootballScene' ? { football: { format: '3v3qb', rosters: [['will', 'bryan', 'dan'], ['vinnie', 'ben', 'jimmy']], qb: 'billy' } } : {}; const m = g.registry.get('__buildMatch')(key, 'single', extra); g.scene.getScenes(false).filter((s) => s.scene.isActive() || s.scene.isPaused()).forEach((s) => g.scene.stop(s.scene.key)); g.scene.start(key, { match: m }); }, key);
    await page.waitForTimeout(1500);
    await page.keyboard.press('Space');
    await page.waitForTimeout(800);
    if (key === 'HorseScene') { for (let i = 0; i < 8; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(250); } }
    out.push(`${key} ${JSON.stringify(await page.evaluate(measure))}`);
  }
  await page.evaluate(() => { const g = window.__game; g.scene.getScenes(false).filter((s) => s.scene.isActive() || s.scene.isPaused()).forEach((s) => g.scene.stop(s.scene.key)); g.scene.start('MenuScene'); });
  await page.waitForTimeout(800);
  out.push(`back to menu ${JSON.stringify(await page.evaluate(measure))}`);
  console.log(`== ${label}\n` + out.join('\n'));
  if (errors.length) console.log('ERRORS', errors.join('\n'));
  await ctx.close();
}
await run('iPhone', { ...devices['iPhone 13'] });
await run('desktop', { viewport: { width: 1920, height: 1080 } });
await browser.close();
