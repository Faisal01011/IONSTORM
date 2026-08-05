'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const GAME_SOURCE = fs.readFileSync(path.join(ROOT, 'src', 'game.js'), 'utf8');
const BOOT_START = GAME_SOURCE.lastIndexOf('(async () => {');

assert.notEqual(BOOT_START, -1, 'game boot entry point must remain discoverable');

class ClassList {
  constructor() {
    this.values = new Set();
  }

  add(...names) {
    names.forEach(name => this.values.add(name));
  }

  remove(...names) {
    names.forEach(name => this.values.delete(name));
  }

  contains(name) {
    return this.values.has(name);
  }

  toggle(name, force) {
    const enabled = force === undefined ? !this.values.has(name) : !!force;

    if (enabled) this.values.add(name);
    else this.values.delete(name);

    return enabled;
  }
}

function makeElement(id = '') {
  const attributes = new Map();
  const children = [];
  let firstElementChild;

  return {
    id,
    attributes,
    children,
    classList: new ClassList(),
    style: {},
    className: '',
    textContent: '',
    innerHTML: '',
    clientWidth: 1200,
    clientHeight: 630,
    width: 0,
    height: 0,
    contexts: {},

    get firstElementChild() {
      firstElementChild ||= makeElement();
      return firstElementChild;
    },

    get offsetWidth() {
      return 0;
    },

    appendChild(child) {
      children.push(child);
      return child;
    },

    addEventListener() {},
    blur() {},
    focus() {},
    remove() {},

    getContext(kind) {
      return this.contexts[kind] || null;
    },

    querySelector() {
      return makeElement();
    },

    setAttribute(name, value) {
      attributes.set(name, String(value));
    }
  };
}

function makeHarness() {
  const elements = new Map();
  const storage = new Map();

  const document = {
    hidden: false,
    activeElement: null,

    addEventListener() {},

    createElement() {
      return makeElement();
    },

    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement(id));
      return elements.get(id);
    }
  };

  const context = {
    console,
    document,
    navigator: {},
    devicePixelRatio: 1,
    addEventListener() {},
    requestAnimationFrame() {},
    confirm: () => true,
    location: { reload() {} },
    localStorage: {
      getItem(key) {
        return storage.has(key) ? storage.get(key) : null;
      },
      setItem(key, value) {
        storage.set(key, String(value));
      }
    },
    setTimeout(callback) {
      callback();
      return 0;
    },
    clearTimeout() {}
  };

  context.window = context;
  context.self = context;
  context.globalThis = context;

  vm.createContext(context);

  const instrumentedSource = GAME_SOURCE.slice(0, BOOT_START) + `
    globalThis.__ionstormTest = {
      G,
      META,
      SETTINGS,
      SHIPS,
      DAILY_MODIFIERS,
      RUN_UPGRADES,
      ELITE_TYPES,
      WAVE_EVENTS,
      BOSS_PHASES,
      BOSS_VARIANTS,
      COSMETICS,
      POWERUP_TYPES,
      POWERUP_DURATION,
      TIME_SLOW_DURATION,
      equippedCosmetics,
      equipCosmetic,
      playVictoryEffect,
      AU,
      COMPUTE_WGSL,
      PART_WGSL,
      initGPU,
      resetRun,
      gameOver,
      dailyChallengeForDate,
      dailyBestFor,
      formatRunTime,
      runAccuracy,
      runRandom,
      shareRunScore,
      resize,
      hud,
      startWave,
      waveProfile,
      waveEvent,
      bossPhaseProfile,
      bossPhaseForHealth,
      bossVariantForTier,
      bossEncounterProfile,
      bossCombatProfile,
      spawnBoss,
      updateBoss,
      spawnBossRelays,
      damageBossRelay,
      bossRelayDestroyed,
      bossRelayBreak,
      bossRelayFailure,
      updateBossRelays,
      damageBoss,
      eliteChance,
      applyEliteModifier,
      eliteSpeedScale,
      damageEnemy,
      spawnSplitterDrones,
      nextRunLevelXp,
      awardRunXp,
      chooseRunUpgrade,
      applyRunUpgrade,
      enemyIsTargetable,
      nearestEnemy,
      updateWorld,
      updatePlayer,
      update,
      buildScene,
      pointer,
      keys,
      toggleSetting,
      setInputResponse,
      getQuality: () => quality,
      setQuality: value => { quality = value; }
    };
  `;

  vm.runInContext(instrumentedSource, context, { filename: 'game.js' });

  return {
    api: context.__ionstormTest,
    context,
    elements,
    view: document.getElementById('view')
  };
}

