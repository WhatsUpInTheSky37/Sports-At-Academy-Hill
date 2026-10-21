// Hockey-only smoke: starts HockeyScene in both orientations, simulates play, screenshots to smoke-output/hockey-*.png
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const base = process.argv[2] ?? 'http://localhost:4184/';
mkdirSync('smoke-output', { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
async function run(label, viewport, hasTouch) {
  const page = await browser.newPage({ viewport, hasTouch });
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/logo|404/.test(m.text())) errors.push(`${label} console: ${m.text()}`); });
  await page.goto(base);
  await page.waitForFunction(() => window.__game && window.__game.scene.isActive('MenuScene'), null, { timeout: 20000 });
  await page.evaluate(() => {
    const g = window.__game;
    const match = g.registry.get('__buildMatch')('HockeyScene', 'single');
    g.scene.getScenes(true).forEach((s) => g.scene.stop(s.scene.key));
    g.scene.start('HockeyScene', { match });
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `smoke-output/hockey-${label}-howto.png` });
  await page.keyboard.press('Space');
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `smoke-output/hockey-${label}.png` });
  // simulate: skate forward, poke, hold shoot and release
  await page.keyboard.down('w');
  await page.waitForTimeout(1600);
  await page.keyboard.press('g');
  await page.waitForTimeout(400);
  await page.keyboard.down('f');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `smoke-output/hockey-${label}-charging.png` });
  await page.keyboard.up('f');
  await page.keyboard.up('w');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `smoke-output/hockey-${label}-play.png` });
  const info = await page.evaluate(() => {
    const s = window.__game.scene.getScene('HockeyScene');
    const st = s.state;
    return { phase: st.phase, scores: st.scores, p0: [st.players[0].x, st.players[0].z], p1: [st.players[1].x, st.players[1].z], puck: [st.puck.x, st.puck.z, st.puck.carrier], time: st.time };
  });
  console.log(label, JSON.stringify(info));
  await page.close();
}
await run('landscape', { width: 1920, height: 1080 }, false);
await run('portrait', { width: 1080, height: 1920 }, true);
await browser.close();
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1); }
console.log('hockey smoke ok');
