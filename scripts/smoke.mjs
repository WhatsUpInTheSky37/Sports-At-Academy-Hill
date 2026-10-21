// Headless smoke test: boots the game, screenshots the menu and each game scene in both orientations.
// Usage: node scripts/smoke.mjs [baseUrl]   (defaults to a vite preview on 4173)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:4173/?renderer=canvas';
const out = 'smoke-output';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const errors = [];
async function run(viewport, label, actions) {
  const page = await browser.newPage({ viewport, hasTouch: label.includes('touch') });
  page.on('pageerror', (e) => errors.push(`${label} [${page.__current ?? 'menu'}]: ${e.message}\n${(e.stack || '').split('\n').slice(1, 6).join('\n')}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/logo|404/.test(m.text())) errors.push(`${label} console: ${m.text()}`); });
  await page.goto(base);
  await page.waitForFunction(() => window.__game && window.__game.scene.isActive('MenuScene'), null, { timeout: 20000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${label}-menu.png` });
  await actions(page);
  await page.close();
}
const startScene = async (page, key, mode = 'single') => {
  await page.evaluate(([key, mode]) => {
    const g = window.__game;
    const mod = g.registry.get('__buildMatch');
    const match = mod(key, mode);
    const active = g.scene.getScenes(false).filter((s) => s.scene.isActive() || s.scene.isPaused()).map((s) => s.scene.key);
    active.forEach((k) => g.scene.stop(k));
    g.scene.start(key, { match });
  }, [key, mode]);
  await page.waitForTimeout(1500);
};
for (const [label, viewport] of [['landscape', { width: 1920, height: 1080 }], ['portrait-touch', { width: 1080, height: 1920 }]]) {
  await run(viewport, label, async (page) => {
    for (const key of ['DerbyScene', 'HorseScene', 'PoolScene', 'WrestlingScene', 'HockeyScene', 'FootballScene', 'DartsScene']) {
      page.__current = key;
      await startScene(page, key);
      // dismiss how-to if present
      await page.evaluate(() => { const g = window.__game; if (g.scene.isActive('HowToScene')) { g.scene.getScene('HowToScene').scene.stop(); const k = g.scene.getScenes(true).find((s) => s.scene.key.endsWith('Scene') && !['HowToScene'].includes(s.scene.key)); } });
      await page.keyboard.press('Space');
      await page.waitForTimeout(2500);
      await page.screenshot({ path: `${out}/${label}-${key}.png` });
    }
  });
}
await browser.close();
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1); }
console.log('smoke ok');