test('ship fire stats translate to the advertised cooldown order', () => {
  const { api } = makeHarness();
  const cooldowns = {};

  Object.assign(api.META.upgrades, {
    hull: 0,
    rapid: 0,
    surge: 0,
    shield: 0,
    seeker: 0,
    magnet: 0,
    speed: 0
  });

  for (const ship of Object.keys(api.SHIPS)) {
    api.META.ship = ship;
    api.resetRun();
    cooldowns[ship] = 0.135 * api.G.player.rateMult;
  }

  assert.ok(cooldowns.interceptor < cooldowns.vanguard);
  assert.ok(cooldowns.vanguard < cooldowns.bastion);
  assert.ok(Math.abs(cooldowns.interceptor - 0.108) < 1e-12);
  assert.ok(Math.abs(cooldowns.bastion - 0.16875) < 1e-12);
});

test('wave threat continues to rise after the early run', () => {
  const { api } = makeHarness();
  const early = api.waveProfile(1);
  const mid = api.waveProfile(10);
  const late = api.waveProfile(25);

  assert.ok(mid.count > early.count);
  assert.ok(late.count > mid.count);
  assert.ok(mid.speed > early.speed);
  assert.ok(late.speed > mid.speed);
  assert.ok(mid.droneHp > early.droneHp);
  assert.ok(late.strikerHp > mid.strikerHp);
  assert.ok(late.fireFloor < early.fireFloor);
  assert.ok(late.count <= 58);
});

test('special wave events rotate without replacing boss waves', () => {
  const { api } = makeHarness();

  assert.equal(api.waveEvent(2), null);
  assert.equal(api.waveEvent(3).id, 'eliteHunt');
  assert.equal(api.waveEvent(4).id, 'asteroidStorm');
  assert.equal(api.waveEvent(7).id, 'salvageRun');
  assert.equal(api.waveEvent(10), null);
  assert.ok(api.eliteChance(3, 'eliteHunt') > api.eliteChance(3, 'standard'));
  assert.equal(api.WAVE_EVENTS.asteroidStorm.asteroidBias > 0, true);
});

test('event HUD follows the active event and hides for standard and boss waves', () => {
  const { api, elements } = makeHarness();

  api.resize();
  api.resetRun();

  api.startWave(3);
  api.hud(0.016);

  assert.equal(elements.get('eventName').textContent, 'ELITE HUNT');
  assert.equal(elements.get('eventHud').classList.contains('hidden'), false);
  assert.equal(elements.get('eventHud').classList.contains('eliteEvent'), true);

  api.startWave(5);
  api.hud(0.016);

  assert.equal(elements.get('eventHud').classList.contains('hidden'), true);
});

test('Dreadnoughts expose four distinct escalating phase profiles', () => {
  const { api } = makeHarness();

  assert.equal(api.bossPhaseForHealth(0.9), 1);
  assert.equal(api.bossPhaseForHealth(0.7), 2);
  assert.equal(api.bossPhaseForHealth(0.4), 3);
  assert.equal(api.bossPhaseForHealth(0.15), 4);
  assert.equal(api.bossPhaseProfile(1).name, 'HUNTER');
  assert.equal(api.bossPhaseProfile(2).attack, 'SPIRAL LANCE');
  assert.equal(api.bossPhaseProfile(4).name, 'MELTDOWN');
  assert.ok(api.BOSS_PHASES[4].cooldown < api.BOSS_PHASES[1].cooldown);
  assert.ok(api.BOSS_PHASES[4].move > api.BOSS_PHASES[1].move);
});

