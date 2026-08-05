'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const GAME_SOURCE = fs.readFileSync(path.join(ROOT, 'src', 'game.js'), 'utf8');
const PROFILE_SOURCE = fs.readFileSync(path.join(ROOT, 'src', 'profile.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'src', 'styles.css'), 'utf8');

test('all local HTML asset references exist', () => {
  const references = [
    ...HTML.matchAll(/\b(?:src|href)="([^"]+)"/g),
    ...HTML.matchAll(/<meta[^>]+(?:property|name)="(?:og:image|twitter:image)"[^>]+content="([^"]+)"/g)
  ].map(match => match[1]);

  for (const reference of references) {
    if (reference.startsWith('data:')) continue;

    const url = new URL(reference, 'https://ionstorm.vercel.app/');
    if (url.origin !== 'https://ionstorm.vercel.app') continue;

    const localPath = path.join(ROOT, decodeURIComponent(url.pathname));
    assert.equal(fs.existsSync(localPath), true, `missing local asset: ${url.pathname}`);
  }
});

test('every button declares its non-submit behavior', () => {
  const buttons = HTML.match(/<button\b[^>]*>/g) || [];

  assert.ok(buttons.length > 0);

  for (const button of buttons) {
    assert.match(button, /\btype="button"/, `button is missing type="button": ${button}`);
  }
});

