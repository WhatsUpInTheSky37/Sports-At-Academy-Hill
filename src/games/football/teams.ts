/**
 * Football rosters: who is on each team, how big the teams are, and the all-time-QB option.
 * Pure helpers so the setup screen, the scene and the tests agree.
 */
import { CHARACTER_IDS, type CharacterId } from '../../core/characters';

/** '2v2' two-on-two, '3v3' three-on-three, '3v3qb' three-on-three with one all-time quarterback for both teams. */
export type FootballFormat = '2v2' | '3v3' | '3v3qb';

export const FOOTBALL_FORMATS: FootballFormat[] = ['2v2', '3v3', '3v3qb'];

export interface FootballSetup {
  format: FootballFormat;
  /** Two rosters, captain first. */
  rosters: [CharacterId[], CharacterId[]];
  /** The all-time quarterback (only used by '3v3qb'); never on either roster. */
  qb: CharacterId;
}

export function teamSize(format: FootballFormat): 2 | 3 { return format === '2v2' ? 2 : 3; }

export function hasAllTimeQb(format: FootballFormat): boolean { return format === '3v3qb'; }

export function formatLabel(format: FootballFormat): string {
  return format === '2v2' ? '2 ON 2' : format === '3v3' ? '3 ON 3' : '3 ON 3 ALL-TIME QB';
}

/**
 * Make a setup consistent: drop duplicates (first pick wins), cut each roster to the team size, pick an
 * all-time QB that is on neither roster, and fill any empty spots from the kids nobody has picked.
 */
export function normalizeSetup(format: FootballFormat, picks: [CharacterId[], CharacterId[]], qb: CharacterId | null): FootballSetup {
  const size = teamSize(format);
  const used = new Set<CharacterId>();
  const rosters: [CharacterId[], CharacterId[]] = [[], []];
  const wantQb = hasAllTimeQb(format);
  // the QB is reserved first so the rosters never swallow them
  let qbPick: CharacterId | null = wantQb && qb && CHARACTER_IDS.includes(qb) ? qb : null;
  if (qbPick) used.add(qbPick);
  for (const team of [0, 1] as const) {
    for (const id of picks[team]) {
      if (rosters[team].length >= size) break;
      if (!CHARACTER_IDS.includes(id) || used.has(id)) continue;
      used.add(id);
      rosters[team].push(id);
    }
  }
  const spare = CHARACTER_IDS.filter((id) => !used.has(id));
  for (const team of [0, 1] as const) {
    while (rosters[team].length < size) {
      const id = spare.shift();
      if (!id) break;
      used.add(id);
      rosters[team].push(id);
    }
  }
  if (wantQb && !qbPick) qbPick = spare.shift() ?? CHARACTER_IDS.find((id) => !used.has(id)) ?? 'will';
  return { format, rosters, qb: qbPick ?? CHARACTER_IDS.find((id) => !used.has(id)) ?? 'will' };
}

/** The classic two-on-two: each captain plus the first kid not already playing. */
export function defaultSetup(p1: CharacterId, p2: CharacterId, format: FootballFormat = '2v2'): FootballSetup {
  return normalizeSetup(format, [[p1], [p2]], null);
}

/** Every kid who is on a roster (or is the all-time QB) in the setup, for sprite-sheet housekeeping. */
export function setupCharacters(setup: FootballSetup): CharacterId[] {
  const ids = [...setup.rosters[0], ...setup.rosters[1]];
  if (hasAllTimeQb(setup.format)) ids.push(setup.qb);
  return ids;
}