test('later Dreadnought encounters escalate without repeating the wave 5 boss', () => {
  const { api } = makeHarness();
  const first = api.bossEncounterProfile(1);
  const middle = api.bossEncounterProfile(3);
  const late = api.bossEncounterProfile(5);

  assert.equal(api.bossVariantForTier(1).id, 'ravager');
  assert.equal(api.bossVariantForTier(5).id, 'annihilator');
  assert.equal(api.bossVariantForTier(99).id, 'annihilator');

  assert.ok(middle.hpMultiplier > first.hpMultiplier);
  assert.ok(late.hpMultiplier > middle.hpMultiplier);
  assert.ok(middle.damageMultiplier > first.damageMultiplier);
  assert.ok(late.damageMultiplier > middle.damageMultiplier);
  assert.ok(late.cooldownMultiplier < middle.cooldownMultiplier);
  assert.ok(late.addIntervalMultiplier < middle.addIntervalMultiplier);
  assert.ok(late.coreWindowMultiplier < middle.coreWindowMultiplier);
  assert.ok(late.addCount > middle.addCount);
  assert.ok(late.extraProjectiles > middle.extraProjectiles);

  api.resize();
  api.resetRun();
  api.G.enemies.length = 0;

  api.G.wave = 5;
  api.spawnBoss();
  const firstBoss = api.G.enemies[0];

  api.G.enemies.length = 0;
  api.G.wave = 25;
  api.spawnBoss();
  const lateBoss = api.G.enemies[0];

  assert.equal(firstBoss.tier, 1);
  assert.equal(lateBoss.tier, 5);
  assert.ok(lateBoss.maxHp > firstBoss.maxHp);
  assert.notEqual(lateBoss.variantId, firstBoss.variantId);
});

test('later boss phases combine stronger pressure with tighter counterfire windows', () => {
  const { api } = makeHarness();
  const early = api.bossCombatProfile({ tier: 5, phase: 1 });
  const final = api.bossCombatProfile({ tier: 5, phase: 4 });

  assert.ok(final.damageMultiplier > early.damageMultiplier);
  assert.ok(final.damageTakenMultiplier < early.damageTakenMultiplier);
  assert.ok(final.cooldown < early.cooldown);
  assert.ok(final.coreWindow < early.coreWindow);
});

test('boss rage makes the same phase faster, harder, and less forgiving', () => {
  const { api } = makeHarness();
  const calm = api.bossCombatProfile({ tier: 4, phase: 4, rage: 0 });
  const enraged = api.bossCombatProfile({ tier: 4, phase: 4, rage: 0.7 });

  assert.ok(enraged.cooldown < calm.cooldown);
  assert.ok(enraged.telegraph < calm.telegraph);
  assert.ok(enraged.coreWindow < calm.coreWindow);
  assert.ok(enraged.move > calm.move);
  assert.ok(enraged.damageMultiplier > calm.damageMultiplier);
  assert.ok(enraged.damageTakenMultiplier < calm.damageTakenMultiplier);
});

test('reactor relays create a break-or-overload boss decision', () => {
  const { api } = makeHarness();

  api.resize();
  api.resetRun();
  api.G.wave = 5;
  api.G.enemies.length = 0;
  api.spawnBoss();

  const boss = api.G.enemies[0];
  boss.y = 150;
  boss.entered = true;
  boss.phaseTransitionT = 0;

  assert.equal(api.spawnBossRelays(boss), true);
  assert.equal(boss.relayActive, true);
  assert.equal(api.G.bossNodes.length, 2);
  assert.equal(boss.relayRemaining, 2);
  assert.doesNotThrow(() => api.buildScene());

  const nodes = [...api.G.bossNodes];

  for (const node of nodes) {
    while (node.hp > 0) {
      api.damageBossRelay(node, 1);
    }
  }

  assert.equal(api.G.bossNodes.length, 0);
  assert.equal(boss.relayActive, false);
  assert.ok(boss.staggerT > 0);
  assert.ok(api.G.surge > 0);

  boss.staggerT = 0;
  boss.coreOpen = false;
  api.spawnBossRelays(boss);
  api.bossRelayFailure(boss);

  assert.equal(boss.relayActive, false);
  assert.equal(boss.pendingAttack, 'overload');
  assert.ok(boss.overloadCount > 0);
  assert.ok(boss.rage > 0);
  assert.ok(boss.telegraphT > 0);

  api.G.ebullets.length = 0;
  api.updateBoss(boss, boss.telegraphT + 0.02);
  assert.ok(api.G.ebullets.length > 0);
});

