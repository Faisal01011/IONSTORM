# IONSTORM architecture

IONSTORM is a dependency-free static web game. The repository deliberately has no bundler or framework: the browser loads the root HTML entry point, the source modules, and the generated social preview asset directly. A small service worker adds installability and offline caching without changing the runtime architecture.

## Runtime layout

```text
index.html
├── src/styles.css       visual system, overlays, HUD, and responsive rules
├── src/game.js          renderer, simulation, input, audio, and core progression
├── src/profile.js       pilot profile, local records, and statistics add-on
├── manifest.webmanifest install metadata and standalone display settings
├── sw.js                cache-first static shell and offline navigation fallback
└── ionstorm-icon.svg    install and home-screen icon
```

`profile.js` is loaded after `game.js` because it extends the core with profile and records screens and wraps selected game lifecycle hooks. The game remains playable when the optional profile layer is unavailable.

## Boot sequence

1. `game.js` reads settings and local progression from `localStorage`.
2. The canvas is sized for the current viewport and device pixel ratio.
3. A procedural sprite atlas is created in memory.
4. WebGPU is attempted first. If it is unavailable or initialization fails, the game initializes its WebGL2 fallback.
5. The title screen is shown and the shared animation loop begins.
6. The service worker is registered progressively; when the browser supports
   installation, the title screen exposes an install action.

The WebGPU path uses embedded WGSL for background, sprite, particle, and compute passes. The fallback uses embedded GLSL ES 3.00 shaders and a CPU-managed particle pool. There are no downloaded models, textures, or game libraries.

## State and persistence

Core state lives in the `G` object in `src/game.js`. It covers the active run, player, enemies, projectiles, pickups, waves, score, combo, boss state, renderer timing, run metrics, daily challenge state, and temporary run progression.

Powerups are selected from one shared seven-item drop table for normal kills and
Dreadnought rewards. TRIPLE, RAPID, SHIELD, and SEEKER retain their existing
combat roles. PIERCING marks each fired bullet with a per-projectile target set
so one shot can pass through multiple contacts without repeatedly damaging the
same contact. MAGNET temporarily increases pickup attraction range and pull
speed on top of the persistent Hangar magnet upgrade. TIME-SLOW uses its own
run-only timer and time scale, separate from the short impact/pickup feedback
slow. All temporary effects reset in `resetRun()` and their remaining time is
shown through the pickup chips in the HUD.

The local meta profile also stores the selected cosmetic in four categories:
ship color, engine trail, engine effect, and victory effect. Each non-default
item references an existing achievement; the Hangar only enables an item after
that achievement is recorded. Equipped values are copied into the run state at
deployment so they affect ship tint, exhaust particles, thrust glow, and
Dreadnought defeat bursts without changing combat balance.

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
four readable combat profiles: Hunter, Siege, Breach, and Meltdown. The phase
thresholds are 70%, 40%, and 15%, which front-loads the more dangerous patterns
instead of leaving most of the fight in the same opening phase. The separate
`bossEncounterProfile()` scales later Mk encounters: hull, damage resistance,
projectile speed, attack cadence, movement, reinforcement count, and
counter-window length all move against the pilot over time. A run-local rage
value compounds with attack cycles and failed relay objectives, tightening the
same fight without making the player absorb unavoidable damage. `BOSS_VARIANTS`
changes the attack doctrine between Ravager, Warden, Harrier, Swarmcore, and
Annihilator encounters, so a later boss is not just the wave-5 boss with a
larger health bar.

The boss telegraphs each attack through `telegraphT` before emitting projectiles,
pauses briefly during `phaseTransitionT`, and exposes its core through `coreOpenT`
after an attack. Periodically, `spawnBossRelays()` adds orbiting reactor nodes
with a visible countdown. Breaking the complete relay network calls
`bossRelayBreak()`, clears hostile bullets, and grants a staggered counterfire
window. Letting the timer expire calls `bossRelayFailure()`, which queues a
telegraphed overload volley, adds escorts, and increases rage. `damageBoss()`
keeps the body damageable while shielded, increases damage during exposed and
staggered windows, and makes phase changes fair by temporarily ignoring hits
and clearing the previous bullet pattern.

Daily mode is selected from the title screen. `dailyChallengeForDate()` derives
one UTC date key, a deterministic seed, and one rotating modifier from that key.
Gameplay-affecting randomness uses the challenge's local linear-congruential
stream, while presentation particles and audio retain their normal visual
randomness. This makes the combat sequence reproducible for the same daily seed
without making the renderer visually repetitive. Daily runs keep a local best
score and expose a share/copy result string; there is intentionally no remote
leaderboard or account requirement.

The game-over flow records a `lastRun` summary and renders survival time,
accuracy, damage dealt, elite kills, boss kills, and temporary systems chosen.
The profile add-on folds those fields into local records and aggregate pilot
statistics without making the core game depend on the add-on.

Persistent values are intentionally local to the browser:

| Key | Purpose |
| --- | --- |
| `ionstorm.hi` | best score |
| `ionstorm.meta` | selected ship, scrap, upgrades, and achievements |
| `ionstorm.settings` | audio, visual-intensity, quality, and input-response preferences |
| `ionstorm.profile` | pilot callsign and local profile identity |
| `ionstorm.board` | the local top-ten records list |
| `ionstorm.stats` | aggregate pilot statistics |
| `ionstorm.daily` | local best daily scores keyed by UTC date |

Cosmetic selections are stored inside `ionstorm.meta.cosmetics`; no remote
account or asset download is required.

The local records list is not a server leaderboard and is not tamper-proof. No account or backend is required to play.

## Offline shell

`sw.js` precaches the root HTML, JavaScript, CSS, manifest, icon, and social
preview. Same-origin GET requests use a cache-first strategy, while failed
navigation requests fall back to the cached `index.html`. Progression remains
in browser `localStorage`, so installed/offline play preserves the same local
pilot profile on that device. Google Fonts are an optional remote enhancement;
the system font stack keeps the game usable when they are unavailable.

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
