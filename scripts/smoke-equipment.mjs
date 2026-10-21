// Builds a contact sheet of every equipment texture at 3x for visual review.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto(process.argv[2] ?? 'http://localhost:4188/?renderer=canvas');
await page.waitForFunction(() => window.__game && window.__game.scene.isActive('MenuScene'), null, { timeout: 20000 });
const dataUrl = await page.evaluate(() => {
  const keys = ['baseball', 'basketball', 'puck', 'football', 'dart', 'spark', ...Array.from({ length: 16 }, (_, i) => `pool-${i}`), 'bat', 'hockeystick', 'cue', 'belt'];
  const tex = window.__game.textures;
  const S = 3;
  const c = document.createElement('canvas');
  c.width = 1700; c.height = 1500;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#8a8f94'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingEnabled = true;
  let x = 20, y = 30, rowH = 0;
  ctx.font = '16px Arial'; ctx.fillStyle = '#111';
  for (const k of keys) {
    const img = tex.get(k).getSourceImage();
    const w = img.width * S, h = img.height * S;
    if (x + w > c.width - 20) { x = 20; y += rowH + 40; rowH = 0; }
    ctx.drawImage(img, x, y, w, h);
    ctx.fillStyle = '#111'; ctx.fillText(`${k} ${img.width}x${img.height}`, x, y + h + 18);
    x += w + 30; rowH = Math.max(rowH, h);
  }
  return c.toDataURL('image/png');
});
writeFileSync('smoke-output/equipment-sheet.png', Buffer.from(dataUrl.split(',')[1], 'base64'));
console.log('sheet written');
await browser.close();
