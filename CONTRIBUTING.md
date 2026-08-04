# Contributing to IONSTORM

Thanks for helping improve IONSTORM. The project is intentionally dependency-light: it is a static browser game with a small Node-based validation harness.

## Development setup

Requirements:

- Node.js 20 or newer
- A modern browser with WebGPU or WebGL2 support
- Python 3, or another local static HTTP server

```bash
npm ci
npm run check
npm run serve
```

Open [http://localhost:4173](http://localhost:4173) after starting the server. Serving the project over HTTP keeps browser graphics and asset behavior consistent with deployment.

## Project boundaries

- `index.html` is the deployment entry point and contains the game shell.
- `src/game.js` owns rendering, simulation, input, audio, combat, and core progression.
- `src/profile.js` is the optional profile, records, and statistics add-on loaded after the game core.
- `src/styles.css` contains the visual system and responsive presentation rules.
- `tests/` contains deterministic Node tests for gameplay rules and repository contracts.
- `docs/architecture.md` explains the runtime and persistence model.

Keep the static entry point at the repository root unless the deployment configuration is changed deliberately and validated locally.

## Change workflow

1. Create a focused branch from `main`, for example `feat/daily-challenge` or `fix/touch-input`.
2. Make the smallest coherent change that solves the problem.
3. Add or update a regression test when behavior changes.
4. Run `npm run check` before committing.
5. Test the game in a desktop browser and, when the change affects layout or input, a narrow portrait viewport as well.
6. Open a pull request using the repository template and describe the user impact.

## Quality expectations

- Preserve the WebGPU path and WebGL2 fallback unless a change explicitly targets rendering.
- Keep the game playable with keyboard, pointer, and touch input where those paths are supported.
- Respect reduced-motion, reduced-flash, contrast, and low-quality settings.
- Avoid introducing a runtime dependency or remote asset without documenting the reason.
- Do not commit credentials, local save data, generated build output, or editor state.

## Commit and pull request guidance

Use short, imperative commit messages such as `Add seeded daily challenge`. Pull requests should explain:

- what changed and why;
- how the change was tested;
- any browser, device, or performance considerations; and
- screenshots or a short recording for visible UI changes.
