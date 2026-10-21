// Drives the championship shell end to end: setup -> hub -> each of the seven events -> result -> hub ... -> champion.
// Each event is started for real (its scene boots), then resolved through the scene's own finishMatch handoff.
import { chromium } from 'playwright';
const base = process.argv[2] ?? 'http://localhost:4173/?renderer=canvas';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(base);
await page.waitForFunction(() => window.__game && window.__game.scene.isActive('MenuScene'), null, { timeout: 20000 });
await page.evaluate(() => { localStorage.removeItem('sports-at-academy-hill-v1'); const g = window.__game; g.scene.stop('MenuScene'); g.scene.start('SetupScene', { championship: true }); });
await page.waitForTimeout(800);
// press START CHAMPIONSHIP via the scene's private start()
await page.evaluate(() => { window.__game.scene.getScene('SetupScene').start(); });
await page.waitForTimeout(800);
const order = ['DerbyScene', 'HorseScene', 'PoolScene', 'WrestlingScene', 'HockeyScene', 'FootballScene', 'DartsScene'];
const winners = [0, 1, 0, 0, 1, 0, 0]; // Will clinches after event 6 (4 wins), darts still played
for (let i = 0; i < 7; i++) {
  const hub = await page.evaluate(() => { const g = window.__game; const s = g.scene.getScene('ChampionshipScene'); return { active: g.scene.isActive('ChampionshipScene'), texts: s.children.list.filter((o) => o.type === 'Text').map((o) => o.text) }; });
  if (!hub.active) { console.log('hub not active before event', i); break; }
  if (hub.texts.some((t) => t.includes('CLINCHES'))) {
    console.log('clinch announced before event', i + 1, 'with points', hub.texts.filter((t) => /^\d$/.test(t)));
    await page.screenshot({ path: 'smoke-output/champ-clinch.png' });
    await page.evaluate(() => { const s = window.__game.scene.getScene('ChampionshipScene'); const zones = s.children.list.filter((o) => o.type === 'Container' && o.list.some((c) => c.type === 'Text' && c.text === 'KEEP PLAYING')); zones[0].list.find((c) => c.type === 'Zone').emit('pointerup'); });
    await page.waitForTimeout(300);
  }
  // click the PLAY EVENT button (the container holding a Text starting with PLAY EVENT)
  await page.evaluate(() => { const s = window.__game.scene.getScene('ChampionshipScene'); const btn = s.children.list.find((o) => o.type === 'Container' && o.list.some((c) => c.type === 'Text' && c.text.startsWith('PLAY EVENT'))); btn.list.find((c) => c.type === 'Zone').emit('pointerup'); });
  await page.waitForFunction((k) => window.__game.scene.isActive(k) || window.__game.scene.isActive('HowToScene'), order[i], { timeout: 15000 });
  await page.waitForTimeout(1200);
  if (await page.evaluate(() => window.__game.scene.isActive('HowToScene'))) { await page.keyboard.press('Space'); await page.waitForTimeout(600); }
  const active = await page.evaluate(() => window.__game.scene.getScenes(true).map((s) => s.scene.key));
  console.log('event', i + 1, order[i], 'active scenes:', active.join(','));
  if (i === 2) await page.screenshot({ path: 'smoke-output/champ-event3.png' });
  await page.evaluate(([k, w]) => { const s = window.__game.scene.getScene(k); s.finishMatch({ winnerSlot: w, summary: 'scripted result', scores: ['1', '0'] }); }, [order[i], winners[i]]);
  await page.waitForFunction(() => window.__game.scene.isActive('ResultScene'), null, { timeout: 15000 });
  await page.waitForTimeout(500);
  await page.evaluate(() => { const s = window.__game.scene.getScene('ResultScene'); const btn = s.children.list.find((o) => o.type === 'Container' && o.list.some((c) => c.type === 'Text' && c.text === 'CONTINUE CHAMPIONSHIP')); btn.list.find((c) => c.type === 'Zone').emit('pointerup'); });
  await page.waitForFunction(() => window.__game.scene.isActive('ChampionshipScene'), null, { timeout: 15000 });
  await page.waitForTimeout(1500);
}
const final = await page.evaluate(() => { const s = window.__game.scene.getScene('ChampionshipScene'); return s.children.list.filter((o) => o.type === 'Text').map((o) => o.text).filter((t) => /CHAMPION|Final score|WILL!|VINNIE!/.test(t)); });
console.log('final screen texts:', JSON.stringify(final));
const rec = await page.evaluate(() => JSON.parse(localStorage.getItem('sports-at-academy-hill-v1')).records);
console.log('records: matches', rec.matchesPlayed, 'championships', JSON.stringify(rec.championships), 'derby', JSON.stringify(rec.games.derby));
await page.screenshot({ path: 'smoke-output/champ-final.png' });
if (errors.length) console.log('ERRORS', errors.join('\n'));
await browser.close();
process.exit(errors.length || !final.some((t) => t.includes('WILL!')) ? 1 : 0);
