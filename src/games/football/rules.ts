/**
 * Two-on-two touch football rules, independent of rendering.
 * Field coordinates: y runs along the field in yards. Team 0 defends y <= 0 and attacks toward
 * y = fieldLength; team 1 defends y >= fieldLength and attacks toward y = 0. End zones extend
 * `endZone` yards beyond each goal line. x is lateral, centred on 0.
 */

export interface FootballConfig {
  /** Goal line to goal line, yards. */
  fieldLength: number;
  /** Depth of each end zone, yards. */
  endZone: number;
  /** Sideline to sideline, yards. */
  width: number;
  /** First team to reach this many points wins. */
  winScore: number;
  /** Defender within this distance (yards) of the ball carrier ends the play. */
  touchDistance: number;
  /** Where possessions start after a score: this many yards from the offence's own goal line. */
  startYard: number;
  downs: number;
  touchdownPoints: number;
  safetyPoints: number;
  /** Human-controlled player speed, yards per second. */
  playerSpeed: number;
  /** AI speed = playerSpeed * (aiSpeedMin + level * (aiSpeedMax - aiSpeedMin)). */
  aiSpeedMin: number;
  aiSpeedMax: number;
  /** Pass flight speed, yards per second, and the maximum lead distance a fully charged pass adds. */
  passSpeed: number;
  passMaxLead: number;
  /** Seconds to fully charge a pass. */
  chargeTime: number;
  /** Receiver catch radius and defender interception radius (yards). */
  catchRadius: number;
  interceptRadius: number;
}

export const FOOTBALL_CONFIG: FootballConfig = {
  fieldLength: 40,
  endZone: 10,
  width: 25,
  winScore: 30,
  touchDistance: 1.25,
  startYard: 5,
  downs: 4,
  touchdownPoints: 6,
  safetyPoints: 2,
  playerSpeed: 7.5,
  aiSpeedMin: 0.9,
  aiSpeedMax: 1.0,
  passSpeed: 24,
  passMaxLead: 12,
  chargeTime: 1.1,
  catchRadius: 1.8,
  interceptRadius: 1.1,
};

export type Team = 0 | 1;

export interface FootballState {
  scores: [number, number];
  offense: Team;
  /** 1-based down number. */
  down: number;
  /** Line of scrimmage, field y (between the goal lines). */
  lineOfScrimmage: number;
  /** True while an intercepting team is returning the ball (no down is consumed when it ends). */
  returning: boolean;
  winner: Team | null;
  /** Human-readable description of the last play result. */
  lastEvent: string;
}

export type PlayOutcome =
  | { type: 'tackled'; spot: number }
  | { type: 'outOfBounds'; spot: number }
  | { type: 'incomplete' }
  | { type: 'touchdown' }
  | { type: 'safety' };

export function other(t: Team): Team { return t === 0 ? 1 : 0; }

/** +1 when the team attacks toward increasing y, -1 otherwise. */
export function attackDir(team: Team): 1 | -1 { return team === 0 ? 1 : -1; }

/** Field y of a team's own n-yard line. */
export function ownYardLine(team: Team, yards: number, cfg: FootballConfig = FOOTBALL_CONFIG): number {
  return team === 0 ? yards : cfg.fieldLength - yards;
}

/** Field y of the goal line the team attacks. */
export function goalLine(team: Team, cfg: FootballConfig = FOOTBALL_CONFIG): number {
  return team === 0 ? cfg.fieldLength : 0;
}

/** Yards from a spot to the goal line the team attacks. */
export function yardsToGoal(team: Team, spot: number, cfg: FootballConfig = FOOTBALL_CONFIG): number {
  return team === 0 ? cfg.fieldLength - spot : spot;
}

/** True when a spot is inside the end zone the given team defends (its own end zone). */
export function inOwnEndZone(team: Team, spot: number, cfg: FootballConfig = FOOTBALL_CONFIG): boolean {
  return team === 0 ? spot <= 0 : spot >= cfg.fieldLength;
}

/** True when a spot is at or beyond the goal line the team attacks. */
export function crossedGoal(team: Team, spot: number, cfg: FootballConfig = FOOTBALL_CONFIG): boolean {
  return team === 0 ? spot >= cfg.fieldLength : spot <= 0;
}

export function createFootball(cfg: FootballConfig = FOOTBALL_CONFIG, firstOffense: Team = 0): FootballState {
  return {
    scores: [0, 0],
    offense: firstOffense,
    down: 1,
    lineOfScrimmage: ownYardLine(firstOffense, cfg.startYard, cfg),
    returning: false,
    winner: null,
    lastEvent: 'Kickoff! ' + 'Ball on the ' + cfg.startYard + '.',
  };
}

/** A forward pass is legal only from behind (or on) the line of scrimmage. */
export function canForwardPass(offense: Team, passerY: number, lineOfScrimmage: number): boolean {
  return offense === 0 ? passerY <= lineOfScrimmage + 1e-6 : passerY >= lineOfScrimmage - 1e-6;
}

/** Clamp an x coordinate to the field width. */
export function clampX(x: number, cfg: FootballConfig = FOOTBALL_CONFIG): number {
  const half = cfg.width / 2;
  return Math.max(-half, Math.min(half, x));
}

