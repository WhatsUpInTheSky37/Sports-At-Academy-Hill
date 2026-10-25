import Phaser from 'phaser';
import { GAME_H, GAME_W, GAMES, THEME, isPortrait } from '../core/constants';
import { champion, currentEvent, isComplete, markClinchAnnounced, needsClinchAnnouncement, type ChampionshipState } from '../core/championship';
import type { MatchConfig } from '../core/match';
import { Storage } from '../core/storage';
import { makeButton, displayStyle, textStyle, makePanel, confetti, makeIconButton } from '../core/ui';
import { CharacterSprite } from '../art/characters';
import { Audio } from '../core/audio';
import { syncOrientation, watchOrientation } from '../core/layout';
import { menuBackdrop } from './MenuScene';

interface ChampData {
  state: ChampionshipState;
  match: MatchConfig;
  /** Set once the title has been written to the records and the fanfare played: a rotation restarts this scene with the same data. */
  recorded?: boolean;
}

/** Championship hub: standings, next event, clinch announcement and the final celebration. */
export class ChampionshipScene extends Phaser.Scene {
  constructor() { super('ChampionshipScene'); }

  create(data: ChampData): void {
    syncOrientation(this);
    watchOrientation(this);
    let { state } = data;
    const { match } = data;
    const W = GAME_W, H = GAME_H, P = isPortrait();
    const names = [match.players[0].character.name, match.players[1].character.name];
    menuBackdrop(this);
    this.add.text(W / 2, 24, 'ACADEMY HILL CHAMPIONSHIP', displayStyle(P ? 36 : 44, '#f5c518', { align: 'center', wordWrap: { width: W - 160 } })).setOrigin(0.5, 0);
    makeIconButton(this, 60, 60, '<', () => this.scene.start('MenuScene'), { radius: 40 });

    // standings
    const sw = P ? W - 60 : 700;
    const sx = P ? W / 2 : 30 + sw / 2;
    const sy = P ? 220 : 240;
    makePanel(this, sx, sy, sw, 220);
    for (const slot of [0, 1] as const) {
      const x = sx + (slot === 0 ? -sw / 4 : sw / 4);
      this.add.image(x, sy - 50, `portrait-${match.players[slot].character.id}`).setScale(0.4);
      this.add.text(x, sy + 5, names[slot], displayStyle(28, '#ffffff')).setOrigin(0.5, 0);
      this.add.text(x, sy + 40, String(state.points[slot]), displayStyle(56, '#f5c518')).setOrigin(0.5, 0);
    }
    this.add.text(sx, sy - 30, '–', displayStyle(60, THEME.textDim)).setOrigin(0.5, 0);
    this.add.text(sx, sy + 60, 'points', textStyle(22, THEME.textDim)).setOrigin(0.5, 0);

    // event list
    const lw = P ? W - 60 : W - sw - 90;
    const lx = P ? W / 2 : 30 + sw + 30 + lw / 2;
    const rowH = P ? 86 : 96;
    const ly = P ? 360 : 110;
    makePanel(this, lx, ly + (rowH * 7) / 2 + 20, lw, rowH * 7 + 40);
    state.events.forEach((gid, i) => {
      const y = ly + 40 + i * rowH;
      const done = i < state.results.length;
      const isNext = i === state.index;
      const g = this.add.graphics();
      g.fillStyle(isNext ? THEME.accent : done ? THEME.panelLight : 0x000000, isNext ? 0.25 : 0.35);
      g.fillRoundedRect(lx - lw / 2 + 20, y - rowH / 2 + 6, lw - 40, rowH - 12, 14);
      this.add.text(lx - lw / 2 + 40, y, `${i + 1}.`, displayStyle(30, isNext ? '#f5c518' : '#ffffff')).setOrigin(0, 0.5);
      this.add.text(lx - lw / 2 + 100, y, GAMES[gid].title, displayStyle(P ? 24 : 28, isNext ? '#f5c518' : '#ffffff', { strokeThickness: 0 })).setOrigin(0, 0.5);
      if (done) {
        const w = state.results[i];
        this.add.image(lx + lw / 2 - 170, y, `portrait-${match.players[w].character.id}`).setScale(0.225);
        this.add.text(lx + lw / 2 - 130, y, names[w], textStyle(24, '#ffffff')).setOrigin(0, 0.5);
      } else if (isNext) {
        this.add.text(lx + lw / 2 - 50, y, 'NEXT', displayStyle(26, '#f5c518', { strokeThickness: 0 })).setOrigin(1, 0.5);
      }
    });

    if (isComplete(state)) {
      const w = champion(state)!;
      if (!data.recorded) Storage.recordChampionship(match.players[w].character.id);
      this.celebrate(w, match, names, state, !data.recorded);
      data.recorded = true;
      return;
    }
    const next = currentEvent(state)!;
    const bx = P ? W / 2 : sx;
    const by = P ? H - 120 : sy + 260;
    makeButton(this, bx, by, `PLAY EVENT ${state.index + 1}:\n${GAMES[next].short.toUpperCase()}`, () => {
      Audio.unlock();
      this.scene.start(GAMES[next].sceneKey, { match: { ...match, gameId: next, championship: state } });
    }, { width: P ? 600 : sw - 40, height: 140, fontSize: 32 }).setDepth(10);
    if (needsClinchAnnouncement(state)) {
      state = markClinchAnnounced(state);
      data.state = state; // so a rotation does not announce the clinch again
      const who = names[state.clinchedBy!];
      const remaining = state.events.length - state.index;
      this.time.delayedCall(300, () => {
        Audio.sfx('fanfare');
        confetti(this, W / 2, H / 2 - 100, 80);
        const dim = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.65).setDepth(50).setInteractive();
        const t1 = this.add.text(W / 2, H / 2 - 160, `${who.toUpperCase()} CLINCHES!`, displayStyle(P ? 60 : 78, '#f5c518', { align: 'center' })).setOrigin(0.5).setDepth(51);
        const t2 = this.add.text(W / 2, H / 2 - 40, `${who} has reached 4 wins and cannot be caught.\nWe play out the remaining ${remaining} event${remaining === 1 ? '' : 's'} for the final score!`, textStyle(30, '#ffffff', { align: 'center', wordWrap: { width: W - 120 } })).setOrigin(0.5).setDepth(51);
        const ok = makeButton(this, W / 2, H / 2 + 110, 'KEEP PLAYING', () => { dim.destroy(); t1.destroy(); t2.destroy(); ok.destroy(); }, { width: 460, height: 96, fontSize: 32, depth: 52 });
      });
    }
  }

  private celebrate(w: 0 | 1, match: MatchConfig, names: string[], state: ChampionshipState, fanfare = true): void {
    const W = GAME_W, H = GAME_H, P = isPortrait();
    this.add.rectangle(W / 2, H / 2, W, H, 0x0a1a0c, 0.92).setDepth(50).setInteractive();
    this.add.text(W / 2, P ? 160 : 60, 'ACADEMY HILL CHAMPION', displayStyle(P ? 40 : 46, '#ffffff')).setOrigin(0.5, 0).setDepth(51);
    this.add.text(W / 2, P ? 220 : 120, names[w].toUpperCase() + '!', displayStyle(P ? 84 : 100, '#f5c518', { strokeThickness: 12 })).setOrigin(0.5, 0).setDepth(51);
    const cy = P ? 760 : 640;
    const s = new CharacterSprite(this, W / 2, cy, match.players[w].character, 1.7).setDepth(51);
    s.cheer();
    const belt = this.add.image(W / 2, cy + 60, 'belt').setDepth(52).setScale(1.2);
    this.tweens.add({ targets: belt, y: cy + 40, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    const l = new CharacterSprite(this, W / 2 + 300, cy + 20, match.players[w === 0 ? 1 : 0].character, 1.05).setDepth(51);
    l.sad();
    this.add.text(W / 2, cy + 150, `Final score: ${names[0]} ${state.points[0]} - ${state.points[1]} ${names[1]}`, displayStyle(34, '#ffffff')).setOrigin(0.5).setDepth(51);
    this.add.text(W / 2, cy + 200, `${names[w === 0 ? 1 : 0]}: "Good game... rematch tomorrow?"`, textStyle(26, THEME.textDim, { fontStyle: 'italic' })).setOrigin(0.5).setDepth(51);
    if (fanfare) {
      Audio.sfx('fanfare');
      this.time.addEvent({ delay: 600, repeat: 6, callback: () => confetti(this, 200 + Math.random() * (W - 400), 200 + Math.random() * 300, 40, 60) });
    }
    const by = P ? H - 150 : H - 90;
    makeButton(this, W / 2 - 250, by, 'NEW CHAMPIONSHIP', () => this.scene.start('SetupScene', { championship: true }), { width: 460, height: 96, fontSize: 30, depth: 53 });
    makeButton(this, W / 2 + 250, by, 'MAIN MENU', () => this.scene.start('MenuScene'), { width: 460, height: 96, fontSize: 30, color: THEME.accent2, depth: 53 });
  }
}
