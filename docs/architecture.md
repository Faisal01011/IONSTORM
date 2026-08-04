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

Core state lives in the `G` object in `src/game.js`. It covers the active run, player, enemies, projectiles, pickups, waves, score, combo, boss state, and renderer timing.

Persistent values are intentionally local to the browser:

| Key | Purpose |
| --- | --- |
| `ionstorm.hi` | best score |
| `ionstorm.meta` | selected ship, scrap, upgrades, and achievements |
| `ionstorm.settings` | audio, visual-intensity, and quality preferences |
| `ionstorm.profile` | pilot callsign and local profile identity |
| `ionstorm.board` | the local top-ten records list |
| `ionstorm.stats` | aggregate pilot statistics |

The local records list is not a server leaderboard and is not tamper-proof. No account or backend is required to play.

## Input model

- Keyboard controls support movement, SURGE, pause, sound, hangar, and relaunch actions.
- Pointer input lets desktop players steer the ship directly.
- Touch input uses the same pointer path, adds a visible SURGE control, and provides touch actions for overlays that would otherwise be keyboard-only.
- Focus management uses `inert`, ARIA labels, visible focus styles, and explicit button types so inactive overlays do not trap keyboard users.

## Validation model

The tests in `tests/` use Node's built-in test runner and a small DOM/WebGPU harness. They validate gameplay invariants such as ship fire rates, canvas quality scaling, audio resynchronization, shader layout, renderer initialization, asset references, responsive contracts, and accessibility-related markup.

Run the complete check locally with:

```bash
npm run check
```

The same command runs in GitHub Actions for pushes to `main` and pull requests targeting `main`.
