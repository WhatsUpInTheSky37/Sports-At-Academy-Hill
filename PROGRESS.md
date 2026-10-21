# Progress

Working notes for the Sports at Academy Hill build. Updated as work lands.

## Done
- Project scaffold: Vite 7 + TypeScript 5 + Phaser 3.90 + Vitest 3, production build and typecheck scripts.
- Shared shell: boot, main menu ("What game do you want to play?"), match setup (1P vs CPU / local 2P, Easy-Normal-Hard, pick any two of Will / Vinnie / Bryan / Ben), settings (sound + music separately, touch controls, difficulty), records, championship hub, How-to-Play / Pause / Result overlays.
- Both orientations: the logical canvas is 1920x1080 in landscape and 1080x1920 in portrait; every screen lays itself out from the live size. Rotating mid-match keeps the match and re-lays out on the next screen.
- Core systems: localStorage settings + win/loss records, procedural WebAudio sound effects and music loop, keyboard (two layouts) + on-screen joystick/buttons, pseudo-3D projector for the behind-the-player camera views, procedural character sprites (front and back views, poses) and equipment textures, environment painters.
- Game 1 Home Run Derby: perspective view, aim reticle + timing bar, real flight physics, trees-as-boundary, 10 outs, tiebreak rounds, CPU batter with difficulty noise. Tests for rules and batting.
- Championship progression logic with clinch announcement and final celebration. Tests.
- Headless smoke script (scripts/smoke.mjs) and a derby full-match playthrough script.

- Game 4 Wrestling, Game 5 Hockey, Game 6 Football, Game 7 Darts: complete with pure rules/sim modules, AI, touch controls, both orientations, tests, and headless screenshots reviewed.

- Game 2 HORSE and Game 3 Billiards: complete with pure rules/physics modules, AI, tests, screenshots reviewed.
- Full suite (113 tests), production build and the all-scene smoke pass are green; the championship flow runs through all seven events to the champion screen in the browser.

- In-browser match completions verified for all seven games (scripts/play-idle.mjs, play-derby.mjs) and the full championship flow (scripts/play-championship.mjs).

- Graphics pass: derby rebuilt so the batter faces the wrap-around evergreen line (no house in view) with a three-sided home run boundary; high-fidelity painters (layered sky, perspective lawn, cypress/pine/deciduous trees with haze, vignette) used by the derby, menu, HORSE, hockey and football; HD basement (billiards, wrestling) and rec room (darts); shaded character sprites with true left-facing frames; realistic equipment textures.

## Remaining / known limitations
- Headless verification uses the Canvas renderer and scripted input; manual play on real phones and keyboards is still the best test of feel and tuning.
- Local two-player wrestling, hockey and football need a physical keyboard (no second set of touch controls).
- Reference-photo fidelity is approximate: the yard scenes are painted from the two photos in reference-images/, not traced from them.
