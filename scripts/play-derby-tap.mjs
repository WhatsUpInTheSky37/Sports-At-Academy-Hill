// Verifies TAP HIT mode: a tap on the field while the pitch is at the plate swings at the tap point.
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, hasTouch: true });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:4173/?renderer=canvas');
await page.waitForFunction(() => window.__game && window.__game.scene.isActive('MenuScene'), null, { timeout: 20000 });
await page.evaluate(() => { const g = window.__game; localStorage.removeItem('sports-at-academy-hill-v1'); const m = g.registry.get('__buildMatch')('DerbyScene', 'single'); g.scene.stop('MenuScene'); g.scene.start('DerbyScene', { match: m }); });
await page.waitForTimeout(1200);
await page.keyboard.press('Space');
await page.waitForTimeout(300);
await page.evaluate(() => { const g = window.__game; g.loop.stop(); window.__simT = g.loop.now || performance.now(); });
const step = (n) => page.evaluate((n) => { const g = window.__game; for (let i = 0; i < n; i++) { window.__simT += 16.67; g.step(window.__simT, 16.67); } }, n);
const info = () => page.evaluate(() => { const s = window.__game.scene.getScene('DerbyScene'); return { phase: s.phase, t: s.pitchT, mode: s.hitMode, aim: { ...s.aim }, center: { ...s.aimCenter }, swung: s.swung, label: s.timingLabel.text, swingVisible: s.swingBtn.visible }; });
let st = await info();
console.log('mode', st.mode, 'swing button visible', st.swingVisible);
for (let i = 0; i < 400; i++) { await step(1); st = await info(); if (st.phase === 'pitch' && st.t > 1.08) break; }
// tap 60px right and 40px below the hit zone centre
const tx = st.center.x + 60, ty = st.center.y + 40;
await page.touchscreen.tap(tx, ty);
await step(2);
st = await info();
console.log('after tap: phase', st.phase, 'swung', st.swung, 'aim', st.aim, 'label', st.label);
if (!st.swung || Math.abs(st.aim.x - 60) > 2 || Math.abs(st.aim.y - 40) > 2) { console.log('TAP HIT FAILED'); process.exit(1); }
await step(40);
await page.screenshot({ path: 'smoke-output/derby-tap-flight.png' });
// switch to classic with the SWITCH button and check the SWING button appears and a field tap no longer swings
await page.evaluate(() => { const s = window.__game.scene.getScene('DerbyScene'); s.setHitMode('classic'); });
st = await info();
console.log('classic: swing button visible', st.swingVisible, 'saved', await page.evaluate(() => JSON.parse(localStorage.getItem('sports-at-academy-hill-v1')).settings.derbyHitMode));
for (let i = 0; i < 600; i++) { await step(1); st = await info(); if (st.phase === 'pitch' && st.t > 1.08) break; }
await page.touchscreen.tap(st.center.x + 60, st.center.y + 40);
await step(2);
st = await info();
console.log('classic field tap: swung', st.swung);
if (st.swung) { console.log('CLASSIC FIELD TAP SHOULD NOT SWING'); process.exit(1); }
if (errors.length) { console.log('ERRORS', errors.join('\n')); process.exit(1); }
await browser.close();
console.log('tap-hit ok');
