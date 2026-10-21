/**
 * Logical (design) resolution. Both orientations are supported: landscape uses 1920x1080 and
 * portrait uses 1080x1920. These are live bindings updated by core/layout.ts, so scenes must read
 * them at create() time rather than caching them at module load.
 */
export let GAME_W = 1920;
export let GAME_H = 1080;
export const LANDSCAPE = { w: 1920, h: 1080 };
export const PORTRAIT = { w: 1080, h: 1920 };
export function setLogicalSize(w: number, h: number): void { GAME_W = w; GAME_H = h; }
export function isPortrait(): boolean { return GAME_H > GAME_W; }

export type GameId = 'derby' | 'horse' | 'pool' | 'wrestling' | 'hockey' | 'football' | 'darts';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type Mode = 'single' | 'local';

export const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];

/** Championship order (ends with darts). */
export const GAME_ORDER: GameId[] = ['derby', 'horse', 'pool', 'wrestling', 'hockey', 'football', 'darts'];

export interface GameInfo {
  id: GameId;
  title: string;
  short: string;
  sceneKey: string;
  venue: string;
  /** Alternating turns (true) or simultaneous keyboard play (false). */
  turnBased: boolean;
  blurb: string;
  howTo: string[];
  keyboardP1: string[];
  keyboardP2: string[];
  touch: string[];
  accent: number;
}

