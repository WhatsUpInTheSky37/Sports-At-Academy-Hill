// Football smoke: tap to hike, press-hold on the field to throw there (touch), swipe to throw, keyboard hike + hold.
// Screenshots to smoke-output/football-*.png in both orientations.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const base = process.argv[2] ?? 'http://localhost:4173/?renderer=canvas';
mkdirSync('smoke-output', { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
let failed = false;
async function run(viewport, label, hasTouch) {
  const page = await browser.newPage({ viewport, hasTouch });
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/logo|404/.test(m.text())) errors.push(`${label} console: ${m.text()}`); });
  await page.goto(base);
  await page.waitForFunction(() => window.__game && window.__game.scene.isActive('MenuScene'), null, { timeout: 20000 });
  await page.evaluate(() => {
    const g = window.__game;
    localStorage.removeItem('sports-at-academy-hill-v1');
    const match = g.registry.get('__buildMatch')('FootballScene', 'single');
    g.scene.getScenes(false).filter((s) => s.scene.isActive() || s.scene.isPaused()).forEach((s) => g.scene.stop(s.scene.key));
    g.scene.start('FootballScene', { match });
  });
  await page.waitForTimeout(1200);
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  await page.evaluate(() => { const g = window.__game; g.loop.stop(); window.__simT = g.loop.now || performance.now(); });
  const step = (n) => page.evaluate((n) => { const g = window.__game; for (let i = 0; i < n; i++) { window.__simT += 16.67; g.step(window.__simT, 16.67); } }, n);
  const info = () => page.evaluate(() => {
    const s = window.__game.scene.getScene('FootballScene');
    return { phase: s.phase, charging: s.charging, passUsed: s.passUsed, pass: s.pass ? { to: s.pass.to, dur: s.pass.duration } : null, holder: s.holder ? s.holder.team : null, down: s.state.down, los: s.state.lineOfScrimmage, scores: [...s.state.scores], faces: s.athletes.map((a) => a.sprite.sprite.frame.name), scales: s.athletes.map((a) => +a.sprite.charScale.toFixed(2)) };
  });
  // the game opens with a kickoff (the CPU kicks to the person, who is walked under it): wait for the first snap
  const untilPre = async () => { for (let i = 0; i < 900; i++) { const st = await info(); if (st.phase === 'pre') return st; if (st.phase === 'pat') { await page.keyboard.down('f'); await step(2); await page.keyboard.up('f'); } if (st.phase === 'kickoff') { await page.keyboard.down('f'); await step(20); await page.keyboard.up('f'); } await step(5); } return info(); };
  await untilPre();
  await step(30);
  let st = await info();
  console.log(label, 'pre-snap faces', st.faces, 'scales', st.scales);
  if (st.scales.some((x) => x > 1.2)) { console.log('SPRITES TOO BIG'); failed = true; }
  if (!(st.faces[2].startsWith('idle') && st.faces[3].startsWith('idle'))) { console.log('DEFENDERS NOT FACING THE OFFENCE'); failed = true; }
  await page.screenshot({ path: `smoke-output/football-${label}-presnap.png` });
  // park two cars on the street for the screenshot
  await page.evaluate(() => { const s = window.__game.scene.getScene('FootballScene'); const R = { lanes: [15.9, 19.5] }; s.cars.push({ y: s.state.lineOfScrimmage + 5, dir: 1, lane: R.lanes[0], speed: 0, color: 0xd32f2f, dark: 0x8e1c1c }); s.cars.push({ y: s.state.lineOfScrimmage + 18, dir: -1, lane: R.lanes[1], speed: 0, color: 0x1e63c9, dark: 0x123f82 }); });
  await step(2);
  await page.screenshot({ path: `smoke-output/football-${label}-road.png` });
  // tap the field to hike
  const W = viewport.width, H = viewport.height;
  const fieldPt = { x: W * 0.55, y: H * 0.5 };
  if (hasTouch) await page.touchscreen.tap(fieldPt.x, fieldPt.y); else await page.mouse.click(fieldPt.x, fieldPt.y);
  await step(3);
  st = await info();
  console.log(label, 'after tap: phase', st.phase);
  if (st.phase !== 'live') { console.log('TAP DID NOT HIKE'); failed = true; }
  await step(30);
  // press-hold on the field ~0.7 s then release: throw to that spot
  const spot = { x: W * 0.62, y: H * 0.42 };
  if (hasTouch) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: spot.x, y: spot.y }] });
    await step(42);
    await page.screenshot({ path: `smoke-output/football-${label}-charging.png` });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.move(spot.x, spot.y); await page.mouse.down();
    await step(42);
    await page.screenshot({ path: `smoke-output/football-${label}-charging.png` });
    await page.mouse.up();
  }
  await step(2);
  st = await info();
  console.log(label, 'after hold-release: passUsed', st.passUsed, 'pass', st.pass);
  if (!st.passUsed) { console.log('HOLD DID NOT THROW'); failed = true; }
  await step(20);
  await page.screenshot({ path: `smoke-output/football-${label}-pass.png` });
  // play out until the next pre-snap, then test a swipe throw
  for (let i = 0; i < 900; i++) { await step(4); st = await info(); if (st.phase === 'pre' && st.holder === 0) break; if (st.phase === 'pat') { await page.keyboard.down('f'); await step(2); await page.keyboard.up('f'); } if (st.phase === 'kickoff') { await page.keyboard.down('f'); await step(20); await page.keyboard.up('f'); } }
  console.log(label, 'next play: down', st.down, 'los', st.los.toFixed(1));
  if (st.phase === 'pre' && st.holder === 0) {
    if (hasTouch) await page.touchscreen.tap(fieldPt.x, fieldPt.y); else await page.mouse.click(fieldPt.x, fieldPt.y);
    await step(20);
    if (hasTouch) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: W * 0.5, y: H * 0.5 }] });
      await step(2);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: W * 0.6, y: H * 0.35 }] });
      await step(2);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.move(W * 0.5, H * 0.5); await page.mouse.down(); await step(2); await page.mouse.move(W * 0.6, H * 0.35, { steps: 3 }); await step(2); await page.mouse.up();
    }
    await step(2);
    st = await info();
    console.log(label, 'after swipe: passUsed', st.passUsed, 'pass', st.pass);
    if (!st.passUsed) { console.log('SWIPE DID NOT THROW'); failed = true; }
    await step(15);
    await page.screenshot({ path: `smoke-output/football-${label}-swipe.png` });
  }
  await page.close();
}
await run({ width: 1920, height: 1080 }, 'landscape', false);
await run({ width: 1080, height: 1920 }, 'portrait', true);