export function outOfBoundsX(x: number, cfg: FootballConfig = FOOTBALL_CONFIG): boolean {
  return Math.abs(x) > cfg.width / 2;
}

/** Clamp a line-of-scrimmage spot so it sits between the goal lines (at least 1 yard inside). */
function clampSpot(spot: number, cfg: FootballConfig): number {
  return Math.max(1, Math.min(cfg.fieldLength - 1, spot));
}

function withWinner(s: FootballState, cfg: FootballConfig): FootballState {
  if (s.winner !== null) return s;
  if (s.scores[0] >= cfg.winScore) return { ...s, winner: 0 };
  if (s.scores[1] >= cfg.winScore) return { ...s, winner: 1 };
  return s;
}

/** Possession switches immediately on an interception; the return is live until the play ends. */
export function interception(state: FootballState): FootballState {
  return { ...state, offense: other(state.offense), down: 1, returning: true, lastEvent: 'INTERCEPTION!' };
}

/** Give the ball to `team` at its own start yard line. */
function freshPossession(s: FootballState, team: Team, cfg: FootballConfig): FootballState {
  return { ...s, offense: team, down: 1, lineOfScrimmage: ownYardLine(team, cfg.startYard, cfg), returning: false };
}

/** Resolve the end of a play and return the next state. */
export function endPlay(state: FootballState, outcome: PlayOutcome, cfg: FootballConfig = FOOTBALL_CONFIG): FootballState {
  if (state.winner !== null) return state;
  const off = state.offense;
  const def = other(off);
  const scores: [number, number] = [state.scores[0], state.scores[1]];
  let s: FootballState = { ...state, scores };

  const score = (team: Team, pts: number, label: string, nextOffense: Team): FootballState => {
    scores[team] += pts;
    const next = freshPossession({ ...s, scores, lastEvent: label }, nextOffense, cfg);
    return withWinner(next, cfg);
  };

  switch (outcome.type) {
    case 'touchdown':
      return score(off, cfg.touchdownPoints, 'TOUCHDOWN!', def);
    case 'safety':
      // The defence scores and then receives the ball at its own start yard.
      return score(def, cfg.safetyPoints, 'SAFETY!', def);
    case 'incomplete': {
      if (s.returning) {
        // cannot happen (no pass on a return) but be safe: just resume at the line
        return { ...s, returning: false, down: 1, lastEvent: 'Play over.' };
      }
      if (s.down >= cfg.downs) {
        return { ...s, offense: def, down: 1, lineOfScrimmage: clampSpot(s.lineOfScrimmage, cfg), returning: false, lastEvent: 'Incomplete. Turnover on downs!' };
      }
      return { ...s, down: s.down + 1, lastEvent: 'Incomplete pass.' };
    }
    case 'tackled':
    case 'outOfBounds': {
      let spot = outcome.spot;
      // A carrier touched in the end zone they attack has scored; in their own end zone it is a safety.
      if (crossedGoal(off, spot, cfg)) return score(off, cfg.touchdownPoints, 'TOUCHDOWN!', def);
      if (inOwnEndZone(off, spot, cfg)) {
        if (s.returning) {
          // Casual rule: a returner stopped in their own end zone restarts at their own start yard (no safety on returns).
          return { ...s, returning: false, down: 1, lineOfScrimmage: ownYardLine(off, cfg.startYard, cfg), lastEvent: 'Return stopped in the end zone. Ball comes out to the ' + cfg.startYard + '.' };
        }
        return score(def, cfg.safetyPoints, 'SAFETY!', def);
      }
      spot = clampSpot(spot, cfg);
      const label = outcome.type === 'outOfBounds' ? 'Out of bounds' : 'Touched';
      if (s.returning) {
        return { ...s, returning: false, down: 1, lineOfScrimmage: spot, lastEvent: `${label} at the ${describeYard(off, spot, cfg)}. First down.` };
      }
      const gained = (spot - s.lineOfScrimmage) * attackDir(off);
      if (s.down >= cfg.downs) {
        return { ...s, offense: def, down: 1, lineOfScrimmage: spot, lastEvent: `${label}. Turnover on downs at the ${describeYard(def, spot, cfg)}!` };
      }
      return { ...s, down: s.down + 1, lineOfScrimmage: spot, lastEvent: `${label}. ${gained >= 0 ? 'Gain' : 'Loss'} of ${Math.abs(Math.round(gained))}.` };
    }
  }
}

/** "own 23" / "their 12" style description of a spot from a team's point of view. */
export function describeYard(team: Team, spot: number, cfg: FootballConfig = FOOTBALL_CONFIG): string {
  const own = team === 0 ? spot : cfg.fieldLength - spot;
  if (own <= cfg.fieldLength / 2) return `own ${Math.round(own)}`;
  return `opponent's ${Math.round(cfg.fieldLength - own)}`;
}

export function ordinal(n: number): string {
  return n === 1 ? '1ST' : n === 2 ? '2ND' : n === 3 ? '3RD' : `${n}TH`;
}
