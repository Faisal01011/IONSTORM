# IONSTORM

> Defend the Veil. Ride the Surge.

IONSTORM is a neon browser arcade shooter built around fast runs, escalating waves, boss encounters, procedural audio, and persistent hangar progression. It uses WebGPU when available and automatically falls back to WebGL2 for broader browser compatibility.

## Play

**Live game:** [ionstorm.vercel.app](https://ionstorm.vercel.app)

## Features

- WebGPU renderer with WebGL2 fallback
- GPU-driven particles and instanced rendering
- Automatic cannons and pointer-controlled movement
- Enemy waves, asteroids, power-ups, and Dreadnought boss fights
- SURGE overdrive ability
- Combo multiplier and score chasing
- Three unlockable ships with different play styles
- Persistent scrap, upgrades, achievements, high scores, pilot profile, and local records
- Procedural sound effects and music
- Reduced flash, reduced shake, and low-quality performance options
- No backend or account required; progress is stored locally in the browser

## Controls

| Action | Keyboard / input |
|---|---|
| Move | `WASD`, arrow keys, or pointer |
| Activate SURGE | `Space` when full |
| Open hangar | `H` |
| Pause / resume | `P` |
| Toggle sound | `M` |
| Restart | `R` |

Reduced flash, reduced shake, and low-quality rendering can be toggled in the hangar. These preferences are saved locally.
| Launch / relaunch | `Enter` |

## Browser support

Use a current version of Chrome, Edge, Firefox, or Safari with hardware acceleration enabled. WebGPU is preferred. Browsers without WebGPU support use the WebGL2 fallback automatically.

If the game reports a renderer error, update your browser and graphics drivers, enable hardware acceleration, and reload the page.

## Run locally

IONSTORM is a dependency-free static site. You can serve it with any local HTTP server:

```bash
git clone https://github.com/Faisal01011/IONSTORM.git
cd IONSTORM
python3 -m http.server 4173
```

Open [http://localhost:4173](http://localhost:4173).

Opening `index.html` directly may work, but a local server is recommended for consistent browser behavior.

## Project structure

```text
IONSTORM/
├── index.html     # Game shell, HUD, menus, and overlays
├── game.js        # Rendering, game loop, entities, combat, audio, and progression
├── profile.js     # Pilot profile, local records, and statistics add-on
├── styles.css     # Visual system, HUD, overlays, responsive styling, and effects
├── og-image.*     # Source and generated social preview image
├── tests/         # Renderer, gameplay, metadata, and asset regression checks
└── CNAME          # Custom deployment domain configuration
```

## Technical notes

- WebGPU shaders are embedded in `game.js` as WGSL.
- WebGL2 shaders are embedded as GLSL ES 3.00 fallback programs.
- Game progression, settings, and local records use `localStorage`.
- The local leaderboard is intentionally client-side and is not tamper-proof.
- The game currently has no server-side account, matchmaking, or global leaderboard.

## Development checks

Run the syntax and regression checks before committing changes:

```bash
npm run check
```

## License

No license has been declared yet. Add a license file before accepting outside contributions or publishing the code for reuse.