// ---- 3 on 3 and 3 on 3 all-time QB ----
async function runFormat(viewport, label, football, hasTouch = false) {
  const page = await browser.newPage({ viewport, hasTouch });
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/logo|404/.test(m.text())) errors.push(`${label} console: ${m.text()}`); });
  await page.goto(base);
  await page.waitForFunction(() => window.__game && window.__game.scene.isActive('MenuScene'), null, { timeout: 20000 });
  await page.evaluate((football) => {
    const g = window.__game;
    localStorage.removeItem('sports-at-academy-hill-v1');
    const match = g.registry.get('__buildMatch')('FootballScene', 'single', { football });
    g.scene.getScenes(false).filter((s) => s.scene.isActive() || s.scene.isPaused()).forEach((s) => g.scene.stop(s.scene.key));
    g.scene.start('FootballScene', { match });
  }, football);
  await page.waitForTimeout(1200);
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  await page.evaluate(() => { const g = window.__game; g.loop.stop(); window.__simT = g.loop.now || performance.now(); });
  const step = (n) => page.evaluate((n) => { const g = window.__game; for (let i = 0; i < n; i++) { window.__simT += 16.67; g.step(window.__simT, 16.67); } }, n);
  const info = () => page.evaluate(() => {
    const s = window.__game.scene.getScene('FootballScene');
    return { phase: s.phase, size: s.size, allTime: s.allTime, n: s.athletes.length, ids: s.athletes.map((a) => a.character.id + ':' + a.team), offense: s.state.offense, qbTeam: s.qbAthlete ? s.qbAthlete.team : null, controlled: s.controlled[0] ? s.controlled[0].character.id : null, passUsed: s.passUsed, holder: s.holder ? s.holder.character.id : null, scores: [...s.state.scores], down: s.state.down };
  });
  // the game opens with a kickoff (the CPU kicks to the person, who is walked under it): wait for the first snap
  const untilPre = async () => { for (let i = 0; i < 900; i++) { const st = await info(); if (st.phase === 'pre') return st; if (st.phase === 'pat') { await page.keyboard.down('f'); await step(2); await page.keyboard.up('f'); } if (st.phase === 'kickoff') { await page.keyboard.down('f'); await step(20); await page.keyboard.up('f'); } await step(5); } return info(); };
  await untilPre();
  await step(30);
  let st = await info();
  console.log(label, JSON.stringify(st));
  const expectN = football.size * 2 + (football.allTime ? 1 : 0);
  if (st.n !== expectN) { console.log(`EXPECTED ${expectN} ATHLETES`); failed = true; }
  if (football.allTime && (!st.allTime || st.controlled !== football.qb || st.qbTeam !== st.offense)) { console.log('ALL-TIME QB NOT SET UP'); failed = true; }
  const recv = football.allTime ? football.size : football.size - 1;
  const plays = await page.evaluate(() => { const s = window.__game.scene.getScene('FootballScene'); return { n: s.plays.length, shown: s.playButtons.filter((b) => b.bg.visible).length, idx: s.playIdx, routes: s.athletes.filter((a) => a.route.length).map((a) => a.routeName) }; });
  console.log(label, 'plays', JSON.stringify(plays));
  if (recv > 0 && (plays.n !== 4 || plays.shown !== 4)) { console.log('PLAY STRIP MISSING'); failed = true; }
  if (recv === 0 && plays.shown !== 0) { console.log('PLAY STRIP SHOWN WITH NO RECEIVERS'); failed = true; }
  if (recv > 0) {
    // call play 3 by key and check the routes follow it
    await page.keyboard.press('3'); await step(2);
    const after = await page.evaluate(() => { const s = window.__game.scene.getScene('FootballScene'); return { idx: s.playIdx, routes: s.athletes.filter((a) => a.route.length).map((a) => a.routeName), want: s.plays[2].routes }; });
    console.log(label, 'called play 3', JSON.stringify(after));
    if (after.idx !== 2 || after.routes.join() !== after.want.join()) { console.log('PLAY CALL DID NOT SET ROUTES'); failed = true; }
  }
  await page.screenshot({ path: `smoke-output/football-${label}-presnap.png` });
  // hike (tap on touch, F on keyboard) and throw with a hold on F (keyboard goes to the open receiver)
  const W = viewport.width, H = viewport.height;
  if (hasTouch) await page.touchscreen.tap(W * 0.55, H * 0.5); else { await page.keyboard.down('f'); await step(2); await page.keyboard.up('f'); }
  await step(25);
  st = await info();
  if (st.phase !== 'live') { console.log('HIKE FAILED'); failed = true; }
  await page.keyboard.down('f'); await step(30); await page.keyboard.up('f');
  await step(3);
  st = await info();
  console.log(label, 'after throw', JSON.stringify({ phase: st.phase, passUsed: st.passUsed, holder: st.holder }));
  if (recv > 0 && !st.passUsed) { console.log('KEYBOARD THROW FAILED'); failed = true; }
  if (recv === 0 && st.passUsed) { console.log('THREW WITH NO RECEIVER'); failed = true; }
  await step(25);
  await page.screenshot({ path: `smoke-output/football-${label}-pass.png` });
  // play on (hike, hold F to throw) until the other team has the ball; with an all-time QB the person should still be the QB
  for (let i = 0; i < 900; i++) {
    await step(5); st = await info();
    if (st.phase === 'pre' && st.offense === 1) break;
    if (st.phase === 'pat') { await page.keyboard.down('f'); await step(2); await page.keyboard.up('f'); }
    if (st.phase === 'kickoff') { await page.keyboard.down('f'); await step(20); await page.keyboard.up('f'); }
    if (st.phase === 'pre' && st.offense === 0) { await page.keyboard.down('f'); await step(2); await page.keyboard.up('f'); await step(20); }
    else if (st.phase === 'live' && !st.passUsed && st.holder) { await page.keyboard.down('f'); await step(30); await page.keyboard.up('f'); await page.keyboard.down('w'); await step(20); await page.keyboard.up('w'); }
  }
  console.log(label, 'other team possession', JSON.stringify({ phase: st.phase, offense: st.offense, qbTeam: st.qbTeam, controlled: st.controlled, ids: st.ids }));
  if (st.phase === 'pre' && st.offense === 1) {
    if (football.allTime) {
      if (st.qbTeam !== 1 || st.controlled !== football.qb) { console.log('ALL-TIME QB DID NOT SWITCH TEAMS'); failed = true; }
      // the person hikes (a tap on touch: this is where the game used to lock up) and throws for the CPU team too
      if (hasTouch) await page.touchscreen.tap(W * 0.55, H * 0.5); else { await page.keyboard.down('f'); await step(2); await page.keyboard.up('f'); }
      await step(25);
      st = await info();
      if (st.phase !== 'live') { console.log('COULD NOT HIKE FOR TEAM 1 (THE LOCK-UP)'); failed = true; }
      await page.keyboard.down('f'); await step(30); await page.keyboard.up('f');
      await step(3);
      st = await info();
      console.log(label, 'threw for the other team', JSON.stringify({ phase: st.phase, passUsed: st.passUsed }));
      if (!st.passUsed) { console.log('ALL-TIME QB COULD NOT THROW FOR TEAM 1'); failed = true; }
      await step(20);
      await page.screenshot({ path: `smoke-output/football-${label}-team1.png` });
    } else if (st.controlled === null) { console.log('NO DEFENDER CONTROLLED'); failed = true; }
  } else { console.log('NEVER REACHED THE OTHER TEAM POSSESSION'); failed = true; }
  await page.close();
}
await runFormat({ width: 1920, height: 1080 }, '1v1', { size: 1, allTime: false, rosters: [['will'], ['vinnie']], qb: 'billy' });
await runFormat({ width: 1920, height: 1080 }, '1v1qb', { size: 1, allTime: true, rosters: [['will'], ['vinnie']], qb: 'billy' });
await runFormat({ width: 1080, height: 1920 }, '2v2qb', { size: 2, allTime: true, rosters: [['will', 'bryan'], ['vinnie', 'ben']], qb: 'billy' }, true);
await browser.close();
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1); }
if (failed) process.exit(1);
console.log('football smoke ok');