export const GAMES: Record<GameId, GameInfo> = {
  derby: {
    id: 'derby',
    title: 'Backyard Home Run Derby',
    short: 'Home Run Derby',
    sceneKey: 'DerbyScene',
    venue: 'The backyard, batting from the end of the driveway',
    turnBased: true,
    blurb: 'Ten outs each. Clear the backyard fence for a homer.',
    howTo: [
      'Pitches come in automatically, right down the middle.',
      'Tap SWING when the ball reaches the hit zone. Watch the timing bar.',
      'EARLY pulls the ball left, LATE pushes it right, PERFECT goes deep up the middle.',
      'A fair ball over the marked backyard boundary is a HOME RUN (no out).',
      'A miss, a foul, or a ball that lands short is one OUT. Letting a pitch go costs nothing.',
      'Each batter gets 10 outs. Most homers wins. Ties go to 3-out tiebreak rounds.',
    ],
    keyboardP1: ['SPACE or F: swing'],
    keyboardP2: ['ENTER or , (comma): swing (players alternate, so either works)'],
    touch: ['Tap the big SWING button'],
    accent: 0x4caf50,
  },
  horse: {
    id: 'horse',
    title: 'Driveway HORSE',
    short: 'HORSE',
    sceneKey: 'HorseScene',
    venue: 'The hoop beside the driveway',
    turnBased: true,
    blurb: 'Make it, match it. Five letters and you are out.',
    howTo: [
      'The SETTER picks a spot on the driveway and shoots.',
      'If the setter scores, the other player must make the SAME shot from the SAME spot.',
      'Miss the match and you earn a letter: H, O, R, S, E. Five letters loses.',
      'If the setter misses, the other player becomes the setter.',
      'Shooting: tap/drag to aim, then hold and release the power meter. Release in the green band.',
    ],
    keyboardP1: ['Click a spot to set a shot', 'Hold and release SPACE/F for power', 'A/D: fine aim'],
    keyboardP2: ['Same controls, players alternate'],
    touch: ['Tap a spot to set', 'Hold and release SHOOT for power', 'Drag to fine aim'],
    accent: 0xff9800,
  },
  pool: {
    id: 'pool',
    title: 'Basement Billiards',
    short: 'Billiards',
    sceneKey: 'PoolScene',
    venue: 'The pool table in the basement',
    turnBased: true,
    blurb: 'Casual eight-ball. Call the eight. No fancy fouls.',
    howTo: [
      'Eight-ball: table is OPEN after the break; the first legally pocketed ball sets your group (solids or stripes).',
      'Pocket a ball from your group to keep shooting. Clear your group, then call a pocket for the 8.',
      'FOUL = scratch, hitting the wrong ball first, hitting nothing, or no ball reaching a rail after contact. Opponent gets ball in hand.',
      'Sinking the 8 early, in the wrong pocket, or with a foul LOSES (except on the break, where it is respotted).',
      'A legal break pockets a ball or sends 4 balls to rails; otherwise the opponent can rerack or play on with ball in hand.',
      'Aim by grabbing the BUTT of the cue and swinging it around the cue ball. Tap the cue-ball picker to choose where you strike it: high = follow, low = draw, sides = english; raise the cue for a massé curve.',
    ],
    keyboardP1: ['Mouse/touch: drag the cue butt to aim, drag power bar', 'A/D: fine aim', 'SPACE: shoot'],
    keyboardP2: ['Same controls, players alternate'],
    touch: ['Drag the cue butt to aim', 'Tap the cue ball picker for spin', 'Drag the power bar then release'],
    accent: 0x2e7d32,
  },
  wrestling: {
    id: 'wrestling',
    title: 'Basement Wrestling',
    short: 'Wrestling',
    sceneKey: 'WrestlingScene',
    venue: 'The couch-cushion ring on the basement floor',
    turnBased: false,
    blurb: 'Grapple, shove, takedown. First three-count wins the belt.',
    howTo: [
      'Move around the cushion ring. Attacks cost STAMINA; it refills while you rest.',
      'GRAPPLE when close to grab your opponent. SHOVE to push them back and, if grappled, TAKE THEM DOWN.',
      'A downed wrestler glows: that is the PIN window. Stand over them and hold PIN for a three-count.',
      'To ESCAPE a pin, tap ESCAPE when the sliding marker is in the green zone (no mashing!).',
      'Rolling out of the cushions pauses the match and resets both wrestlers.',
      'First successful three-count wins the homemade belt.',
    ],
    keyboardP1: ['WASD: move', 'F: grapple / pin', 'G: shove / takedown', 'H: escape'],
    keyboardP2: ['Arrows: move', ', (comma): grapple / pin', '. (period): shove / takedown', '/ (slash): escape'],
    touch: ['Left stick: move', 'Buttons: GRAB, SHOVE, ESC'],
    accent: 0xe91e63,
  },
  hockey: {
    id: 'hockey',
    title: 'Driveway Hockey',
    short: 'Hockey',
    sceneKey: 'HockeyScene',
    venue: 'The long driveway with a net at each end',
    turnBased: false,
    blurb: 'One on one street hockey. First to five.',
    howTo: [
      'Skate to the puck. Touch it with your stick to carry it.',
      'Hold SHOOT to wind up, release to fire toward the net you are facing.',
      'POKE lunges your stick forward to knock the puck loose from the carrier.',
      'A goal only counts when the puck fully crosses the line inside the net.',
      'After each goal the puck resets at center. First to 5 wins.',
    ],
    keyboardP1: ['WASD: skate', 'F: shoot (hold for power)', 'G: poke check'],
    keyboardP2: ['Arrows: skate', ', (comma): shoot', '. (period): poke check'],
    touch: ['Left stick: skate', 'SHOOT and POKE buttons'],
    accent: 0x03a9f4,
  },
  football: {
    id: 'football',
    title: 'Two-on-Two Football',
    short: 'Football',
    sceneKey: 'FootballScene',
    venue: 'The grassy field behind the neighborhood',
    turnBased: false,
    blurb: 'Touch football. Four downs to score. First to 30.',
    howTo: [
      'Offense: press SNAP to start the play. You are the QB. Run, or press PASS to throw to your teammate.',
      'Only one forward pass per play, and only from behind the line of scrimmage.',
      'Four downs to score a touchdown (6 points). No first downs. Turnover on downs at the spot.',
      'Defense: press SWITCH to control the defender closest to the ball. One touch on the ball carrier ends the play.',
      'Interceptions can be returned. Getting touched in your own end zone is a SAFETY (2 points for the defense).',
      'First team to 30 wins.',
    ],
    keyboardP1: ['WASD: move', 'F: snap / pass', 'G: switch player'],
    keyboardP2: ['Arrows: move', ', (comma): snap / pass', '. (period): switch player'],
    touch: ['Left stick: move', 'SNAP/PASS and SWITCH buttons'],
    accent: 0x8bc34a,
  },
  darts: {
    id: 'darts',
    title: 'Darts (301)',
    short: 'Darts',
    sceneKey: 'DartsScene',
    venue: 'The dartboard on the basement wall',
    turnBased: true,
    blurb: '301, double out. Three darts a turn.',
    howTo: [
      'Both players start at 301. Three darts per turn; subtract what you hit.',
      'DOUBLE OUT: you must finish by hitting a DOUBLE (the thin outer ring) or the inner bull to land on exactly zero.',
      'Going below zero, leaving exactly 1, or reaching zero without a double is a BUST: your score resets to the start of the turn.',
      'Outer bull = 25, inner bull = 50. Triples are the thin inner ring.',
      'Drag to aim. The crosshair sways; tap THROW when it sits where you want. Checkout hints appear when you can finish.',
    ],
    keyboardP1: ['Mouse: aim', 'SPACE/F: throw'],
    keyboardP2: ['Same controls, players alternate'],
    touch: ['Drag to aim, tap THROW'],
    accent: 0xd32f2f,
  },
};

/** Palette matched to the Sports at Academy Hill logo: deep green, gold, cream, orange. */
export const THEME = {
  bg: 0x14301a,
  panel: 0x1f4426,
  panelLight: 0x2d5c36,
  accent: 0xf5c518,
  accent2: 0xff8a2a,
  text: '#fff3c4',
  textDim: '#c8d6b4',
  good: 0x8bc34a,
  bad: 0xef5350,
  font: 'Trebuchet MS, "Segoe UI", Arial, sans-serif',
  fontDisplay: '"Arial Black", "Trebuchet MS", Arial, sans-serif',
};
