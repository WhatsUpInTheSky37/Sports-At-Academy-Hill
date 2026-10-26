# Sports at Academy Hill

Seven homemade sports from one childhood afternoon: Backyard Home Run Derby, Driveway HORSE, Basement Billiards, Basement Wrestling, Driveway Hockey Shootout, Backyard Football and Darts, starring Will F, Vinnie G, Bryan B, Ben L, Dan R, Jimmy "Boner" K and Billy D. Built with TypeScript, Vite and Phaser 3. No backend, no accounts, nothing to pay for.

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
- **CPU turns:** in derby, HORSE, billiards and darts the CPU's turn is fast-forwarded by default (a button in the game lets you watch it, and Settings can flip the default).
- **High scores:** every finished match posts the people's numbers to a shared online board (Supabase, public key, insert-only) under the kid they played as: home runs, goals, points, letters taken on a HORSE win, darts to check out, time to the pin, opponent's balls left on a pool win. HIGH SCORES on the menu shows the top ten per game; the result card says where you landed.
- **Modes:** 1 player vs CPU (Easy / Normal / Hard) or 2 players on one device. Derby, HORSE, billiards, hockey and darts are pass-and-play (touch or keyboard). Wrestling and football are simultaneous, so local two-player needs a physical keyboard; the setup screen says so.
- **Characters:** pick any two of Will, Vinnie, Bryan and Ben for either side.
- **Touch:** every game has on-screen controls in single player (joystick + buttons, or drag-to-aim + big action buttons).
- **Pause (II / Esc):** resume, restart, How to Play, sound toggle, main menu. Results screen: rematch or menu.
- **Championship:** all seven events in order, ending with darts. One point per event. Reaching four wins is announced as a clinch, but all seven are played for the final score, then the champion gets the homemade belt.
- **Saved data:** settings and win/loss records (per game per character, vs-CPU tally per difficulty, championships) live in `localStorage`. Reset from Settings.

### Controls

| Game | Keyboard (P1) | Keyboard (P2) | Touch |
| --- | --- | --- | --- |
| Home Run Derby | WASD/arrows move the aim reticle, SPACE/F swing (or click the ball in TAP HIT mode) | ENTER or `,` swing (turns alternate) | TAP HIT: tap the ball as it crosses the plate. CLASSIC: drag to aim, tap SWING. SWITCH button in-game or in Settings |
| HORSE | Arrows pick a spot; hold SPACE / F and release in the gold band, A/D aim; or flick up with the mouse | same, turns alternate | Tap a chalk spot, then flick up on the court: pull length = power, sideways = aim |
| Billiards | Drag to aim, A/D fine aim, SPACE shoot | same, turns alternate | Drag to aim, drag/hold power bar |
| Wrestling | WASD move, F grapple/pin, G shove/takedown, H punch, J leg kick; hold any button to escape a pin | Arrows, `,` grapple/pin, `.` shove, `/` punch, `'` leg kick | Stick + GRAB / SHOVE / PUNCH / KICK; hold any button to escape a pin |
| Hockey | WASD skate, click the net to shoot (F / SPACE: open corner); in goal: A / D slide, F poke, G dive | Arrows skate, `,` or ENTER shoot (turns alternate); in goal: arrows slide, `,` poke, `.` dive | Left stick to skate, tap the net where you want the puck; in goal: stick slides, POKE / DIVE buttons |
| Football | WASD move, F hike / hold F to throw to the receiver, G switch; or press-hold / swipe on the field to throw there | Arrows, `,` hike / hold to throw, `.` switch | Tap the field to hike; press-hold (longer = harder) or swipe (faster = harder) where the ball should land; stick to run; tap to switch on defense |
| Darts | Mouse/WASD aim, SPACE/F throw | same, turns alternate | Drag to aim, tap THROW |

### Rules and simplifications