test('boss impact pressure is applied as a capped heavy hit', () => {
  const { api } = makeHarness();

  api.resize();
  api.resetRun();
  api.G.player.inv = 0;
  api.G.player.x = 400;
  api.G.player.y = 400;
  api.G.lives = 3;
  api.G.ebullets.push({
    x: api.G.player.x,
    y: api.G.player.y,
    vx: 0,
    vy: 0,
    r: 7,
    damage: 1.8
  });

  api.updateWorld(0);

  assert.equal(api.G.lives, 1);
});

test('boss phase shifts are protected and attacks are telegraphed before firing', () => {
  const { api } = makeHarness();

  api.resize();
  api.resetRun();
  api.G.wave = 5;
  api.G.state = 'playing';
  api.G.enemies.length = 0;
  api.spawnBoss();

  const boss = api.G.enemies[0];
  boss.y = 150;
  boss.entered = true;
  boss.hp = boss.maxHp * 0.69;
  boss.attackT = 10;

  api.updateBoss(boss, 0.016);

  assert.equal(boss.phase, 2);
  assert.ok(boss.phaseTransitionT > 0);

  const protectedHp = boss.hp;
  api.damageBoss(boss, 10);
  assert.equal(boss.hp, protectedHp);

  api.updateBoss(boss, 1.2);
  boss.attackT = 0;
  boss.telegraphT = 0;
  boss.coreOpenT = 0;
  api.G.ebullets.length = 0;

  api.updateBoss(boss, 0.016);

  assert.ok(boss.telegraphT > 0);
  assert.equal(api.G.ebullets.length, 0);

  const telegraph = boss.telegraphT;
  api.updateBoss(boss, telegraph + 0.01);

  assert.ok(api.G.ebullets.length > 0);
  assert.equal(boss.coreOpen, true);
});

test('boss HUD communicates phase, attack warning, and exposed core state', () => {
  const { api, elements } = makeHarness();

  api.resize();
  api.resetRun();
  api.G.wave = 5;
  api.G.enemies.push({
    type: 'boss',
    x: 600,
    y: 150,
    r: 105,
    hp: 180,
    maxHp: 300,
    phase: 2,
    phaseTransitionT: 0,
    telegraphT: 0.4,
    coreOpen: false,
    attackName: 'SPIRAL LANCE',
    entered: true
  });

  api.hud(0.016);

  assert.equal(elements.get('bossPhase').textContent, 'PHASE 2 · SIEGE');
  assert.equal(elements.get('bossStatus').textContent, 'INCOMING — SPIRAL LANCE');
  assert.equal(elements.get('boss').classList.contains('telegraph'), true);

  const boss = api.G.enemies[0];
  boss.telegraphT = 0;
  boss.coreOpen = true;
  api.hud(0.016);

  assert.equal(elements.get('bossStatus').textContent, 'CORE EXPOSED');
  assert.equal(elements.get('boss').classList.contains('coreOpen'), true);
});

test('elite modifiers add distinct threat and reward behavior', () => {
  const { api } = makeHarness();

  api.resize();
  api.resetRun();
  api.G.wave = 6;

  const aegis = {
    type: 'drone',
    x: 300,
    y: 100,
    r: 24,
    hp: 4,
    vy: 100,
    val: 100
  };

  api.applyEliteModifier(aegis, 'aegis');

  assert.equal(aegis.elite, true);
  assert.equal(aegis.eliteName, api.ELITE_TYPES.aegis.name);
  assert.ok(aegis.maxHp > 4);
  assert.ok(aegis.shieldHp > 0);

  const shieldBefore = aegis.shieldHp;
  api.damageEnemy(aegis, 1);
  assert.ok(aegis.shieldHp < shieldBefore);
  assert.equal(aegis.hp, aegis.maxHp);

  const berserker = {
    type: 'striker',
    x: 300,
    y: 100,
    r: 22,
    hp: 4,
    vy: 100,
    val: 100
  };

  api.applyEliteModifier(berserker, 'berserker');
  const calmSpeed = api.eliteSpeedScale(berserker);
  berserker.hp = 1;
  const enragedSpeed = api.eliteSpeedScale(berserker);

  assert.ok(enragedSpeed > calmSpeed);
});

test('splitter elites release smaller targetable drones on destruction', () => {
  const { api } = makeHarness();

  api.resize();
  api.resetRun();
  api.G.wave = 6;
  api.G.enemies.length = 0;

  api.spawnSplitterDrones({
    x: 400,
    y: 180,
    val: 600,
    splitCount: 2
  });

  assert.equal(api.G.enemies.length, 2);
  assert.ok(api.G.enemies.every(enemy => enemy.mini));
  assert.ok(api.G.enemies.every(enemy => api.enemyIsTargetable(enemy)));
  assert.ok(api.G.enemies.every(enemy => enemy.r < 24));
});

