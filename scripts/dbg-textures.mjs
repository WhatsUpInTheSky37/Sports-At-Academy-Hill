import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message, '\n', (e.stack || '').split('\n').slice(0, 8).join('\n')));
await page.goto('http://localhost:4173/?renderer=canvas');
await page.waitForFunction(() => window.__game && window.__game.scene.isActive('MenuScene'), null, { timeout: 20000 });
for (const key of ['DerbyScene', 'HorseScene', 'PoolScene', 'WrestlingScene', 'HockeyScene', 'FootballScene', 'DartsScene']) {
  console.log('-> starting', key);
  await page.evaluate((key) => { const g = window.__game; const m = g.registry.get('__buildMatch')(key, 'single'); g.scene.getScenes(false).filter((s) => s.scene.isActive() || s.scene.isPaused()).forEach((s) => g.scene.stop(s.scene.key)); g.scene.start(key, { match: m }); }, key);
  await page.waitForTimeout(1500);
  await page.evaluate(() => { const g = window.__game; if (g.scene.isActive('HowToScene')) g.scene.getScene('HowToScene').scene.stop(); });
  await page.keyboard.press('Space');
  await page.waitForTimeout(2500);
  const bad = await page.evaluate(() => {
    const g = window.__game; const out = [];
    for (const sc of g.scene.getScenes(true)) {
      const walk = (list, path) => { for (const o of list) { if (o.texture && o.frame && o.frame.source && !o.frame.source.image) out.push(path + ':' + o.texture.key + '/' + o.frame.name); if (o.list) walk(o.list, path + '>' + (o.type || '')); } };
      walk(sc.children.list, sc.scene.key);
      if (sc.scene.key === 'HorseScene') out.push('horse keys: ' + Object.keys(g.textures.list).filter((k) => k.includes('bg')).join(','));
    }
    return out;
  });
  if (bad.length) console.log('DEAD TEXTURE REFS', bad.slice(0, 5));
}
await browser.close();
