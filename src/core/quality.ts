/**
 * Rendering quality chosen for the device. Phones already display the 1080-wide logical canvas at
 * about one device pixel per logical pixel, so 2x art buys nothing there and the extra canvas memory
 * can crash mobile Safari. Desktops get the sharp 2x sprite sheets and backdrops.
 */
function detect(): { mobile: boolean; sheetRes: number; backdropSS: number } {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return { mobile: false, sheetRes: 2, backdropSS: 2 };
  const ua = navigator.userAgent || '';
  const touchMac = /Mac/.test(ua) && (navigator.maxTouchPoints || 0) > 1; // iPadOS reports itself as a Mac
  const mobile = /iPhone|iPad|iPod|Android|Mobile/i.test(ua) || touchMac;
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
  const lowMem = typeof mem === 'number' && mem <= 4;
  const hd = !mobile && !lowMem;
  return { mobile, sheetRes: hd ? 2 : 1, backdropSS: hd ? 2 : 1 };
}

export const QUALITY = detect();