test('enemies cannot be destroyed or targeted before entering the playfield', () => {
  const { api } = makeHarness();
  const offscreen = { type: 'drone', x: 100, y: -60, r: 24 };
  const visible = { type: 'drone', x: 300, y: 30, r: 24 };
  const enteringBoss = { type: 'boss', x: 200, y: -80, r: 105, entered: false };
  const activeBoss = { type: 'boss', x: 200, y: 150, r: 105, entered: true };

  assert.equal(api.enemyIsTargetable(offscreen), false);
  assert.equal(api.enemyIsTargetable(visible), true);
  assert.equal(api.enemyIsTargetable(enteringBoss), false);
  assert.equal(api.enemyIsTargetable(activeBoss), true);

  api.G.enemies.push(offscreen, visible);
  assert.equal(api.nearestEnemy(100, -60), visible);
});

test('projectiles wait for an enemy to enter the playfield before colliding', () => {
  const { api } = makeHarness();
  const enemy = {
    type: 'drone',
    x: 300,
    y: -20,
    r: 24,
    hp: 1,
    baseX: 300,
    amp: 0,
    freq: 1,
    vy: 80,
    t: 0,
    flash: 0,
    fireT: 9999,
    val: 100
  };

  api.resize();
  api.G.state = 'playing';
  api.G.player.alive = true;
  api.G.player.x = 600;
  api.G.player.y = 520;
  api.G.enemies.push(enemy);
  api.G.bullets.push({ x: 300, y: -20, vx: 0, vy: 0, r: 6 });

  api.updateWorld(0);

  assert.equal(api.G.enemies.length, 1);
  assert.equal(api.G.enemies[0].hp, 1);
  assert.equal(api.G.bullets.length, 1);

  enemy.y = 30;
  api.G.bullets[0].y = 30;
  api.updateWorld(0);

  assert.equal(api.G.enemies.length, 0);
  assert.equal(api.G.bullets.length, 0);
});

test('temporary combat pickups include piercing, magnet, and time-slow effects', () => {
  const { api } = makeHarness();

  assert.deepEqual(Array.from(api.POWERUP_TYPES), [
    'triple',
    'rapid',
    'shield',
    'seeker',
    'piercing',
    'magnet',
    'slow'
  ]);

  const collect = type => {
    api.resize();
    api.resetRun();
    const p = api.G.player;

    api.G.powerups.push({
      x: p.x,
      y: p.y,
      type,
      t: 0,
      spark: 0
    });

    api.updateWorld(0);
  };

  collect('piercing');
  assert.equal(api.G.player.piercing, api.POWERUP_DURATION);

  collect('magnet');
  assert.equal(api.G.player.magnet, api.POWERUP_DURATION);

  collect('slow');
  assert.equal(api.G.timeSlowT, api.TIME_SLOW_DURATION);

  api.G.slowT = 0;
  api.update(0.016);
  assert.equal(api.G.timeScale, 0.45);
});

test('magnet pickup temporarily pulls salvage from beyond the normal radius', () => {
  const { api } = makeHarness();

  api.resize();
  api.resetRun();
  api.G.player.x = 400;
  api.G.player.y = 400;
  api.G.player.magnet = api.POWERUP_DURATION;

  const pickup = {
    x: 600,
    y: 400,
    type: 'shield',
    t: 0,
    spark: 0
  };

  api.G.powerups.push(pickup);
  api.updateWorld(0.1);

  assert.ok(pickup.x < 600);
  assert.equal(api.G.powerups.length, 1);
});

