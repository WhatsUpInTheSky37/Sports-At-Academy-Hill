import Phaser from 'phaser';
import { GAME_H, GAME_W, GAMES, THEME, setLogicalSize, type GameId } from './core/constants';
import { buildMatch } from './core/match';
import { Storage } from './core/storage';
import { desiredSize } from './core/layout';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { SetupScene } from './scenes/SetupScene';
import { SettingsScene } from './scenes/SettingsScene';
import { RecordsScene } from './scenes/RecordsScene';
import { ChampionshipScene } from './scenes/ChampionshipScene';
import { HowToScene, PauseScene, ResultScene } from './scenes/overlays';
import { DerbyScene } from './games/derby/DerbyScene';
import { HorseScene } from './games/horse/HorseScene';
import { PoolScene } from './games/pool/PoolScene';
import { WrestlingScene } from './games/wrestling/WrestlingScene';
import { HockeyScene } from './games/hockey/HockeyScene';
import { FootballScene } from './games/football/FootballScene';
import { DartsScene } from './games/darts/DartsScene';

const initial = desiredSize();
setLogicalSize(initial.w, initial.h);

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_W,
  height: GAME_H,
  backgroundColor: THEME.bg,
  antialias: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: GAME_W,
    height: GAME_H,
  },
  input: { activePointers: 4 },
  scene: [
    BootScene, MenuScene, SetupScene, SettingsScene, RecordsScene, ChampionshipScene,
    HowToScene, PauseScene, ResultScene,
    DerbyScene, HorseScene, PoolScene, WrestlingScene, HockeyScene, FootballScene, DartsScene,
  ],
};

const game = new Phaser.Game(config);
(window as unknown as { __game: Phaser.Game }).__game = game;
// Test hook used by scripts/smoke.mjs to jump straight into a game scene.
game.registry.set('__buildMatch', (sceneKey: string, mode: 'single' | 'local' = 'single') => {
  const id = (Object.keys(GAMES) as GameId[]).find((k) => GAMES[k].sceneKey === sceneKey) ?? 'derby';
  const s = Storage.settings;
  return buildMatch(id, { mode, difficulty: s.difficulty, p1: 'will', p2: 'vinnie' });
});
