# Sports at Academy Hill

Seven homemade sports from one childhood afternoon: Backyard Home Run Derby, Driveway HORSE, Basement Billiards, Basement Wrestling, Driveway Hockey, Two-on-Two Football and Darts, starring Will, Vinnie, Bryan and Ben. Built with TypeScript, Vite and Phaser 3. No backend, no accounts, nothing to pay for.

## Installation and local startup

```bash
npm install
npm run dev        # http://localhost:5173
```

Requires Node 18+ (developed on Node 22).

## Production build and deployment

```bash
npm run build      # typecheck + vite build into dist/
npm run preview    # serve dist/ locally on http://localhost:4173
```

`dist/` is a static site with relative asset paths (`base: './'`), so it can be dropped onto GitHub Pages, Netlify, an S3 bucket or any static host. There is no server component.

**GitHub Pages (automatic):** `.github/workflows/deploy-pages.yml` builds and publishes `dist/` on every push to `main`. One-time setup: in the repository **Settings → Pages**, set **Source** to **GitHub Actions**. The game is then served at

```
https://whatsupinthesky37.github.io/Sports-At-Academy-Hill/
```

## Tests and smoke checks

```bash
npm test                 # vitest: rules/physics/scoring tests for every game + championship + storage
npm run typecheck
npm run build && npm run preview &   # then, in another shell:
npm run smoke            # headless Chromium: boots every scene in both orientations, screenshots to smoke-output/
node scripts/play-championship.mjs   # runs a full seven-event championship through the shell to the champion screen
node scripts/play-derby.mjs          # plays a complete derby match vs the CPU
node scripts/play-idle.mjs HockeyScene 900   # plays one game vs the CPU to the result screen (fast-forwarded)
```

The smoke and playthrough scripts open `?renderer=canvas`, a URL switch that forces Phaser's Canvas renderer (headless Chromium's software WebGL is too slow to be useful). Normal play uses WebGL.

## Playing

- **Orientation:** plays in landscape or portrait. The layout adapts; on a phone just hold it however you like.
- **Modes:** 1 player vs CPU (Easy / Normal / Hard) or 2 players on one device. Derby, HORSE, billiards and darts are pass-and-play (touch or keyboard). Wrestling, hockey and football are simultaneous, so local two-player needs a physical keyboard; the setup screen says so.
- **Characters:** pick any two of Will, Vinnie, Bryan and Ben for either side.
- **Touch:** every game has on-screen controls in single player (joystick + buttons, or drag-to-aim + big action buttons).
- **Pause (II / Esc):** resume, restart, How to Play, sound and music toggles, main menu. Results screen: rematch or menu.
- **Championship:** all seven events in order, ending with darts. One point per event. Reaching four wins is announced as a clinch, but all seven are played for the final score, then the champion gets the homemade belt.
- **Saved data:** settings and win/loss records (per game per character, vs-CPU tally per difficulty, championships) live in `localStorage`. Reset from Settings.

### Controls

| Game | Keyboard (P1) | Keyboard (P2) | Touch |
| --- | --- | --- | --- |
| Home Run Derby | WASD/arrows move the aim reticle, SPACE/F swing (or click the ball in TAP HIT mode) | ENTER or `,` swing (turns alternate) | TAP HIT: tap the ball as it crosses the plate. CLASSIC: drag to aim, tap SWING. SWITCH button in-game or in Settings |
| HORSE | Click a chalk spot, A/D fine aim, hold/release SPACE for power | same, turns alternate | Tap spot, drag to aim, hold/release SHOOT |
| Billiards | Drag to aim, A/D fine aim, SPACE shoot | same, turns alternate | Drag to aim, drag/hold power bar |
| Wrestling | WASD move, F grapple/pin, G shove/takedown, H escape | Arrows, `,` grapple/pin, `.` shove, `/` escape | Stick + GRAB / SHOVE / ESC |
| Hockey | WASD skate, F shoot (hold for power), G poke check | Arrows, `,` shoot, `.` poke | Stick + SHOOT / POKE |
| Football | WASD move, F snap/pass, G switch player | Arrows, `,` snap/pass, `.` switch | Stick + SNAP/PASS / SWITCH |
| Darts | Mouse/WASD aim, SPACE/F throw | same, turns alternate | Drag to aim, tap THROW |

### Rules and simplifications