test('piercing bullets survive one target and cannot damage the same target twice', () => {
  const { api } = makeHarness();

  api.resize();
  api.resetRun();
  api.G.enemies.length = 0;
  api.G.bullets.length = 0;
  api.G.wave = 1;

  const enemy = offset => ({
    type: 'drone',
    x: 320 + offset,
    y: 160,
    r: 24,
    hp: 1,
    baseX: 320 + offset,
    amp: 0,
    freq: 1,
    vy: 0,
    t: 0,
    flash: 0,
    fireT: 9999,
    val: 100
  });

  api.G.enemies.push(enemy(0), enemy(0));
  api.G.bullets.push({
    x: 320,
    y: 160,
    vx: 0,
    vy: 0,
    r: 6,
    piercing: true,
    hitTargets: new Set()
  });

  api.updateWorld(0);
  assert.equal(api.G.enemies.length, 1);
  assert.equal(api.G.bullets.length, 1);

  api.updateWorld(0);
  assert.equal(api.G.enemies.length, 0);
  assert.equal(api.G.bullets.length, 1);
});

test('daily challenges are stable by UTC date and seed gameplay randomness', () => {
  const { api } = makeHarness();
  const first = api.dailyChallengeForDate('2026-08-05');
  const second = api.dailyChallengeForDate('2026-08-05');
  const otherDay = api.dailyChallengeForDate('2026-08-06');

  assert.deepEqual(first, second);
  assert.notEqual(first.seed, otherDay.seed);
  assert.ok(api.DAILY_MODIFIERS.some(modifier => modifier.id === first.modifier.id));

  api.G.challenge = {
    ...first,
    mode: 'daily',
    rngState: first.seed
  };
  const sequence = [api.runRandom(), api.runRandom(), api.runRandom()];

  api.G.challenge.rngState = first.seed;
  assert.deepEqual(
    sequence,
    [api.runRandom(), api.runRandom(), api.runRandom()]
  );
});

test('daily deployments expose the seeded mode and persist a local daily best', () => {
  const { api, context } = makeHarness();

  api.resize();
  api.resetRun('daily');

  assert.equal(api.G.runMode, 'daily');
  assert.equal(api.G.challenge.mode, 'daily');
  assert.equal(api.G.challenge.rngState, api.G.challenge.seed);

  const date = api.G.challenge.date;
  api.G.score = 4321;
  api.G.wave = 4;
  api.gameOver();

  const saved = JSON.parse(context.localStorage.getItem('ionstorm.daily'));
  assert.equal(saved.bestByDate[date], 4321);
  assert.equal(api.dailyBestFor(date), 4321);
});

test('game over publishes a detailed run breakdown', () => {
  const { api, elements } = makeHarness();

  api.resize();
  api.resetRun('standard');
  api.G.runTime = 125.9;
  api.G.shotsFired = 20;
  api.G.shotsHit = 13;
  api.G.damageDealt = 87.4;
  api.G.eliteKills = 2;
  api.G.bossesDefeated = 1;
  api.G.systemsInstalled = 3;
  api.gameOver();

  assert.equal(elements.get('sTime').textContent, '02:05');
  assert.equal(elements.get('sAccuracy').textContent, '65%');
  assert.equal(elements.get('sDamage').textContent, '87');
  assert.equal(elements.get('sElites').textContent, '2');
  assert.equal(elements.get('sBosses').textContent, '1');
  assert.equal(elements.get('sSystems').textContent, '3');
  assert.equal(api.G.lastRun.accuracy, 65);
});

test('a tied score is not announced as a new record', () => {
  const { api, elements } = makeHarness();

  api.G.hi = 1000;
  api.resetRun();
  api.G.score = 1000;
  api.G.hi = 1000;
  api.gameOver();

  assert.equal(elements.get('newRec').classList.contains('hidden'), true);

  api.G.hi = 1000;
  api.resetRun();
  api.G.score = 1200;
  api.G.hi = 1200;
  api.gameOver();

  assert.equal(elements.get('newRec').classList.contains('hidden'), false);
});

test('low-quality mode actually scales the backing canvas', () => {
  const { api, context, view } = makeHarness();

  context.devicePixelRatio = 2;
  view.clientWidth = 1000;
  view.clientHeight = 600;

  api.setQuality(0.66);
  api.resize();

  assert.ok(Math.abs(api.G.dpr - 0.99) < 1e-12);
  assert.equal(view.width, 990);
  assert.equal(view.height, 594);

  api.toggleSetting('lowQuality');
  assert.equal(api.SETTINGS.lowQuality, true);
  assert.equal(api.getQuality(), 0.66);
});

