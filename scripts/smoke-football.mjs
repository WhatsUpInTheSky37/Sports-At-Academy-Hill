// Football-only smoke: boots the game, jumps to FootballScene, plays a few keyboard snaps, screenshots both orientations.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:4185/';
mkdirSync('smoke-output', { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const errors = [];
async function run(viewport, label, hasTouch, steps) {
  const page = await browser.newPage({ viewport, hasTouch });
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/logo|404/.test(m.text())) errors.push(`${label} console: ${m.text()}`); });
  await page.goto(base);
  await page.waitForFunction(() => window.__game && window.__game.scene.isActive('MenuScene'), null, { timeout: 20000 });
  await page.evaluate(() => {
    const g = window.__game;
    const match = g.registry.get('__buildMatch')('FootballScene', 'single');
    g.scene.getScenes(true).forEach((s) => g.scene.stop(s.scene.key));
    g.scene.start('FootballScene', { match });
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `smoke-output/football-${label}-howto.png` });
  await page.keyboard.press('Space');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `smoke-output/football-${label}-presnap.png` });
  await steps(page);
  const info = await page.evaluate(() => {
    const s = window.__game.scene.getScene('FootballScene');
    return { phase: s.phase, state: s.state, holder: s.holder ? { team: s.holder.team, idx: s.holder.idx, x: s.holder.x, y: s.holder.y } : null };
  });
  console.log(label, JSON.stringify(info));
  await page.close();
}
const play = async (page) => {
  // snap, run forward a bit, then throw
  await page.keyboard.press('F');
  await page.waitForTimeout(300);
  await page.keyboard.down('W');
  await page.waitForTimeout(500);
  await page.keyboard.up('W');
  await page.screenshot({ path: `smoke-output/football-live.png` });
  await page.keyboard.down('F');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `smoke-output/football-charging.png` });
  await page.keyboard.up('F');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `smoke-output/football-afterpass.png` });
  await page.waitForTimeout(2500);
  // second play: just run
  await page.keyboard.press('F');
  await page.keyboard.down('W');
  await page.waitForTimeout(3500);
  await page.keyboard.up('W');
  await page.screenshot({ path: `smoke-output/football-run.png` });
  await page.waitForTimeout(3000);
  // keep playing automatically for a while to exercise AI possessions
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('F');
    await page.keyboard.down('W');
    await page.waitForTimeout(2500);
    await page.keyboard.up('W');
    await page.waitForTimeout(2200);
  }
  await page.screenshot({ path: `smoke-output/football-later.png` });
};
await run({ width: 1920, height: 1080 }, 'landscape', false, play);
await run({ width: 1080, height: 1920 }, 'portrait', true, async (page) => {
  await page.keyboard.press('F');
  await page.keyboard.down('W');
  await page.waitForTimeout(900);
  await page.keyboard.up('W');
  await page.screenshot({ path: `smoke-output/football-portrait-live.png` });
  await page.waitForTimeout(4000);
});
await browser.close();
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1); }
console.log('football smoke ok');
