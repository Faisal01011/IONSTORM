'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const GAME_SOURCE = fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8');
const PROFILE_SOURCE = fs.readFileSync(path.join(ROOT, 'profile.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

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

test('keyboard navigation cannot accidentally launch or activate menu actions', () => {
  assert.match(GAME_SOURCE, /k === 'tab'/);
  assert.match(GAME_SOURCE, /interactiveTarget && \(k === 'enter' \|\| k === ' '\)/);
  assert.match(GAME_SOURCE, /if \(k === 'enter' \|\| k === ' '\) \{\s*resetRun\(\)/);
});

test('hidden overlays and HUD controls use inert focus management', () => {
  for (const id of ['hud', 'surge', 'ovHangar', 'ovPause', 'ovOver', 'ovFatal']) {
    assert.match(HTML, new RegExp(`id="${id}"[^>]*\\binert\\b`), `missing inert state: ${id}`);
  }

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
