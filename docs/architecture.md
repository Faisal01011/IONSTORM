# IONSTORM architecture

IONSTORM is a dependency-free static web game. The repository deliberately has no bundler or framework: the browser loads the root HTML entry point, the source modules, and the generated social preview asset directly. This keeps local development, deployment, and offline experimentation straightforward.

## Runtime layout

```text
index.html
├── src/styles.css       visual system, overlays, HUD, and responsive rules
├── src/game.js          renderer, simulation, input, audio, and core progression
└── src/profile.js       pilot profile, local records, and statistics add-on
```

`profile.js` is loaded after `game.js` because it extends the core with profile and records screens and wraps selected game lifecycle hooks. The game remains playable when the optional profile layer is unavailable.

## Boot sequence

1. `game.js` reads settings and local progression from `localStorage`.
2. The canvas is sized for the current viewport and device pixel ratio.
3. A procedural sprite atlas is created in memory.
4. WebGPU is attempted first. If it is unavailable or initialization fails, the game initializes its WebGL2 fallback.
5. The title screen is shown and the shared animation loop begins.

The WebGPU path uses embedded WGSL for background, sprite, particle, and compute passes. The fallback uses embedded GLSL ES 3.00 shaders and a CPU-managed particle pool. There are no downloaded models, textures, or game libraries.

## State and persistence

Core state lives in the `G` object in `src/game.js`. It covers the active run, player, enemies, projectiles, pickups, waves, score, combo, boss state, renderer timing, and temporary run progression.

Enemy kills award run XP. When the current threshold is reached, the simulation
enters the `upgrade` state and freezes the world while `ovUpgrade` presents
three unique temporary systems. Choosing a card applies its effect immediately;
the choice is kept only in the current `G.runUpgrades` run state and is cleared
by `resetRun()`.

Wave composition is driven by `waveProfile()` and `waveEvent()`. From wave 3,
eligible contacts can be promoted to one of three temporary elite modifiers:
Aegis absorbs incoming damage with an energy shield, Berserker accelerates as
its hull falls, and Splitter releases two smaller drones on destruction. Event
waves expose their active rule through `eventHud`; Elite Hunt raises elite
frequency, Asteroid Storm increases debris, and Salvage Run improves pickup
drops. Event state is reset at the start of each wave and does not persist.

Every fifth wave creates one Dreadnought. `BOSS_PHASES` maps its health bands to
four readable combat profiles: Hunter, Siege, Breach, and Meltdown. The boss
telegraphs each attack through `telegraphT` before emitting projectiles, pauses
briefly during `phaseTransitionT`, and exposes its core through `coreOpenT` after
an attack. `damageBoss()` keeps the body damageable while shielded, increases
damage during the exposed window, and makes phase changes fair by temporarily
ignoring hits and clearing the previous bullet pattern.

Persistent values are intentionally local to the browser:

| Key | Purpose |
| --- | --- |
| `ionstorm.hi` | best score |
| `ionstorm.meta` | selected ship, scrap, upgrades, and achievements |
| `ionstorm.settings` | audio, visual-intensity, quality, and input-response preferences |
| `ionstorm.profile` | pilot callsign and local profile identity |
| `ionstorm.board` | the local top-ten records list |
| `ionstorm.stats` | aggregate pilot statistics |

The local records list is not a server leaderboard and is not tamper-proof. No account or backend is required to play.

## Input model

- Keyboard controls support movement, SURGE, pause, sound, hangar, and relaunch actions.
- Pointer input lets desktop players steer the ship directly.
- Touch input uses the same pointer path, adds a visible SURGE control, and provides touch actions for overlays that would otherwise be keyboard-only.
- The Hangar's input-response setting changes steering convergence and keyboard acceleration without changing the selected ship's base speed.
- Focus management uses `inert`, ARIA labels, visible focus styles, and explicit button types so inactive overlays do not trap keyboard users. Upgrade cards are real buttons and support both touch selection and `1`–`3` keyboard shortcuts.

## Validation model

The tests in `tests/` use Node's built-in test runner and a small DOM/WebGPU harness. They validate gameplay invariants such as ship fire rates, canvas quality scaling, audio resynchronization, shader layout, renderer initialization, asset references, responsive contracts, and accessibility-related markup.

Run the complete check locally with:

```bash
npm run check
```

The same command runs in GitHub Actions for pushes to `main` and pull requests targeting `main`.