- **Derby:** automatic hittable pitches; swing timing (Early / Perfect / Late) sets direction and contact, the aim point sets loft (aim under the ball for a fly ball). Two batting modes: TAP HIT (one tap on the ball when it arrives: where you tap is where the bat meets it) and CLASSIC (aim reticle plus SWING button). Fair territory is a regulation 90-degree wedge whose foul lines start at the back point of home plate. The batter faces the backyard with the evergreen line wrapping around three sides; a fair ball that clears the trees wherever it crosses the line is a home run; miss, foul, or short is an out; taking a pitch is free. 10 outs each, then 3-out tiebreak rounds until someone leads.
- **HORSE:** setter picks a spot and shoots; a make must be matched from the same spot or the matcher earns a letter. Setter miss hands over the setter role. Five letters loses. Shots are a flick: pull up to a sweet length for perfect power (a vertical bar shows the band), sideways to aim; the live arc shows the launch but not the landing. A nearly-right flick is nudged toward perfect, and the wobble that grows with distance is mild, so close shots are near-automatic and deep ones are a gamble.
- **Billiards:** casual eight-ball (open table after the break, groups on the first legal pocketed ball, fouls give ball in hand anywhere, called pocket for the 8, 8 on the break is respotted, illegal break lets the opponent accept or rerack). No jump/masse shots, no three-foul rule.
- **Wrestling:** cartoon grappling in a couch-cushion ring. Punches and leg kicks drain stamina (a kick sweeps a staggered or tired opponent, so punch then kick is the classic combo), shoves and grapples set up the takedown, and a three-count pin wins. The pinned wrestler holds any button to break free: about 1.4 s at full stamina, over 3 s when exhausted. Stepping out resets both wrestlers.
- **Hockey:** a shootout. Five attempts each, alternating; the shooter skates in from the top of the driveway with an 8-second shot clock and taps the net where the puck should go. Aim error grows with distance and skating speed. The player who is not shooting is in goal: slide across with the stick, poke check when the shooter comes inside about 1.7 m, or dive toward a post (fast and wide but low, and you are down for a moment afterwards). The CPU shooter winds up visibly before releasing and the puck is a touch slower against a person in goal. A CPU goalie slides to cut the angle, reacts to the shot (faster on harder difficulty) and can poke the puck away inside the crease. Regulation ends early when the trailing player cannot catch up; ties go to sudden death. The view zooms toward the net as the shooter closes in.
- **Football:** touch football on a 40-yard field plus end zones, with goal posts. On the setup screen pick the format (1 on 1 or 2 on 2), switch the all-time QB on or off, and build each team from the seven kids; the first pick is the captain. Before each snap the offense calls one of four plays (tap, or keys 1-4) that sets the receivers' routes. With the all-time QB you throw for both teams and never play defense; nobody rushes you, but a 6-second clock does, and you cannot run it past the line (whoever catches it is yours to run). 1 on 1 without the all-time QB is a running game. The keyboard throw goes to the most open receiver; a press-hold or swipe throw goes to the spot, and the receiver who can get there soonest goes after it. 4 downs and no first downs, TD 6 plus a kicked point after (a timing marker that must land in the green to split the uprights), safety 2, kickoffs to open the game and after every touchdown (hold to charge, let go to kick; the receiving captain fields it and returns, a kick into the end zone is a touchback at the 8), one forward pass per play from behind the line, interceptions returnable, first to 30. Backyard rush rule: the rusher counts Mississippis (2.5 s, slower on easier CPUs) before crossing the line. Passes are thrown to a spot: throw power sets speed and arc (hard = fast and flat, soft = a lob the receiver can run under). No fumbles, blocking, kicking or penalties. The field runs along a neighborhood street on the far sideline, and the odd car drives by (cars are decoration and never touch the play). Field size, winning score, touch distance and speeds are in `src/games/football/rules.ts`.
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
  audio.ts              procedural WebAudio sound effects (no background music)
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

Everything in the game is generated at runtime: characters, balls, sticks, tables, rooms and yards are drawn procedurally onto canvases, and every sound effect is synthesized with WebAudio; there is no background music. There are no third-party art or audio assets and no runtime network requests. The only dependency shipped to the browser is Phaser 3 (MIT).

If you drop `logo.png` into `public/`, the title screen uses it; otherwise the title is drawn in code.

## Reference images for future property art

`reference-images/` holds the overhead photo and the street-view photo of the house, driveway and backyard. They are not loaded by the game (nothing under that folder ships); they are the source the yard scenes were painted from:

- The batter stands at the street end of the long driveway, the house (white siding, blue shutters) on the left, the evergreen hedge on the right and across the back of the yard, and the backyard opening up and to the left. Fair territory is the wedge toward that back-left corner; the hedge is the home run line and is drawn at childhood height (jumpable, with gaps).
- Hockey and HORSE use the same driveway and hedge.

To push the art closer to the photos, edit the painters in `src/art/environment.ts` and each scene's `paintBackground` (derby has `paintDiamond`, `paintHedgeShadows` and friends, rasterised at 2x). Add new photos to the same folder.