- **Derby:** automatic hittable pitches; swing timing (Early / Perfect / Late) sets direction and contact, the aim point sets loft (aim under the ball for a fly ball). Two batting modes: TAP HIT (one tap on the ball when it arrives: where you tap is where the bat meets it) and CLASSIC (aim reticle plus SWING button). Fair territory is a regulation 90-degree wedge whose foul lines start at the back point of home plate. The batter faces the backyard with the evergreen line wrapping around three sides; a fair ball that clears the trees wherever it crosses the line is a home run; miss, foul, or short is an out; taking a pitch is free. 10 outs each, then 3-out tiebreak rounds until someone leads.
- **HORSE:** setter picks a spot and shoots; a make must be matched from the same spot or the matcher earns a letter. Setter miss hands over the setter role. Five letters loses.
- **Billiards:** casual eight-ball (open table after the break, groups on the first legal pocketed ball, fouls give ball in hand anywhere, called pocket for the 8, 8 on the break is respotted, illegal break lets the opponent accept or rerack). No jump/masse shots, no three-foul rule.
- **Wrestling:** cartoon grappling in a couch-cushion ring. Three-count pins with a timed escape window (no mashing). Stepping out resets both wrestlers.
- **Hockey:** one on one, no goalies, side boundaries, goals only through the goal mouth, first to 5.
- **Football:** 2v2 touch, 40-yard field plus end zones, 4 downs and no first downs, TD 6, no extra points, safety 2, one forward pass per play from behind the line, interceptions returnable, first to 30. No fumbles, blocking, kicking or penalties. Field size, winning score, touch distance and speeds are in `src/games/football/rules.ts`.
- **Darts:** 301 straight-in, double-out (inner bull counts). Bust restores the start-of-turn score. Score comes from the actual impact coordinates on a standard board.

Tuning values for each game are exported constants at the top of that game's module (`DEFAULT_BATTING` and `DERBY_VISUAL` for derby, and the equivalent config objects in `horse/`, `pool/`, `wrestling/`, `hockey/`, `football/`, `darts/`).

## Project structure

```
index.html              entry page
src/main.ts             Phaser config, scene list, orientation bootstrap
src/core/               shared systems
  constants.ts          logical size, game catalogue (titles, how-to text, controls), theme
  layout.ts             orientation handling (landscape 1920x1080 / portrait 1080x1920)
  storage.ts            settings + records in localStorage
  audio.ts              procedural WebAudio sound effects and music
  input.ts              keyboard layouts + on-screen joystick/buttons
  ui.ts                 buttons, panels, meters, announcements, confetti
  projection.ts         pseudo-3D camera used by the perspective scenes
  match.ts              match config / results
  championship.ts       championship progression (pure)
  BaseGameScene.ts      shell every game scene extends (HUD, pause, help, results)
src/art/                procedural artwork: characters (front/back/left-facing poses), equipment, environment painters (sky, perspective lawn, trees, haze)
src/scenes/             boot, menu, setup, settings, records, championship hub, overlays
src/games/<game>/       one folder per sport: pure rules/physics modules + the Phaser scene
tests/                  vitest suites (rules, physics, scoring, championship, storage)
scripts/                headless browser smoke/playthrough scripts
reference-images/       property reference photos (overhead + street view) used to lay out the yard scenes
public/logo.png         optional: the game logo for the title screen
```

## Assets and licenses

Everything in the game is generated at runtime: characters, balls, sticks, tables, rooms and yards are drawn procedurally onto canvases, and every sound effect and the music loop is synthesized with WebAudio. There are no third-party art or audio assets and no runtime network requests. The only dependency shipped to the browser is Phaser 3 (MIT).

If you drop `logo.png` into `public/`, the title screen uses it; otherwise the title is drawn in code.

## Reference images for future property art

`reference-images/` holds the overhead photo and the street-view photo of the house, driveway and backyard. They are not loaded by the game (nothing under that folder ships); they are the source the yard scenes were painted from:

- The batter stands at the street end of the long driveway, the house (white siding, blue shutters) on the left, the evergreen hedge on the right and across the back of the yard, and the backyard opening up and to the left. Fair territory is the wedge toward that back-left corner; the hedge is the home run line and is drawn at childhood height (jumpable, with gaps).
- Hockey and HORSE use the same driveway and hedge.

To push the art closer to the photos, edit the painters in `src/art/environment.ts` and each scene's `paintBackground` (derby has `paintDiamond`, `paintHedgeShadows` and friends, rasterised at 2x). Add new photos to the same folder.
