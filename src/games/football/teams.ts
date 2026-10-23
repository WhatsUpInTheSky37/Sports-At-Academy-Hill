/**
 * Football rosters: team size (1 on 1 or 2 on 2), the all-time-QB option, who is on each team.
 * Pure helpers so the setup screen, the scene and the tests agree.
 */
import { CHARACTER_IDS, type CharacterId } from '../../core/characters';

export type TeamSize = 1 | 2;
export const TEAM_SIZES: TeamSize[] = [1, 2];

export interface FootballSetup {
  size: TeamSize;
  /** One kid quarterbacks both teams (1 player only; the CPU runs both defences). */
  allTime: boolean;
  /** Two rosters, captain first. */
  rosters: [CharacterId[], CharacterId[]];
  /** The all-time quarterback (only used when allTime); never on either roster. */
  qb: CharacterId;
}

export function formatLabel(size: TeamSize, allTime: boolean): string {
  return `${size} ON ${size}${allTime ? ' + ALL-TIME QB' : ''}`;
}

/**
 * Make a setup consistent: drop duplicates (first pick wins), cut each roster to the team size, pick an
 * all-time QB that is on neither roster, and fill any empty spots from the kids nobody has picked.
 */
export function normalizeSetup(size: TeamSize, allTime: boolean, picks: [CharacterId[], CharacterId[]], qb: CharacterId | null): FootballSetup {
  const used = new Set<CharacterId>();
  const rosters: [CharacterId[], CharacterId[]] = [[], []];
  // the QB is reserved first so the rosters never swallow them
  let qbPick: CharacterId | null = allTime && qb && CHARACTER_IDS.includes(qb) ? qb : null;
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
  if (allTime && !qbPick) qbPick = spare.shift() ?? 'will';
  return { size, allTime, rosters, qb: qbPick ?? spare[0] ?? CHARACTER_IDS.find((id) => !used.has(id)) ?? 'will' };
}

/** The classic two-on-two: each captain plus the first kid not already playing. */
export function defaultSetup(p1: CharacterId, p2: CharacterId, size: TeamSize = 2, allTime = false): FootballSetup {
  return normalizeSetup(size, allTime, [[p1], [p2]], null);
}

/** Every kid on the field in the setup (rosters plus the all-time QB), for sprite-sheet housekeeping. */
export function setupCharacters(setup: FootballSetup): CharacterId[] {
  const ids = [...setup.rosters[0], ...setup.rosters[1]];
  if (setup.allTime) ids.push(setup.qb);
  return ids;
}
