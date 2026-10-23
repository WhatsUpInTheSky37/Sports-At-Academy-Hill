// Screenshots of the kickoff and point-after screens. Usage: node scripts/shot-kicks.mjs [base]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const base = process.argv[2] ?? 'http://localhost:4173/?renderer=canvas';
mkdirSync('smoke-output', { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
for (const [label, viewport, hasTouch] of [['landscape', { width: 1920, height: 1080 }, false], ['portrait', { width: 1080, height: 1920 }, true]]) {
  const page = await browser.newPage({ viewport, hasTouch });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  await page.waitForFunction(() => window.__game && window.__game.scene.isActive('MenuScene'), null, { timeout: 20000 });
  await page.evaluate(() => {
    const g = window.__game;
    localStorage.removeItem('sports-at-academy-hill-v1');
    const match = g.registry.get('__buildMatch')('FootballScene', 'single', { football: { size: 2, allTime: false, rosters: [['will', 'bryan'], ['vinnie', 'ben']], qb: 'billy' } });
    g.scene.getScenes(false).filter((s) => s.scene.isActive() || s.scene.isPaused()).forEach((s) => g.scene.stop(s.scene.key));
    g.scene.start('FootballScene', { match });
  });
  await page.waitForTimeout(1200);
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  await page.evaluate(() => { const g = window.__game; g.loop.stop(); window.__simT = g.loop.now || performance.now(); });
  const step = (n) => page.evaluate((n) => { const g = window.__game; for (let i = 0; i < n; i++) { window.__simT += 16.67; g.step(window.__simT, 16.67); } }, n);
  const info = () => page.evaluate(() => { const s = window.__game.scene.getScene('FootballScene'); return { phase: s.phase, kick: s.kick && { kind: s.kick.kind, stage: s.kick.stage, team: s.kick.team }, holder: s.holder && s.holder.character.id, ball: { x: +s.ball.x.toFixed(1), y: +s.ball.y.toFixed(1), z: +s.ball.z.toFixed(1) }, ev: s.state.lastEvent }; });
  await step(20);
  console.log(label, 'opening', JSON.stringify(await info()));
  await page.screenshot({ path: `smoke-output/football-${label}-kickoff-ready.png` });
  await step(110); // the CPU kicks after 1.5 s; catch it in flight
  console.log(label, 'in flight', JSON.stringify(await info()));
  await page.screenshot({ path: `smoke-output/football-${label}-kickoff-fly.png` });
  for (let i = 0; i < 400; i++) { await step(5); const st = await info(); if (st.phase === 'live' || st.phase === 'dead' || st.phase === 'pre') break; }
  console.log(label, 'fielded', JSON.stringify(await info()));
  await page.screenshot({ path: `smoke-output/football-${label}-return.png` });
  // a point after for the person's team (once the field has reset after the kickoff)
  for (let i = 0; i < 400; i++) { await step(5); const st = await info(); if (st.phase === 'pre') break; }
  await page.evaluate(() => { const s = window.__game.scene.getScene('FootballScene'); s.state = { ...s.state, scores: [6, 0] }; s.startPat(0); });
  await step(25);
  console.log(label, 'pat', JSON.stringify(await info()));
  await page.screenshot({ path: `smoke-output/football-${label}-pat.png` });
  // kick when the marker is near the middle
  for (let i = 0; i < 120; i++) { const m = await page.evaluate(() => window.__game.scene.getScene('FootballScene').kick.marker); if (Math.abs(m - 0.5) < 0.06) break; await step(1); }
  await page.keyboard.down('f'); await step(2); await page.keyboard.up('f');
  await step(35);
  console.log(label, 'pat flight', JSON.stringify(await info()));
  await page.screenshot({ path: `smoke-output/football-${label}-pat-fly.png` });
  for (let i = 0; i < 200; i++) { await step(5); const st = await info(); if (!st.kick || st.kick.stage === 'done') break; }
  const res = await info();
  console.log(label, 'pat result', JSON.stringify(res));
  if (!/GOOD/.test(res.ev)) { console.log('PAT FROM THE MIDDLE WAS NOT GOOD'); process.exitCode = 1; }
  if (errors.length) { console.log('ERRORS', errors); process.exitCode = 1; }
  await page.close();
}
await browser.close();
console.log('kick shots done');
