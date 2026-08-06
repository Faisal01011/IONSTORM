'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const ACCOUNT_SOURCE = fs.readFileSync(path.join(ROOT, 'src', 'account.js'), 'utf8');

function fakeElement() {
  return {
    classList: { toggle() {}, add() {}, remove() {} },
    style: {},
    setAttribute() {},
    addEventListener() {},
    appendChild() {},
    focus() {},
    textContent: '',
    className: '',
    disabled: false,
    innerHTML: '',
    inert: false
  };
}

function loadAccount() {
  const storage = new Map();
  const context = {
    console,
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key)
    },
    setTimeout: callback => {
      callback();
      return 1;
    },
    clearTimeout() {},
    CustomEvent: class CustomEvent {
      constructor(type, init) {
        this.type = type;
        this.detail = init?.detail;
      }
    },
    document: {
      readyState: 'complete',
      body: { appendChild() {} },
      head: { appendChild() {} },
      createElement: () => fakeElement(),
      getElementById: () => fakeElement(),
      querySelector: () => null,
      addEventListener() {}
    },
    addEventListener() {},
    dispatchEvent() {},
    location: { href: 'http://localhost:4173/' }
  };

  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(ACCOUNT_SOURCE, context, { filename: 'account.js' });
  return context.ionstormAccount;
}

test('account layer keeps the strongest local and cloud progression', () => {
  const account = loadAccount();
  const merged = account.mergeSnapshots({
    savedAt: 1,
    game: {
      highScore: 10,
      meta: {
        scrap: 5,
        achievements: { firstKill: true },
        upgrades: { hull: 1 },
        cosmetics: { colors: 'crimson' }
      },
      daily: { bestByDate: { '2026-08-06': 20 } }
    },
    profile: { profile: { callsign: 'LOCAL' }, board: [], stats: { runs: 2 } }
  }, {
    savedAt: 2,
    game: {
      highScore: 20,
      meta: {
        scrap: 3,
        achievements: { firstKill: false, combo20: true },
        upgrades: { hull: 2 },
        cosmetics: { colors: 'gold' }
      },
      daily: { bestByDate: { '2026-08-06': 30 } }
    },
    profile: { profile: { callsign: 'CLOUD' }, board: [], stats: { runs: 4 } }
  });

  assert.equal(merged.game.highScore, 20);
  assert.equal(merged.game.meta.scrap, 5);
  assert.equal(merged.game.meta.upgrades.hull, 2);
  assert.equal(merged.game.daily.bestByDate['2026-08-06'], 30);
  assert.equal(merged.game.meta.achievements.firstKill, true);
  assert.equal(merged.game.meta.achievements.combo20, true);
  assert.equal(merged.profile.stats.runs, 4);
});

test('account layer exposes guest-safe runtime without Supabase configuration', () => {
  const account = loadAccount();

  assert.equal(account.isConfigured(), false);
  assert.equal(typeof account.open, 'function');
  assert.equal(typeof account.continueAsGuest, 'function');
});