test('mobile overlays provide touch actions without requiring a keyboard', () => {
  for (const id of [
    'startPrompt',
    'resumeBtn',
    'pauseSoundBtn',
    'pauseRestartBtn',
    'relaunchBtn',
    'overHangarBtn',
    'surge'
  ]) {
    assert.match(HTML, new RegExp(`id="${id}"`), `missing mobile action: ${id}`);
  }

  assert.match(GAME_SOURCE, /isTouchDoubleTap/);
  assert.match(GAME_SOURCE, /G\.state === 'playing' && isTouchDoubleTap/);
  assert.match(GAME_SOURCE, /\$\('surge'\)\.addEventListener\('click'/);
});

test('responsive rules cover phone safe areas and short landscape screens', () => {
  assert.match(CSS, /env\(safe-area-inset-top\)/);
  assert.match(CSS, /@media \(max-width: 720px\), \(max-height: 560px\) and \(pointer: coarse\)/);
  assert.match(CSS, /@media \(max-height: 560px\) and \(min-width: 600px\) and \(pointer: coarse\)/);
  assert.match(CSS, /min-height: 48px/);
});

test('input response control covers touch and keyboard steering', () => {
  assert.match(HTML, /id="settingResponseRange"/);
  assert.match(HTML, /min="75"\s+max="175"\s+step="5"/);
  assert.match(GAME_SOURCE, /inputResponse/);
  assert.match(GAME_SOURCE, /pointer\.isTouch/);
  assert.match(GAME_SOURCE, /setInputResponse\(responseRange\.value/);
  assert.match(GAME_SOURCE, /p\.vx \+= ax \* 2400 \* dt \* speedMult \* inputResponse/);
  assert.match(GAME_SOURCE, /rangeTarget && \['arrowup', 'arrowdown', 'arrowleft', 'arrowright'\]/);
});

test('in-run progression exposes an accessible upgrade choice flow', () => {
  assert.match(HTML, /id="ovUpgrade"[\s\S]*?aria-labelledby="upgradeTitle"[\s\S]*?inert/);
  assert.match(HTML, /id="upgradeCards"/);
  assert.match(HTML, /id="levelHud"/);
  assert.match(GAME_SOURCE, /function awardRunXp\(amount\)/);
  assert.match(GAME_SOURCE, /function chooseRunUpgrade\(id\)/);
  assert.match(GAME_SOURCE, /G\.state = 'upgrade'/);
  assert.match(GAME_SOURCE, /choices\.length < Math\.min\(3, ids\.length\)/);
});

test('Dreadnought encounters expose readable multi-phase combat states', () => {
  assert.match(HTML, /id="bossStatus"/);
  assert.match(HTML, /id="bossAttack"/);
  assert.match(GAME_SOURCE, /const BOSS_PHASES =/);
  assert.match(GAME_SOURCE, /function bossPhaseForHealth\(fraction\)/);
  assert.match(GAME_SOURCE, /function beginBossAttack\(e\)/);
  assert.match(GAME_SOURCE, /function damageBoss\(e, amount\)/);
  assert.match(GAME_SOURCE, /phaseTransitionT/);
  assert.match(GAME_SOURCE, /CORE EXPOSED/);
  assert.match(CSS, /#boss\.coreOpen/);
  assert.match(CSS, /#boss\.telegraph/);
  assert.match(CSS, /#boss\.phaseShift/);
});

test('keyboard navigation cannot accidentally launch or activate menu actions', () => {
  assert.match(GAME_SOURCE, /k === 'tab'/);
  assert.match(GAME_SOURCE, /interactiveTarget && \(k === 'enter' \|\| k === ' '\)/);
  assert.match(GAME_SOURCE, /if \(k === 'enter' \|\| k === ' '\) \{\s*resetRun\(\)/);
});

test('hidden overlays and HUD controls use inert focus management', () => {
  for (const id of ['hud', 'levelHud', 'eventHud', 'surge', 'ovHangar', 'ovUpgrade', 'ovPause', 'ovOver', 'ovFatal']) {
    assert.match(HTML, new RegExp(`id="${id}"[^>]*\\binert\\b`), `missing inert state: ${id}`);
  }

  assert.match(HTML, /id="eventHud"[^>]*\binert\b/);
  assert.match(GAME_SOURCE, /function waveEvent\(n = G\.wave\)/);
  assert.match(GAME_SOURCE, /function applyEliteModifier\(e, kind = pickEliteKind\(\)\)/);
  assert.match(GAME_SOURCE, /SPLITTER CORE RELEASED/);
  assert.match(CSS, /#eventHud/);

  assert.match(GAME_SOURCE, /el\.inert = !on/);
  assert.doesNotMatch(HTML, /aria-hidden="true"[^>]*>\s*<button/);
});

test('record deletion uses the themed confirmation dialog', () => {
  assert.match(PROFILE_SOURCE, /clearRecordsDialog\.showModal\(\)/);
  assert.match(PROFILE_SOURCE, /id="clearRecordsConfirmBtn"/);
  assert.doesNotMatch(PROFILE_SOURCE, /\bconfirm\s*\(/);
});

test('the social preview metadata describes the generated image', () => {
  assert.match(HTML, /property="og:image" content="https:\/\/ionstorm\.vercel\.app\/og-image\.png"/);
  assert.match(HTML, /property="og:image:width" content="1200"/);
  assert.match(HTML, /property="og:image:height" content="630"/);

  const image = fs.readFileSync(path.join(ROOT, 'og-image.png'));
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  assert.deepEqual(image.subarray(0, 8), pngSignature);
});

test('repository metadata and source boundaries are production-ready', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')
  );

  assert.equal(packageJson.license, 'MIT');
  assert.equal(packageJson.repository.url, 'git+https://github.com/Faisal01011/IONSTORM.git');
  assert.equal(packageJson.homepage, 'https://ionstorm.vercel.app');

  for (const file of [
    'LICENSE',
    'CONTRIBUTING.md',
    'SECURITY.md',
    'docs/architecture.md',
    '.github/workflows/quality.yml',
    'src/game.js',
    'src/profile.js',
    'src/styles.css'
  ]) {
    assert.equal(fs.existsSync(path.join(ROOT, file)), true, `missing project file: ${file}`);
  }

  assert.match(HTML, /src\/styles\.css/);
  assert.match(HTML, /src\/game\.js/);
  assert.match(HTML, /src\/profile\.js/);
});
