// Wrestling smoke: four touch buttons, punch/kick poses, hold-to-escape bar and a stretch of CPU play.
// Screenshots to smoke-output/wrestling-*.png in both orientations.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const base = process.argv[2] ?? 'http://localhost:4173/?renderer=canvas';
mkdirSync('smoke-output', { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
let failed = false;
async function run(label, viewport, hasTouch) {
  const page = await browser.newPage({ viewport, hasTouch });
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}\n${e.stack}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/logo|404/.test(m.text())) errors.push(`${label} console: ${m.text()}`); });
  await page.goto(base);
  await page.waitForFunction(() => window.__game && window.__game.scene.isActive('MenuScene'), null, { timeout: 20000 });
  const start = (mode) => page.evaluate((mode) => {
    const g = window.__game;
    localStorage.removeItem('sports-at-academy-hill-v1');
    const match = g.registry.get('__buildMatch')('WrestlingScene', mode);
    g.scene.getScenes(false).filter((s) => s.scene.isActive() || s.scene.isPaused()).forEach((s) => g.scene.stop(s.scene.key));
    g.scene.start('WrestlingScene', { match });
  }, mode);
  const step = (n) => page.evaluate((n) => { const g = window.__game; for (let i = 0; i < n; i++) { window.__simT += 16.67; g.step(window.__simT, 16.67); } }, n);
  const info = () => page.evaluate(() => {
    const s = window.__game.scene.getScene('WrestlingScene');
    return { phase: s.state.phase, w: s.state.w.map((w) => ({ x: +w.x.toFixed(2), z: +w.z.toFixed(2), state: w.state, strike: w.strike, stamina: Math.round(w.stamina) })), pin: { ...s.state.pin }, buttons: s.controls[0] ? ['a', 'b', 'c', 'd'].filter((b) => s.controls[0].keys[b]).length : 0 };
  });

  // ---- local two-player: deterministic poses and the pin/escape flow ----
  await start('local');
  await page.waitForTimeout(1200);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => { const s = window.__game.scene.getScene('WrestlingScene'); return s && s.started && s.running; }, null, { timeout: 15000 });
  await page.evaluate(() => { const g = window.__game; g.loop.stop(); window.__simT = g.loop.now || performance.now(); });
  await step(90);
  await page.screenshot({ path: `smoke-output/wrestling-${label}-start.png` });
  // walk P1 up to P2 and punch
  await page.keyboard.down('d'); await step(24); await page.keyboard.up('d');
  let st = await info();
  console.log(label, 'approach', JSON.stringify(st.w));
  await page.keyboard.down('h'); await step(2); await page.keyboard.up('h');
  await step(2);
  st = await info();
  console.log(label, 'punch', JSON.stringify(st.w));
  if (st.w[0].state !== 'strike' || st.w[0].strike !== 'punch') { console.log('PUNCH POSE MISSING'); failed = true; }
  if (st.w[1].state !== 'stagger') { console.log('PUNCH DID NOT STAGGER'); failed = true; }
  await page.screenshot({ path: `smoke-output/wrestling-${label}-punch.png` });
  await step(14); // punch animation over, opponent still staggered
  // step back in (the punch knocked them away) and kick: the opponent is still staggered -> sweep
  await page.evaluate(() => { const s = window.__game.scene.getScene('WrestlingScene'); s.state.w[1].x = s.state.w[0].x + 0.85; s.state.w[1].z = s.state.w[0].z; s.state.w[1].vx = 0; s.state.w[1].vz = 0; s.state.w[0].cooldown = 0; });
  await page.keyboard.down('j'); await step(2); await page.keyboard.up('j');
  await step(2);
  st = await info();
  console.log(label, 'kick', JSON.stringify(st.w));
  if (st.w[0].state !== 'strike' || st.w[0].strike !== 'kick') { console.log('KICK POSE MISSING'); failed = true; }
  if (st.w[1].state !== 'down') { console.log('KICK DID NOT SWEEP A STAGGERED OPPONENT'); failed = true; }
  await page.screenshot({ path: `smoke-output/wrestling-${label}-kick.png` });
  await step(30);
  // pin: hold F next to the downed opponent, then P2 holds quote to break free
  await page.evaluate(() => { const s = window.__game.scene.getScene('WrestlingScene'); s.state.w[1].x = s.state.w[0].x + 0.5; s.state.w[1].z = s.state.w[0].z; s.state.w[1].vx = 0; s.state.w[1].vz = 0; });
  await page.keyboard.down('f');
  await step(5);
  st = await info();
  if (!st.pin.active) { console.log('PIN DID NOT START', JSON.stringify(st)); failed = true; }
  await step(30);
  await page.keyboard.down("'");
  await step(40);
  st = await info();
  console.log(label, 'escape progress', st.pin.escape && st.pin.escape.toFixed(2), 'holding', st.pin.holding, 'count', st.pin.count);
  if (!(st.pin.escape > 0.3 && st.pin.holding)) { console.log('ESCAPE BAR NOT FILLING WHILE HELD'); failed = true; }
  await page.screenshot({ path: `smoke-output/wrestling-${label}-pin.png` });
  await step(60);
  await page.keyboard.up("'");
  await page.keyboard.up('f');
  st = await info();
  console.log(label, 'after hold', JSON.stringify({ pin: st.pin.active, phase: st.phase, w: st.w.map((w) => w.state) }));
  if (st.pin.active || st.phase === 'done' || st.w[1].state !== 'idle') { console.log('HOLD DID NOT BREAK THE PIN'); failed = true; }

  // ---- single player vs CPU: let it run with a scripted human for a while ----
  await page.evaluate(() => { const g = window.__game; g.loop.start(g.step.bind(g)); });
  await start('single');
  await page.waitForTimeout(1200);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => { const s = window.__game.scene.getScene('WrestlingScene'); return s && s.started && s.running; }, null, { timeout: 15000 });
  await page.evaluate(() => { const g = window.__game; g.loop.stop(); window.__simT = g.loop.now || performance.now(); });
  await step(90);
  await page.screenshot({ path: `smoke-output/wrestling-${label}-cpu.png` });
  // count sim events by wrapping the scene's event handler
  await page.evaluate(() => { const s = window.__game.scene.getScene('WrestlingScene'); window.__ev = {}; const orig = s.handleEvent.bind(s); s.handleEvent = (e) => { const k = e.type + (e.by !== undefined ? ':' + e.by : ''); window.__ev[k] = (window.__ev[k] || 0) + 1; orig(e); }; });
  // scripted human: random keys, but hold a button whenever pinned
  const keys = ['w', 'a', 's', 'd', 'h', 'j', 'g', 'f', 'd', 'h'];
  let iters = 0;
  for (let i = 0; i < 400; i++) {
    iters++;
    st = await info();
    if (st.phase === 'done') break;
    const k = st.w[0].state === 'pinned' ? 'f' : keys[Math.floor(Math.random() * keys.length)];
    await page.keyboard.down(k);
    await step(st.w[0].state === 'pinned' ? 20 : 8);
    await page.keyboard.up(k);
    await step(st.w[0].state === 'pinned' ? 0 : 4);
  }
  st = await info();
  const ev = await page.evaluate(() => window.__ev);
  console.log(label, 'cpu play', iters, 'iters', JSON.stringify({ phase: st.phase, w: st.w, events: ev }));
  if (!ev['punch:1'] && !ev['kick:1']) console.log('note: the CPU threw no strikes this run (random human kept it grappling)');
  await page.evaluate(() => { const g = window.__game; g.scene.getScenes(false).filter((s) => s.scene.isActive() || s.scene.isPaused()).forEach((s) => g.scene.stop(s.scene.key)); });
  await page.close();
}
await run('landscape', { width: 1920, height: 1080 }, false);
await run('portrait', { width: 1080, height: 1920 }, true);
await browser.close();
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1); }
if (failed) process.exit(1);
console.log('wrestling smoke ok');
