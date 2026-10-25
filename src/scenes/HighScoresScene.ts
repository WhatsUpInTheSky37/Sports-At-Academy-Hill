import Phaser from 'phaser';
import { GAME_H, GAME_ORDER, GAME_W, GAMES, THEME, isPortrait, type GameId } from '../core/constants';
import { CHARACTERS, displayName } from '../core/characters';
import { SCORE_META, fetchTop, type ScoreEntry } from '../core/leaderboard';
import { displayStyle, textStyle, makeButton, makeIconButton, makePanel } from '../core/ui';
import { syncOrientation, watchOrientation } from '../core/layout';
import { menuBackdrop } from './MenuScene';

/** The online high-score board: a tab per game, the top ten with the kid who set each one. */
export class HighScoresScene extends Phaser.Scene {
  constructor() { super('HighScoresScene'); }
  private game_: GameId = 'derby';
  private dyn: Phaser.GameObjects.GameObject[] = [];
  private req = 0;

  create(data: { game?: GameId } = {}): void {
    syncOrientation(this);
    watchOrientation(this);
    menuBackdrop(this);
    this.game_ = data.game ?? 'derby';
    const W = GAME_W;
    this.add.text(W / 2, 30, 'HIGH SCORES', displayStyle(52, '#f5c518')).setOrigin(0.5, 0);
    makeIconButton(this, 60, 60, '<', () => this.scene.start('MenuScene'), { radius: 40 });
    this.add.text(W / 2, isPortrait() ? 100 : 96, 'Shared online: every kid everywhere is on one board.', textStyle(22, THEME.textDim)).setOrigin(0.5, 0);
    this.render();
  }

  private render(): void {
    this.dyn.forEach((o) => o.destroy());
    this.dyn = [];
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => { this.dyn.push(o); return o; };
    const W = GAME_W, H = GAME_H, P = isPortrait();
    // tabs
    const tabW = P ? 250 : 240, tabH = 64, gap = 10;
    const perRow = P ? 4 : 7;
    const rows = Math.ceil(GAME_ORDER.length / perRow);
    const tabTop = P ? 150 : 150;
    GAME_ORDER.forEach((id, i) => {
      const row = Math.floor(i / perRow), col = i % perRow;
      const n = Math.min(perRow, GAME_ORDER.length - row * perRow);
      const x = W / 2 - ((n - 1) * (tabW + gap)) / 2 + col * (tabW + gap);
      const y = tabTop + row * (tabH + gap);
      const on = id === this.game_;
      add(makeButton(this, x, y, GAMES[id].short.toUpperCase(), () => { this.game_ = id; this.render(); }, { width: tabW, height: tabH, fontSize: 22, color: on ? THEME.accent : THEME.panelLight, textColor: on ? '#1a1a1a' : '#ffffff' }));
    });
    const top = tabTop + rows * (tabH + gap) + 30;
    const pw = Math.min(W - 60, 1200);
    const ph = H - top - 60;
    add(makePanel(this, W / 2, top + ph / 2, pw, ph));
    const left = W / 2 - pw / 2;
    const meta = SCORE_META[this.game_];
    add(this.add.text(left + 30, top + 18, GAMES[this.game_].title.toUpperCase(), displayStyle(26, '#f5c518', { strokeThickness: 0 })).setOrigin(0, 0));
    add(this.add.text(left + pw - 30, top + 22, `${meta.label}${meta.lowerIsBetter ? '  (lower is better)' : ''}`, textStyle(20, THEME.textDim)).setOrigin(1, 0));
    const status = add(this.add.text(W / 2, top + ph / 2, 'Loading the board…', textStyle(26, THEME.textDim)).setOrigin(0.5));
    const req = ++this.req;
    fetchTop(this.game_, 10).then((rows) => {
      if (req !== this.req || !this.scene.isActive()) return;
      status.destroy();
      this.dyn = this.dyn.filter((o) => o !== status);
      this.renderRows(rows, left, top + 70, pw, add);
    }).catch(() => {
      if (req !== this.req || !this.scene.isActive()) return;
      status.setText('Could not reach the scoreboard. Check the connection and try again.');
    });
  }

  private renderRows(rows: ScoreEntry[], left: number, y0: number, pw: number, add: <T extends Phaser.GameObjects.GameObject>(o: T) => T): void {
    const P = isPortrait();
    const meta = SCORE_META[this.game_];
    if (!rows.length) {
      add(this.add.text(left + pw / 2, y0 + 60, 'No scores yet. Go set one!', textStyle(28, THEME.textDim)).setOrigin(0.5, 0));
      return;
    }
    const rowH = P ? 76 : 66;
    rows.forEach((r, i) => {
      const y = y0 + i * rowH;
      const ch = CHARACTERS[r.character];
      if (i % 2 === 0) add(this.add.rectangle(left + pw / 2, y + rowH / 2 - 4, pw - 40, rowH - 4, 0xffffff, 0.05));
      add(this.add.text(left + 40, y + rowH / 2 - 4, `${i + 1}.`, displayStyle(28, i === 0 ? '#f5c518' : '#ffffff', { strokeThickness: 0 })).setOrigin(0, 0.5));
      if (ch) {
        add(this.add.image(left + 125, y + rowH / 2 - 4, `portrait-${ch.id}`).setScale(P ? 0.24 : 0.22));
        add(this.add.text(left + 170, y + rowH / 2 - 4, displayName(ch), textStyle(P ? 24 : 26, '#ffffff')).setOrigin(0, 0.5));
      }
      add(this.add.text(left + pw * (P ? 0.62 : 0.56), y + rowH / 2 - 4, meta.format(r.score), displayStyle(P ? 30 : 32, '#ffffff', { strokeThickness: 0 })).setOrigin(0.5, 0.5));
      const when = r.created_at ? new Date(r.created_at).toLocaleDateString() : '';
      add(this.add.text(left + pw - 40, y + rowH / 2 - 4, `${r.difficulty === 'local' ? '2 players' : `vs CPU ${r.difficulty}`}${when ? `  •  ${when}` : ''}`, textStyle(P ? 17 : 20, THEME.textDim)).setOrigin(1, 0.5));
    });
  }
}