test('input response is clamped, persisted, and speeds both control paths', () => {
  const { api, context } = makeHarness();

  api.resize();
  api.G.time = 1;
  api.G.player.alive = true;
  api.G.player.x = 300;
  api.G.player.y = 500;
  api.pointer.x = 700;
  api.pointer.y = 500;
  api.pointer.lastMove = 1;
  api.pointer.isTouch = true;

  api.setInputResponse(75);
  api.updatePlayer(0.016);
  const slowTouchVelocity = api.G.player.vx;

  api.G.player.x = 300;
  api.G.player.vx = 0;
  api.setInputResponse(175);
  api.updatePlayer(0.016);
  const fastTouchVelocity = api.G.player.vx;

  assert.ok(fastTouchVelocity > slowTouchVelocity);
  assert.equal(api.SETTINGS.inputResponse, 1.75);
  assert.equal(
    JSON.parse(context.localStorage.getItem('ionstorm.settings')).inputResponse,
    1.75
  );

  api.pointer.lastMove = -9;
  api.pointer.isTouch = false;
  api.keys.add('d');
  api.G.player.vx = 0;
  api.setInputResponse(75);
  api.updatePlayer(0.016);
  const slowKeyboardVelocity = api.G.player.vx;

  api.G.player.vx = 0;
  api.setInputResponse(175);
  api.updatePlayer(0.016);
  const fastKeyboardVelocity = api.G.player.vx;

  assert.ok(fastKeyboardVelocity > slowKeyboardVelocity);

  api.setInputResponse(999);
  assert.equal(api.SETTINGS.inputResponse, 1.75);

  api.setInputResponse(0);
  assert.equal(api.SETTINGS.inputResponse, 0.75);
});

test('run XP pauses the mission and presents three unique upgrade choices', () => {
  const { api, elements } = makeHarness();

  api.resize();
  api.resetRun();
  api.G.runXp = api.G.runXpNext - 10;

  api.awardRunXp(20);

  assert.equal(api.G.runLevel, 2);
  assert.equal(api.G.state, 'upgrade');
  assert.equal(api.G.upgradeQueue, 1);
  assert.equal(api.G.upgradeChoices.length, 3);
  assert.equal(new Set(api.G.upgradeChoices).size, 3);
  assert.equal(elements.get('ovUpgrade').classList.contains('on'), true);
  assert.equal(elements.get('upgradeCards').children.length, 3);
});

test('selecting an in-run upgrade applies it and resumes the mission', () => {
  const { api, elements } = makeHarness();

  api.resize();
  api.resetRun();
  api.G.state = 'upgrade';
  api.G.upgradeQueue = 1;
  api.G.upgradeChoices = ['overclock'];
  api.G.player.rateMult = 1;

  assert.equal(api.chooseRunUpgrade('overclock'), true);
  assert.equal(api.G.state, 'playing');
  assert.equal(api.G.upgradeQueue, 0);
  assert.equal(api.G.runUpgrades.overclock, 1);
  assert.equal(api.G.player.rateMult, 0.86);
  assert.equal(elements.get('ovUpgrade').classList.contains('on'), false);
});

test('temporary run upgrades reset on the next deployment', () => {
  const { api } = makeHarness();

  api.resize();
  api.resetRun();
  api.G.state = 'upgrade';
  api.G.upgradeQueue = 1;
  api.G.upgradeChoices = ['surgeCore'];

  api.chooseRunUpgrade('surgeCore');

  assert.equal(api.G.surgeDuration, 6.25);
  assert.equal(api.G.runUpgrades.surgeCore, 1);

  api.resetRun();

  assert.equal(api.G.runLevel, 1);
  assert.equal(api.G.runXp, 0);
  assert.equal(api.G.surgeDuration, 5);
  assert.equal(Object.keys(api.G.runUpgrades).length, 0);
});

test('cosmetics are grouped, achievement-gated, and persisted when equipped', () => {
  const { api, context } = makeHarness();
  const categories = Object.keys(api.COSMETICS);

  assert.deepEqual(categories, ['colors', 'trails', 'engines', 'victories']);
  assert.equal(api.equippedCosmetics().color.id, 'ship');
  assert.equal(api.equipCosmetic('colors', 'crimson'), false);

  api.META.achievements.firstKill = true;
  assert.equal(api.equipCosmetic('colors', 'crimson'), true);
  assert.equal(api.equippedCosmetics().color.id, 'crimson');

  const saved = JSON.parse(context.localStorage.getItem('ionstorm.meta'));
  assert.equal(saved.cosmetics.colors, 'crimson');
  assert.ok(api.COSMETICS.trails.some(item => item.requires === 'bossKill'));
});

