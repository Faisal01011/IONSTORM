# IONSTORM

**Defend the Veil. Ride the Surge.**

[![Play the live game](https://img.shields.io/badge/play-live%20game-5ff2ff?style=flat-square&logo=vercel&logoColor=061018)](https://ionstorm.vercel.app)
[![Quality checks](https://github.com/Faisal01011/IONSTORM/actions/workflows/quality.yml/badge.svg)](https://github.com/Faisal01011/IONSTORM/actions/workflows/quality.yml)
[![License](https://img.shields.io/badge/license-MIT-ffb454?style=flat-square)](LICENSE)

IONSTORM is a neon browser arcade shooter built for short, replayable runs. Pilot through escalating enemy waves, break Dreadnought boss encounters, collect scrap, and bring permanent Hangar upgrades into your next deployment.

It uses WebGPU when available and falls back to WebGL2 automatically, so the same game can run across modern desktop and mobile browsers without an account or backend. It can also be installed as a standalone PWA and cached for offline play.

[![IONSTORM preview](og-image.png)](https://ionstorm.vercel.app)

## What is included

- WebGPU rendering with a WebGL2 fallback
- GPU-driven particles, instanced sprites, procedural backgrounds, and screen effects
- Automatic cannons with pointer, keyboard, and touch movement
- Escalating enemy waves, asteroids, power-ups, and tiered four-phase Dreadnought bosses
- Elite enemy modifiers, splitter reinforcements, and rotating event waves
- In-run XP progression with three-choice temporary upgrade drafts
- UTC-seeded daily challenges with rotating modifiers, local best scores, and shareable results
- Detailed post-run metrics including survival time, accuracy, damage, elites, bosses, and systems
- SURGE overdrive, combo multipliers, achievements, and score chasing
- Three ships with distinct speed, hull, shield, and firing profiles
- Persistent scrap, upgrades, pilot profile, local records, and statistics
- Achievement-unlocked cosmetics: ship colors, engine trails, engine effects, and victory effects
- Procedural sound effects and music with accessible mute controls
- Reduced flash, reduced shake, contrast, low-quality, and input-response settings
- A responsive interface for desktop, portrait mobile, and landscape mobile play
- Installable PWA shell with offline caching and local progression

## Controls

| Action | Desktop | Mobile |
| --- | --- | --- |
| Move | `WASD`, arrow keys, or pointer | Drag on the game canvas |
| Fire | Automatic cannons | Automatic cannons |
| Activate SURGE | `Space` when charged | Tap the SURGE control or double-tap |
| Launch | `Enter` or `Space` | Tap **LAUNCH MISSION** |
| Pause / resume | `P` | Tap the pause button |
| Toggle sound | `M` | Tap the sound button |
| Open Hangar | `H` | Tap **HANGAR** |
| Relaunch after a run | `R` or `Enter` | Tap **RELAUNCH** |

During a deployment, destroyed enemies grant run XP. Each level-up pauses the
mission and offers three different temporary systems; choose with `1`–`3` on
desktop or tap a card on mobile. These upgrades reset when the run ends.

The title screen also includes one daily challenge shared by UTC date. Every
daily run uses the same deterministic combat seed and a rotating modifier such
as REDLINE, IRON VEIL, SURGE CIRCUIT, or SALVAGE RUSH. Daily best scores are
stored locally, and the end screen can share or copy a compact result card.

Every run ends with a tactical breakdown: survival time, firing accuracy,
damage dealt, elite contacts destroyed, Dreadnoughts defeated, and temporary
systems installed.

From wave 3 onward, elite contacts can appear with Aegis shields, Berserker
rage drives, or Splitter cores. Every few waves also introduces a tactical event
such as Elite Hunt, Asteroid Storm, or Salvage Run; the event panel explains the
current modifier while the wave is active.

Combat pickups now cover seven temporary systems: TRIPLE spread shot, RAPID
fire, SHIELD cells, SEEKER missiles, PIERCING lances that pass through multiple
contacts once per target, a MAGNET that reaches farther and pulls salvage faster, and
TIME-SLOW that reduces hostile-world speed for seven seconds. Active timers are
shown in the mobile and desktop HUD; pickup effects last only for the current
deployment.

Every fifth wave culminates in a Dreadnought encounter. Its four phases—Hunter,
Siege, Breach, and Meltdown—change movement, reinforcements, and attack patterns.
Later encounters also advance the Dreadnought Mk: hull and damage resistance rise,
attack cadence and projectile speed increase, reinforcements arrive in larger
groups, and the exposed-core counter window tightens. Each Mk uses a different
attack doctrine—Ravager, Warden, Harrier, Swarmcore, or Annihilator—so reaching
the next boss is a new combat problem rather than a repeated wave-5 loop.
Attacks are telegraphed in the boss panel before they fire, and each completed
pattern opens a short **CORE EXPOSED** window for high-damage counterfire.

Visual and performance preferences are saved locally in the browser.
The Hangar's **INPUT RESPONSE** slider tunes touch, pointer, and keyboard steering from 75% (precise) to 175% (fast), with 125% as the default.

The Hangar's **COSMETICS BAY** turns achievement progress into visible rewards.
Equip unlocked ship colors, engine trails, engine signatures, and Dreadnought
victory effects; selections are stored in the local pilot profile and apply to
new deployments.

## Run locally

IONSTORM is a static site. Node.js is only used for the repository checks; no runtime package installation is required by the game.

```bash
git clone https://github.com/Faisal01011/IONSTORM.git
cd IONSTORM
npm ci
npm run check
npm run serve
```

Open [http://localhost:4173](http://localhost:4173). A local HTTP server is recommended because it reproduces deployed asset and browser behavior more reliably than opening `index.html` directly.

On supported browsers, use **INSTALL IONSTORM** on the title screen to add the
game to your device. The service worker caches the game shell after the first
successful load, so subsequent launches work without a network connection.

## Browser support

Use a current version of Chrome, Edge, Firefox, or Safari with hardware acceleration enabled. WebGPU is preferred; browsers without a working WebGPU path use the WebGL2 fallback automatically.

If the title screen reports a renderer error, update the browser and graphics drivers, enable hardware acceleration, and reload the page. The renderer shown in the mission panel tells you whether WebGPU or WebGL2 is active.

## Repository layout

```text
IONSTORM/
├── .github/             CI, issue forms, PR template, and code ownership
├── docs/                architecture and development notes
├── src/
│   ├── game.js          renderer, simulation, input, audio, and core progression
│   ├── profile.js       pilot profile, records, and statistics add-on
│   └── styles.css       visual system and responsive interface
├── tests/               Node regression tests and repository contracts
├── index.html           static entry point and game shell
├── manifest.webmanifest install metadata and standalone display settings
├── sw.js                 cache-first offline shell service worker
├── ionstorm-icon.svg     install and home-screen icon
├── og-image.png         generated social preview
├── og-image.svg         editable social preview source
├── CNAME                custom deployment domain configuration
├── package.json         metadata and developer commands
└── LICENSE              MIT license
```

Read the [architecture notes](docs/architecture.md) for the boot sequence, renderer paths, persistence keys, input model, and testing strategy.

## Development

Run the full validation suite before opening a pull request:

```bash
npm run check
```

The check runs JavaScript syntax validation and the built-in Node test suite. GitHub Actions runs the same command for pushes to `main` and pull requests targeting `main`.

For contribution expectations, browser testing guidance, and the project boundaries, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Scope and roadmap

The current records board is intentionally local to the browser; it is not a global leaderboard and is not tamper-proof. There is no account system, matchmaking, or server-side progression.

The next gameplay milestone is gamepad input, followed by richer accessibility
and input customisation.

## License

IONSTORM is released under the [MIT License](LICENSE).
