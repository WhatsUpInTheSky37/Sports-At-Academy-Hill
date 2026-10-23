// Plays football against the CPU for a while with simple scripted inputs and reports if the game loop
// stalls (phase stuck) or throws. Usage: node scripts/play-football.mjs [base] [format] [frames]
import { chromium } from 'playwright';
const base = process.argv[2] ?? 'http://localhost:4173/?renderer=canvas';
const format = process.argv[3] ?? '2v2';
const frames = +(process.argv[4] ?? 6000);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message + '\n' + e.stack));
await page.goto(base);
await page.waitForFunction(() => window.__game && window.__game.scene.isActive('MenuScene'), null, { timeout: 20000 });
await page.evaluate((format) => {
  const g = window.__game;
  localStorage.removeItem('sports-at-academy-hill-v1');
  const size = format.startsWith('1') ? 1 : 2;
  const football = { size, allTime: format.endsWith('qb'), rosters: [['will', 'bryan'].slice(0, size), ['vinnie', 'ben'].slice(0, size)], qb: 'billy' };
  const match = g.registry.get('__buildMatch')('FootballScene', 'single', { football });
  g.scene.getScenes(false).filter((s) => s.scene.isActive() || s.scene.isPaused()).forEach((s) => g.scene.stop(s.scene.key));
  g.scene.start('FootballScene', { match });
}, format);
await page.waitForTimeout(1200);
await page.keyboard.press('Space');
await page.waitForTimeout(300);
await page.evaluate(() => { const g = window.__game; g.loop.stop(); window.__simT = g.loop.now || performance.now(); });
const step = (n) => page.evaluate((n) => { const g = window.__game; for (let i = 0; i < n; i++) { window.__simT += 16.67; g.step(window.__simT, 16.67); } }, n);
const info = () => page.evaluate(() => {
  const s = window.__game.scene.getScene('FootballScene');
  return { allTime: s.allTime, kick: s.kick ? s.kick.kind + ':' + s.kick.stage + ':' + s.kick.team : null, phase: s.phase, offense: s.state.offense, down: s.state.down, los: +s.state.lineOfScrimmage.toFixed(1), passUsed: s.passUsed, holder: s.holder ? s.holder.character.id : null, playT: +s.playT.toFixed(1), scores: [...s.state.scores], ev: s.state.lastEvent, finished: s.finished, off: s.athletes.filter((a) => Math.abs(a.x) > 13 || a.y < -11 || a.y > 51).map((a) => a.character.id) };
});
let last = null, same = 0, plays = 0, possessions = new Set(), kicks = new Set(), pats = 0;
const keys = ['w', 'a', 's', 'd'];
for (let f = 0; f < frames; f += 10) {
  await step(10);
  const st = await info();
  possessions.add(st.offense);
  if (st.off.length) console.log('OFF FIELD', st.off, JSON.stringify(st));
  const key = JSON.stringify([st.phase, st.offense, st.down, st.los, st.passUsed, st.holder, st.kick]);
  if (st.kick) kicks.add(st.kick.split(':')[0]);
  if (key === last) same++; else { same = 0; last = key; }
  const mine = st.offense === 0 || st.allTime;
  if (st.phase === 'pat') { if (st.kick.endsWith(':ready:0')) { await page.keyboard.down('f'); await step(2); await page.keyboard.up('f'); pats++; } }
  else if (st.phase === 'kickoff') { if (st.kick.endsWith(':ready:0')) { await page.keyboard.down('f'); await step(15 + Math.floor(Math.random() * 20)); await page.keyboard.up('f'); } else { const k = keys[Math.floor(Math.random() * keys.length)]; await page.keyboard.down(k); await step(6); await page.keyboard.up(k); } }
  else if (st.phase === 'pre' && mine) { await page.keyboard.press(String(1 + Math.floor(Math.random() * 4))); await step(2); await page.keyboard.down('f'); await step(2); await page.keyboard.up('f'); plays++; }
  else if (st.phase === 'live' && mine && !st.passUsed && st.holder && st.playT > 0.5) { await page.keyboard.down('f'); await step(25); await page.keyboard.up('f'); }
  else if (st.phase === 'live') { const k = keys[Math.floor(Math.random() * keys.length)]; await page.keyboard.down(k); await step(6); await page.keyboard.up(k); }
  if (same > 60) { console.log('STUCK', JSON.stringify(st)); break; }
  if (st.finished) { console.log('match finished', JSON.stringify(st)); break; }
}
const st = await info();
console.log('end', JSON.stringify(st), 'plays', plays, 'pats kicked', pats, 'kick phases seen', [...kicks], 'possessions seen', [...possessions]);
if (!kicks.has('kickoff')) { console.log('NO KICKOFF SEEN'); process.exitCode = 1; }
if (errors.length) console.log('ERRORS:\n' + errors.join('\n'));
await browser.close();
process.exit(errors.length || same > 60 ? 1 : 0);
