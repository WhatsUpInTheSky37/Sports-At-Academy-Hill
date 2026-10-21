import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
for (const [label, viewport] of [['landscape', { width: 1920, height: 1080 }], ['portrait', { width: 1080, height: 1920 }]]) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:4173/?renderer=canvas');
  await page.waitForFunction(() => window.__game && window.__game.scene.isActive('MenuScene'), null, { timeout: 20000 });
  const shots = [
    ['SetupScene', { gameId: 'wrestling' }], ['SettingsScene', {}], ['RecordsScene', {}],
    ['ChampionshipScene', null], ['HowToScene', null], ['PauseScene', null], ['ResultScene', null],
  ];
  for (const [key, data] of shots) {
    await page.evaluate(([key, data]) => {
      const g = window.__game;
      g.scene.getScenes(false).filter((s) => s.scene.isActive() || s.scene.isPaused()).forEach((s) => g.scene.stop(s.scene.key));
      const bm = g.registry.get('__buildMatch');
      if (key === 'ChampionshipScene') {
        const match = bm('DerbyScene', 'single');
        const state = { events: ['derby','horse','pool','wrestling','hockey','football','darts'], index: 4, points: [3,1], results: [0,0,1,0], clinchedBy: null, clinchAnnounced: false };
        g.scene.start(key, { state, match: { ...match, championship: state } });
      } else if (key === 'HowToScene' || key === 'PauseScene' || key === 'ResultScene') {
        const match = bm('DerbyScene', 'local');
        g.scene.start('DerbyScene', { match });
        setTimeout(() => {
          const d = key === 'HowToScene' ? { gameId: 'derby', parent: 'DerbyScene', mode: 'local' } : key === 'PauseScene' ? { parent: 'DerbyScene', match } : { parent: 'DerbyScene', match, result: { winnerSlot: 1, summary: '6 - 4 home runs', scores: ['4 HR', '6 HR'] } };
          if (g.scene.isActive('HowToScene')) g.scene.stop('HowToScene');
          g.scene.start(key, d);
          g.scene.pause('DerbyScene');
        }, 800);
      } else {
        g.scene.start(key, data);
      }
    }, [key, data]);
    await page.waitForTimeout(1800);
    await page.screenshot({ path: `smoke-output/${label}-${key}.png` });
  }
  if (errors.length) console.log(label, 'ERRORS', errors.join('\n'));
  await page.close();
}
await browser.close();
console.log('done');