test('selected cosmetics feed the run visual state and victory effects', () => {
  const { api } = makeHarness();
  api.META.achievements.firstKill = true;
  api.META.achievements.bossKill = true;
  api.equipCosmetic('colors', 'crimson');
  api.equipCosmetic('trails', 'nova');
  api.equipCosmetic('engines', 'nova');
  api.equipCosmetic('victories', 'dread');
  api.resetRun('standard');

  assert.deepEqual(Array.from(api.G.shipTint), [1, .42, .32]);
  assert.equal(api.G.trailStyle, 'nova');
  assert.equal(api.G.engineStyle, 'nova');
  assert.equal(api.G.victoryStyle, 'dread');
  assert.doesNotThrow(() => api.playVictoryEffect(100, 100));
});

test('cosmetic visuals remain safe in the live simulation and scene builder', () => {
  const { api } = makeHarness();

  api.resize();
  api.resetRun();

  assert.doesNotThrow(() => api.update(0.016));
  assert.doesNotThrow(() => api.buildScene());
});

test('unmuting resynchronizes procedural music instead of catching up', () => {
  const { api } = makeHarness();

  api.AU.ctx = { currentTime: 42 };
  api.AU.out = { gain: { value: 0 } };
  api.AU.muted = true;
  api.SETTINGS.muted = true;
  api.AU.musicT = 1;

  api.AU.toggle();

  assert.equal(api.AU.muted, false);
  assert.equal(api.AU.musicT, 42.1);
});

test('WebGPU initializes a sampled atlas texture before claiming the canvas', async () => {
  const { api, context, view } = makeHarness();
  const calls = [];

  const atlasTexture = {
    createView() {
      calls.push('createView');
      return {};
    }
  };

  const device = {
    lost: new Promise(() => {}),
    queue: {
      copyExternalImageToTexture(source, destination, size) {
        calls.push('copyExternalImageToTexture');
        assert.equal(source.source.width, 2048);
        assert.equal(destination.texture, atlasTexture);
        assert.equal(size.width, 2048);
      }
    },
    createTexture(descriptor) {
      calls.push('createTexture');
      assert.equal(descriptor.format, 'rgba8unorm');
      return atlasTexture;
    },
    createBuffer() { return {}; },
    createSampler() { return {}; },
    createBindGroupLayout() { return {}; },
    createBindGroup() { return {}; },
    createShaderModule() { return {}; },
    createPipelineLayout() { return {}; },
    createRenderPipeline() {
      calls.push('createRenderPipeline');
      return {};
    },
    createComputePipeline() {
      calls.push('createComputePipeline');
      return {};
    }
  };

  const canvasContext = {
    configure() {
      calls.push('configure');
    }
  };

  view.getContext = kind => {
    calls.push(`getContext:${kind}`);
    return kind === 'webgpu' ? canvasContext : null;
  };

  context.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2, STORAGE: 4 };
  context.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
  context.GPUTextureUsage = { TEXTURE_BINDING: 1, COPY_DST: 2 };
  context.GPUColorWrite = { ALL: 15 };
  context.navigator.gpu = {
    getPreferredCanvasFormat: () => 'bgra8unorm',
    requestAdapter: async () => ({
      info: { vendor: 'Test GPU' },
      requestDevice: async () => device
    })
  };

  const info = await api.initGPU({ width: 2048, height: 2048 });

  assert.equal(info, 'Test GPU');
  assert.ok(calls.includes('createTexture'));
  assert.ok(calls.includes('copyExternalImageToTexture'));
  assert.ok(
    calls.indexOf('createComputePipeline') < calls.indexOf('getContext:webgpu'),
    'the fallback canvas must remain unclaimed until setup succeeds'
  );
  assert.ok(calls.indexOf('getContext:webgpu') < calls.indexOf('configure'));
});

test('GPU shaders share the JavaScript particle capacity and field layout', () => {
  const { api } = makeHarness();

  assert.match(api.COMPUTE_WGSL, /const MAXP = 16384u;/);
  assert.match(api.PART_WGSL, /var size = p\.lm\.z/);
  assert.match(api.PART_WGSL, /p\.cs\.rgb \* p\.cs\.w/);
});
