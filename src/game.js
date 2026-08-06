'use strict';

/* =========================================================================
   IONSTORM — expanded production build
   game.js

   Part 2 / 4
   - helpers
   - constants
   - settings persistence
   - meta progression
   - ships
   - upgrades
   - achievements
   - global game state
   - procedural audio system
   ========================================================================= */

/* =========================================================================
   DOM + math helpers
   ========================================================================= */

const $ = id => document.getElementById(id);

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const rand = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;

const POWERUP_DURATION = 14;
const TIME_SLOW_DURATION = 7;
const POWERUP_TYPES = [
  'triple',
  'rapid',
  'shield',
  'seeker',
  'piercing',
  'magnet',
  'slow'
];

const DAILY_KEY = 'ionstorm.daily';

let deferredInstallPrompt = null;

function isStandaloneApp() {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function setInstallPromptVisible(visible) {
  const button = $('installPrompt');
  if (!button || isStandaloneApp()) return;
  button.classList.toggle('hidden', !visible);
  button.setAttribute('aria-hidden', String(!visible));
}

function registerOfflineShell() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {
    /* Offline play is progressive enhancement; gameplay remains available. */
  });
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  setInstallPromptVisible(true);
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  setInstallPromptVisible(false);
});

const DAILY_MODIFIERS = [
  {
    id: 'redline',
    name: 'REDLINE',
    description: 'Hostile formations arrive faster. Score multiplier +15%.',
    scoreMultiplier: 1.15,
    countMultiplier: 1.08,
    speedMultiplier: 1.1,
    spawnGapMultiplier: 0.9,
    fireMultiplier: 0.94
  },
  {
    id: 'ironVeil',
    name: 'IRON VEIL',
    description: 'Enemy hulls are reinforced. Survive the armor for +20% score.',
    scoreMultiplier: 1.2,
    hpMultiplier: 1.16,
    bossHpMultiplier: 1.2,
    bossDamageTakenMultiplier: 0.9
  },
  {
    id: 'surgeCircuit',
    name: 'SURGE CIRCUIT',
    description: 'The Veil feeds your overdrive. SURGE gain is amplified.',
    scoreMultiplier: 1.1,
    speedMultiplier: 1.04,
    spawnGapMultiplier: 0.96,
    surgeMultiplier: 1.3,
    dropBonus: 0.05
  },
  {
    id: 'salvageRush',
    name: 'SALVAGE RUSH',
    description: 'Recoverable tech floods the lanes. Pickups are more frequent.',
    scoreMultiplier: 1.08,
    countMultiplier: 0.96,
    spawnGapMultiplier: 1.04,
    dropBonus: 0.3,
    scrapMultiplier: 1.25
  }
];

function utcDayKey(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);

  if (Number.isNaN(value.getTime())) return '1970-01-01';

  return [
    value.getUTCFullYear(),
    String(value.getUTCMonth() + 1).padStart(2, '0'),
    String(value.getUTCDate()).padStart(2, '0')
  ].join('-');
}

function hashSeed(value) {
  let hash = 2166136261;

  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) || 1;
}

function dailyChallengeForDate(date = utcDayKey()) {
  const dateKey = typeof date === 'string' ? date : utcDayKey(date);
  const seed = hashSeed('IONSTORM::DAILY::' + dateKey);
  const modifier = DAILY_MODIFIERS[
    hashSeed('IONSTORM::MODIFIER::' + dateKey) % DAILY_MODIFIERS.length
  ];

  return {
    date: dateKey,
    seed,
    code: dateKey.replace(/-/g, ''),
    modifier: { ...modifier }
  };
}

function dailyModifier() {
  return typeof G !== 'undefined' && G.challenge?.mode === 'daily'
    ? G.challenge.modifier
    : null;
}

function runRandom() {
  if (typeof G !== 'undefined' && G.challenge?.mode === 'daily') {
    let state = G.challenge.rngState >>> 0;
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    G.challenge.rngState = state;
    return state / 4294967296;
  }

  return Math.random();
}

const gameRand = (a, b) => a + runRandom() * (b - a);

const boundedInt = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  const n = Number(value);
  return Number.isFinite(n) ? clamp(Math.floor(n), min, max) : min;
};

const pad7 = n => String(Math.floor(n)).padStart(7, '0');

let DAILY_HISTORY = { bestByDate: {} };

try {
  const storedDaily = JSON.parse(localStorage.getItem(DAILY_KEY) || '{}');
  const bestByDate = storedDaily && typeof storedDaily.bestByDate === 'object'
    ? storedDaily.bestByDate
    : {};

  DAILY_HISTORY.bestByDate = Object.fromEntries(
    Object.entries(bestByDate)
      .filter(([date]) => /^\d{4}-\d{2}-\d{2}$/.test(date))
      .map(([date, score]) => [date, boundedInt(score)])
  );
} catch {
  /* Storage may be unavailable. Use an empty local daily archive. */
}

function saveDailyHistory() {
  try {
    localStorage.setItem(DAILY_KEY, JSON.stringify(DAILY_HISTORY));
  } catch {
    /* Ignore storage failures. */
  }

  notifyProgressChanged('daily');
}

function dailyBestFor(date = utcDayKey()) {
  return boundedInt(DAILY_HISTORY.bestByDate[date]);
}

function saveDailyScore(challenge, score) {
  if (!challenge || challenge.mode === 'standard') return 0;

  const date = challenge.date || utcDayKey();
  const next = Math.max(dailyBestFor(date), boundedInt(score));

  DAILY_HISTORY.bestByDate[date] = next;
  saveDailyHistory();

  return next;
}

function dailyScoreMultiplier() {
  return dailyModifier()?.scoreMultiplier || 1;
}

function dailyScrapMultiplier() {
  return dailyModifier()?.scrapMultiplier || 1;
}

function runAccuracy() {
  if (!G.shotsFired) return 0;
  return Math.round(G.shotsHit / G.shotsFired * 100);
}

function runSystemsCount() {
  return Object.values(G.runUpgrades || {}).reduce((sum, count) => sum + count, 0);
}

function formatRunTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;

  return String(minutes).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
}

/* =========================================================================
   Storage keys
   ========================================================================= */

const HI_KEY = 'ionstorm.hi';
const META_KEY = 'ionstorm.meta';
const SETTINGS_KEY = 'ionstorm.settings';

function notifyProgressChanged(source = 'local') {
  if (
    typeof window === 'undefined' ||
    typeof window.dispatchEvent !== 'function' ||
    typeof CustomEvent === 'undefined'
  ) return;

  window.dispatchEvent(new CustomEvent('ionstorm:progress-changed', {
    detail: { source }
  }));
}

const INPUT_RESPONSE_MIN = 0.75;
const INPUT_RESPONSE_MAX = 1.75;
const DEFAULT_INPUT_RESPONSE = 1.25;

/* =========================================================================
   Renderer / buffer constants
   ========================================================================= */

const MAX_INST = 8192;
const MAXP = 16384;
const MAX_SPAWN = 1024;
const PCAP = 4096;

/* =========================================================================
   Backend state
   ========================================================================= */

let mode = null;
let gl = null;
let GL = null;
let bootDone = false;

/* WebGPU objects */
let device;
let ctx;
let format;

let frameBuf;
let frameF32;
let frameU32;

let instBufN;
let instBufA;
let partsBuf;
let spawnBuf;
let counterBuf;

let bgPipe;
let sprNPipe;
let sprAPipe;
let partPipe;
let spawnPipe;
let updPipe;

let frameBG;
let bgN;
let bgA;
let compBG;
let partBG;

/* Instance arrays */
let instN = new Float32Array(MAX_INST * 12);
let instC = 0;

let addN = new Float32Array(MAX_INST * 12);
let addC = 0;

/* GPU particle spawn buffer */
let spawnData = new Float32Array(MAX_SPAWN * 12);
let spawnC = 0;

/* WebGL2 CPU particle pool */
const pPool = new Float32Array(PCAP * 12);
let pCursor = 0;

/* =========================================================================
   Ships
   ========================================================================= */

const SHIPS = {
  vanguard: {
    name: 'VANGUARD',
    desc: 'BALANCED INTERCEPT FRAME',
    speed: 1,
    lives: 3,
    fire: 1,
    shield: 0,
    seeker: 0,
    rapid: 0,
    color: '#5ff2ff'
  },

  interceptor: {
    name: 'INTERCEPTOR',
    desc: 'HIGH SPEED · LIGHT HULL · RAPID START',
    speed: 1.35,
    lives: 2,
    fire: 1.25,
    shield: 0,
    seeker: 0,
    rapid: 1,
    color: '#ffb454'
  },

  bastion: {
    name: 'BASTION',
    desc: 'HEAVY HULL · SLOW · SHIELD START',
    speed: 0.75,
    lives: 5,
    fire: 0.8,
    shield: 1,
    seeker: 0,
    rapid: 0,
    color: '#ff5c47'
  }
};

function currentShip() {
  return SHIPS[META.ship] || SHIPS.vanguard;
}

/* =========================================================================
   Hangar upgrades
   ========================================================================= */

const UPGRADES = {
  hull: {
    name: 'HULL PLATING',
    desc: '+1 MAX HULL',
    max: 2,
    cost: lvl => 500 * (lvl + 1)
  },

  rapid: {
    name: 'RAPID COILS',
    desc: '-12% FIRE COOLDOWN',
    max: 3,
    cost: lvl => 300 * (lvl + 1)
  },

  surge: {
    name: 'SURGE CAPACITOR',
    desc: '+25% SURGE GAIN',
    max: 3,
    cost: lvl => 400 * (lvl + 1)
  },

  shield: {
    name: 'SHIELD MATRIX',
    desc: 'START WITH +1 SHIELD',
    max: 1,
    cost: () => 600
  },

  seeker: {
    name: 'SEEKER RACK',
    desc: 'START WITH SEEKER SWARM',
    max: 1,
    cost: () => 450
  },

  magnet: {
    name: 'MAGNET DRIVE',
    desc: '+40% PICKUP RADIUS',
    max: 3,
    cost: lvl => 250 * (lvl + 1)
  },

  speed: {
    name: 'OVERCLOCK',
    desc: '+10% MOVE SPEED',
    max: 2,
    cost: lvl => 400 * (lvl + 1)
  }
};

/* Temporary run upgrades. These are deliberately separate from Hangar
   upgrades: they make the current deployment stronger, then disappear when
   the pilot launches a new run. */
const RUN_UPGRADES = {
  overclock: {
    name: 'OVERCLOCK',
    category: 'WEAPON SYSTEM',
    desc: 'Cannon cooldown reduced by 14%.',
    accent: 'cyan',
    apply() {
      G.player.rateMult *= 0.86;
    }
  },

  reinforcedHull: {
    name: 'REINFORCED HULL',
    category: 'DEFENSE MATRIX',
    desc: '+1 maximum hull and repair one point.',
    accent: 'amber',
    apply() {
      G.maxLives++;
      G.lives = Math.min(G.maxLives, G.lives + 1);
      drawLives();
    }
  },

  ionMagnet: {
    name: 'ION MAGNET',
    category: 'SALVAGE SYSTEM',
    desc: 'Pickup attraction radius increased by 35%.',
    accent: 'teal',
    apply() {
      G.magnetR *= 1.35;
    }
  },

  surgeCore: {
    name: 'SURGE CORE',
    category: 'OVERDRIVE SYSTEM',
    desc: 'SURGE duration increased by 1.25 seconds.',
    accent: 'surge',
    apply() {
      G.surgeDuration += 1.25;
    }
  },

  criticalSystems: {
    name: 'CRITICAL SYSTEMS',
    category: 'TARGETING ARRAY',
    desc: '12% chance for cannons and missiles to deal double damage.',
    accent: 'red',
    apply() {
      G.critChance = Math.min(0.48, G.critChance + 0.12);
    }
  },

  comboShield: {
    name: 'COMBO SHIELD',
    category: 'COMBAT PROTOCOL',
    desc: 'The next hull hit preserves your combo multiplier.',
    accent: 'violet',
    apply() {
      G.comboGuard++;
    }
  }
};

/* Elite contacts and wave events add variety without introducing a second
   progression system. Elite modifiers are temporary run threats; event waves
   change the composition or reward profile of one wave, then clear normally. */
const ELITE_TYPES = {
  aegis: {
    name: 'AEGIS',
    desc: 'ENERGY SHIELD',
    color: [0.35, 0.95, 1],
    speed: 0.92
  },

  berserker: {
    name: 'BERSERKER',
    desc: 'RAGE DRIVE',
    color: [1, 0.45, 0.18],
    speed: 1.12
  },

  splitter: {
    name: 'SPLITTER',
    desc: 'MULTIPLYING CORE',
    color: [0.78, 0.48, 1],
    speed: 1.04
  }
};

const WAVE_EVENTS = {
  eliteHunt: {
    id: 'eliteHunt',
    name: 'ELITE HUNT',
    description: 'COMMAND FRAMES DETECTED · ELITE FREQUENCY INCREASED',
    tone: 'red',
    spawnMultiplier: 1,
    spawnGapMultiplier: 0.92,
    eliteBoost: 0.3
  },

  asteroidStorm: {
    id: 'asteroidStorm',
    name: 'ASTEROID STORM',
    description: 'DEBRIS FIELD ENTERED · WATCH THE LANES',
    tone: 'gold',
    spawnMultiplier: 1.12,
    spawnGapMultiplier: 0.82,
    asteroidBias: 0.34
  },

  salvageRun: {
    id: 'salvageRun',
    name: 'SALVAGE RUN',
    description: 'RECOVERABLE SIGNALS DETECTED · PICKUPS AMPLIFIED',
    tone: 'gold',
    spawnMultiplier: 0.86,
    spawnGapMultiplier: 1.04,
    salvageLimit: 5,
    dropBonus: 0.28
  }
};

/* Dreadnought phase profiles are the readable base kit shared by every
   encounter. The health bands are intentionally uneven: the last two phases
   arrive earlier so a pilot cannot coast through the same four attacks on
   every boss. Encounter tiers below them add pressure, faster patterns, more
   reinforcements, and a different attack doctrine while the same telegraph /
   counterfire language remains intact. */
const BOSS_PHASES = {
  1: {
    name: 'HUNTER',
    threshold: 0.7,
    attack: 'AIMED BARRAGE',
    telegraph: 0.52,
    cooldown: 1.22,
    coreWindow: 0.62,
    coreMultiplier: 1.28,
    addInterval: 7.2,
    move: 0.44
  },

  2: {
    name: 'SIEGE',
    threshold: 0.4,
    attack: 'SPIRAL LANCE',
    telegraph: 0.56,
    cooldown: 1.14,
    coreWindow: 0.58,
    coreMultiplier: 1.44,
    addInterval: 5.5,
    move: 0.56
  },

  3: {
    name: 'BREACH',
    threshold: 0.15,
    attack: 'BREACH WALL',
    telegraph: 0.46,
    cooldown: 0.94,
    coreWindow: 0.48,
    coreMultiplier: 1.58,
    addInterval: 4.1,
    move: 0.72
  },

  4: {
    name: 'MELTDOWN',
    threshold: 0,
    attack: 'CORE MELTDOWN',
    telegraph: 0.38,
    cooldown: 0.7,
    coreWindow: 0.34,
    coreMultiplier: 1.72,
    addInterval: 3.1,
    move: 0.9
  }
};

const BOSS_VARIANTS = [
  {
    id: 'ravager',
    name: 'RAVAGER',
    style: 'direct'
  },

  {
    id: 'warden',
    name: 'WARDEN',
    style: 'spiral'
  },

  {
    id: 'harrier',
    name: 'HARRIER',
    style: 'lane'
  },

  {
    id: 'swarmcore',
    name: 'SWARMCORE',
    style: 'swarm'
  },

  {
    id: 'annihilator',
    name: 'ANNIHILATOR',
    style: 'mixed'
  }
];

function bossPhaseProfile(phase = 1) {
  return BOSS_PHASES[phase] || BOSS_PHASES[1];
}

function bossVariantForTier(tier = 1) {
  const index = clamp(Math.floor(Number(tier) || 1) - 1, 0, BOSS_VARIANTS.length - 1);
  return BOSS_VARIANTS[index];
}

function bossEncounterProfile(tier = 1) {
  const encounter = Math.max(1, Math.floor(Number(tier) || 1));
  const step = encounter - 1;
  const variant = bossVariantForTier(encounter);
  const daily = dailyModifier();

  return {
    tier: encounter,
    variantId: variant.id,
    variantName: variant.name,
    style: variant.style,

    /* Hull growth is deliberately nonlinear after the second encounter. */
    hpMultiplier: (1 + step * 0.4 + Math.min(0.5, step * step * 0.02)) *
      (daily?.bossHpMultiplier || 1),
    damageMultiplier: 1 + Math.min(1.05, step * 0.16),
    damageTakenMultiplier: Math.max(0.74, 1 - step * 0.065) *
      (daily?.bossDamageTakenMultiplier || 1),
    cooldownMultiplier: Math.max(0.62, 1 - step * 0.065) *
      (daily?.bossCooldownMultiplier || 1),
    telegraphMultiplier: Math.max(0.7, 1 - step * 0.04) *
      (daily?.bossTelegraphMultiplier || 1),
    projectileSpeedMultiplier: 1 + Math.min(0.5, step * 0.07),
    moveMultiplier: 1 + Math.min(0.55, step * 0.08),
    addIntervalMultiplier: Math.max(0.5, 1 - step * 0.09),
    addCount: 1 + Math.min(3, Math.floor(step / 2)),
    coreWindowMultiplier: Math.max(0.54, 1 - step * 0.085),
    extraProjectiles: Math.min(5, Math.floor(step / 2)),
    relayCount: 2 + Math.min(2, Math.floor(step / 2)),
    relayInterval: Math.max(3.8, 6.2 - step * 0.3),
    relayDuration: Math.max(3.4, 5.2 - step * 0.22)
  };
}

function bossCombatProfile(e = {}) {
  const phaseNumber = Math.max(1, Math.floor(Number(e.phase) || 1));
  const phase = bossPhaseProfile(phaseNumber);
  const encounter = bossEncounterProfile(e.tier || 1);
  const phaseStep = phaseNumber - 1;
  const rage = clamp(Number(e.rage) || 0, 0, 0.85);

  return {
    ...phase,
    rage,
    cooldown: Math.max(
      0.36,
      phase.cooldown * encounter.cooldownMultiplier * (1 - rage * 0.18)
    ),
    telegraph: Math.max(
      0.22,
      phase.telegraph * encounter.telegraphMultiplier * (1 - rage * 0.12)
    ),
    coreWindow: Math.max(
      0.18,
      phase.coreWindow * encounter.coreWindowMultiplier * (1 - rage * 0.16)
    ),
    addInterval: Math.max(
      2.2,
      phase.addInterval * encounter.addIntervalMultiplier * (1 - rage * 0.12)
    ),
    move: phase.move * encounter.moveMultiplier * (1 + rage * 0.2),
    damageMultiplier: encounter.damageMultiplier *
      (1 + phaseStep * 0.08) * (1 + rage * 0.24),
    damageTakenMultiplier: encounter.damageTakenMultiplier *
      Math.max(0.76, 1 - phaseStep * 0.045 - rage * 0.07),
    projectileSpeedMultiplier: encounter.projectileSpeedMultiplier,
    addCount: encounter.addCount,
    extraProjectiles: encounter.extraProjectiles,
    relayCount: encounter.relayCount + Math.min(1, phaseStep > 1 ? 1 : 0),
    relayInterval: encounter.relayInterval,
    relayDuration: encounter.relayDuration,
    tier: encounter.tier,
    variantId: encounter.variantId,
    variantName: encounter.variantName,
    style: encounter.style
  };
}

function bossPhaseForHealth(fraction) {
  const hp = clamp(Number(fraction) || 0, 0, 1);

  if (hp > BOSS_PHASES[1].threshold) return 1;
  if (hp > BOSS_PHASES[2].threshold) return 2;
  if (hp > BOSS_PHASES[3].threshold) return 3;
  return 4;
}

function getUpgradeLevel(id) {
  return META.upgrades[id] || 0;
}

/* =========================================================================
   Achievements
   ========================================================================= */

const ACHIEVEMENTS = {
  firstKill: {
    name: 'FIRST BLOOD',
    desc: 'Destroy your first enemy'
  },

  combo20: {
    name: 'COMBO MASTER',
    desc: 'Reach a 20 kill combo'
  },

  surgeUsed: {
    name: 'SURGE RIDER',
    desc: 'Activate SURGE'
  },

  bossKill: {
    name: 'BOSS SLAYER',
    desc: 'Destroy a Dreadnought'
  },

  wave10: {
    name: 'DEEP SPACE',
    desc: 'Reach wave 10'
  },

  asteroid: {
    name: 'ROCK BREAKER',
    desc: 'Destroy an asteroid'
  },

  hangarBuy: {
    name: 'ENGINEER',
    desc: 'Purchase an upgrade'
  },

  hullMax: {
    name: 'JUGGERNAUT',
    desc: 'Launch with 6+ hull'
  }
};

const COSMETICS = {
  colors: [
    { id: 'ship', name: 'FRAME STANDARD', desc: 'Use the selected ship frame color', hex: '#5ff2ff', rgb: [1, .95, 1], requires: null },
    { id: 'crimson', name: 'CRIMSON VEIL', desc: 'A hot red combat finish', hex: '#ff5c47', rgb: [1, .42, .32], requires: 'firstKill' },
    { id: 'gold', name: 'SOLAR GOLD', desc: 'A bright reward for combo pilots', hex: '#ffb454', rgb: [1, .72, .34], requires: 'combo20' },
    { id: 'violet', name: 'VOID VIOLET', desc: 'A deep-space finish for survivors', hex: '#d18cff', rgb: [.82, .45, 1], requires: 'wave10' }
  ],
  trails: [
    { id: 'ion', name: 'ION TRAIL', desc: 'Balanced engine particles', hex: '#5ff2ff', palette: [[1, 1, 1], [.62, .96, 1], [.3, .85, 1]], count: 2, speed: 1, life: [.22, .45], size: [6, 10], intensity: 1, requires: null },
    { id: 'plasma', name: 'PLASMA TRAIL', desc: 'Hotter, denser exhaust', hex: '#ffb454', palette: [[1, 1, 1], [1, .72, .3], [1, .32, .16]], count: 3, speed: 1.12, life: [.28, .54], size: [7, 12], intensity: 1.12, requires: 'asteroid' },
    { id: 'prism', name: 'PRISM TRAIL', desc: 'A shifting spectral exhaust', hex: '#d18cff', palette: [[.4, 1, 1], [1, .45, .95], [1, .8, .25]], count: 3, speed: .94, life: [.26, .52], size: [6, 11], intensity: 1.08, requires: 'surgeUsed' },
    { id: 'nova', name: 'NOVA TRAIL', desc: 'A boss-slayer signature', hex: '#ffffff', palette: [[1, 1, 1], [1, .8, .34], [1, .28, .58]], count: 4, speed: 1.34, life: [.34, .68], size: [8, 14], intensity: 1.25, requires: 'bossKill' }
  ],
  engines: [
    { id: 'standard', name: 'STANDARD CORE', desc: 'Stable thrust profile', hex: '#5ff2ff', color: [.35, .95, 1], glowSize: 56, coreSize: 34, pulseAmount: .06, pulseSpeed: 40, trailPower: 1, alpha: .45, requires: null },
    { id: 'flare', name: 'FLARE CORE', desc: 'Longer, brighter exhaust', hex: '#ffb454', color: [1, .58, .2], glowSize: 70, coreSize: 44, pulseAmount: .1, pulseSpeed: 34, trailPower: 1.18, alpha: .58, requires: 'hangarBuy' },
    { id: 'pulse', name: 'PULSE CORE', desc: 'Rhythmic high-energy thrust', hex: '#d18cff', color: [.82, .35, 1], glowSize: 62, coreSize: 38, pulseAmount: .18, pulseSpeed: 12, trailPower: 1.05, alpha: .56, requires: 'combo20' },
    { id: 'nova', name: 'NOVA CORE', desc: 'Heavy overdrive signature', hex: '#ff5c47', color: [1, .24, .16], glowSize: 82, coreSize: 52, pulseAmount: .14, pulseSpeed: 22, trailPower: 1.42, alpha: .72, requires: 'bossKill' }
  ],
  victories: [
    { id: 'burst', name: 'ION BURST', desc: 'Classic end-of-battle burst', hex: '#5ff2ff', colors: [[.37, .95, 1]], requires: null },
    { id: 'fireworks', name: 'FIREWORKS', desc: 'A wide celebratory cascade', hex: '#ffb454', colors: [[1, .7, .2], [1, .3, .65], [.35, .9, 1]], requires: 'wave10' },
    { id: 'crown', name: 'CROWN FLASH', desc: 'A victory flash for the juggernaut', hex: '#ffffff', colors: [[1, 1, 1], [1, .82, .25], [.4, 1, 1]], requires: 'hullMax' },
    { id: 'dread', name: 'DREAD BREAKER', desc: 'A Dreadnought-ending signature', hex: '#ff5c47', colors: [[1, .2, .15], [1, .65, .2], [1, 1, 1]], requires: 'bossKill' }
  ]
};

function cosmeticList(category) {
  return COSMETICS[category] || [];
}

function cosmeticUnlocked(item) {
  return !item.requires || !!META.achievements[item.requires];
}

function equippedCosmetics() {
  const selected = META.cosmetics || {};
  const pick = (category, fallback) => {
    const item = cosmeticList(category).find(entry => entry.id === selected[category]);
    return item && cosmeticUnlocked(item)
      ? item
      : cosmeticList(category).find(entry => entry.id === fallback) || cosmeticList(category)[0];
  };

  return {
    color: pick('colors', 'ship'),
    trail: pick('trails', 'ion'),
    engine: pick('engines', 'standard'),
    victory: pick('victories', 'burst')
  };
}

function equipCosmetic(category, id) {
  const item = cosmeticList(category).find(entry => entry.id === id);
  if (!item || !cosmeticUnlocked(item)) return false;

  META.cosmetics[category] = id;
  saveMeta();
  return true;
}

/* =========================================================================
   Settings
   ========================================================================= */

let SETTINGS = {
  muted: false,
  reduceFlash: false,
  reduceShake: false,
  lowQuality: false,
  inputResponse: DEFAULT_INPUT_RESPONSE
};

try {
  const storedSettings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');

  for (const key of Object.keys(SETTINGS)) {
    if (typeof SETTINGS[key] === 'boolean' && typeof storedSettings[key] === 'boolean') {
      SETTINGS[key] = storedSettings[key];
    }
  }

  const storedInputResponse = Number(storedSettings.inputResponse);

  if (Number.isFinite(storedInputResponse)) {
    SETTINGS.inputResponse = clamp(
      storedInputResponse,
      INPUT_RESPONSE_MIN,
      INPUT_RESPONSE_MAX
    );
  }
} catch {
  /* Storage may be unavailable. Use defaults. */
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(SETTINGS));
  } catch {
    /* Ignore storage failures. */
  }

  notifyProgressChanged('settings');
}

/* =========================================================================
   Meta progression state
   ========================================================================= */

let META = {
  scrap: 0,
  ship: 'vanguard',
  upgrades: {
    hull: 0,
    rapid: 0,
    surge: 0,
    shield: 0,
    seeker: 0,
    magnet: 0,
    speed: 0
  },
  achievements: {},
  cosmetics: {
    colors: 'ship',
    trails: 'ion',
    engines: 'standard',
    victories: 'burst'
  }
};

try {
  const storedMeta = JSON.parse(localStorage.getItem(META_KEY) || '{}');

  META.scrap = boundedInt(storedMeta.scrap);
  META.ship = SHIPS[storedMeta.ship] ? storedMeta.ship : 'vanguard';

  for (const [id, upgrade] of Object.entries(UPGRADES)) {
    META.upgrades[id] = boundedInt(
      storedMeta.upgrades && storedMeta.upgrades[id],
      0,
      upgrade.max
    );
  }

  for (const id of Object.keys(ACHIEVEMENTS)) {
    if (storedMeta.achievements && storedMeta.achievements[id] === true) {
      META.achievements[id] = true;
    }
  }

  for (const [category, items] of Object.entries(COSMETICS)) {
    const saved = storedMeta.cosmetics && storedMeta.cosmetics[category];
    if (items.some(item => item.id === saved)) {
      META.cosmetics[category] = saved;
    }
  }
} catch {
  /* Storage may be unavailable. Use defaults. */
}

function saveMeta() {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(META));
  } catch {
    /* Ignore storage failures. */
  }

  notifyProgressChanged('meta');
}

/* The account layer consumes this narrow bridge instead of reaching into the
   renderer's private variables. Settings stay device-local by design. */
window.ionstormGame = {
  getSnapshot() {
    return {
      highScore: boundedInt(G.hi),
      meta: {
        scrap: boundedInt(META.scrap),
        ship: META.ship,
        upgrades: { ...META.upgrades },
        achievements: { ...META.achievements },
        cosmetics: { ...META.cosmetics }
      },
      daily: {
        bestByDate: { ...DAILY_HISTORY.bestByDate }
      }
    };
  },

  applySnapshot(snapshot = {}) {
    const incomingMeta = snapshot.meta && typeof snapshot.meta === 'object'
      ? snapshot.meta
      : {};
    const incomingUpgrades = incomingMeta.upgrades || {};
    const incomingAchievements = incomingMeta.achievements || {};
    const incomingCosmetics = incomingMeta.cosmetics || {};
    const incomingDaily = snapshot.daily && typeof snapshot.daily === 'object'
      ? snapshot.daily
      : {};

    META.scrap = boundedInt(incomingMeta.scrap);
    META.ship = SHIPS[incomingMeta.ship] ? incomingMeta.ship : 'vanguard';

    for (const [id, upgrade] of Object.entries(UPGRADES)) {
      META.upgrades[id] = boundedInt(incomingUpgrades[id], 0, upgrade.max);
    }

    META.achievements = {};

    for (const id of Object.keys(ACHIEVEMENTS)) {
      if (incomingAchievements[id] === true) {
        META.achievements[id] = true;
      }
    }

    META.cosmetics = {
      colors: 'ship',
      trails: 'ion',
      engines: 'standard',
      victories: 'burst'
    };

    for (const [category, items] of Object.entries(COSMETICS)) {
      if (items.some(item => item.id === incomingCosmetics[category])) {
        META.cosmetics[category] = incomingCosmetics[category];
      }
    }

    DAILY_HISTORY.bestByDate = {};

    if (incomingDaily.bestByDate && typeof incomingDaily.bestByDate === 'object') {
      for (const [date, score] of Object.entries(incomingDaily.bestByDate)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          DAILY_HISTORY.bestByDate[date] = boundedInt(score);
        }
      }
    }

    G.hi = boundedInt(snapshot.highScore);
    saveMeta();
    saveDailyHistory();
    updateTitleMeta();

    if (G.state === 'hangar') {
      renderHangar();
    }
  }
};

function addScrap(amount) {
  if (!amount || amount <= 0) return;
  META.scrap = boundedInt(META.scrap + Math.floor(amount));
  saveMeta();
}

function unlockAch(id) {
  if (!ACHIEVEMENTS[id]) return;
  if (META.achievements[id]) return;

  META.achievements[id] = true;
  saveMeta();

  if (typeof toast === 'function') {
    toast('ACHIEVEMENT — ' + ACHIEVEMENTS[id].name, 'gold');
  }
}

/* =========================================================================
   Global game state
   ========================================================================= */

const G = {
  state: 'boot',
  time: 0,
  dpr: 1,
  w: 0,
  h: 0,

  score: 0,
  hi: 0,
  runStartHi: 0,
  runMode: 'standard',
  challenge: null,
  lastRun: null,
  runTime: 0,
  shotsFired: 0,
  shotsHit: 0,
  damageDealt: 0,
  damageTaken: 0,
  eliteKills: 0,
  bossesDefeated: 0,
  systemsInstalled: 0,

  lives: 3,
  maxLives: 3,

  wave: 0,
  kills: 0,
  dropDry: 0,

  combo: 0,
  comboT: 0,
  mult: 1,
  maxCombo: 0,

  /* In-run progression */
  runLevel: 1,
  runXp: 0,
  runXpNext: 220,
  upgradeQueue: 0,
  upgradeChoices: [],
  runUpgrades: {},

  shake: 0,
  offX: 0,
  offY: 0,

  timeScale: 1,
  slowT: 0,
  timeSlowT: 0,

  waveQ: 0,
  spawnT: 0,
  waitT: 0,
  waveState: 'idle',
  eventId: 'standard',
  eventEliteSpawned: false,

  overDelay: 0,
  overReady: false,

  ambientT: 0,
  cometT: 2,

  /* SURGE */
  surge: 0,
  surgeActive: false,
  surgeT: 0,
  surgeCooldown: 0,
  surgeMult: 1,
  surgeDuration: 5,
  critChance: 0,
  comboGuard: 0,

  /* Impact feel */
  hitStop: 0,
  aberration: 0,

  /* Pickup magnet */
  magnetR: 130,

  /* Ship visuals */
  shipSprite: 1,
  engineCol: [0.35, 0.95, 1],
  enginePal: [
    [1, 1, 1],
    [0.62, 0.96, 1],
    [0.3, 0.85, 1]
  ],
  shipTint: [1, 1, 1],
  trailStyle: 'ion',
  trailProfile: null,
  engineStyle: 'standard',
  engineProfile: null,
  victoryStyle: 'burst',

  /* World objects */
  bullets: [],
  ebullets: [],
  bossNodes: [],
  enemies: [],
  powerups: [],
  rings: [],
  missiles: [],

  player: {
    x: 200,
    y: 400,
    vx: 0,
    vy: 0,
    r: 15,
    cool: 0,
    inv: 0,
    triple: 0,
    rapid: 0,
    piercing: 0,
    magnet: 0,
    shield: 0,
    missile: 0,
    mCool: 0,
    mSide: 1,
    alive: true,
    rateMult: 1,
    speedMult: 1
  }
};

try {
  G.hi = boundedInt(localStorage.getItem(HI_KEY));
} catch {
  G.hi = 0;
}

/* =========================================================================
   Input state
   ========================================================================= */

const keys = new Set();

const pointer = {
  x: 0,
  y: 0,
  down: false,
  isTouch: false,
  lastMove: -9,
  lastTapAt: -999,
  lastTapX: 0,
  lastTapY: 0
};

/* =========================================================================
   Procedural audio system
   ========================================================================= */

const AU = {
  ctx: null,
  out: null,
  noise: null,
  muted: SETTINGS.muted,

  musicT: 0,
  step: 0,

  lastShot: 0,
  lastMis: 0,

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }

    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;

    this.ctx = new C();

    const g = this.ctx.createGain();
    g.gain.value = this.muted ? 0 : 0.55;

    const comp = this.ctx.createDynamicsCompressor();

    g.connect(comp);
    comp.connect(this.ctx.destination);

    this.out = g;

    const len = this.ctx.sampleRate;
    const b = this.ctx.createBuffer(1, len, len);
    const d = b.getChannelData(0);

    for (let i = 0; i < len; i++) {
      d[i] = Math.random() * 2 - 1;
    }

    this.noise = b;

    this.musicT = this.ctx.currentTime + 0.1;
    this.step = 0;
  },

  panNode(x) {
    if (!this.ctx) return this.out;

    const p = this.ctx.createStereoPanner();
    const pan = G.w ? clamp((x / G.w) * 2 - 1, -1, 1) : 0;

    p.pan.value = pan;
    p.connect(this.out);

    return p;
  },

  tone(o) {
    if (!this.ctx) return;

    const t = o.t ?? this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();

    osc.type = o.type || 'sine';

    osc.frequency.setValueAtTime(o.f0, t);
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(o.f1 || o.f0, 1),
      t + (o.slide ?? o.dur)
    );

    g.gain.setValueAtTime(o.vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);

    let n = osc;

    if (o.lp) {
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.lp;
      osc.connect(f);
      n = f;
    }

    const dest = o.x != null ? this.panNode(o.x) : this.out;

    n.connect(g);
    g.connect(dest);

    osc.start(t);
    osc.stop(t + o.dur + 0.05);
  },

  hiss(o) {
    if (!this.ctx) return;

    const t = o.t ?? this.ctx.currentTime;

    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;

    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';

    f.frequency.setValueAtTime(o.f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(o.f1, 20), t + o.dur);

    const g = this.ctx.createGain();

    g.gain.setValueAtTime(o.vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);

    const dest = o.x != null ? this.panNode(o.x) : this.out;

    s.connect(f);
    f.connect(g);
    g.connect(dest);

    s.start(t);
    s.stop(t + o.dur + 0.05);
  },

  shoot() {
    if (!this.ctx || this.muted) return;

    const t = this.ctx.currentTime;
    if (t - this.lastShot < 0.045) return;

    this.lastShot = t;

    this.tone({
      type: 'square',
      f0: rand(740, 860),
      f1: 170,
      dur: 0.08,
      vol: 0.045,
      x: G.player.x
    });
  },

  missile() {
    if (!this.ctx || this.muted) return;

    const t = this.ctx.currentTime;
    if (t - this.lastMis < 0.09) return;

    this.lastMis = t;

    this.hiss({
      t,
      dur: 0.28,
      vol: 0.09,
      f0: 3200,
      f1: 500,
      x: G.player.x
    });

    this.tone({
      t,
      type: 'sawtooth',
      f0: 180,
      f1: 760,
      dur: 0.24,
      vol: 0.06,
      x: G.player.x
    });
  },

  boom(sz = 1, x = null) {
    if (!this.ctx || this.muted) return;

    const t = this.ctx.currentTime;

    this.hiss({
      t,
      dur: 0.5 * sz,
      vol: 0.3 * Math.min(sz, 1.6),
      f0: 1400,
      f1: 80,
      x
    });

    this.tone({
      t,
      type: 'sine',
      f0: 110,
      f1: 36,
      dur: 0.5 * sz,
      vol: 0.3 * Math.min(sz, 1.6),
      x
    });
  },

  hurt() {
    if (!this.ctx || this.muted) return;

    const t = this.ctx.currentTime;

    this.tone({
      t,
      type: 'sawtooth',
      f0: 300,
      f1: 55,
      dur: 0.28,
      vol: 0.2,
      x: G.player.x
    });

    this.hiss({
      t,
      dur: 0.3,
      vol: 0.22,
      f0: 2000,
      f1: 120,
      x: G.player.x
    });
  },

  pickup() {
    if (!this.ctx || this.muted) return;

    const t = this.ctx.currentTime;

    this.tone({
      t,
      type: 'sine',
      f0: 660,
      f1: 660,
      dur: 0.09,
      vol: 0.16,
      x: G.player.x
    });

    this.tone({
      t: t + 0.09,
      type: 'sine',
      f0: 990,
      f1: 990,
      dur: 0.14,
      vol: 0.16,
      x: G.player.x
    });

    this.tone({
      t: t + 0.18,
      type: 'triangle',
      f0: 1320,
      f1: 1320,
      dur: 0.18,
      vol: 0.12,
      x: G.player.x
    });
  },

  waveSnd() {
    if (!this.ctx || this.muted) return;

    const t = this.ctx.currentTime;

    [220, 330, 440].forEach((f, i) => {
      this.tone({
        t: t + i * 0.07,
        type: 'triangle',
        f0: f,
        f1: f,
        dur: 0.16,
        vol: 0.1
      });
    });
  },

  over() {
    if (!this.ctx || this.muted) return;

    const t = this.ctx.currentTime;

    [330, 262, 196, 131].forEach((f, i) => {
      this.tone({
        t: t + i * 0.16,
        type: 'sawtooth',
        f0: f,
        f1: f * 0.94,
        dur: 0.22,
        vol: 0.12,
        lp: 900
      });
    });
  },

  surgeSnd() {
    if (!this.ctx || this.muted) return;

    const t = this.ctx.currentTime;

    this.tone({
      t,
      type: 'sawtooth',
      f0: 80,
      f1: 800,
      dur: 0.4,
      vol: 0.2
    });

    this.tone({
      t: t + 0.1,
      type: 'square',
      f0: 440,
      f1: 1760,
      dur: 0.3,
      vol: 0.15
    });

    this.tone({
      t: t + 0.2,
      type: 'triangle',
      f0: 220,
      f1: 880,
      dur: 0.5,
      vol: 0.12
    });
  },

  bossWarn() {
    if (!this.ctx || this.muted) return;

    const t = this.ctx.currentTime;

    [55, 55, 82.5, 110].forEach((f, i) => {
      this.tone({
        t: t + i * 0.18,
        type: 'sawtooth',
        f0: f,
        f1: f * 0.98,
        dur: 0.34,
        vol: 0.16,
        lp: 320
      });
    });

    this.hiss({
      t,
      dur: 0.8,
      vol: 0.05,
      f0: 300,
      f1: 60
    });
  },

  bossPhase() {
    if (!this.ctx || this.muted) return;

    const t = this.ctx.currentTime;

    this.tone({
      t,
      type: 'square',
      f0: 220,
      f1: 880,
      dur: 0.16,
      vol: 0.1
    });

    this.hiss({
      t,
      dur: 0.2,
      vol: 0.08,
      f0: 2400,
      f1: 300
    });
  },

  uiMove() {
    if (!this.ctx || this.muted) return;

    this.tone({
      type: 'triangle',
      f0: 520,
      f1: 520,
      dur: 0.04,
      vol: 0.04
    });
  },

  uiConfirm() {
    if (!this.ctx || this.muted) return;

    const t = this.ctx.currentTime;

    this.tone({
      t,
      type: 'triangle',
      f0: 660,
      f1: 660,
      dur: 0.07,
      vol: 0.08
    });

    this.tone({
      t: t + 0.07,
      type: 'triangle',
      f0: 990,
      f1: 990,
      dur: 0.1,
      vol: 0.08
    });
  },

  uiError() {
    if (!this.ctx || this.muted) return;

    this.tone({
      type: 'square',
      f0: 160,
      f1: 90,
      dur: 0.12,
      vol: 0.06,
      lp: 500
    });
  },

  toggle() {
    this.muted = !this.muted;

    SETTINGS.muted = this.muted;
    saveSettings();

    if (this.out) {
      this.out.gain.value = this.muted ? 0 : 0.55;
    }

    /* Do not try to catch up every music step skipped while muted. */
    if (!this.muted && this.ctx) {
      this.musicT = this.ctx.currentTime + 0.1;
    }

    const btn = $('sndBtn');
    if (btn) syncSoundControls();
  },

  BASS: [
    55, 0, 55, 55, 0, 55, 0, 110,
    43.65, 0, 43.65, 43.65, 0, 43.65, 0, 87.31,
    65.41, 0, 65.41, 65.41, 0, 65.41, 0, 130.81,
    49, 0, 49, 49, 0, 49, 58.27, 65.41
  ],

  music() {
    if (!this.ctx || this.muted || G.state !== 'playing') return;

    const spb = 60 / 112 / 2;

    while (this.musicT < this.ctx.currentTime + 0.18) {
      const i = this.step;
      const t = this.musicT;

      const danger = G.lives === 1;
      const highCombo = G.combo >= 12;
      const surge = G.surgeActive;

      /* Kick */
      if (i % 4 === 0) {
        this.tone({
          t,
          type: 'sine',
          f0: danger ? 100 : 130,
          f1: 42,
          dur: 0.15,
          vol: danger ? 0.4 : 0.34
        });
      }

      /* Hats */
      if (i % 2 === 1) {
        this.hiss({
          t,
          dur: 0.03,
          vol: surge ? 0.035 : 0.022,
          f0: 7000,
          f1: 6000
        });
      }

      /* Bassline */
      const f = this.BASS[i];

      if (f) {
        this.tone({
          t,
          type: 'square',
          f0: surge ? f * 1.02 : f,
          f1: f,
          dur: 0.24,
          vol: danger ? 0.08 : 0.11,
          lp: danger ? 260 : 420
        });
      }

      /* Low-health heartbeat */
      if (danger && i % 8 === 0) {
        this.tone({
          t,
          type: 'sine',
          f0: 55,
          f1: 45,
          dur: 0.25,
          vol: 0.2
        });
      }

      /* High-combo arpeggio */
      if (highCombo && i % 2 === 0) {
        const seq = [660, 880, 990, 1320];

        this.tone({
          t,
          type: 'triangle',
          f0: seq[(this.step >> 1) & 3],
          f1: seq[(this.step >> 1) & 3],
          dur: 0.08,
          vol: 0.035
        });
      }

      /* Surge riser */
      if (surge && i % 4 === 2) {
        this.hiss({
          t,
          dur: 0.12,
          vol: 0.03,
          f0: 1200,
          f1: 4000
        });
      }

      this.musicT += spb;
      this.step = (this.step + 1) & 31;
    }
  }
};
/* =========================================================================
   Procedural sprite atlas
   2048x2048, 8x8 grid, 256px cells

   Cells:
   0  soft particle blob
   1  Vanguard player ship
   2  player lance bullet
   3  enemy orb bullet
   4  drone
   5  striker
   6  tank
   7  triple powerup
   8  rapid powerup
   9  shield powerup
   10 shockwave ring
   11 shield bubble
   12 seeker powerup
   13 missile projectile
   14 boss dreadnought
   16 Interceptor player ship
   17 Bastion player ship
   18 asteroid hazard
   19 piercing powerup
   20 magnet powerup
   21 time-slow powerup
   22 piercing projectile
   ========================================================================= */

function buildAtlas() {
  const S = 2048;
  const C = 256;
  const P = 30;
  const GRID = 8;

  const cv = document.createElement('canvas');
  cv.width = cv.height = S;

  const g = cv.getContext('2d');

  const cell = (i, fn) => {
    g.save();
    g.translate(
      (i % GRID) * C + C / 2,
      ((i / GRID) | 0) * C + C / 2
    );
    fn(C / 2 - P);
    g.restore();
    g.shadowBlur = 0;
    g.shadowColor = 'transparent';
  };

  const glow = (c, b) => {
    g.shadowColor = c;
    g.shadowBlur = b;
  };

  const nog = () => {
    g.shadowBlur = 0;
    g.shadowColor = 'transparent';
  };

  const lin = (x0, y0, x1, y1, st) => {
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    for (const [o, c] of st) gr.addColorStop(o, c);
    return gr;
  };

  const rad = (x, y, r0, r1, st) => {
    const gr = g.createRadialGradient(x, y, r0, x, y, r1);
    for (const [o, c] of st) gr.addColorStop(o, c);
    return gr;
  };

  const poly = p => {
    g.beginPath();
    p.forEach((q, i) => {
      if (i) g.lineTo(q[0], q[1]);
      else g.moveTo(q[0], q[1]);
    });
    g.closePath();
  };

  const hex = (rr, rot = -Math.PI / 2) => {
    g.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = Math.PI / 3 * k + rot;
      const x = Math.cos(a) * rr;
      const y = Math.sin(a) * rr;
      if (k) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.closePath();
  };

  const dot = (x, y, r, c) => {
    g.fillStyle = c;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
  };

  const saw = (rr, spikes, c1, c2) => {
    g.beginPath();
    for (let k = 0; k < spikes * 2; k++) {
      const a = Math.PI * k / spikes;
      const rr2 = k % 2 ? rr * 0.72 : rr;
      const x = Math.cos(a) * rr2;
      const y = Math.sin(a) * rr2;
      if (k) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.closePath();

    g.fillStyle = lin(0, -rr, 0, rr, [[0, c1], [1, c2]]);
    g.fill();

    g.strokeStyle = 'rgba(255,255,255,.22)';
    g.lineWidth = 2;
    g.stroke();
  };

  const pupDisc = (rr, ring) => {
    g.fillStyle = rad(0, 0, rr * 0.1, rr * 0.6, [
      [0, '#0d1a26'],
      [1, '#050b12']
    ]);

    g.beginPath();
    g.arc(0, 0, rr * 0.6, 0, TAU);
    g.fill();

    g.strokeStyle = ring;
    g.lineWidth = 3;
    g.stroke();
  };

  /* 0 — soft particle blob */
  cell(0, r => {
    g.fillStyle = rad(0, 0, 0, r, [
      [0, 'rgba(255,255,255,1)'],
      [0.3, 'rgba(255,255,255,.5)'],
      [1, 'rgba(255,255,255,0)']
    ]);
    g.fillRect(-r, -r, r * 2, r * 2);
  });

  /* 1 — VANGUARD player ship */
  cell(1, r => {
    glow('#5ff2ff', 30);

    g.fillStyle = rad(-r * 0.17, r * 0.8, 1, r * 0.34, [
      [0, 'rgba(230,255,255,.95)'],
      [0.4, 'rgba(95,242,255,.55)'],
      [1, 'rgba(95,242,255,0)']
    ]);
    g.beginPath();
    g.ellipse(-r * 0.17, r * 0.8, r * 0.13, r * 0.22, 0, 0, TAU);
    g.fill();

    g.fillStyle = rad(r * 0.17, r * 0.8, 1, r * 0.34, [
      [0, 'rgba(230,255,255,.95)'],
      [0.4, 'rgba(95,242,255,.55)'],
      [1, 'rgba(95,242,255,0)']
    ]);
    g.beginPath();
    g.ellipse(r * 0.17, r * 0.8, r * 0.13, r * 0.22, 0, 0, TAU);
    g.fill();

    nog();

    const wing = s => {
      g.fillStyle = lin(0, -r * 0.1, 0, r * 0.7, [
        [0, '#3d6f8f'],
        [0.5, '#274b63'],
        [1, '#12283a']
      ]);

      poly([
        [s * r * 0.16, -r * 0.08],
        [s * r * 0.98, r * 0.34],
        [s * r * 0.92, r * 0.52],
        [s * r * 0.42, r * 0.62],
        [s * r * 0.2, r * 0.5]
      ]);
      g.fill();

      g.strokeStyle = 'rgba(140,220,255,.35)';
      g.lineWidth = 2;
      g.stroke();

      g.strokeStyle = 'rgba(4,12,20,.55)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(s * r * 0.3, r * 0.14);
      g.lineTo(s * r * 0.8, r * 0.4);
      g.stroke();

      g.strokeStyle = '#ffb454';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(s * r * 0.84, r * 0.36);
      g.lineTo(s * r * 0.93, r * 0.42);
      g.stroke();

      glow(s > 0 ? '#4dff7c' : '#ff4d5e', 12);
      dot(s * r * 0.95, r * 0.44, 3.5, s > 0 ? '#7dffa0' : '#ff8090');
      nog();

      g.fillStyle = lin(s * r * 0.56 - r * 0.03, 0, s * r * 0.56 + r * 0.03, 0, [
        [0, '#0c1622'],
        [0.5, '#3a5a74'],
        [1, '#0c1622']
      ]);
      g.fillRect(s * r * 0.58 - r * 0.025, -r * 0.52, r * 0.05, r * 0.62);

      g.fillStyle = '#9fdcff';
      g.fillRect(s * r * 0.58 - r * 0.025, -r * 0.56, r * 0.05, r * 0.05);
    };

    wing(-1);
    wing(1);

    g.fillStyle = '#1b3a52';

    poly([
      [-r * 0.2, r * 0.55],
      [-r * 0.42, r * 0.86],
      [-r * 0.24, r * 0.86],
      [-r * 0.12, r * 0.66]
    ]);
    g.fill();

    poly([
      [r * 0.2, r * 0.55],
      [r * 0.42, r * 0.86],
      [r * 0.24, r * 0.86],
      [r * 0.12, r * 0.66]
    ]);
    g.fill();

    glow('rgba(95,242,255,.8)', 18);

    g.fillStyle = lin(0, -r, 0, r * 0.9, [
      [0, '#e8fbff'],
      [0.25, '#8fd8ef'],
      [0.55, '#3c6d8c'],
      [1, '#152c40']
    ]);

    g.beginPath();
    g.moveTo(0, -r);
    g.quadraticCurveTo(r * 0.2, -r * 0.45, r * 0.26, -r * 0.05);
    g.quadraticCurveTo(r * 0.3, r * 0.35, r * 0.2, r * 0.78);
    g.lineTo(r * 0.1, r * 0.86);
    g.lineTo(0, r * 0.78);
    g.lineTo(-r * 0.1, r * 0.86);
    g.lineTo(-r * 0.2, r * 0.78);
    g.quadraticCurveTo(-r * 0.3, r * 0.35, -r * 0.26, -r * 0.05);
    g.quadraticCurveTo(-r * 0.2, -r * 0.45, 0, -r);
    g.closePath();
    g.fill();

    nog();

    g.strokeStyle = 'rgba(200,240,255,.5)';
    g.lineWidth = 2;
    g.stroke();

    g.strokeStyle = 'rgba(230,250,255,.6)';
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(0, -r * 0.85);
    g.lineTo(0, r * 0.6);
    g.stroke();

    g.strokeStyle = 'rgba(6,16,26,.5)';
    g.lineWidth = 1.5;

    g.beginPath();
    g.moveTo(-r * 0.2, -r * 0.1);
    g.lineTo(r * 0.2, -r * 0.1);
    g.stroke();

    g.beginPath();
    g.moveTo(-r * 0.22, r * 0.25);
    g.lineTo(r * 0.22, r * 0.25);
    g.stroke();

    g.fillStyle = '#0a1420';

    g.beginPath();
    g.ellipse(-r * 0.15, r * 0.02, r * 0.05, r * 0.14, 0, 0, TAU);
    g.fill();

    g.beginPath();
    g.ellipse(r * 0.15, r * 0.02, r * 0.05, r * 0.14, 0, 0, TAU);
    g.fill();

    glow('#6ff2ff', 10);

    g.fillStyle = rad(0, -r * 0.42, 1, r * 0.3, [
      [0, '#ffffff'],
      [0.35, '#9ff1ff'],
      [0.8, '#0e4a66'],
      [1, '#082a3e']
    ]);

    g.beginPath();
    g.ellipse(0, -r * 0.4, r * 0.11, r * 0.24, 0, 0, TAU);
    g.fill();

    nog();

    g.fillStyle = 'rgba(255,255,255,.85)';
    g.beginPath();
    g.ellipse(-r * 0.03, -r * 0.5, r * 0.03, r * 0.07, -0.3, 0, TAU);
    g.fill();

    g.fillStyle = '#ffb454';

    poly([
      [-r * 0.14, r * 0.45],
      [-r * 0.06, r * 0.45],
      [-r * 0.1, r * 0.55]
    ]);
    g.fill();

    poly([
      [r * 0.06, r * 0.45],
      [r * 0.14, r * 0.45],
      [r * 0.1, r * 0.55]
    ]);
    g.fill();

    g.fillStyle = '#0a1420';

    g.beginPath();
    g.ellipse(-r * 0.17, r * 0.8, r * 0.09, r * 0.07, 0, 0, TAU);
    g.fill();

    g.beginPath();
    g.ellipse(r * 0.17, r * 0.8, r * 0.09, r * 0.07, 0, 0, TAU);
    g.fill();

    glow('#bffcff', 8);
    dot(-r * 0.17, r * 0.8, r * 0.045, '#dffcff');
    dot(r * 0.17, r * 0.8, r * 0.045, '#dffcff');
    nog();
  });

  /* 2 — player lance bullet */
  cell(2, r => {
    glow('#7df3ff', 22);

    g.fillStyle = lin(0, -r, 0, r, [
      [0, '#ffffff'],
      [0.5, '#9df0ff'],
      [1, 'rgba(90,220,255,.15)']
    ]);

    g.beginPath();
    g.moveTo(0, -r * 0.9);
    g.bezierCurveTo(r * 0.25, -r * 0.35, r * 0.22, r * 0.2, r * 0.12, r * 0.85);
    g.lineTo(0, r * 0.95);
    g.lineTo(-r * 0.12, r * 0.85);
    g.bezierCurveTo(-r * 0.22, r * 0.2, -r * 0.25, -r * 0.35, 0, -r * 0.9);
    g.fill();

    nog();
  });

  /* 3 — enemy orb bullet */
  cell(3, r => {
    glow('#ff5c47', 18);

    g.fillStyle = rad(0, 0, 0, r * 0.8, [
      [0, '#fff3e0'],
      [0.35, '#ffb454'],
      [0.7, 'rgba(255,92,71,.85)'],
      [1, 'rgba(255,92,71,0)']
    ]);

    g.beginPath();
    g.arc(0, 0, r * 0.8, 0, TAU);
    g.fill();

    nog();
  });

  /* 4 — DRONE */
  cell(4, r => {
    const blade = a => {
      g.save();
      g.rotate(a);

      g.fillStyle = lin(0, 0, r * 0.95, 0, [
        [0, '#7a1626'],
        [0.6, '#c22743'],
        [1, '#ff6a5e']
      ]);

      poly([
        [r * 0.16, -r * 0.1],
        [r * 0.92, -r * 0.26],
        [r * 0.98, 0],
        [r * 0.9, r * 0.14],
        [r * 0.16, r * 0.12]
      ]);
      g.fill();

      g.strokeStyle = 'rgba(255,170,150,.4)';
      g.lineWidth = 2;
      g.stroke();

      g.strokeStyle = 'rgba(10,4,8,.5)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(r * 0.3, 0);
      g.lineTo(r * 0.85, -r * 0.08);
      g.stroke();

      g.restore();
    };

    glow('#ff5c47', 14);

    blade(Math.PI * 0.25);
    blade(Math.PI * 0.75);
    blade(Math.PI * 1.25);
    blade(Math.PI * 1.75);

    nog();

    g.fillStyle = rad(0, 0, r * 0.1, r * 0.42, [
      [0, '#5a1220'],
      [0.7, '#380913'],
      [1, '#1c050a']
    ]);

    g.beginPath();
    g.arc(0, 0, r * 0.4, 0, TAU);
    g.fill();

    g.strokeStyle = 'rgba(255,150,130,.5)';
    g.lineWidth = 2.5;
    g.stroke();

    g.strokeStyle = 'rgba(255,110,90,.35)';
    g.lineWidth = 3;

    g.beginPath();
    g.arc(0, 0, r * 0.3, -0.6, 0.9);
    g.stroke();

    g.beginPath();
    g.arc(0, 0, r * 0.3, Math.PI - 0.6, Math.PI + 0.9);
    g.stroke();

    glow('#ffb454', 16);

    g.fillStyle = rad(0, r * 0.08, 1, r * 0.2, [
      [0, '#fff3d0'],
      [0.4, '#ffb454'],
      [1, '#7a2c14']
    ]);

    g.beginPath();
    g.arc(0, r * 0.08, r * 0.17, 0, TAU);
    g.fill();

    nog();

    g.fillStyle = '#2a0a10';
    g.beginPath();
    g.ellipse(0, r * 0.08, r * 0.14, r * 0.05, 0, 0, TAU);
    g.fill();

    dot(-r * 0.05, r * 0.06, r * 0.02, '#fff');
  });

  /* 5 — STRIKER */
  cell(5, r => {
    glow('#ffb454', 22);

    g.fillStyle = rad(0, -r * 0.62, 1, r * 0.26, [
      [0, 'rgba(255,240,200,.9)'],
      [0.5, 'rgba(255,180,84,.5)'],
      [1, 'rgba(255,140,60,0)']
    ]);

    g.beginPath();
    g.ellipse(0, -r * 0.62, r * 0.12, r * 0.2, 0, 0, TAU);
    g.fill();

    nog();

    const wing = s => {
      g.fillStyle = lin(0, -r * 0.3, 0, r * 0.6, [
        [0, '#8c2f1c'],
        [0.5, '#c65a24'],
        [1, '#e8934a']
      ]);

      poly([
        [s * r * 0.1, -r * 0.15],
        [s * r * 0.85, -r * 0.42],
        [s * r * 0.95, -r * 0.3],
        [s * r * 0.5, r * 0.15],
        [s * r * 0.22, r * 0.3]
      ]);
      g.fill();

      g.strokeStyle = 'rgba(255,220,170,.45)';
      g.lineWidth = 2;
      g.stroke();

      g.strokeStyle = 'rgba(20,6,4,.5)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(s * r * 0.25, -r * 0.1);
      g.lineTo(s * r * 0.8, -r * 0.3);
      g.stroke();
    };

    wing(-1);
    wing(1);

    glow('#ff8a4c', 14);

    g.fillStyle = lin(0, r * 0.9, 0, -r * 0.7, [
      [0, '#ffe0a8'],
      [0.4, '#e07a30'],
      [1, '#5a1d12']
    ]);

    poly([
      [0, r * 0.92],
      [r * 0.2, r * 0.3],
      [r * 0.16, -r * 0.3],
      [r * 0.09, -r * 0.62],
      [0, -r * 0.72],
      [-r * 0.09, -r * 0.62],
      [-r * 0.16, -r * 0.3],
      [-r * 0.2, r * 0.3]
    ]);
    g.fill();

    nog();

    g.strokeStyle = 'rgba(255,230,190,.55)';
    g.lineWidth = 2;
    g.stroke();

    glow('#ffd98a', 10);

    g.fillStyle = rad(0, r * 0.25, 1, r * 0.16, [
      [0, '#fff8e0'],
      [0.5, '#ffcf6e'],
      [1, '#8a4a16']
    ]);

    g.beginPath();
    g.ellipse(0, r * 0.28, r * 0.06, r * 0.16, 0, 0, TAU);
    g.fill();

    nog();

    g.strokeStyle = 'rgba(255,120,60,.6)';
    g.lineWidth = 2;

    g.beginPath();
    g.moveTo(r * 0.18, r * 0.32);
    g.lineTo(r * 0.14, -r * 0.25);
    g.stroke();

    g.beginPath();
    g.moveTo(-r * 0.18, r * 0.32);
    g.lineTo(-r * 0.14, -r * 0.25);
    g.stroke();
  });

  /* 6 — TANK */
  cell(6, r => {
    glow('#ff7a3c', 20);

    g.fillStyle = lin(-r * 0.7, -r * 0.7, r * 0.7, r * 0.8, [
      [0, '#6e2430'],
      [0.5, '#471420'],
      [1, '#25080f']
    ]);

    hex(r * 0.95);
    g.fill();

    nog();

    g.strokeStyle = 'rgba(255,150,110,.55)';
    g.lineWidth = 3;
    hex(r * 0.95);
    g.stroke();

    g.strokeStyle = 'rgba(0,0,0,.5)';
    g.lineWidth = 4;
    hex(r * 0.8);
    g.stroke();

    g.strokeStyle = 'rgba(255,120,90,.25)';
    g.lineWidth = 2;

    for (let k = 0; k < 6; k++) {
      const a = Math.PI / 3 * k - Math.PI / 2;
      g.beginPath();
      g.moveTo(Math.cos(a) * r * 0.36, Math.sin(a) * r * 0.36);
      g.lineTo(Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8);
      g.stroke();
    }

    for (let k = 0; k < 6; k++) {
      const a = Math.PI / 3 * k - Math.PI / 2 + Math.PI / 6;
      dot(Math.cos(a) * r * 0.86, Math.sin(a) * r * 0.86, 3, 'rgba(255,190,150,.7)');
    }

    g.strokeStyle = '#ffb454';
    g.lineWidth = 5;

    for (let i = -2; i <= 2; i++) {
      g.beginPath();
      g.moveTo(i * r * 0.16 - r * 0.06, r * 0.6);
      g.lineTo(i * r * 0.16 + r * 0.06, r * 0.72);
      g.stroke();
    }

    const barrel = x => {
      g.fillStyle = lin(x - r * 0.07, 0, x + r * 0.07, 0, [
        [0, '#160409'],
        [0.5, '#4a2a30'],
        [1, '#160409']
      ]);

      g.fillRect(x - r * 0.06, r * 0.1, r * 0.12, r * 0.6);

      glow('#ff9a5c', 10);
      g.fillStyle = '#ffd9a8';
      g.fillRect(x - r * 0.06, r * 0.66, r * 0.12, r * 0.06);
      nog();
    };

    barrel(-r * 0.34);
    barrel(r * 0.34);

    glow('#ff9a3c', 26);

    g.fillStyle = rad(0, 0, 1, r * 0.34, [
      [0, '#fff6dc'],
      [0.35, '#ffb454'],
      [0.7, '#c2401f'],
      [1, 'rgba(90,20,10,0)']
    ]);

    g.beginPath();
    g.arc(0, 0, r * 0.32, 0, TAU);
    g.fill();

    nog();

    g.strokeStyle = 'rgba(255,220,170,.8)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(0, 0, r * 0.22, 0, Math.PI * 1.5);
    g.stroke();

    g.strokeStyle = 'rgba(120,30,20,.8)';
    g.lineWidth = 4;
    g.beginPath();
    g.arc(0, 0, r * 0.3, 0, TAU);
    g.stroke();
  });

  /* 7 — TRIPLE powerup */
  cell(7, r => {
    glow('#5ff2ff', 26);
    saw(r * 0.94, 10, '#123047', '#071726');
    nog();

    pupDisc(r, 'rgba(95,242,255,.65)');

    glow('#8ff4ff', 18);

    const spear = (x, len) => {
      g.fillStyle = lin(0, -len, 0, r * 0.35, [
        [0, '#ffffff'],
        [0.45, '#8ff4ff'],
        [1, '#136d84']
      ]);

      poly([
        [x, -len],
        [x + r * 0.1, -len * 0.2],
        [x + r * 0.06, r * 0.35],
        [x - r * 0.06, r * 0.35],
        [x - r * 0.1, -len * 0.2]
      ]);
      g.fill();
    };

    spear(-r * 0.32, r * 0.28);
    spear(0, r * 0.46);
    spear(r * 0.32, r * 0.28);

    nog();

    g.strokeStyle = 'rgba(143,244,255,.7)';
    g.lineWidth = 2;

    g.beginPath();
    g.moveTo(-r * 0.5, r * 0.1);
    g.lineTo(-r * 0.66, r * 0.22);
    g.moveTo(r * 0.5, -r * 0.05);
    g.lineTo(r * 0.66, -r * 0.16);
    g.stroke();
  });

  /* 8 — RAPID powerup */
  cell(8, r => {
    glow('#ffb454', 26);
    saw(r * 0.94, 10, '#4a2a10', '#241205');
    nog();

    pupDisc(r, 'rgba(255,180,84,.65)');

    glow('#ffd98a', 18);

    g.fillStyle = lin(0, -r * 0.5, 0, r * 0.5, [
      [0, '#fff8e0'],
      [0.5, '#ffcf6e'],
      [1, '#c26a1e']
    ]);

    poly([
      [r * 0.12, -r * 0.5],
      [-r * 0.26, r * 0.06],
      [-r * 0.03, r * 0.06],
      [-r * 0.14, r * 0.5],
      [r * 0.28, -r * 0.1],
      [r * 0.03, -r * 0.1]
    ]);
    g.fill();

    g.globalAlpha = 0.65;

    poly([
      [r * 0.34, -r * 0.34],
      [r * 0.06, r * 0.02],
      [r * 0.22, r * 0.02],
      [r * 0.14, r * 0.34],
      [r * 0.44, -r * 0.02],
      [r * 0.28, -r * 0.02]
    ]);
    g.fill();

    g.globalAlpha = 1;

    nog();

    g.strokeStyle = 'rgba(255,217,138,.7)';
    g.lineWidth = 3;

    g.beginPath();
    g.moveTo(-r * 0.62, -r * 0.18);
    g.lineTo(-r * 0.34, -r * 0.18);
    g.moveTo(-r * 0.66, 0);
    g.lineTo(-r * 0.38, 0);
    g.moveTo(-r * 0.62, r * 0.18);
    g.lineTo(-r * 0.34, r * 0.18);
    g.stroke();
  });

  /* 9 — SHIELD powerup */
  cell(9, r => {
    glow('#5fe0ff', 26);
    saw(r * 0.94, 8, '#0e3a44', '#062028');
    nog();

    pupDisc(r, 'rgba(95,224,255,.65)');

    glow('#aef6ff', 18);

    g.fillStyle = lin(0, -r * 0.45, 0, r * 0.5, [
      [0, '#eaffff'],
      [0.5, '#6fe6ff'],
      [1, '#0e6a80']
    ]);

    poly([
      [0, -r * 0.46],
      [r * 0.36, -r * 0.28],
      [r * 0.3, r * 0.1],
      [0, r * 0.48],
      [-r * 0.3, r * 0.1],
      [-r * 0.36, -r * 0.28]
    ]);
    g.fill();

    nog();

    g.strokeStyle = 'rgba(255,255,255,.5)';
    g.lineWidth = 2;

    poly([
      [0, -r * 0.46],
      [r * 0.36, -r * 0.28],
      [r * 0.3, r * 0.1],
      [0, r * 0.48],
      [-r * 0.3, r * 0.1],
      [-r * 0.36, -r * 0.28]
    ]);
    g.stroke();

    glow('#ffffff', 10);
    dot(0, -r * 0.02, r * 0.09, '#eaffff');
    nog();

    g.strokeStyle = 'rgba(174,246,255,.7)';
    g.lineWidth = 2;

    g.beginPath();
    g.moveTo(-r * 0.52, -r * 0.3);
    g.lineTo(-r * 0.68, -r * 0.4);
    g.moveTo(r * 0.52, -r * 0.3);
    g.lineTo(r * 0.68, -r * 0.4);
    g.stroke();
  });

  /* 10 — shockwave ring */
  cell(10, r => {
    glow('#8df2ff', 16);

    g.strokeStyle = 'rgba(150,240,255,.95)';
    g.lineWidth = r * 0.14;

    g.beginPath();
    g.arc(0, 0, r * 0.78, 0, TAU);
    g.stroke();

    nog();
  });

  /* 11 — shield bubble */
  cell(11, r => {
    glow('#5fe0ff', 14);

    g.fillStyle = 'rgba(95,224,255,.09)';
    g.beginPath();
    g.arc(0, 0, r * 0.92, 0, TAU);
    g.fill();

    g.strokeStyle = 'rgba(140,235,255,.85)';
    g.lineWidth = 4;
    g.stroke();

    g.strokeStyle = 'rgba(220,250,255,.8)';
    g.lineWidth = 7;

    g.beginPath();
    g.arc(0, 0, r * 0.92, -2.4, -1.4);
    g.stroke();

    nog();
  });

  /* 12 — SEEKER powerup */
  cell(12, r => {
    glow('#ff5c47', 26);
    saw(r * 0.94, 9, '#471420', '#20060c');
    nog();

    pupDisc(r, 'rgba(255,92,71,.65)');

    glow('#ffb454', 16);

    g.fillStyle = lin(0, -r * 0.5, 0, r * 0.4, [
      [0, '#ffffff'],
      [0.4, '#ffd9a8'],
      [1, '#c2401f']
    ]);

    poly([
      [0, -r * 0.5],
      [r * 0.12, -r * 0.2],
      [r * 0.12, r * 0.25],
      [-r * 0.12, r * 0.25],
      [-r * 0.12, -r * 0.2]
    ]);
    g.fill();

    g.fillStyle = '#ff5c47';

    poly([
      [-r * 0.12, r * 0.05],
      [-r * 0.26, r * 0.3],
      [-r * 0.12, r * 0.28]
    ]);
    g.fill();

    poly([
      [r * 0.12, r * 0.05],
      [r * 0.26, r * 0.3],
      [r * 0.12, r * 0.28]
    ]);
    g.fill();

    g.fillStyle = rad(0, r * 0.35, 1, r * 0.2, [
      [0, 'rgba(255,240,200,.95)'],
      [0.6, 'rgba(255,122,60,.7)'],
      [1, 'rgba(255,92,71,0)']
    ]);

    g.beginPath();
    g.ellipse(0, r * 0.36, r * 0.09, r * 0.16, 0, 0, TAU);
    g.fill();

    nog();

    g.strokeStyle = 'rgba(255,143,125,.8)';
    g.lineWidth = 3;

    g.beginPath();
    g.arc(0, -r * 0.05, r * 0.42, -0.5, 0.5);
    g.stroke();

    g.beginPath();
    g.arc(0, -r * 0.05, r * 0.42, Math.PI - 0.5, Math.PI + 0.5);
    g.stroke();
  });

  /* 13 — missile projectile */
  cell(13, r => {
    glow('#ff9a5c', 14);

    g.fillStyle = rad(0, r * 0.55, 1, r * 0.45, [
      [0, 'rgba(255,246,220,.95)'],
      [0.4, 'rgba(255,154,92,.7)'],
      [1, 'rgba(255,92,71,0)']
    ]);

    g.beginPath();
    g.ellipse(0, r * 0.55, r * 0.16, r * 0.4, 0, 0, TAU);
    g.fill();

    nog();

    g.fillStyle = lin(-r * 0.12, 0, r * 0.12, 0, [
      [0, '#5a2a2a'],
      [0.5, '#ffd9c0'],
      [1, '#5a2a2a']
    ]);

    poly([
      [0, -r * 0.85],
      [r * 0.14, -r * 0.4],
      [r * 0.14, r * 0.35],
      [-r * 0.14, r * 0.35],
      [-r * 0.14, -r * 0.4]
    ]);
    g.fill();

    g.strokeStyle = 'rgba(255,220,190,.6)';
    g.lineWidth = 1.5;
    g.stroke();

    glow('#ff5c47', 8);
    g.fillStyle = '#ff5c47';

    poly([
      [0, -r * 0.85],
      [r * 0.1, -r * 0.55],
      [-r * 0.1, -r * 0.55]
    ]);
    g.fill();

    nog();

    g.fillStyle = '#c2401f';

    poly([
      [-r * 0.14, r * 0.1],
      [-r * 0.3, r * 0.45],
      [-r * 0.14, r * 0.38]
    ]);
    g.fill();

    poly([
      [r * 0.14, r * 0.1],
      [r * 0.3, r * 0.45],
      [r * 0.14, r * 0.38]
    ]);
    g.fill();
  });

  /* 14 — BOSS DREADNOUGHT */
  cell(14, r => {
    glow('#ff4d6d', 28);

    const plate = s => {
      g.fillStyle = lin(0, -r * 0.65, 0, r * 0.75, [
        [0, '#4a1024'],
        [0.45, '#8a1d3d'],
        [1, '#22060f']
      ]);

      poly([
        [s * r * 0.20, -r * 0.64],
        [s * r * 0.98, -r * 0.22],
        [s * r * 0.90, r * 0.42],
        [s * r * 0.34, r * 0.72],
        [s * r * 0.20, r * 0.30]
      ]);
      g.fill();

      g.strokeStyle = 'rgba(255,120,160,.35)';
      g.lineWidth = 2.5;
      g.stroke();

      g.fillStyle = lin(s * r * 0.6, 0, s * r * 0.9, 0, [
        [0, '#160409'],
        [0.5, '#5a2233'],
        [1, '#160409']
      ]);
      g.fillRect(s * r * 0.72 - r * 0.05, r * 0.10, r * 0.10, r * 0.52);

      glow('#ff9a5c', 12);
      g.fillStyle = '#ffd9a8';
      g.fillRect(s * r * 0.72 - r * 0.05, r * 0.56, r * 0.10, r * 0.07);
      nog();

      glow('#ff4d6d', 10);
      dot(s * r * 0.86, r * 0.02, 4, '#ff8fb0');
      nog();
    };

    plate(-1);
    plate(1);

    g.fillStyle = lin(0, -r, 0, r, [
      [0, '#3d0d20'],
      [0.42, '#711838'],
      [1, '#18030b']
    ]);

    hex(r * 0.86);
    g.fill();

    g.strokeStyle = 'rgba(255,140,170,.5)';
    g.lineWidth = 3;
    hex(r * 0.86);
    g.stroke();

    g.strokeStyle = 'rgba(0,0,0,.55)';
    g.lineWidth = 5;
    hex(r * 0.72);
    g.stroke();

    g.strokeStyle = 'rgba(255,90,120,.24)';
    g.lineWidth = 2;

    for (let k = 0; k < 6; k++) {
      const a = Math.PI / 3 * k - Math.PI / 2;
      g.beginPath();
      g.moveTo(Math.cos(a) * r * 0.32, Math.sin(a) * r * 0.32);
      g.lineTo(Math.cos(a) * r * 0.72, Math.sin(a) * r * 0.72);
      g.stroke();
    }

    glow('#ff4dff', 26);

    g.fillStyle = rad(0, 0, 1, r * 0.36, [
      [0, '#ffffff'],
      [0.28, '#ffb0ff'],
      [0.65, '#d32bd8'],
      [1, 'rgba(70,0,70,0)']
    ]);

    g.beginPath();
    g.arc(0, 0, r * 0.34, 0, TAU);
    g.fill();

    nog();

    g.strokeStyle = 'rgba(255,170,255,.9)';
    g.lineWidth = 3;

    g.beginPath();
    g.arc(0, 0, r * 0.22, 0, TAU);
    g.stroke();

    g.fillStyle = '#240214';
    g.beginPath();
    g.ellipse(0, 0, r * 0.15, r * 0.05, 0, 0, TAU);
    g.fill();

    glow('#ffffff', 12);
    dot(0, 0, r * 0.05, '#fff');
    nog();

    glow('#ffb454', 14);

    for (let i = -2; i <= 2; i++) {
      g.fillStyle = '#ffb454';
      g.fillRect(i * r * 0.16 - r * 0.03, r * 0.78, r * 0.06, r * 0.12);
    }

    nog();
  });

  /* 16 — INTERCEPTOR player ship */
  cell(16, r => {
    glow('#ffb454', 28);

    g.fillStyle = rad(-r * 0.22, r * 0.82, 1, r * 0.3, [
      [0, 'rgba(255,245,220,.95)'],
      [0.4, 'rgba(255,180,84,.55)'],
      [1, 'rgba(255,180,84,0)']
    ]);
    g.beginPath();
    g.ellipse(-r * 0.22, r * 0.82, r * 0.11, r * 0.2, 0, 0, TAU);
    g.fill();

    g.fillStyle = rad(r * 0.22, r * 0.82, 1, r * 0.3, [
      [0, 'rgba(255,245,220,.95)'],
      [0.4, 'rgba(255,180,84,.55)'],
      [1, 'rgba(255,180,84,0)']
    ]);
    g.beginPath();
    g.ellipse(r * 0.22, r * 0.82, r * 0.11, r * 0.2, 0, 0, TAU);
    g.fill();

    nog();

    const wing = s => {
      g.fillStyle = lin(0, -r * 0.3, 0, r * 0.7, [
        [0, '#7a4d12'],
        [0.5, '#c98a2e'],
        [1, '#3d230a']
      ]);

      poly([
        [s * r * 0.14, -r * 0.25],
        [s * r * 0.95, r * 0.1],
        [s * r * 0.75, r * 0.55],
        [s * r * 0.2, r * 0.45]
      ]);
      g.fill();

      g.strokeStyle = 'rgba(255,230,180,.4)';
      g.lineWidth = 2;
      g.stroke();

      g.strokeStyle = 'rgba(70,35,10,.5)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(s * r * 0.3, r * 0.05);
      g.lineTo(s * r * 0.78, r * 0.32);
      g.stroke();

      glow('#ffb454', 10);
      dot(s * r * 0.86, r * 0.24, 3.5, '#ffd9a8');
      nog();
    };

    wing(-1);
    wing(1);

    glow('#ffb454', 16);

    g.fillStyle = lin(0, -r, 0, r * 0.85, [
      [0, '#fff7e8'],
      [0.3, '#ffd9a8'],
      [0.65, '#b46a24'],
      [1, '#331608']
    ]);

    poly([
      [0, -r],
      [r * 0.16, -r * 0.2],
      [r * 0.18, r * 0.45],
      [r * 0.08, r * 0.8],
      [0, r * 0.65],
      [-r * 0.08, r * 0.8],
      [-r * 0.18, r * 0.45],
      [-r * 0.16, -r * 0.2]
    ]);
    g.fill();

    nog();

    g.strokeStyle = 'rgba(255,240,210,.55)';
    g.lineWidth = 2;
    g.stroke();

    glow('#ffd98a', 12);

    g.fillStyle = rad(0, -r * 0.42, 1, r * 0.22, [
      [0, '#ffffff'],
      [0.4, '#ffd9a8'],
      [1, '#6e3812']
    ]);

    g.beginPath();
    g.ellipse(0, -r * 0.42, r * 0.08, r * 0.18, 0, 0, TAU);
    g.fill();

    nog();

    g.strokeStyle = 'rgba(70,30,10,.5)';
    g.lineWidth = 2;

    g.beginPath();
    g.moveTo(-r * 0.12, r * 0.1);
    g.lineTo(r * 0.12, r * 0.1);
    g.stroke();
  });

  /* 17 — BASTION player ship */
  cell(17, r => {
    glow('#ff5c47', 26);

    const pod = s => {
      g.fillStyle = lin(0, -r * 0.4, 0, r * 0.7, [
        [0, '#401414'],
        [0.5, '#7a2323'],
        [1, '#1d0808']
      ]);

      poly([
        [s * r * 0.18, -r * 0.45],
        [s * r * 0.85, -r * 0.15],
        [s * r * 0.82, r * 0.52],
        [s * r * 0.28, r * 0.68]
      ]);
      g.fill();

      g.strokeStyle = 'rgba(255,150,130,.35)';
      g.lineWidth = 2.5;
      g.stroke();

      g.fillStyle = '#2a0a0a';
      g.fillRect(s * r * 0.62 - r * 0.06, r * 0.15, r * 0.12, r * 0.5);

      glow('#ff8f7d', 10);
      g.fillStyle = '#ffb0a0';
      g.fillRect(s * r * 0.62 - r * 0.06, r * 0.58, r * 0.12, r * 0.07);
      nog();
    };

    pod(-1);
    pod(1);

    g.fillStyle = lin(0, -r, 0, r, [
      [0, '#38131a'],
      [0.45, '#6e2430'],
      [1, '#160409']
    ]);

    hex(r * 0.88);
    g.fill();

    g.strokeStyle = 'rgba(255,140,120,.5)';
    g.lineWidth = 3;
    hex(r * 0.88);
    g.stroke();

    g.strokeStyle = 'rgba(0,0,0,.5)';
    g.lineWidth = 5;
    hex(r * 0.7);
    g.stroke();

    g.fillStyle = '#160409';
    g.fillRect(-r * 0.24, r * 0.1, r * 0.12, r * 0.68);
    g.fillRect(r * 0.12, r * 0.1, r * 0.12, r * 0.68);

    glow('#ff8f7d', 10);
    g.fillStyle = '#ffd0c0';
    g.fillRect(-r * 0.24, r * 0.72, r * 0.12, r * 0.07);
    g.fillRect(r * 0.12, r * 0.72, r * 0.12, r * 0.07);
    nog();

    glow('#ff4d4d', 22);

    g.fillStyle = rad(0, 0, 1, r * 0.3, [
      [0, '#fff0f0'],
      [0.35, '#ff8080'],
      [0.75, '#a02020'],
      [1, 'rgba(60,0,0,0)']
    ]);

    g.beginPath();
    g.arc(0, 0, r * 0.28, 0, TAU);
    g.fill();

    nog();

    g.strokeStyle = 'rgba(255,120,120,.8)';
    g.lineWidth = 3;

    g.beginPath();
    g.arc(0, 0, r * 0.18, 0, TAU);
    g.stroke();

    glow('#ff5c47', 12);

    g.strokeStyle = 'rgba(255,92,71,.65)';
    g.lineWidth = 5;

    g.beginPath();
    g.arc(0, -r * 0.1, r * 0.62, Math.PI * 1.15, Math.PI * 1.85);
    g.stroke();

    nog();
  });

  /* 18 — ASTEROID hazard */
  cell(18, r => {
    glow('rgba(255,180,120,.3)', 8);

    const pts = [];
    const rr = [0.95, 0.78, 0.88, 0.72, 0.9, 0.75, 0.98, 0.8, 0.86, 0.7];

    for (let k = 0; k < 10; k++) {
      const a = TAU * k / 10;
      pts.push([
        Math.cos(a) * r * rr[k],
        Math.sin(a) * r * rr[k]
      ]);
    }

    g.fillStyle = rad(-r * 0.2, -r * 0.2, r * 0.1, r, [
      [0, '#7d6a5a'],
      [0.5, '#4f4038'],
      [1, '#221a16']
    ]);

    poly(pts);
    g.fill();

    g.strokeStyle = 'rgba(255,220,180,.18)';
    g.lineWidth = 3;
    poly(pts);
    g.stroke();

    nog();

    dot(-r * 0.25, -r * 0.1, r * 0.13, 'rgba(0,0,0,.35)');
    dot(r * 0.2, r * 0.25, r * 0.1, 'rgba(0,0,0,.3)');
    dot(r * 0.05, -r * 0.35, r * 0.07, 'rgba(0,0,0,.3)');

    glow('#ff9a5c', 6);

    g.strokeStyle = 'rgba(255,154,92,.35)';
    g.lineWidth = 2.5;

    g.beginPath();
    g.moveTo(-r * 0.5, r * 0.1);
    g.lineTo(-r * 0.1, r * 0.2);
    g.lineTo(r * 0.15, r * 0.05);
    g.lineTo(r * 0.5, r * 0.2);
    g.stroke();

    nog();
  });

  /* 19 — PIERCING powerup */
  cell(19, r => {
    glow('#c48cff', 26);
    saw(r * 0.94, 8, '#39235c', '#170d2a');
    nog();

    pupDisc(r, 'rgba(196,140,255,.72)');

    glow('#e5c8ff', 18);
    g.fillStyle = lin(0, -r * 0.52, 0, r * 0.52, [
      [0, '#ffffff'],
      [0.4, '#d8b6ff'],
      [1, '#7141b0']
    ]);

    poly([
      [0, -r * 0.54],
      [r * 0.14, -r * 0.2],
      [r * 0.1, r * 0.5],
      [0, r * 0.6],
      [-r * 0.1, r * 0.5],
      [-r * 0.14, -r * 0.2]
    ]);
    g.fill();

    nog();
    g.strokeStyle = 'rgba(229,200,255,.8)';
    g.lineWidth = 3;

    g.beginPath();
    g.moveTo(-r * 0.52, -r * 0.18);
    g.lineTo(r * 0.52, -r * 0.18);
    g.moveTo(-r * 0.52, r * 0.18);
    g.lineTo(r * 0.52, r * 0.18);
    g.stroke();
  });

  /* 20 — MAGNET powerup */
  cell(20, r => {
    glow('#62f4d2', 26);
    saw(r * 0.94, 10, '#12463f', '#06211f');
    nog();

    pupDisc(r, 'rgba(98,244,210,.72)');

    glow('#b8ffed', 18);
    g.strokeStyle = '#b8ffed';
    g.lineWidth = r * 0.16;
    g.lineCap = 'round';
    g.beginPath();
    g.arc(0, r * 0.02, r * 0.38, Math.PI * 0.14, Math.PI * 0.86, true);
    g.stroke();

    nog();
    g.fillStyle = '#5ef4d0';
    g.fillRect(-r * 0.48, -r * 0.08, r * 0.18, r * 0.32);
    g.fillRect(r * 0.3, -r * 0.08, r * 0.18, r * 0.32);

    g.fillStyle = '#eaffff';
    g.fillRect(-r * 0.48, -r * 0.08, r * 0.18, r * 0.08);
    g.fillRect(r * 0.3, -r * 0.08, r * 0.18, r * 0.08);

    g.strokeStyle = 'rgba(184,255,237,.72)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(-r * 0.64, r * 0.42);
    g.lineTo(-r * 0.42, r * 0.42);
    g.moveTo(r * 0.42, r * 0.42);
    g.lineTo(r * 0.64, r * 0.42);
    g.stroke();
  });

  /* 21 — TIME-SLOW powerup */
  cell(21, r => {
    glow('#8aa8ff', 26);
    saw(r * 0.94, 9, '#263a76', '#101a3d');
    nog();

    pupDisc(r, 'rgba(138,168,255,.72)');

    glow('#d9e2ff', 16);
    g.strokeStyle = '#d9e2ff';
    g.lineWidth = 4;
    g.beginPath();
    g.arc(0, 0, r * 0.38, 0, TAU);
    g.stroke();

    nog();
    g.strokeStyle = '#8aa8ff';
    g.lineWidth = 3;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(0, -r * 0.22);
    g.moveTo(0, 0);
    g.lineTo(r * 0.2, r * 0.14);
    g.stroke();

    g.strokeStyle = 'rgba(217,226,255,.7)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(-r * 0.54, -r * 0.52);
    g.lineTo(-r * 0.24, -r * 0.52);
    g.moveTo(r * 0.24, -r * 0.52);
    g.lineTo(r * 0.54, -r * 0.52);
    g.stroke();
  });

  /* 22 — PIERCING projectile */
  cell(22, r => {
    glow('#c48cff', 22);

    g.fillStyle = lin(0, -r, 0, r, [
      [0, '#ffffff'],
      [0.45, '#d8b6ff'],
      [1, 'rgba(143,86,220,.16)']
    ]);

    poly([
      [0, -r],
      [r * 0.2, -r * 0.2],
      [r * 0.12, r * 0.82],
      [0, r],
      [-r * 0.12, r * 0.82],
      [-r * 0.2, -r * 0.2]
    ]);
    g.fill();

    nog();
    g.strokeStyle = 'rgba(229,200,255,.9)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(0, 0, r * 0.42, 0, TAU);
    g.stroke();
  });

  return cv;
}
/* =========================================================================
   WGSL — WebGPU shaders
   ========================================================================= */

const FRAME_WGSL = `
struct Frame {
  res: vec2f,
  time: f32,
  dpr: f32,
  off: vec2f,
  dt: f32,
  spawnCount: u32,
  p0: f32,
  p1: f32,
  pad: vec2f
}
`;

const BG_WGSL = FRAME_WGSL + `
@group(0) @binding(0) var<uniform> F: Frame;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) sp: vec2f
}

@vertex fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  var p = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0)
  );

  var o: VOut;
  o.pos = vec4f(p[vi], 0.0, 1.0);
  o.sp = p[vi];
  return o;
}

fn h21(p: vec2f) -> f32 {
  var q = fract(p * vec2f(123.34, 345.45));
  q += dot(q, q + 34.345);
  return fract(q.x * q.y);
}

fn vnoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);

  let a = h21(i);
  let b = h21(i + vec2f(1.0, 0.0));
  let c = h21(i + vec2f(0.0, 1.0));
  let d = h21(i + vec2f(1.0, 1.0));

  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fbm(p0: vec2f) -> f32 {
  var p = p0;
  var v = 0.0;
  var a = 0.5;

  for (var i = 0; i < 5; i++) {
    v += a * vnoise(p);
    p = p * 2.03 + vec2f(11.3, 7.9);
    a *= 0.5;
  }

  return v;
}

fn stars(uv: vec2f, scale: f32, dens: f32, spd: f32, t: f32) -> vec3f {
  let p = uv * scale + vec2f(0.0, -t * spd);
  let i = floor(p);
  let f = fract(p);
  let r = h21(i);

  if (r > dens) {
    return vec3f(0.0);
  }

  let posn = vec2f(h21(i + 3.7), h21(i + 9.2));
  let d = length(f - posn);
  let tw = 0.6 + 0.4 * sin(t * (2.0 + r * 6.0) + r * 40.0);
  let m = smoothstep(0.10, 0.0, d);
  let tint = mix(vec3f(0.7, 0.9, 1.0), vec3f(1.0, 0.85, 0.6), h21(i + 5.5));

  return tint * m * tw * (0.35 + 0.65 * (1.0 - r / dens));
}

@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let px = v.pos.xy + F.off * 0.4;
  let uv = px / F.res.y;
  let t = F.time;

  let p = uv * 2.6;
  let scroll = t * 0.045;

  let aberr = F.p0;
  let offset = vec2f(aberr * 0.003, aberr * 0.002);

  let n1 = fbm(p + vec2f(0.0, -scroll));
  let n2 = fbm(p * 1.7 + n1 * 1.3 + vec2f(3.1, -scroll * 1.6));
  let n3 = fbm(p * 0.8 - vec2f(1.7, scroll * 0.7));

  var col = vec3f(0.012, 0.02, 0.045);

  col += vec3f(0.05, 0.34, 0.38) * pow(n2, 2.4) * 0.85;
  col += vec3f(0.75, 0.28, 0.12) * pow(n1 * n3, 3.0) * 1.1;
  col += vec3f(0.10, 0.16, 0.30) * pow(n3, 3.0) * 0.5;

  let s1 = stars(uv - offset, 26.0, 0.10, 0.55, t) * 0.9;
  let s2 = stars(uv, 46.0, 0.07, 1.0, t) * 0.7;
  let s3 = stars(uv + offset, 80.0, 0.05, 1.8, t) * 0.5;

  col += vec3f(s1.r, s2.g, s3.b);
  col += vec3f(s2.r, s3.g, s1.b) * 0.5;

  return vec4f(col, 1.0);
}
`;

const SPRITE_WGSL = FRAME_WGSL + `
struct Inst {
  a: vec4f,
  b: vec4f,
  c: vec4f
}

@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var S: sampler;
@group(0) @binding(2) var T: texture_2d<f32>;

@group(1) @binding(0) var<storage, read> IN: array<Inst>;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) col: vec4f
}

@vertex fn vs(
  @builtin(vertex_index) vi: u32,
  @builtin(instance_index) ii: u32
) -> VOut {
  let inst = IN[ii];

  let c = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u)) - 1.0;

  let rot = inst.a.z;
  let cr = cos(rot);
  let sr = sin(rot);

  let local = vec2f(c.x * inst.b.x * 0.5, c.y * inst.b.y * 0.5);
  let world = vec2f(
    local.x * cr - local.y * sr,
    local.x * sr + local.y * cr
  ) + inst.a.xy;

  let dev = world * F.dpr + F.off;

  let ndc = vec2f(
    dev.x / F.res.x * 2.0 - 1.0,
    1.0 - dev.y / F.res.y * 2.0
  );

  let id = u32(inst.a.w + 0.5);
  let uv01 = c * 0.5 + 0.5;

  var o: VOut;

  o.pos = vec4f(ndc, 0.0, 1.0);

  /* 8x8 atlas */
  o.uv = (vec2f(f32(id & 7u), f32(id >> 3u)) + uv01) * 0.125;

  o.col = vec4f(inst.c.rgb, inst.b.z);

  return o;
}

@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let tx = textureSample(T, S, v.uv);
  let a = tx.a * v.col.a;
  return vec4f(tx.rgb * v.col.rgb * a, a);
}
`;

const PART_WGSL = FRAME_WGSL + `
struct Part {
  pv: vec4f,
  cs: vec4f,
  lm: vec4f
}

@group(0) @binding(0) var<uniform> F: Frame;
@group(1) @binding(0) var<storage, read> PR: array<Part>;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) col: vec4f
}

@vertex fn vs(
  @builtin(vertex_index) vi: u32,
  @builtin(instance_index) ii: u32
) -> VOut {
  let p = PR[ii];

  let c = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u)) - 1.0;

  var k = clamp(p.lm.x / max(p.lm.y, 0.0001), 0.0, 1.0);
  var size = p.lm.z * (0.3 + 0.7 * k);

  if (p.lm.x <= 0.0) {
    size = 0.0;
  }

  let px = p.pv.xy * F.dpr + F.off + c * size * F.dpr;

  let ndc = vec2f(
    px.x / F.res.x * 2.0 - 1.0,
    1.0 - px.y / F.res.y * 2.0
  );

  var o: VOut;

  o.pos = vec4f(ndc, 0.0, 1.0);
  o.uv = c;
  o.col = vec4f(p.cs.rgb * p.cs.w, k);

  return o;
}

@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let d2 = dot(v.uv, v.uv);

  var a = max(0.0, 1.0 - d2);
  a = a * a;

  let fade = v.col.a * v.col.a;

  return vec4f(v.col.rgb * a * fade * 1.4, 0.0);
}
`;

const COMPUTE_WGSL = FRAME_WGSL + `
const MAXP = ${MAXP}u;

struct Part {
  pv: vec4f,
  cs: vec4f,
  lm: vec4f
}

@group(0) @binding(0) var<uniform> F: Frame;

@group(1) @binding(0) var<storage, read_write> PR: array<Part>;
@group(1) @binding(1) var<storage, read_write> NEXT: atomic<u32>;
@group(1) @binding(2) var<storage, read> SP: array<Part>;

@compute @workgroup_size(128)
fn cs_spawn(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x;

  if (i >= F.spawnCount) {
    return;
  }

  let idx = atomicAdd(&NEXT, 1u) % MAXP;
  PR[idx] = SP[i];
}

@compute @workgroup_size(64)
fn cs_update(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x;

  if (i >= MAXP) {
    return;
  }

  var p = PR[i];

  if (p.lm.x <= 0.0) {
    return;
  }

  p.lm.x = p.lm.x - F.dt;

  if (p.lm.x <= 0.0) {
    p.lm.x = 0.0;
    PR[i] = p;
    return;
  }

  let dr = pow(max(p.lm.w, 0.001), F.dt * 60.0);

  p.pv.z *= dr;
  p.pv.w *= dr;

  p.pv.x += p.pv.z * F.dt;
  p.pv.y += p.pv.w * F.dt;

  PR[i] = p;
}
`;

/* =========================================================================
   GLSL ES 3.00 — WebGL2 fallback shaders
   ========================================================================= */

const BG_VS_GLSL = `#version 300 es
void main() {
  vec2 p = vec2(
    float((gl_VertexID << 1) & 2),
    float(gl_VertexID & 2)
  );

  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

const BG_FS_GLSL = `#version 300 es
precision highp float;

uniform vec2 uRes;
uniform float uTime;
uniform vec2 uOff;
uniform float uAberr;

out vec4 o;

float h21(vec2 p) {
  vec2 q = fract(p * vec2(123.34, 345.45));
  q += dot(q, q + 34.345);
  return fract(q.x * q.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);

  float a = h21(i);
  float b = h21(i + vec2(1.0, 0.0));
  float c = h21(i + vec2(0.0, 1.0));
  float d = h21(i + vec2(1.0, 1.0));

  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p0) {
  vec2 p = p0;
  float v = 0.0;
  float a = 0.5;

  for (int i = 0; i < 5; i++) {
    v += a * vnoise(p);
    p = p * 2.03 + vec2(11.3, 7.9);
    a *= 0.5;
  }

  return v;
}

vec3 stars(vec2 uv, float scale, float dens, float spd, float t) {
  vec2 p = uv * scale + vec2(0.0, -t * spd);
  vec2 i = floor(p);
  vec2 f = fract(p);

  float r = h21(i);

  if (r > dens) return vec3(0.0);

  vec2 posn = vec2(h21(i + 3.7), h21(i + 9.2));
  float d = length(f - posn);

  float tw = 0.6 + 0.4 * sin(t * (2.0 + r * 6.0) + r * 40.0);
  float m = smoothstep(0.10, 0.0, d);

  vec3 tint = mix(vec3(0.7, 0.9, 1.0), vec3(1.0, 0.85, 0.6), h21(i + 5.5));

  return tint * m * tw * (0.35 + 0.65 * (1.0 - r / dens));
}

void main() {
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) + uOff * 0.4;
  vec2 uv = px / uRes.y;

  float t = uTime;

  vec2 p = uv * 2.6;
  float scroll = t * 0.045;

  vec2 offset = vec2(uAberr * 0.003, uAberr * 0.002);

  float n1 = fbm(p + vec2(0.0, -scroll));
  float n2 = fbm(p * 1.7 + n1 * 1.3 + vec2(3.1, -scroll * 1.6));
  float n3 = fbm(p * 0.8 - vec2(1.7, scroll * 0.7));

  vec3 col = vec3(0.012, 0.02, 0.045);

  col += vec3(0.05, 0.34, 0.38) * pow(n2, 2.4) * 0.85;
  col += vec3(0.75, 0.28, 0.12) * pow(n1 * n3, 3.0) * 1.1;
  col += vec3(0.10, 0.16, 0.30) * pow(n3, 3.0) * 0.5;

  vec3 s1 = stars(uv - offset, 26.0, 0.10, 0.55, t) * 0.9;
  vec3 s2 = stars(uv, 46.0, 0.07, 1.0, t) * 0.7;
  vec3 s3 = stars(uv + offset, 80.0, 0.05, 1.8, t) * 0.5;

  col += vec3(s1.r, s2.g, s3.b);
  col += vec3(s2.r, s3.g, s1.b) * 0.5;

  o = vec4(col, 1.0);
}
`;

const SP_VS_GLSL = `#version 300 es
layout(location = 0) in vec4 A;
layout(location = 1) in vec4 B;
layout(location = 2) in vec4 C;

uniform vec2 uRes;
uniform float uDpr;
uniform vec2 uOff;

out vec2 vUv;
out vec4 vCol;

void main() {
  int vi = gl_VertexID;

  vec2 c = vec2(float((vi << 1) & 2), float(vi & 2)) - 1.0;

  float cr = cos(A.z);
  float sr = sin(A.z);

  vec2 local = vec2(c.x * B.x * 0.5, c.y * B.y * 0.5);

  vec2 world = vec2(
    local.x * cr - local.y * sr,
    local.x * sr + local.y * cr
  ) + A.xy;

  vec2 dev = world * uDpr + uOff;

  vec2 ndc = vec2(
    dev.x / uRes.x * 2.0 - 1.0,
    1.0 - dev.y / uRes.y * 2.0
  );

  int id = int(A.w + 0.5);
  vec2 uv01 = c * 0.5 + 0.5;

  /* 8x8 atlas */
  vUv = (vec2(float(id & 7), float(id >> 3)) + uv01) * 0.125;

  vCol = vec4(C.rgb, B.z);

  gl_Position = vec4(ndc, 0.0, 1.0);
}
`;

const SP_FS_GLSL = `#version 300 es
precision highp float;

in vec2 vUv;
in vec4 vCol;

uniform sampler2D uTex;
uniform int uAdd;

out vec4 o;

void main() {
  vec4 tx = texture(uTex, vUv);
  float a = tx.a * vCol.a;

  if (uAdd == 1) {
    o = vec4(tx.rgb * vCol.rgb * a, 0.0);
  } else {
    o = vec4(tx.rgb * vCol.rgb * a, a);
  }
}
`;

/* =========================================================================
   WebGPU backend initialization
   ========================================================================= */

async function initGPU(atlasCanvas) {
  if (!('gpu' in navigator)) {
    throw 'navigator.gpu missing';
  }

  const adapter = await navigator.gpu.requestAdapter();

  if (!adapter) {
    throw 'no adapter returned';
  }

  device = await adapter.requestDevice({ label: 'ionstorm' });

  if (bootDone) {
    throw 'webgpu arrived after fallback';
  }

  device.lost.then(info => {
    if (info.reason !== 'destroyed') {
      fatal('GPU DEVICE LOST — ' + info.message);
    }
  });

  format = navigator.gpu.getPreferredCanvasFormat();

  const U = GPUBufferUsage;
  const S = GPUShaderStage;
  const T = GPUTextureUsage;

  const atlasTex = device.createTexture({
    label: 'ionstorm-atlas',
    size: {
      width: atlasCanvas.width,
      height: atlasCanvas.height,
      depthOrArrayLayers: 1
    },
    format: 'rgba8unorm',
    usage: T.TEXTURE_BINDING | T.COPY_DST
  });

  device.queue.copyExternalImageToTexture(
    { source: atlasCanvas },
    { texture: atlasTex },
    {
      width: atlasCanvas.width,
      height: atlasCanvas.height,
      depthOrArrayLayers: 1
    }
  );

  frameBuf = device.createBuffer({
    size: 48,
    usage: U.UNIFORM | U.COPY_DST
  });

  frameF32 = new Float32Array(12);
  frameU32 = new Uint32Array(frameF32.buffer);

  instBufN = device.createBuffer({
    size: MAX_INST * 48,
    usage: U.STORAGE | U.COPY_DST
  });

  instBufA = device.createBuffer({
    size: MAX_INST * 48,
    usage: U.STORAGE | U.COPY_DST
  });

  partsBuf = device.createBuffer({
    size: MAXP * 48,
    usage: U.STORAGE | U.COPY_DST
  });

  spawnBuf = device.createBuffer({
    size: MAX_SPAWN * 48,
    usage: U.STORAGE | U.COPY_DST
  });

  counterBuf = device.createBuffer({
    size: 4,
    usage: U.STORAGE
  });

  const samp = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear'
  });

  const frameBGL = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: S.VERTEX | S.FRAGMENT | S.COMPUTE,
        buffer: { type: 'uniform' }
      },
      {
        binding: 1,
        visibility: S.FRAGMENT,
        sampler: {}
      },
      {
        binding: 2,
        visibility: S.FRAGMENT,
        texture: {}
      }
    ]
  });

  frameBG = device.createBindGroup({
    layout: frameBGL,
    entries: [
      { binding: 0, resource: { buffer: frameBuf } },
      { binding: 1, resource: samp },
      { binding: 2, resource: atlasTex.createView() }
    ]
  });

  const instBGL = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: S.VERTEX,
        buffer: { type: 'read-only-storage' }
      }
    ]
  });

  bgN = device.createBindGroup({
    layout: instBGL,
    entries: [
      { binding: 0, resource: { buffer: instBufN } }
    ]
  });

  bgA = device.createBindGroup({
    layout: instBGL,
    entries: [
      { binding: 0, resource: { buffer: instBufA } }
    ]
  });

  const partReadBGL = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: S.VERTEX,
        buffer: { type: 'read-only-storage' }
      }
    ]
  });

  partBG = device.createBindGroup({
    layout: partReadBGL,
    entries: [
      { binding: 0, resource: { buffer: partsBuf } }
    ]
  });

  const partRWBGL = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: S.COMPUTE,
        buffer: { type: 'storage' }
      },
      {
        binding: 1,
        visibility: S.COMPUTE,
        buffer: { type: 'storage' }
      },
      {
        binding: 2,
        visibility: S.COMPUTE,
        buffer: { type: 'read-only-storage' }
      }
    ]
  });

  compBG = device.createBindGroup({
    layout: partRWBGL,
    entries: [
      { binding: 0, resource: { buffer: partsBuf } },
      { binding: 1, resource: { buffer: counterBuf } },
      { binding: 2, resource: { buffer: spawnBuf } }
    ]
  });

  const mkMod = src => device.createShaderModule({ code: src });

  const blendAlpha = {
    color: {
      srcFactor: 'one',
      dstFactor: 'one-minus-src-alpha',
      operation: 'add'
    },
    alpha: {
      srcFactor: 'one',
      dstFactor: 'one-minus-src-alpha',
      operation: 'add'
    }
  };

  const blendAdd = {
    color: {
      srcFactor: 'one',
      dstFactor: 'one',
      operation: 'add'
    },
    alpha: {
      srcFactor: 'zero',
      dstFactor: 'one',
      operation: 'add'
    }
  };

  const target = b => ({
    format,
    blend: b,
    writeMask: GPUColorWrite.ALL
  });

  bgPipe = device.createRenderPipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [frameBGL]
    }),
    vertex: {
      module: mkMod(BG_WGSL),
      entryPoint: 'vs'
    },
    fragment: {
      module: mkMod(BG_WGSL),
      entryPoint: 'fs',
      targets: [target(null)]
    },
    primitive: {
      topology: 'triangle-list'
    }
  });

  const sprLay = device.createPipelineLayout({
    bindGroupLayouts: [frameBGL, instBGL]
  });

  const sprMod = mkMod(SPRITE_WGSL);

  sprNPipe = device.createRenderPipeline({
    layout: sprLay,
    vertex: {
      module: sprMod,
      entryPoint: 'vs'
    },
    fragment: {
      module: sprMod,
      entryPoint: 'fs',
      targets: [target(blendAlpha)]
    },
    primitive: {
      topology: 'triangle-list'
    }
  });

  sprAPipe = device.createRenderPipeline({
    layout: sprLay,
    vertex: {
      module: sprMod,
      entryPoint: 'vs'
    },
    fragment: {
      module: sprMod,
      entryPoint: 'fs',
      targets: [target(blendAdd)]
    },
    primitive: {
      topology: 'triangle-list'
    }
  });

  const prtLay = device.createPipelineLayout({
    bindGroupLayouts: [frameBGL, partReadBGL]
  });

  const prtMod = mkMod(PART_WGSL);

  partPipe = device.createRenderPipeline({
    layout: prtLay,
    vertex: {
      module: prtMod,
      entryPoint: 'vs'
    },
    fragment: {
      module: prtMod,
      entryPoint: 'fs',
      targets: [target(blendAdd)]
    },
    primitive: {
      topology: 'triangle-list'
    }
  });

  const cmpLay = device.createPipelineLayout({
    bindGroupLayouts: [frameBGL, partRWBGL]
  });

  const cmpMod = mkMod(COMPUTE_WGSL);

  spawnPipe = device.createComputePipeline({
    layout: cmpLay,
    compute: {
      module: cmpMod,
      entryPoint: 'cs_spawn'
    }
  });

  updPipe = device.createComputePipeline({
    layout: cmpLay,
    compute: {
      module: cmpMod,
      entryPoint: 'cs_update'
    }
  });

  /* Claim the canvas only after resource and pipeline setup succeeds so a
     WebGL2 fallback remains possible if WebGPU initialization fails. */
  const canvas = $('view');

  ctx = canvas.getContext('webgpu');

  if (!ctx) {
    throw new Error('WebGPU canvas context unavailable');
  }

  ctx.configure({
    device,
    format,
    alphaMode: 'premultiplied'
  });

  let info = '';

  try {
    info = (adapter.info && (adapter.info.description || adapter.info.vendor)) || '';
  } catch {
    /* Optional adapter info may be unavailable. */
  }

  return info;
}

/* =========================================================================
   WebGL2 backend initialization
   ========================================================================= */

function initGL(atlasCanvas) {
  const c = $('view');

  gl = c.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
  });

  if (!gl) {
    gl = c.getContext('WebGL2');
  }

  if (!gl) {
    throw 'no WebGL2 context (device may be too old, in Low Power Mode, or out of GPU memory)';
  }
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);

    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw 'GL shader: ' + gl.getShaderInfoLog(s);
    }

    return s;
  };

  const prog = (vs, fs) => {
    const p = gl.createProgram();

    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);

    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw 'GL link: ' + gl.getProgramInfoLog(p);
    }

    return p;
  };

  GL = {};

  GL.bg = {
    p: prog(BG_VS_GLSL, BG_FS_GLSL)
  };

  GL.bg.uRes = gl.getUniformLocation(GL.bg.p, 'uRes');
  GL.bg.uTime = gl.getUniformLocation(GL.bg.p, 'uTime');
  GL.bg.uOff = gl.getUniformLocation(GL.bg.p, 'uOff');
  GL.bg.uAberr = gl.getUniformLocation(GL.bg.p, 'uAberr');

  GL.sp = {
    p: prog(SP_VS_GLSL, SP_FS_GLSL)
  };

  GL.sp.uRes = gl.getUniformLocation(GL.sp.p, 'uRes');
  GL.sp.uDpr = gl.getUniformLocation(GL.sp.p, 'uDpr');
  GL.sp.uOff = gl.getUniformLocation(GL.sp.p, 'uOff');
  GL.sp.uTex = gl.getUniformLocation(GL.sp.p, 'uTex');
  GL.sp.uAdd = gl.getUniformLocation(GL.sp.p, 'uAdd');

  GL.bufN = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, GL.bufN);
  gl.bufferData(gl.ARRAY_BUFFER, MAX_INST * 48, gl.DYNAMIC_DRAW);

  GL.bufA = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, GL.bufA);
  gl.bufferData(gl.ARRAY_BUFFER, MAX_INST * 48, gl.DYNAMIC_DRAW);

  const mkVAO = buf => {
    const v = gl.createVertexArray();

    gl.bindVertexArray(v);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);

    for (let l = 0; l < 3; l++) {
      gl.enableVertexAttribArray(l);
      gl.vertexAttribPointer(l, 4, gl.FLOAT, false, 48, l * 16);
      gl.vertexAttribDivisor(l, 1);
    }

    gl.bindVertexArray(null);

    return v;
  };

  GL.vaoN = mkVAO(GL.bufN);
  GL.vaoA = mkVAO(GL.bufA);
  GL.vaoBG = gl.createVertexArray();

  GL.tex = gl.createTexture();

  gl.bindTexture(gl.TEXTURE_2D, GL.tex);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    atlasCanvas
  );

  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  gl.disable(gl.DEPTH_TEST);
}

/* =========================================================================
   Particle palette
   ========================================================================= */

const PAL = {
  ember: [1, 0.42, 0.18],
  amber: [1, 0.72, 0.3],
  cyan: [0.35, 0.95, 1],
  white: [1, 1, 1],
  crimson: [1, 0.25, 0.3],
  teal: [0.2, 0.9, 0.75],
  surge: [1, 0.3, 1]
};

/* =========================================================================
   Particle push helpers
   ========================================================================= */

function pushP(x, y, vx, vy, r, g, b, inten, life, size, drag) {
  if (mode === 'gl') {
    const o = pCursor * 12;

    pPool[o] = x;
    pPool[o + 1] = y;
    pPool[o + 2] = vx;
    pPool[o + 3] = vy;

    pPool[o + 4] = life;
    pPool[o + 5] = life;
    pPool[o + 6] = size;
    pPool[o + 7] = drag;

    pPool[o + 8] = r;
    pPool[o + 9] = g;
    pPool[o + 10] = b;
    pPool[o + 11] = inten;

    pCursor = (pCursor + 1) % PCAP;

    return;
  }

  if (spawnC >= MAX_SPAWN) return;

  const o = spawnC * 12;

  spawnData[o] = x;
  spawnData[o + 1] = y;
  spawnData[o + 2] = vx;
  spawnData[o + 3] = vy;

  spawnData[o + 4] = r;
  spawnData[o + 5] = g;
  spawnData[o + 6] = b;
  spawnData[o + 7] = inten;

  spawnData[o + 8] = life;
  spawnData[o + 9] = life;
  spawnData[o + 10] = size;
  spawnData[o + 11] = drag;

  spawnC++;
}

function stepParticles(dt) {
  for (let i = 0; i < PCAP; i++) {
    const o = i * 12;

    let life = pPool[o + 4];

    if (life <= 0) continue;

    life -= dt;

    if (life <= 0) {
      pPool[o + 4] = 0;
      continue;
    }

    pPool[o + 4] = life;

    const dr = Math.pow(Math.max(pPool[o + 7], 0.001), dt * 60);

    pPool[o + 2] *= dr;
    pPool[o + 3] *= dr;

    pPool[o] += pPool[o + 2] * dt;
    pPool[o + 1] += pPool[o + 3] * dt;

    const k = clamp(life / pPool[o + 5], 0, 1);
    const size = pPool[o + 6] * (0.3 + 0.7 * k);

    push(
      addN,
      pPool[o],
      pPool[o + 1],
      0,
      0,
      size,
      size,
      k * k * pPool[o + 11],
      pPool[o + 8],
      pPool[o + 9],
      pPool[o + 10]
    );
  }
}

/* =========================================================================
   Instance list helpers
   ========================================================================= */

function push(arr, x, y, rot, id, w, h, alpha, r, g, b) {
  const n = (arr === instN) ? instC : addC;

  if (n >= MAX_INST) return;

  const o = n * 12;

  arr[o] = x;
  arr[o + 1] = y;
  arr[o + 2] = rot;
  arr[o + 3] = id;

  arr[o + 4] = w;
  arr[o + 5] = h;
  arr[o + 6] = alpha;
  arr[o + 7] = 0;

  arr[o + 8] = r;
  arr[o + 9] = g;
  arr[o + 10] = b;
  arr[o + 11] = 0;

  if (arr === instN) instC++;
  else addC++;
}

const glow = (x, y, size, r, g, b, a) => {
  push(addN, x, y, 0, 0, size, size, a, r, g, b);
};

/* =========================================================================
   Particle burst / explosion helpers
   ========================================================================= */

function burst(x, y, o) {
  const n = o.n || 16;
  const cols = o.cols || [PAL.ember];

  for (let i = 0; i < n; i++) {
    const a = (o.ang ?? rand(0, TAU)) + (Math.random() - 0.5) * (o.arc ?? TAU);
    const sp = (o.spd || 140) + Math.random() * (o.spdV || 80);
    const c = cols[(Math.random() * cols.length) | 0];

    pushP(
      x + rand(-3, 3),
      y + rand(-3, 3),
      Math.cos(a) * sp,
      Math.sin(a) * sp,
      c[0],
      c[1],
      c[2],
      o.inten ?? 1,
      (o.life || 0.7) * rand(0.55, 1.3),
      (o.size || 8) * rand(0.6, 1.5),
      o.drag ?? 0.92
    );
  }
}

function explosion(x, y, s) {
  burst(x, y, {
    n: Math.round(10 * s),
    spd: 60,
    spdV: 60,
    life: 0.25,
    size: 12 * s,
    cols: [PAL.white, PAL.amber],
    inten: 1.4,
    drag: 0.86
  });

  burst(x, y, {
    n: Math.round(22 * s),
    spd: 200 * s,
    spdV: 130,
    life: 0.8,
    size: 9 * s,
    cols: [PAL.ember, PAL.amber, PAL.crimson],
    drag: 0.9
  });

  burst(x, y, {
    n: Math.round(10 * s),
    spd: 320 * s,
    spdV: 150,
    life: 0.5,
    size: 4,
    cols: [PAL.white, PAL.amber],
    inten: 1.2,
    drag: 0.96
  });

  G.rings.push({
    x,
    y,
    r: 8,
    vr: 480 * s,
    a: 0.85
  });

  const shakeScale = SETTINGS.reduceShake ? 0.35 : 1;
  const shakeCap = SETTINGS.reduceShake ? 14 : 34;
  const aberrScale = SETTINGS.reduceShake ? 0.35 : 1;
  const aberrCap = SETTINGS.reduceShake ? 3 : 8;

  G.shake = Math.min(G.shake + 7 * s * shakeScale, shakeCap);
  G.aberration = Math.min(G.aberration + 3 * s * aberrScale, aberrCap);
}
/* =========================================================================
   UI helpers
   ========================================================================= */

function show(el, on) {
  el.classList.toggle('on', on);
  el.inert = !on;
}

function setChromeVisible(target, on) {
  const el = typeof target === 'string' ? $(target) : target;

  if (!el) return;

  el.classList.toggle('hidden', !on);
  el.inert = !on;
}

function setGameControlsInteractive(on) {
  ['hud', 'levelHud', 'eventHud', 'surge'].forEach(id => {
    const el = $(id);
    if (el) el.inert = !on;
  });
}

function setPauseButton(paused) {
  const button = $('pauseBtn');

  if (!button) return;

  const icon = button.querySelector('.hudbtnIcon');
  const label = button.querySelector('.hudbtnLabel');

  if (icon) icon.textContent = paused ? '▶' : '❚❚';
  if (label) label.textContent = paused ? 'RESUME' : 'PAUSE';

  button.setAttribute('aria-label', paused ? 'Resume game' : 'Pause game');
  button.setAttribute('aria-pressed', String(paused));
}

function syncSoundControls() {
  const soundButton = $('sndBtn');
  const pauseSoundButton = $('pauseSoundBtn');
  const soundOn = !AU.muted;

  if (soundButton) {
    soundButton.classList.toggle('mut', AU.muted);
    soundButton.setAttribute('aria-pressed', String(soundOn));
    soundButton.setAttribute('aria-label', soundOn ? 'Mute sound' : 'Enable sound');
  }

  if (pauseSoundButton) {
    pauseSoundButton.textContent = soundOn ? 'SOUND ON' : 'SOUND OFF';
    pauseSoundButton.setAttribute('aria-pressed', String(soundOn));
  }
}

function banner(txt) {
  const b = $('banner');
  b.textContent = txt;
  b.classList.remove('show');
  void b.offsetWidth;
  b.classList.add('show');
}

function toast(txt, cls) {
  const d = document.createElement('div');
  d.className = 'toast' + (cls ? ' ' + cls : '');
  d.textContent = txt;
  $('toasts').appendChild(d);
  setTimeout(() => d.remove(), 1750);
}

function drawLives() {
  const max = G.maxLives || 3;
  const hull = $('hLives');

  hull.setAttribute('aria-label', `${G.lives} of ${max} hull points remaining`);
  hull.innerHTML = Array.from({ length: max }, (_, i) => {
    return `<span class="pip${i < G.lives ? '' : ' off'}" aria-hidden="true"></span>`;
  }).join('');
}

const cache = {};

function setTxt(el, v) {
  if (!el) return;
  if (cache[el.id] !== v) {
    cache[el.id] = v;
    el.textContent = v;
  }
}

function updateTitleMeta() {
  setTxt($('tHi'), pad7(G.hi));
  setTxt($('tScrap'), String(META.scrap));
  setTxt($('tShip'), currentShip().name);

  const daily = dailyChallengeForDate();
  setTxt($('dailyDate'), daily.date + ' UTC');
  setTxt($('dailyName'), daily.modifier.name);
  setTxt($('dailyDesc'), daily.modifier.description);
  setTxt($('dailyBest'), dailyBestFor(daily.date) ? pad7(dailyBestFor(daily.date)) : '—');
}

/* =========================================================================
   In-run upgrade choices
   ========================================================================= */

function nextRunLevelXp(level) {
  return 220 + Math.max(0, Math.floor(level) - 1) * 90;
}

function runXpValue(type, elite = false) {
  const base = type === 'boss' ? 180 :
    type === 'tank' ? 62 :
    type === 'striker' ? 32 :
    type === 'asteroid' ? 24 :
    18;

  return elite ? Math.round(base * 1.75) : base;
}

function pickRunUpgradeChoices() {
  const ids = Object.keys(RUN_UPGRADES);
  const choices = [];

  while (choices.length < Math.min(3, ids.length)) {
    const id = ids[(runRandom() * ids.length) | 0];

    if (!choices.includes(id)) {
      choices.push(id);
    }
  }

  return choices;
}

function applyRunUpgrade(id) {
  const upgrade = RUN_UPGRADES[id];

  if (!upgrade) return false;

  G.runUpgrades[id] = (G.runUpgrades[id] || 0) + 1;
  G.systemsInstalled++;
  upgrade.apply();
  toast('SYSTEM INSTALLED — ' + upgrade.name, 'gold');

  return true;
}

function renderUpgradeChoices() {
  const cards = $('upgradeCards');

  if (!cards) return;

  cards.innerHTML = '';

  G.upgradeChoices.forEach((id, index) => {
    const upgrade = RUN_UPGRADES[id];

    if (!upgrade) return;

    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'upgradeCard panel ' + upgrade.accent;
    card.setAttribute(
      'aria-label',
      `${upgrade.name}: ${upgrade.desc}`
    );

    card.innerHTML = `
      <span class="upgradeCardTop">
        <span class="upgradeCardIndex">SYSTEM 0${index + 1}</span>
        <span class="upgradeCardIcon" aria-hidden="true">◈</span>
      </span>
      <span class="upgradeCardCategory">${upgrade.category}</span>
      <span class="upgradeCardName">${upgrade.name}</span>
      <span class="upgradeCardDesc">${upgrade.desc}</span>
      <span class="upgradeCardPrompt">SELECT SYSTEM</span>
    `;

    card.addEventListener('click', () => {
      chooseRunUpgrade(id);
    });

    cards.appendChild(card);
  });

  setTxt($('upgradeLevelValue'), String(G.runLevel).padStart(2, '0'));
  setTxt($('upgradeXpValue'), `${Math.floor(G.runXp)} / ${G.runXpNext} XP`);
}

function presentUpgradeChoice() {
  G.state = 'upgrade';
  G.upgradeChoices = pickRunUpgradeChoices();

  show($('ovUpgrade'), true);
  setGameControlsInteractive(false);
  renderUpgradeChoices();

  if (AU.ctx && AU.ctx.state !== 'suspended') {
    AU.ctx.suspend();
  }

  const cards = $('upgradeCards');
  const first = cards && cards.firstElementChild;

  if (first && typeof first.focus === 'function') {
    first.focus();
  }
}

function openUpgradeChoice() {
  if (G.state !== 'playing') return;

  AU.uiConfirm();
  toast('LEVEL ' + String(G.runLevel).padStart(2, '0') + ' REACHED', 'gold');
  presentUpgradeChoice();
}

function closeUpgradeChoice() {
  G.upgradeChoices = [];
  show($('ovUpgrade'), false);
  setGameControlsInteractive(true);
  G.state = 'playing';

  if (AU.ctx) {
    AU.ctx.resume();
  }
}

function chooseRunUpgrade(id) {
  if (G.state !== 'upgrade' || !G.upgradeChoices.includes(id)) return false;

  AU.ensure();
  applyRunUpgrade(id);
  G.upgradeQueue = Math.max(0, G.upgradeQueue - 1);

  if (G.upgradeQueue > 0) {
    presentUpgradeChoice();
  } else {
    closeUpgradeChoice();
  }

  AU.uiConfirm();
  return true;
}

function awardRunXp(amount) {
  if (G.state !== 'playing' || !Number.isFinite(amount) || amount <= 0) {
    return;
  }

  G.runXp += amount;

  while (G.runXp >= G.runXpNext) {
    G.runXp -= G.runXpNext;
    G.runLevel++;
    G.runXpNext = nextRunLevelXp(G.runLevel);
    G.upgradeQueue++;
  }

  if (G.upgradeQueue > 0) {
    openUpgradeChoice();
  }
}

/* =========================================================================
   Hangar UI
   ========================================================================= */

function openHangar() {
  if (G.state !== 'title' && G.state !== 'over') return;

  G.state = 'hangar';

  show($('ovTitle'), false);
  show($('ovOver'), false);
  show($('ovUpgrade'), false);
  show($('ovHangar'), true);

  ['hud', 'levelHud', 'eventHud', 'combo', 'chips', 'surge', 'boss'].forEach(id => {
    setChromeVisible(id, false);
  });

  AU.ensure();
  renderHangar();
}

function closeHangar() {
  G.state = 'title';

  show($('ovHangar'), false);
  show($('ovTitle'), true);

  updateTitleMeta();
}

const SETTING_CONTROLS = {
  reduceFlash: ['settingFlash', 'settingFlashState'],
  reduceShake: ['settingShake', 'settingShakeState'],
  lowQuality: ['settingQuality', 'settingQualityState']
};

function setInputResponse(value, playUi = false) {
  const percent = Number(value);

  if (!Number.isFinite(percent)) return;

  SETTINGS.inputResponse = clamp(
    percent / 100,
    INPUT_RESPONSE_MIN,
    INPUT_RESPONSE_MAX
  );

  saveSettings();
  renderSettings();

  if (playUi) AU.uiConfirm();
}

function renderSettings() {
  for (const [key, [buttonId, stateId]] of Object.entries(SETTING_CONTROLS)) {
    const enabled = !!SETTINGS[key];
    const button = $(buttonId);

    button.classList.toggle('on', enabled);
    button.setAttribute('aria-pressed', String(enabled));
    $(stateId).textContent = enabled ? 'ON' : 'OFF';
  }

  const responsePercent = Math.round(SETTINGS.inputResponse * 100);
  const responseRange = $('settingResponseRange');

  responseRange.value = String(responsePercent);
  responseRange.setAttribute('aria-valuenow', String(responsePercent));
  responseRange.setAttribute('aria-valuetext', responsePercent + '%');
  $('settingResponseState').textContent = responsePercent + '%';
}

function toggleSetting(key) {
  if (!Object.hasOwn(SETTING_CONTROLS, key)) return;

  SETTINGS[key] = !SETTINGS[key];
  saveSettings();

  if (key === 'reduceFlash' && SETTINGS.reduceFlash) {
    $('flash').style.opacity = 0;
  }

  if (key === 'reduceShake' && SETTINGS.reduceShake) {
    G.shake = 0;
    G.offX = 0;
    G.offY = 0;
  }

  if (key === 'lowQuality') {
    quality = SETTINGS.lowQuality ? 0.66 : 1;
    resize();
  }

  renderSettings();
  AU.uiConfirm();
}

function renderHangar() {
  $('hScrap').textContent = META.scrap;
  renderSettings();

  /* Ships */
  const sg = $('shipGrid');
  sg.innerHTML = '';

  for (const [id, s] of Object.entries(SHIPS)) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'shipCard panel' + (META.ship === id ? ' sel' : '');
    card.setAttribute('aria-pressed', String(META.ship === id));

    card.innerHTML = `
      <div class="shipName" style="color:${s.color}">${s.name}</div>
      <div class="shipDesc">${s.desc}</div>
      <div class="shipStats">
        <span>SPEED ${s.speed.toFixed(2)}×</span>
        <span>HULL ${s.lives}</span>
        <span>FIRE ${s.fire.toFixed(2)}×</span>
      </div>
    `;

    card.addEventListener('click', () => {
      AU.ensure();
      META.ship = id;
      saveMeta();
      renderHangar();
      updateTitleMeta();
      AU.uiConfirm();
    });

    sg.appendChild(card);
  }

  /* Upgrades */
  const ug = $('upGrid');
  ug.innerHTML = '';

  for (const [id, u] of Object.entries(UPGRADES)) {
    const lvl = getUpgradeLevel(id);
    const maxed = lvl >= u.max;
    const cost = maxed ? 0 : u.cost(lvl);

    const row = document.createElement('div');
    row.className = 'upRow panel';

    row.innerHTML = `
      <div>
        <div class="upName">${u.name}</div>
        <div class="upDesc">${u.desc}</div>
      </div>
      <div class="upLvl">LV ${lvl}/${u.max}</div>
      <button type="button" class="buy${maxed ? ' max' : ''}" ${maxed || META.scrap < cost ? 'disabled' : ''}>
        ${maxed ? 'MAX' : cost + ' SCRAP'}
      </button>
    `;

    const btn = row.querySelector('button');

    btn.addEventListener('click', () => {
      AU.ensure();

      if (maxed || META.scrap < cost) {
        AU.uiError();
        return;
      }

      META.scrap -= cost;
      META.upgrades[id]++;

      saveMeta();
      unlockAch('hangarBuy');

      renderHangar();
      updateTitleMeta();

      AU.uiConfirm();
    });

    ug.appendChild(row);
  }

  /* Cosmetics */
  const cg = $('cosmeticsGrid');
  cg.innerHTML = '';

  const cosmeticGroups = [
    ['colors', 'SHIP COLORS'],
    ['trails', 'ENGINE TRAILS'],
    ['engines', 'ENGINE EFFECTS'],
    ['victories', 'VICTORY EFFECTS']
  ];

  for (const [category, label] of cosmeticGroups) {
    const group = document.createElement('div');
    group.className = 'cosmeticGroup';
    group.innerHTML = `<div class="cosmeticGroupTitle">${label}</div><div class="cosmeticOptions"></div>`;

    const options = group.querySelector('.cosmeticOptions');
    const selected = META.cosmetics[category];

    for (const item of cosmeticList(category)) {
      const unlocked = cosmeticUnlocked(item);
      const active = selected === item.id && unlocked;
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'cosmeticCard panel' + (active ? ' sel' : '') + (!unlocked ? ' locked' : '');
      card.disabled = !unlocked;
      card.setAttribute('aria-pressed', String(active));
      card.setAttribute('aria-label', `${item.name}${unlocked ? '' : ' — locked'}`);
      card.innerHTML = `
        <span class="cosmeticSwatch" style="--cosmetic:${item.hex}"></span>
        <span class="cosmeticInfo">
          <b>${item.name}</b>
          <small>${unlocked ? item.desc : 'UNLOCK: ' + ACHIEVEMENTS[item.requires].name}</small>
        </span>
        <span class="cosmeticState">${active ? 'EQUIPPED' : unlocked ? 'EQUIP' : 'LOCKED'}</span>
      `;

      card.addEventListener('click', () => {
        AU.ensure();
        if (equipCosmetic(category, item.id)) {
          renderHangar();
          if (G.state === 'playing') resetRun(G.runMode);
          updateTitleMeta();
          AU.uiConfirm();
        }
      });

      options.appendChild(card);
    }

    cg.appendChild(group);
  }

  /* Achievements */
  const ag = $('achGrid');
  ag.innerHTML = '';

  for (const [id, a] of Object.entries(ACHIEVEMENTS)) {
    const unlocked = !!META.achievements[id];

    const d = document.createElement('div');
    d.className = 'ach panel' + (unlocked ? ' unlocked' : '');

    d.innerHTML = `
      <div class="achName">${a.name}</div>
      <div class="achDesc">${a.desc}</div>
    `;

    ag.appendChild(d);
  }
}

/* =========================================================================
   Run setup
   ========================================================================= */

function resetRun(runMode = G.runMode) {
  const ship = currentShip();
  const cosmetics = equippedCosmetics();
  const up = META.upgrades;
  const selectedMode = runMode === 'daily' ? 'daily' : 'standard';
  const dailySeed = selectedMode === 'daily' ? dailyChallengeForDate() : null;
  const challenge = dailySeed
    ? {
      ...dailySeed,
      mode: 'daily',
      rngState: dailySeed.seed,
      bestScore: dailyBestFor()
    }
    : null;

  G.maxLives = ship.lives + up.hull;
  G.surgeMult = 1 + 0.25 * up.surge;
  G.magnetR = 130 * (1 + 0.4 * up.magnet);

  G.shipSprite =
    META.ship === 'interceptor' ? 16 :
    META.ship === 'bastion' ? 17 :
    1;

  const shipEngineCol =
    META.ship === 'interceptor' ? [1, 0.72, 0.3] :
    META.ship === 'bastion' ? [1, 0.36, 0.28] :
    [0.35, 0.95, 1];

  const shipEnginePal =
    META.ship === 'interceptor' ? [
      [1, 0.9, 0.7],
      [1, 0.72, 0.3],
      [1, 0.5, 0.15]
    ] :
    META.ship === 'bastion' ? [
      [1, 0.7, 0.6],
      [1, 0.36, 0.28],
      [0.8, 0.15, 0.15]
    ] : [
      [1, 1, 1],
      [0.62, 0.96, 1],
      [0.3, 0.85, 1]
    ];

  const engineProfile = cosmetics.engine.id === 'standard'
    ? { ...cosmetics.engine, color: shipEngineCol }
    : cosmetics.engine;
  const trailProfile = cosmetics.trail.id === 'ion'
    ? { ...cosmetics.trail, palette: shipEnginePal }
    : cosmetics.trail;

  G.shipTint = cosmetics.color.id === 'ship'
    ? [1, 1, 1]
    : cosmetics.color.rgb;
  G.engineCol = engineProfile.color;
  G.enginePal = trailProfile.palette;
  G.trailProfile = trailProfile;
  G.engineProfile = engineProfile;
  G.trailStyle = cosmetics.trail.id;
  G.engineStyle = cosmetics.engine.id;
  G.victoryStyle = cosmetics.victory.id;

  Object.assign(G, {
    score: 0,
    runStartHi: G.hi,
    runMode: selectedMode,
    challenge,
    lastRun: null,
    runTime: 0,
    shotsFired: 0,
    shotsHit: 0,
    damageDealt: 0,
    damageTaken: 0,
    eliteKills: 0,
    bossesDefeated: 0,
    systemsInstalled: 0,
    lives: G.maxLives,
    wave: 0,
    eventId: 'standard',
    eventEliteSpawned: false,
    kills: 0,
    dropDry: 0,

    combo: 0,
    comboT: 0,
    mult: 1,
    maxCombo: 0,

    runLevel: 1,
    runXp: 0,
    runXpNext: nextRunLevelXp(1),
    upgradeQueue: 0,
    upgradeChoices: [],
    runUpgrades: {},

    shake: 0,
    timeScale: 1,
    slowT: 0,
    timeSlowT: 0,

    overDelay: 0,
    overReady: false,

    surge: 0,
    surgeActive: false,
    surgeT: 0,
    surgeCooldown: 0,
    surgeDuration: 5,
    critChance: 0,
    comboGuard: 0,

    hitStop: 0,
    aberration: 0
  });

  G.bullets.length = 0;
  G.ebullets.length = 0;
  G.bossNodes.length = 0;
  G.enemies.length = 0;
  G.powerups.length = 0;
  G.rings.length = 0;
  G.missiles.length = 0;

  const p = G.player;

  Object.assign(p, {
    x: G.w / 2,
    y: G.h - 110,
    vx: 0,
    vy: 0,
    cool: 0,
    inv: 1.5,

    triple: 0,
    rapid: ship.rapid ? POWERUP_DURATION : 0,
    piercing: 0,
    magnet: 0,
    shield: Math.min(2, (ship.shield || 0) + (up.shield || 0)),
    missile: (ship.seeker || up.seeker) ? POWERUP_DURATION : 0,

    mCool: 0,
    mSide: 1,
    alive: true,

    rateMult: (1 / ship.fire) * (1 - 0.12 * up.rapid),
    speedMult: ship.speed * (1 + 0.1 * up.speed)
  });

  keys.clear();

  G.state = 'playing';

  AU.ensure();
  AU.step = 0;

  if (AU.ctx) {
    AU.musicT = AU.ctx.currentTime + 0.1;
  }

  show($('ovTitle'), false);
  show($('ovOver'), false);
  show($('ovPause'), false);
  show($('ovUpgrade'), false);
  show($('ovHangar'), false);

  ['hud', 'levelHud', 'eventHud', 'combo', 'chips', 'surge'].forEach(id => {
    setChromeVisible(id, true);
  });

  setChromeVisible('eventHud', false);

  setChromeVisible('boss', false);
  setGameControlsInteractive(true);

  setPauseButton(false);

  startWave(1);
  drawLives();

  if (G.maxLives >= 6) {
    unlockAch('hullMax');
  }
}

/* =========================================================================
   Waves and enemy spawning
   ========================================================================= */

function startWave(n) {
  G.wave = n;
  G.eventId = 'standard';
  G.eventEliteSpawned = false;

  if (n >= 10) {
    unlockAch('wave10');
  }

  if (n % 5 === 0) {
    G.waveQ = 0;
    G.spawnT = 0;
    G.waveState = 'clearing';

    banner('DREADNOUGHT');
    toast('BOSS INBOUND', 'red');

    spawnBoss();
    AU.bossWarn();

    return;
  }

  const event = waveEvent(n);
  const threat = waveProfile(n);

  G.eventId = event ? event.id : 'standard';
  G.waveQ = Math.ceil(threat.count * (event ? event.spawnMultiplier : 1));
  G.spawnT = 1.1;
  G.waveState = 'spawning';

  if (event) {
    banner(event.name);
    toast(event.description, event.tone);
  } else {
    banner('WAVE ' + String(n).padStart(2, '0'));
  }

  AU.waveSnd();
}

/* Keep the late-run threat curve moving instead of letting enemy count and
   enemy durability flatten after the first few waves. */
function waveProfile(n = G.wave) {
  const wave = Math.max(1, Math.floor(n));
  const progress = wave - 1;
  const daily = dailyModifier();
  const base = {
    count: Math.min(10 + wave * 3 + Math.floor(wave / 5), 58),
    speed: 1 + Math.min(0.5, progress * 0.03),
    spawnGap: Math.max(0.3, 1.15 - wave * 0.055),
    droneHp: 1 + Math.floor(progress / 8),
    strikerHp: 2 + Math.floor(progress / 7),
    asteroidHp: 8 + Math.floor(wave * 0.8),
    tankHp: 7 + Math.floor(wave * 0.65),
    fireFloor: Math.max(0.82, 1.2 - progress * 0.025)
  };

  if (!daily) return base;

  const hpMultiplier = daily.hpMultiplier || 1;

  return {
    count: Math.max(1, Math.round(base.count * (daily.countMultiplier || 1))),
    speed: base.speed * (daily.speedMultiplier || 1),
    spawnGap: Math.max(0.24, base.spawnGap * (daily.spawnGapMultiplier || 1)),
    droneHp: Math.max(1, Math.ceil(base.droneHp * hpMultiplier)),
    strikerHp: Math.max(1, Math.ceil(base.strikerHp * hpMultiplier)),
    asteroidHp: Math.max(1, Math.ceil(base.asteroidHp * hpMultiplier)),
    tankHp: Math.max(1, Math.ceil(base.tankHp * hpMultiplier)),
    fireFloor: Math.max(0.7, base.fireFloor * (daily.fireMultiplier || 1))
  };
}

function waveEvent(n = G.wave) {
  const wave = Math.max(1, Math.floor(n));

  if (wave < 3 || wave % 5 === 0) return null;
  if (wave % 7 === 0) return WAVE_EVENTS.salvageRun;
  if (wave % 4 === 0) return WAVE_EVENTS.asteroidStorm;
  if (wave % 3 === 0) return WAVE_EVENTS.eliteHunt;

  return null;
}

function activeWaveEvent() {
  return WAVE_EVENTS[G.eventId] || null;
}

function eliteChance(wave = G.wave, eventId = G.eventId) {
  if (wave < 3) return 0;

  const base = Math.min(0.05 + Math.max(0, wave - 3) * 0.012, 0.24);
  const eventBoost = WAVE_EVENTS[eventId]?.eliteBoost || 0;

  return Math.min(0.52, base + eventBoost);
}

function pickType() {
  const r = runRandom();
  const event = activeWaveEvent();

  const ast = Math.min(
    0.06 + G.wave * 0.008 + (event?.asteroidBias || 0),
    event?.id === 'asteroidStorm' ? 0.58 : 0.18
  );
  const tank = Math.min(0.06 + G.wave * 0.022, 0.3);
  const stri = Math.min(0.16 + G.wave * 0.034, 0.46);

  if (r < ast) return 'asteroid';

  const rr = (r - ast) / (1 - ast);

  return rr < tank ? 'tank' : rr < tank + stri ? 'striker' : 'drone';
}

function pickEliteKind() {
  const r = runRandom();

  return r < 0.42 ? 'aegis' : r < 0.76 ? 'berserker' : 'splitter';
}

function applyEliteModifier(e, kind = pickEliteKind()) {
  const profile = ELITE_TYPES[kind] || ELITE_TYPES.aegis;
  const scale = 1.35 + Math.min(0.35, Math.max(0, G.wave - 3) * 0.018);

  e.elite = true;
  e.eliteKind = kind;
  e.eliteName = profile.name;
  e.eliteColor = profile.color;
  e.maxHp = Math.ceil(e.hp * scale);
  e.hp = e.maxHp;
  e.val = Math.round(e.val * 2.25);
  e.vy *= profile.speed;

  if (kind === 'aegis') {
    e.shieldMax = Math.ceil(4 + G.wave * 0.65);
    e.shieldHp = e.shieldMax;
    e.shieldBroken = false;
  } else if (kind === 'berserker') {
    e.rage = true;
  } else {
    e.splitCount = 2;
  }

  return e;
}

function eliteSpeedScale(e) {
  if (e.eliteKind !== 'berserker') return 1;

  const health = clamp(e.hp / Math.max(e.maxHp || e.hp, 1), 0, 1);
  return 1.05 + (1 - health) * 0.62;
}

function spawnEnemy() {
  if (G.enemies.length > 70) return;

  const type = pickType();
  const threat = waveProfile();

  const e = {
    type,
    x: gameRand(50, G.w - 50),
    y: -60,
    t: gameRand(0, 6),
    flash: 0,
    fireT: gameRand(1.2, 2.6)
  };

  if (type === 'drone') {
    e.hp = threat.droneHp;
    e.r = 24;
    e.baseX = e.x;
    e.amp = gameRand(40, 120);
    e.freq = gameRand(1.2, 2.2);
    e.vy = (gameRand(70, 100) + G.wave * 3) * threat.speed;
    e.val = 100;
  } else if (type === 'striker') {
    e.hp = threat.strikerHp;
    e.r = 22;
    e.vy = (gameRand(120, 160) + G.wave * 4) * threat.speed;
    e.val = 250;
  } else if (type === 'asteroid') {
    e.hp = threat.asteroidHp;
    e.r = gameRand(26, 44);
    e.vy = (gameRand(45, 85) + G.wave * 2) * threat.speed;
    e.vx = gameRand(-35, 35);
    e.rot = gameRand(0, TAU);
    e.vr = gameRand(-1.1, 1.1);
    e.val = 150;
    e.fireT = 9999;
  } else {
    e.hp = threat.tankHp;
    e.r = 36;
    e.vy = (34 + G.wave) * threat.speed;
    e.val = 600;
  }

  const event = activeWaveEvent();
  const guaranteedElite = event?.id === 'eliteHunt' &&
    type !== 'asteroid' &&
    !G.eventEliteSpawned;

  if (type !== 'asteroid' && (guaranteedElite || runRandom() < eliteChance())) {
    applyEliteModifier(e);

    if (event?.id === 'eliteHunt') {
      G.eventEliteSpawned = true;
    }
  }

  G.enemies.push(e);
}

function enemyFire(e) {
  const p = G.player;
  if (!p.alive) return;

  const dx = p.x - e.x;
  const dy = p.y - e.y;
  const spd = Math.min(155 + G.wave * 7, 360);

  const shot = ang => {
    const a = Math.atan2(dy, dx) + ang;
    G.ebullets.push({
      x: e.x,
      y: e.y + e.r * 0.4,
      vx: Math.cos(a) * spd,
      vy: Math.sin(a) * spd,
      r: 7
    });
  };

  if (e.type === 'tank') {
    shot(-0.3);
    shot(0);
    shot(0.3);
  } else if (e.eliteKind === 'berserker') {
    shot(-0.12);
    shot(0.12);
  } else {
    shot(0);
  }
}

function nearestEnemy(x, y) {
  let best = null;
  let bd = 1e18;

  for (const e of G.enemies) {
    if (!enemyIsTargetable(e)) continue;

    const d = (e.x - x) * (e.x - x) + (e.y - y) * (e.y - y);
    if (d < bd) {
      bd = d;
      best = e;
    }
  }

  return best;
}

function enemyIsTargetable(e) {
  if (e.type === 'boss') return e.entered === true;
  return e.y >= Math.max(e.r || 0, 0);
}

function damageBoss(e, amount) {
  if (!e.entered || e.phaseTransitionT > 0) return false;

  const profile = bossCombatProfile(e);
  const raw = Math.max(0, Number(amount) || 0);
  const multiplier =
    (e.coreOpen ? profile.coreMultiplier : 0.72) *
    profile.damageTakenMultiplier;

  const dealt = raw * multiplier;
  G.damageDealt += dealt;
  e.hp -= dealt;
  return e.hp <= 0;
}

function damageEnemy(e, amount) {
  let remaining = Math.max(0, Number(amount) || 0);

  if (e.type === 'boss') {
    return damageBoss(e, remaining);
  }

  if (e.eliteKind === 'aegis' && e.shieldHp > 0) {
    const absorbed = Math.min(e.shieldHp, remaining);

    e.shieldHp -= absorbed;
    remaining -= absorbed;

    if (e.shieldHp <= 0 && !e.shieldBroken) {
      e.shieldHp = 0;
      e.shieldBroken = true;

      G.rings.push({
        x: e.x,
        y: e.y,
        r: e.r * 0.7,
        vr: 520,
        a: 0.9
      });

      burst(e.x, e.y, {
        n: 18,
        spd: 180,
        spdV: 90,
        life: 0.45,
        size: 7,
        cols: [PAL.cyan, PAL.white],
        drag: 0.9
      });

      toast('AEGIS SHIELD BROKEN', 'gold');
    }
  }

  G.damageDealt += remaining;
  e.hp -= remaining;
  return e.hp <= 0;
}

function projectileDamage(base) {
  return G.critChance > 0 && runRandom() < G.critChance
    ? base * 2
    : base;
}

/* =========================================================================
   SURGE
   ========================================================================= */

function activateSurge() {
  if (G.surge < 100 || G.surgeActive || G.surgeCooldown > 0) return;

  G.surgeActive = true;
  G.surgeT = G.surgeDuration;
  G.surge = 0;
  G.surgeCooldown = 8.0;

  G.aberration = Math.min(G.aberration + 6, SETTINGS.reduceShake ? 3 : 8);
  G.shake += SETTINGS.reduceShake ? 5 : 15;

  AU.surgeSnd();
  unlockAch('surgeUsed');

  banner('SURGE ENGAGED');
  toast('OVERDRIVE ACTIVE', 'surge');

  G.rings.push({
    x: G.player.x,
    y: G.player.y,
    r: 50,
    vr: 800,
    a: 1
  });

  burst(G.player.x, G.player.y, {
    n: 40,
    spd: 300,
    spdV: 200,
    life: 0.8,
    size: 12,
    cols: [PAL.surge, PAL.white, PAL.cyan],
    drag: 0.85
  });
}

/* =========================================================================
   Boss helpers
   ========================================================================= */

function eb(x, y, vx, vy, r = 7, damage = 1) {
  if (G.ebullets.length < 340) {
    G.ebullets.push({ x, y, vx, vy, r, damage });
  }
}

function bossAimedSpread(e, n, spread) {
  const p = G.player;
  if (!p.alive) return;

  const base = Math.atan2(p.y - e.y, p.x - e.x);
  const combat = bossCombatProfile(e);
  const spd = Math.min(
    (210 + G.wave * 7) * combat.projectileSpeedMultiplier,
    520
  );

  for (let i = 0; i < n; i++) {
    const a = base + (i - (n - 1) / 2) * spread;
    eb(
      e.x,
      e.y + e.r * 0.35,
      Math.cos(a) * spd,
      Math.sin(a) * spd,
      7,
      combat.damageMultiplier
    );
  }
}

function bossSpiral(e, arms = 3) {
  e.spiralA = (e.spiralA || 0) + 0.42;

  const combat = bossCombatProfile(e);
  const spd = Math.min(
    (165 + G.wave * 5) * combat.projectileSpeedMultiplier,
    450
  );

  for (let k = 0; k < arms; k++) {
    const a = e.spiralA + k * TAU / arms;
    eb(
      e.x,
      e.y,
      Math.cos(a) * spd,
      Math.sin(a) * spd,
      6,
      combat.damageMultiplier
    );
  }
}

function bossWall(e) {
  const combat = bossCombatProfile(e);
  const n = 11 + Math.min(3, combat.extraProjectiles);
  const gap = (runRandom() * n) | 0;
  const y = e.y + e.r * 0.45;
  const spd = Math.min(
    (210 + G.wave * 6) * combat.projectileSpeedMultiplier,
    470
  );

  for (let i = 0; i < n; i++) {
    if (i === gap || i === gap + 1) continue;

    const x = e.x + (i - (n - 1) / 2) * 48;

    eb(x, y, gameRand(-14, 14), spd, 7, combat.damageMultiplier);
  }
}

/* Boss relays turn the exposed-core window into an active decision instead of
   a passive damage phase. The pilot can break the orbiting nodes for a safe
   stagger, or keep firing the hull and accept the telegraphed overload. */
function clearBossRelays(e) {
  for (let i = G.bossNodes.length - 1; i >= 0; i--) {
    if (G.bossNodes[i].boss === e) {
      G.bossNodes.splice(i, 1);
    }
  }

  e.relayActive = false;
  e.relayTimer = 0;
  e.relayRemaining = 0;
  e.relayTotal = 0;
}

function spawnBossRelays(e) {
  if (!e.entered || e.phaseTransitionT > 0 || e.relayActive) return false;

  const profile = bossCombatProfile(e);
  const count = clamp(Math.round(profile.relayCount || 2), 2, 5);
  const nodeHp = 2 +
    Math.min(3, Math.floor(Math.max(0, (e.tier || 1) - 1) / 2)) +
    (e.phase >= 3 ? 1 : 0);

  clearBossRelays(e);

  e.relayActive = true;
  e.relayTotal = count;
  e.relayRemaining = count;
  e.relayTimer = profile.relayDuration;
  e.relayT = profile.relayInterval;

  for (let k = 0; k < count; k++) {
    const direction = k % 2 === 0 ? 1 : -1;

    G.bossNodes.push({
      boss: e,
      angle: TAU * k / count + e.t * 0.1,
      orbit: 142 + (k % 2) * 24 + e.phase * 4,
      orbitY: 0.58 + (k % 2) * 0.06,
      orbitSpeed: direction * (0.72 + e.phase * 0.08 + (e.tier || 1) * 0.02),
      x: e.x,
      y: e.y,
      r: 19,
      hp: nodeHp,
      maxHp: nodeHp,
      flash: 0
    });
  }

  toast('REACTOR RELAYS EXPOSED', 'gold');
  banner('BREAK THE RELAYS');
  return true;
}

function bossRelayDestroyed(node) {
  const e = node && node.boss;

  if (!e || !e.relayActive) return false;

  const index = G.bossNodes.indexOf(node);

  if (index < 0) return false;

  G.bossNodes.splice(index, 1);
  e.relayRemaining = Math.max(0, e.relayRemaining - 1);
  G.score += Math.round(180 * (e.tier || 1));
  G.surge = Math.min(100, G.surge + 7 * G.surgeMult);

  if (G.score > G.hi) {
    G.hi = G.score;
  }

  G.rings.push({
    x: node.x,
    y: node.y,
    r: 12,
    vr: 440,
    a: 0.9
  });

  burst(node.x, node.y, {
    n: 16,
    spd: 180,
    spdV: 100,
    life: 0.48,
    size: 7,
    cols: [PAL.cyan, PAL.white, PAL.surge],
    drag: 0.89
  });

  toast(
    e.relayRemaining > 0
      ? 'RELAY BROKEN · ' + e.relayRemaining + ' LEFT'
      : 'RELAY NETWORK COLLAPSED',
    'gold'
  );

  if (e.relayRemaining === 0) {
    bossRelayBreak(e);
  }

  return true;
}

function damageBossRelay(node, amount) {
  if (!node || !node.boss || node.hp <= 0) return false;

  const dealt = Math.max(0, Number(amount) || 0);
  node.hp -= dealt;
  node.flash = 1;
  G.damageDealt += dealt;

  if (node.hp <= 0) {
    return bossRelayDestroyed(node);
  }

  return false;
}

function bossRelayBreak(e) {
  if (!e || !e.relayActive) return;

  const profile = bossCombatProfile(e);

  clearBossRelays(e);
  e.staggerT = Math.max(1.35, 1.65 - (e.tier || 1) * 0.04);
  e.coreOpen = true;
  e.coreOpenT = e.staggerT;
  e.attackT = profile.cooldown + e.staggerT + 0.55;
  e.telegraphT = 0;
  e.pendingAttack = null;

  G.ebullets.length = 0;
  G.surge = Math.min(100, G.surge + 18 * G.surgeMult);
  G.score += 500 * (e.tier || 1);

  if (G.score > G.hi) {
    G.hi = G.score;
  }

  awardRunXp(45 + (e.tier || 1) * 12);
  AU.boom(1.2, e.x);
  toast('DREADNOUGHT STAGGERED · COUNTERFIRE', 'surge');
  banner('RELAY BREAK');
}

function bossRelayFailure(e) {
  if (!e || !e.relayActive) return;

  const profile = bossCombatProfile(e);

  clearBossRelays(e);
  e.overloadCount = (e.overloadCount || 0) + 1;
  e.rage = clamp((e.rage || 0) + 0.14, 0, 0.85);
  e.pendingAttack = 'overload';
  e.telegraphT = Math.max(0.26, profile.telegraph * 0.8);
  e.attackName = profile.variantName + ' · RELAY OVERLOAD';
  e.coreOpen = false;
  e.coreOpenT = 0;
  e.attackT = Math.min(e.attackT, profile.cooldown * 0.55);
  e.relayT = profile.relayInterval * 0.62;

  G.ebullets.length = 0;
  spawnBossAdd(e, 1 + Math.min(2, profile.addCount));
  toast('RELAY FAILURE · BOSS ENRAGED', 'red');
  banner('REACTOR OVERLOAD');
}

function updateBossRelays(dt) {
  for (let i = G.bossNodes.length - 1; i >= 0; i--) {
    const node = G.bossNodes[i];
    const e = node.boss;

    if (!e || !e.relayActive) {
      G.bossNodes.splice(i, 1);
      continue;
    }

    node.angle += node.orbitSpeed * dt;
    node.flash = Math.max(0, node.flash - dt * 5);
    node.x = e.x + Math.cos(node.angle) * node.orbit;
    node.y = e.y + Math.sin(node.angle) * node.orbit * node.orbitY;
  }
}

function spawnBossAdd(e, count = 1) {
  const eliteChanceForAdds = Math.min(
    0.32,
    Math.max(0, (e.tier || 1) - 2) * 0.08
  );

  for (let k = 0; k < count; k++) {
    if (G.enemies.length > 56) return;

    const type = runRandom() < Math.max(0.58, 0.72 - (e.tier || 1) * 0.018)
      ? 'drone'
      : 'striker';
    const threat = waveProfile();

    const a = {
      type,
      x: clamp(e.x + gameRand(-260, 260), 50, G.w - 50),
      y: -60,
      t: gameRand(0, 6),
      flash: 0,
      fireT: gameRand(1.2, 2.4)
    };

    if (type === 'drone') {
      a.hp = threat.droneHp;
      a.r = 24;
      a.baseX = a.x;
      a.amp = gameRand(36, 100);
      a.freq = gameRand(1.2, 2.2);
      a.vy = (gameRand(82, 116) + G.wave * 3) * threat.speed;
      a.val = 100;
    } else {
      a.hp = threat.strikerHp;
      a.r = 22;
      a.vy = (gameRand(132, 172) + G.wave * 4) * threat.speed;
      a.val = 250;
    }

    if (runRandom() < eliteChanceForAdds) {
      applyEliteModifier(a);
    }

    /* Higher-tier bosses do not just summon more bodies; their escorts also
       arrive with the same late-run durability curve as the main wave. */
    a.vy *= 1 + Math.min(0.28, ((e.tier || 1) - 1) * 0.04);
    G.enemies.push(a);
  }
}

function bossPhaseFX(e) {
  const profile = bossCombatProfile(e);

  e.flash = 1;
  e.phaseTransitionT = 1.1;
  e.telegraphT = 0;
  e.coreOpenT = 0;
  e.coreOpen = false;
  e.attackT = profile.cooldown;
  e.addT = profile.addInterval;
  e.relayT = Math.min(2.8, profile.relayInterval * 0.55);
  e.staggerT = 0;
  e.pendingAttack = null;
  e.rage = Math.max(e.rage || 0, (e.phase - 1) * 0.14);
  clearBossRelays(e);
  e.attackName = 'PHASE SHIFT';

  /* A phase change is a readable reset point. Clearing the old pattern keeps
     bullets from one phase leaking unfairly into the next one. */
  G.ebullets.length = 0;

  G.rings.push({
    x: e.x,
    y: e.y,
    r: e.r * 0.6,
    vr: 620,
    a: 0.9
  });

  burst(e.x, e.y, {
    n: 26,
    spd: 230,
    spdV: 160,
    life: 0.65,
    size: 9,
    cols: [PAL.white, PAL.surge, PAL.crimson],
    drag: 0.9
  });

  G.hitStop = Math.max(G.hitStop, 0.045);
  G.shake = Math.min(G.shake + (SETTINGS.reduceShake ? 3 : 8), SETTINGS.reduceShake ? 14 : 38);

  AU.bossPhase();
  banner('PHASE ' + e.phase + ' — ' + profile.name);
  toast('DREADNOUGHT ' + profile.name + ' ONLINE', 'red');
}

function spawnBoss() {
  const lvl = Math.max(1, Math.floor(G.wave / 5));
  const encounter = bossEncounterProfile(lvl);
  const hp = Math.round((260 + lvl * 125) * encounter.hpMultiplier);

  G.enemies.push({
    type: 'boss',
    x: G.w / 2,
    y: -240,
    t: gameRand(0, 6),
    flash: 0,
    attackT: 1.2,
    telegraphT: 0,
    coreOpenT: 0,
    phaseTransitionT: 0,
    staggerT: 0,
    coreOpen: false,
    attackName: BOSS_PHASES[1].attack,
    pendingAttack: null,

    hp,
    maxHp: hp,

    r: 105,
    val: 5000 + lvl * 2500,

    tier: lvl,
    variantId: encounter.variantId,
    variantName: encounter.variantName,
    phase: 1,
    pattern: 0,
    spiralA: 0,
    attackCount: 0,
    overloadCount: 0,
    rage: 0,
    relayT: 3.2,
    relayTimer: 0,
    relayActive: false,
    relayRemaining: 0,
    relayTotal: 0,
    addT: BOSS_PHASES[1].addInterval * encounter.addIntervalMultiplier,
    entered: false
  });
}

function beginBossAttack(e) {
  const profile = bossCombatProfile(e);

  e.telegraphT = profile.telegraph;
  e.attackName = profile.variantName + ' · ' + profile.attack;
  e.pendingAttack = 'standard';
  e.coreOpen = false;
  e.coreOpenT = 0;
}

function fireBossOverload(e) {
  const profile = bossCombatProfile(e);
  const pressure = profile.extraProjectiles + 1;

  bossWall(e);
  bossSpiral(e, 5 + pressure);
  bossAimedSpread(e, 7 + pressure * 2, Math.max(0.08, 0.15 - pressure * 0.008));
  bossCrossfire(e, 3 + pressure);
  spawnBossAdd(e, 1 + Math.min(2, profile.addCount));

  e.telegraphT = 0;
  e.coreOpen = true;
  e.coreOpenT = Math.max(0.18, profile.coreWindow * 0.68);
  e.attackT = Math.max(0.36, profile.cooldown * 0.7);
  e.pendingAttack = null;
}

function fireBossAttack(e) {
  const profile = bossCombatProfile(e);
  e.attackCount = (e.attackCount || 0) + 1;

  if (e.pendingAttack === 'overload') {
    fireBossOverload(e);
    return;
  }

  const pressure = profile.extraProjectiles;
  const cycle = e.pattern % 4;

  e.pattern = (e.pattern + 1) % 4;

  if (e.phase === 1) {
    bossAimedSpread(e, 5 + pressure * 2, Math.max(0.12, 0.2 - pressure * 0.015));

    if (profile.style === 'spiral' || (profile.style === 'mixed' && cycle === 0)) {
      bossSpiral(e, 2 + pressure);
    }

    if (profile.rage > 0.22 || profile.tier >= 3) {
      bossCrossfire(e, 2 + pressure);
    }
  } else if (e.phase === 2) {
    bossSpiral(e, 4 + pressure);
    bossAimedSpread(e, 3 + pressure, 0.24);

    if (profile.style === 'lane' || (profile.style === 'mixed' && cycle === 1)) {
      bossCrossfire(e, 2 + pressure);
    }

    if (profile.rage > 0.28) {
      bossWall(e);
    }
  } else if (e.phase === 3) {
    if (profile.style === 'spiral' || (profile.style === 'mixed' && cycle === 2)) {
      bossSpiral(e, 5 + pressure);
      bossCrossfire(e, 2 + pressure);
    } else if (cycle % 2 === 0) {
      bossWall(e);
    } else {
      bossAimedSpread(e, 7 + pressure * 2, Math.max(0.1, 0.16 - pressure * 0.01));
    }

    if (profile.rage > 0.34) {
      bossCrossfire(e, 2 + pressure);
    }
  } else if (profile.style === 'swarm') {
    bossWall(e);
    bossAimedSpread(e, 5 + pressure * 2, 0.18);
    spawnBossAdd(e, 1 + pressure);
  } else if (cycle % 3 === 0) {
    bossWall(e);
    bossAimedSpread(e, 3 + pressure, 0.28);
    bossCrossfire(e, 2 + pressure);
  } else if (cycle % 3 === 1) {
    bossSpiral(e, 5 + pressure);
    bossAimedSpread(e, 5 + pressure, 0.18);
  } else {
    bossAimedSpread(e, 9 + pressure * 2, Math.max(0.08, 0.12 - pressure * 0.008));
    bossWall(e);

    if (profile.style === 'lane' || profile.style === 'mixed') {
      bossCrossfire(e, 2 + pressure);
    }
  }

  e.telegraphT = 0;
  e.coreOpen = true;
  e.coreOpenT = profile.coreWindow;
  e.attackT = profile.cooldown;
  e.pendingAttack = null;
}

function updateBoss(e, dt) {
  const p = G.player;

  if (!e.entered) {
    e.y += 92 * dt;

    if (e.y >= 150) {
      e.entered = true;
      e.attackT = 1.05;
    }

    return;
  } else {
    e.y += (150 - e.y) * 1.8 * dt;

    const target = clamp(p.x, G.w * 0.2, G.w * 0.8);
    const profile = bossCombatProfile(e);

    e.x += clamp(target - e.x, -120, 120) * profile.move * dt;
    e.x += Math.sin(e.t * 0.62) * (42 + e.phase * 8) *
      bossEncounterProfile(e.tier).moveMultiplier * dt;

    e.x = clamp(e.x, 110, G.w - 110);
  }

  const frac = clamp(e.hp / e.maxHp, 0, 1);
  const next = bossPhaseForHealth(frac);

  if (next !== e.phase) {
    e.phase = next;
    bossPhaseFX(e);
  }

  e.rage = Math.max(
    e.rage || 0,
    clamp(
      (e.phase - 1) * 0.14 +
        Math.min(0.34, (e.attackCount || 0) * 0.022) +
        Math.min(0.24, (e.overloadCount || 0) * 0.12),
      0,
      0.85
    )
  );

  if (e.phaseTransitionT > 0) {
    e.phaseTransitionT = Math.max(0, e.phaseTransitionT - dt);
    e.coreOpen = false;
    e.coreOpenT = 0;
    return;
  }

  if (e.staggerT > 0) {
    e.staggerT = Math.max(0, e.staggerT - dt);
    e.coreOpen = true;
    e.coreOpenT = e.staggerT;
    return;
  }

  if (e.entered && G.state === 'playing' && p.alive) {
    if (e.relayActive) {
      e.relayTimer -= dt;

      if (e.relayTimer <= 0) {
        bossRelayFailure(e);
      }
    } else {
      e.relayT -= dt;

      if (e.relayT <= 0) {
        spawnBossRelays(e);
      }
    }

    if (e.telegraphT > 0) {
      e.telegraphT -= dt;

      if (e.telegraphT <= 0) {
        fireBossAttack(e);
      }
    } else if (e.coreOpenT > 0) {
      e.coreOpenT -= dt;
      e.coreOpen = e.coreOpenT > 0;
    } else {
      e.coreOpen = false;
      e.attackT -= dt;

      if (e.attackT <= 0) {
        beginBossAttack(e);
      }
    }

    e.addT -= dt;

    if (e.addT <= 0) {
      const profile = bossCombatProfile(e);
      e.addT = Math.max(
        profile.addInterval * 0.72,
        profile.addInterval - G.wave * 0.06
      );
      spawnBossAdd(e, profile.addCount);
    }
  }
}

function playVictoryEffect(x, y) {
  const effect = cosmeticList('victories').find(item => item.id === G.victoryStyle)
    || cosmeticList('victories')[0];
  const colors = effect.colors;

  if (effect.id === 'fireworks') {
    for (let i = 0; i < 5; i++) {
      burst(x + rand(-120, 120), y + rand(-60, 70), {
        n: 22,
        spd: 170,
        spdV: 170,
        life: 0.9,
        size: 8,
        cols: colors,
        drag: 0.9
      });
    }
  } else if (effect.id === 'crown') {
    burst(x, y - 34, {
      n: 44,
      ang: Math.PI,
      arc: Math.PI,
      spd: 260,
      spdV: 120,
      life: 1.1,
      size: 10,
      cols: colors,
      drag: 0.9
    });
  } else if (effect.id === 'dread') {
    burst(x, y, {
      n: 110,
      spd: 360,
      spdV: 260,
      life: 1.2,
      size: 13,
      cols: colors,
      drag: 0.86
    });
  } else {
    burst(x, y, {
      n: 60,
      spd: 260,
      spdV: 180,
      life: 0.9,
      size: 9,
      cols: colors,
      drag: 0.89
    });
  }
}

function bossDeath(e) {
  clearBossRelays(e);
  G.hitStop = Math.max(G.hitStop, 0.16);

  G.shake = Math.min(
    G.shake + (SETTINGS.reduceShake ? 12 : 40),
    SETTINGS.reduceShake ? 16 : 52
  );

  G.aberration = Math.min(
    G.aberration + (SETTINGS.reduceShake ? 2 : 11),
    SETTINGS.reduceShake ? 3 : 16
  );

  banner('BOSS DOWN');
  toast('DREADNOUGHT CORE DESTROYED', 'gold');
  unlockAch('bossKill');

  AU.boom(2.7, e.x);

  for (let k = 0; k < 6; k++) {
    explosion(
      e.x + rand(-110, 110),
      e.y + rand(-65, 70),
      rand(1.1, 2.1)
    );
  }

  G.rings.push({
    x: e.x,
    y: e.y,
    r: 26,
    vr: 980,
    a: 1
  });

  burst(e.x, e.y, {
    n: 80,
    spd: 280,
    spdV: 260,
    life: 1.05,
    size: 12,
    cols: [PAL.white, PAL.amber, PAL.surge, PAL.crimson],
    drag: 0.88
  });

  playVictoryEffect(e.x, e.y);

  for (let k = 0; k < 3; k++) {
    G.powerups.push({
      x: e.x + gameRand(-100, 100),
      y: e.y + gameRand(-35, 35),
      type: POWERUP_TYPES[(runRandom() * POWERUP_TYPES.length) | 0],
      t: gameRand(0, 2),
      spark: 0
    });
  }

  if (G.lives < G.maxLives) {
    G.lives++;
    drawLives();
    toast('HULL RESTORED +1', 'gold');
  }
}

function spawnSplitterDrones(e) {
  const room = Math.max(0, 70 - G.enemies.length);
  const count = Math.min(e.splitCount || 2, room);

  for (let k = 0; k < count; k++) {
    const x = clamp(e.x + gameRand(-28, 28), 24, G.w - 24);

    G.enemies.push({
      type: 'drone',
      x,
      y: e.y,
      t: gameRand(0, 6),
      flash: 0,
      fireT: gameRand(1.8, 3.2),
      hp: Math.max(1, Math.ceil(G.wave / 12)),
      r: 14,
      baseX: x,
      amp: gameRand(18, 52),
      freq: gameRand(1.8, 2.8),
      vy: (gameRand(100, 135) + G.wave * 3) * waveProfile().speed,
      val: Math.max(30, Math.floor(e.val * 0.16)),
      mini: true
    });
  }

  if (count > 0) {
    toast('SPLITTER CORE RELEASED', 'red');
    burst(e.x, e.y, {
      n: 18,
      spd: 180,
      spdV: 100,
      life: 0.5,
      size: 7,
      cols: [PAL.surge, PAL.white],
      drag: 0.88
    });
  }
}

/* =========================================================================
   Kills / damage / game over
   ========================================================================= */

function killEnemy(e, i) {
  G.enemies.splice(i, 1);

  G.kills++;
  G.combo++;
  G.comboT = 4;

  G.maxCombo = Math.max(G.maxCombo, G.combo);
  G.mult = Math.min(9, 1 + Math.floor(G.combo / 6));

  G.score += Math.round(e.val * G.mult * dailyScoreMultiplier());

  if (e.elite) G.eliteKills++;

  if (G.score > G.hi) {
    G.hi = G.score;
  }

  if (G.kills === 1) unlockAch('firstKill');
  if (G.combo >= 20) unlockAch('combo20');
  if (e.type === 'asteroid') unlockAch('asteroid');

  if (e.type === 'boss') {
    G.bossesDefeated++;
    G.surge = Math.min(100, G.surge + 60 * G.surgeMult);
    bossDeath(e);
    G.dropDry = 0;
    awardRunXp(runXpValue(e.type, e.elite));
    return;
  }

  const surgeFill =
    e.type === 'tank' ? 25 :
    e.type === 'striker' ? 12 :
    6;

  G.surge = Math.min(
    100,
    G.surge + surgeFill * G.surgeMult * (e.elite ? 1.25 : 1) *
      (dailyModifier()?.surgeMultiplier || 1)
  );

  if (e.type === 'tank') {
    G.hitStop = Math.max(G.hitStop, 0.06);
  } else if (e.type === 'striker') {
    G.hitStop = Math.max(G.hitStop, 0.03);
  }

  const s =
    e.type === 'tank' ? 1.8 :
    e.type === 'striker' ? 1.1 :
    e.type === 'asteroid' ? 1.3 :
    0.9;

  explosion(e.x, e.y, s);
  AU.boom(s * 0.8, e.x);

  if (e.eliteKind === 'splitter') {
    spawnSplitterDrones(e);
  }

  G.dropDry++;

  const event = activeWaveEvent();
  const chance =
    e.type === 'tank' ? 0.32 :
    e.type === 'asteroid' ? 0.08 :
    0.11;
  const dropChance = Math.min(
    0.9,
    chance + (e.elite ? 0.12 : 0) + (event?.dropBonus || 0) +
      (dailyModifier()?.dropBonus || 0)
  );
  const dropLimit = event?.salvageLimit || 14;

  if (runRandom() < dropChance || G.dropDry >= dropLimit) {
    G.dropDry = 0;

    G.powerups.push({
      x: e.x,
      y: e.y,
      type: POWERUP_TYPES[(runRandom() * POWERUP_TYPES.length) | 0],
      t: 0,
      spark: 0
    });

    G.rings.push({
      x: e.x,
      y: e.y,
      r: 6,
      vr: 380,
      a: 0.8
    });
  }

  awardRunXp(runXpValue(e.type, e.elite));
}

function hitPlayer(damage = 1) {
  const p = G.player;
  const hullDamage = clamp(Math.round(Number(damage) || 1), 1, 2);

  if (p.inv > 0 || !p.alive) return;

  G.damageTaken += hullDamage;

  if (p.shield > 0) {
    p.shield--;
    p.inv = 1.0;

    G.rings.push({
      x: p.x,
      y: p.y,
      r: 24,
      vr: 460,
      a: 0.9
    });

    burst(p.x, p.y, {
      n: 16,
      spd: 180,
      life: 0.5,
      size: 7,
      cols: [PAL.cyan, PAL.white],
      drag: 0.9
    });

    G.shake += SETTINGS.reduceShake ? 3 : 9;
    G.aberration += SETTINGS.reduceShake ? 1 : 3;

    AU.hurt();
    toast('SHIELD DOWN', 'red');

    return;
  }

  G.lives -= hullDamage;

  if (hullDamage > 1) {
    toast('HEAVY IMPACT', 'red');
  }

  if (G.comboGuard > 0) {
    G.comboGuard--;
    G.comboT = 4;
    toast('COMBO SHIELD HELD', 'gold');
  } else {
    G.combo = 0;
    G.mult = 1;
  }

  explosion(p.x, p.y, 1.6);

  p.inv = 2.4;
  G.shake += SETTINGS.reduceShake ? 8 : 26;
  G.slowT = 0.5;
  G.aberration = SETTINGS.reduceShake ? 2 : 5;

  if (!SETTINGS.reduceFlash) {
    $('flash').style.opacity = 0.85;
    setTimeout(() => {
      $('flash').style.opacity = 0;
    }, 60);
  }

  AU.hurt();
  AU.boom(1.3, p.x);

  drawLives();

  if (G.lives <= 0) {
    p.alive = false;
    G.overDelay = 1.6;
    explosion(p.x, p.y, 2.4);
  }
}

function gameOver() {
  G.state = 'over';
  G.overReady = false;

  const earned = Math.floor(
    (Math.floor(G.score / 100) + G.kills * 5 + G.wave * 50) *
    dailyScrapMultiplier()
  );

  addScrap(earned);

  const isDaily = G.runMode === 'daily' && G.challenge;
  const dailyBest = isDaily ? saveDailyScore(G.challenge, G.score) : 0;
  const dailyDate = isDaily ? G.challenge.date : '';

  G.lastRun = {
    mode: G.runMode,
    challengeDate: dailyDate,
    challengeCode: isDaily ? G.challenge.code : '',
    score: G.score,
    wave: G.wave,
    kills: G.kills,
    maxCombo: G.maxCombo,
    time: G.runTime,
    accuracy: runAccuracy(),
    damage: Math.round(G.damageDealt),
    damageTaken: G.damageTaken,
    elites: G.eliteKills,
    bosses: G.bossesDefeated,
    systems: G.systemsInstalled,
    shotsFired: G.shotsFired,
    shotsHit: G.shotsHit,
    scrap: earned,
    dailyBest
  };

  try {
    localStorage.setItem(HI_KEY, String(G.hi));
  } catch {
    /* Ignore storage failures. */
  }

  $('sScore').textContent = pad7(G.score);
  $('sBest').textContent = pad7(G.hi);
  $('sWave').textContent = String(G.wave).padStart(2, '0');
  $('sKills').textContent = G.kills;
  $('sCombo').textContent = '×' + G.maxCombo;
  $('sScrap').textContent = String(earned);
  $('sTotalScrap').textContent = String(META.scrap);

  setTxt($('sTime'), formatRunTime(G.runTime));
  setTxt($('sAccuracy'), runAccuracy() + '%');
  setTxt($('sDamage'), String(Math.round(G.damageDealt)));
  setTxt($('sElites'), String(G.eliteKills));
  setTxt($('sBosses'), String(G.bossesDefeated));
  setTxt($('sSystems'), String(G.systemsInstalled));

  const dailyResult = $('dailyResult');

  if (dailyResult) {
    dailyResult.classList.toggle('hidden', !isDaily);
  }

  setTxt($('dailyResultDate'), isDaily ? 'DAILY // ' + dailyDate : '');
  setTxt($('sDailyBest'), isDaily ? pad7(dailyBest) : '—');

  const isNewRecord = G.score > G.runStartHi;
  $('newRec').classList.toggle('hidden', !isNewRecord);

  updateTitleMeta();

  AU.over();
  show($('ovUpgrade'), false);
  show($('ovOver'), true);
  setGameControlsInteractive(false);

  const relaunchBtn = $('relaunchBtn');
  if (relaunchBtn) relaunchBtn.disabled = true;

  setTimeout(() => {
    G.overReady = true;
    if (relaunchBtn) relaunchBtn.disabled = false;
  }, 600);
}

function shareRunScore() {
  const run = G.lastRun || {
    mode: G.runMode,
    challengeDate: G.challenge?.date || '',
    score: G.score,
    wave: G.wave,
    accuracy: runAccuracy()
  };
  const modeLabel = run.mode === 'daily'
    ? 'DAILY ' + run.challengeDate
    : 'STANDARD RUN';
  const text = [
    'IONSTORM // ' + modeLabel,
    'SCORE ' + pad7(run.score) + ' · WAVE ' + String(run.wave).padStart(2, '0'),
    'ACCURACY ' + run.accuracy + '% · ' + formatRunTime(run.time || G.runTime),
    'Defend the Veil: https://ionstorm.vercel.app'
  ].join('\n');

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    navigator.share({
      title: 'IONSTORM ' + modeLabel,
      text
    }).then(() => {
      toast('SCORE SHARED', 'gold');
    }).catch(error => {
      if (error && error.name !== 'AbortError') toast('SHARE CANCELLED');
    });
    return true;
  }

  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === 'function'
  ) {
    navigator.clipboard.writeText(text).then(() => {
      toast('SCORE COPIED', 'gold');
    }).catch(() => {
      toast('SHARE UNAVAILABLE', 'red');
    });
    return true;
  }

  toast('SHARE UNAVAILABLE', 'red');
  return false;
}

/* =========================================================================
   Player update
   ========================================================================= */

function updatePlayer(dt) {
  const p = G.player;

  if (!p.alive) return;

  const ax =
    (keys.has('d') || keys.has('arrowright') ? 1 : 0) -
    (keys.has('a') || keys.has('arrowleft') ? 1 : 0);

  const ay =
    (keys.has('s') || keys.has('arrowdown') ? 1 : 0) -
    (keys.has('w') || keys.has('arrowup') ? 1 : 0);

  const speedMult = p.speedMult * (G.surgeActive ? 1.6 : 1);
  const inputResponse = SETTINGS.inputResponse;

  p.vx += ax * 2400 * dt * speedMult * inputResponse;
  p.vy += ay * 2400 * dt * speedMult * inputResponse;

  if (G.time - pointer.lastMove < 1.2) {
    const pointerResponse = inputResponse * (pointer.isTouch ? 1.1 : 1);

    p.vx += (
      (pointer.x - p.x) * 16 * pointerResponse -
      p.vx * 8 * pointerResponse
    ) * dt;
    p.vy += (
      (pointer.y - p.y) * 16 * pointerResponse -
      p.vy * 8 * pointerResponse
    ) * dt;
  }

  const damp = Math.exp(-5 * dt);

  p.vx *= damp;
  p.vy *= damp;

  const spd = Math.hypot(p.vx, p.vy);
  const maxSpd = 520 * p.speedMult * (G.surgeActive ? 1.5 : 1);

  if (spd > maxSpd) {
    p.vx *= maxSpd / spd;
    p.vy *= maxSpd / spd;
  }

  p.x = clamp(p.x + p.vx * dt, 26, G.w - 26);
  p.y = clamp(p.y + p.vy * dt, 60, G.h - 30);

  p.cool -= dt;
  p.inv = Math.max(0, p.inv - dt);

  p.triple = Math.max(0, p.triple - dt);
  p.rapid = Math.max(0, p.rapid - dt);
  p.piercing = Math.max(0, p.piercing - dt);
  p.magnet = Math.max(0, p.magnet - dt);

  const rate = (p.rapid > 0 ? 0.075 : 0.135) * p.rateMult;

  while (p.cool <= 0) {
    p.cool += rate;

    const dirs = p.triple > 0 ? [-0.16, 0, 0.16] : [0];

    for (const a of dirs) {
      G.bullets.push({
        x: p.x + Math.sin(a) * 14,
        y: p.y - 28,
        vx: Math.sin(a) * 520,
        vy: -Math.cos(a) * 760,
        r: 6,
        piercing: p.piercing > 0,
        hitTargets: new Set()
      });
    }

    G.shotsFired += dirs.length;

    pushP(
      p.x,
      p.y - 32,
      rand(-20, 20),
      -80,
      1,
      1,
      1,
      1.2,
      0.1,
      6,
      0.9
    );

    AU.shoot();
  }

  const trail = G.trailProfile || COSMETICS.trails[0];
  const engine = G.engineProfile || COSMETICS.engines[0];
  const trailCount = trail.count || 2;
  const trailPower = (trail.speed || 1) * (engine.trailPower || 1);
  const trailIntensity = (trail.intensity || 1) * (engine.id === 'pulse'
    ? 1 + Math.sin(G.time * engine.pulseSpeed) * 0.24
    : 1);

  for (let i = 0; i < trailCount; i++) {
    const c = trail.palette[(Math.random() * trail.palette.length) | 0];
    const life = trail.life || [.22, .45];
    const size = trail.size || [6, 10];

    pushP(
      p.x + rand(-5, 5),
      p.y + 30,
      p.vx * -0.3 + rand(-16, 16),
      rand(130, 220) * trailPower,
      c[0],
      c[1],
      c[2],
      1.4 * trailIntensity,
      rand(life[0], life[1]) * trailPower,
      rand(size[0], size[1]) * (engine.trailPower || 1),
      0.88
    );
  }

  if (Math.random() < 0.18) {
    pushP(
      p.x + rand(-3, 3),
      p.y + 30,
      p.vx * -0.2 + rand(-10, 10),
      rand(160, 240),
      1,
      1,
      1,
      1.7,
      0.15,
      12,
      0.86
    );
  }

  if (G.surgeActive && Math.random() < 0.5) {
    pushP(
      p.x + rand(-8, 8),
      p.y + 35,
      p.vx * -0.4 + rand(-30, 30),
      rand(200, 350),
      PAL.surge[0],
      PAL.surge[1],
      PAL.surge[2],
      2,
      0.3,
      rand(8, 14),
      0.85
    );
  }

  p.mCool -= dt;

  if (p.missile > 0) {
    p.missile = Math.max(0, p.missile - dt);

    if (p.mCool <= 0 && G.missiles.length < 24) {
      p.mCool = 0.45;
      p.mSide *= -1;
      G.shotsFired++;

      const s = p.mSide;

      G.missiles.push({
        x: p.x + s * 22,
        y: p.y + 4,
        vx: s * 140,
        vy: -140,
        spd: 240,
        life: 3
      });

      burst(p.x + s * 22, p.y + 8, {
        n: 5,
        spd: 70,
        life: 0.2,
        size: 5,
        cols: [PAL.amber, PAL.white],
        drag: 0.85
      });

      AU.missile();
    }
  }
}

/* =========================================================================
   World / wave update
   ========================================================================= */

function updateWaves(dt) {
  if (G.waveState === 'spawning') {
    G.spawnT -= dt;

    if (G.spawnT <= 0 && G.waveQ > 0) {
      spawnEnemy();
      G.waveQ--;
      const event = activeWaveEvent();
      const gapMultiplier = event?.spawnGapMultiplier || 1;
      G.spawnT = waveProfile().spawnGap * gapMultiplier * gameRand(0.72, 1.18);
    }

    if (G.waveQ <= 0) {
      G.waveState = 'clearing';
    }
  } else if (G.waveState === 'clearing' && G.enemies.length === 0) {
    G.waveState = 'waiting';
    G.waitT = 1.8;
  } else if (G.waveState === 'waiting') {
    G.waitT -= dt;

    if (G.waitT <= 0) {
      startWave(G.wave + 1);
    }
  }
}

function updateWorld(dt) {
  const p = G.player;

  /* Player bullets */
  for (let i = G.bullets.length - 1; i >= 0; i--) {
    const b = G.bullets[i];

    b.x += b.vx * dt;
    b.y += b.vy * dt;

    if (b.y < -40 || b.x < -30 || b.x > G.w + 30) {
      G.bullets.splice(i, 1);
    }
  }

  /* Seeker missiles */
  for (let i = G.missiles.length - 1; i >= 0; i--) {
    const m = G.missiles[i];

    m.life -= dt;

    const tgt = nearestEnemy(m.x, m.y);

    let ang = Math.atan2(m.vy, m.vx);
    const want = tgt ? Math.atan2(tgt.y - m.y, tgt.x - m.x) : -Math.PI / 2;

    let diff = want - ang;

    while (diff > Math.PI) diff -= TAU;
    while (diff < -Math.PI) diff += TAU;

    ang += clamp(diff, -7 * dt, 7 * dt);

    m.spd = Math.min(m.spd + 1100 * dt, 860);

    m.vx = Math.cos(ang) * m.spd;
    m.vy = Math.sin(ang) * m.spd;

    m.x += m.vx * dt;
    m.y += m.vy * dt;

    pushP(
      m.x - Math.cos(ang) * 10,
      m.y - Math.sin(ang) * 10,
      rand(-15, 15),
      rand(-10, 30),
      Math.random() < 0.5 ? 1 : 0.9,
      Math.random() < 0.5 ? 0.55 : 0.3,
      0.18,
      1.1,
      0.3,
      6,
      0.9
    );

    let dead =
      m.life <= 0 ||
      m.y < -40 ||
      m.x < -40 ||
      m.x > G.w + 40 ||
      m.y > G.h + 40;

    if (!dead) {
      for (let j = G.enemies.length - 1; j >= 0; j--) {
        const e = G.enemies[j];

        if (
          enemyIsTargetable(e) &&
          Math.hypot(e.x - m.x, e.y - m.y) < e.r + 10
        ) {
          G.shotsHit++;
          const destroyed = damageEnemy(e, projectileDamage(3));
          e.flash = 1;
          dead = true;

          burst(m.x, m.y, {
            n: 14,
            spd: 180,
            spdV: 90,
            life: 0.5,
            size: 8,
            cols: [PAL.ember, PAL.amber, PAL.white],
            drag: 0.9
          });

          G.rings.push({
            x: m.x,
            y: m.y,
            r: 6,
            vr: 300,
            a: 0.7
          });

          G.shake = Math.min(G.shake + 3, 34);
          G.aberration = Math.min(G.aberration + 1.5, 6);

          AU.boom(0.6, m.x);

          if (destroyed) {
            killEnemy(e, j);

            if (G.state !== 'playing') {
              G.missiles.splice(i, 1);
              return;
            }
          }

          break;
        }
      }
    }

    if (dead) {
      burst(m.x, m.y, {
        n: 6,
        spd: 120,
        life: 0.3,
        size: 6,
        cols: [PAL.ember, PAL.white],
        drag: 0.9
      });

      G.missiles.splice(i, 1);
    }
  }

  /* Enemy bullets */
  for (let i = G.ebullets.length - 1; i >= 0; i--) {
    const b = G.ebullets[i];

    b.x += b.vx * dt;
    b.y += b.vy * dt;

    if (
      b.y > G.h + 40 ||
      b.y < -60 ||
      b.x < -40 ||
      b.x > G.w + 40
    ) {
      G.ebullets.splice(i, 1);
    }
  }

  /* Enemies */
  for (let i = G.enemies.length - 1; i >= 0; i--) {
    const e = G.enemies[i];

    e.t += dt;
    e.flash = Math.max(0, e.flash - dt * 4);

    if (e.type === 'boss') {
      updateBoss(e, dt);
    } else {
      const movementScale = eliteSpeedScale(e);

      if (e.type === 'asteroid') {
        e.y += e.vy * movementScale * dt;
        e.x += e.vx * movementScale * dt;
        e.rot += e.vr * dt;

        if (e.x < e.r || e.x > G.w - e.r) {
          e.vx *= -1;
        }
      } else if (e.type === 'drone') {
        e.y += e.vy * movementScale * dt;
        e.x = clamp(
          e.baseX + Math.sin(e.t * e.freq) * e.amp,
          24,
          G.w - 24
        );
      } else if (e.type === 'striker') {
        e.y += e.vy * movementScale * dt;
        e.x += clamp(p.x - e.x, -140, 140) * 0.8 * movementScale * dt;
      } else {
        e.y += e.vy * movementScale * dt;
        e.x += Math.sin(e.t * 0.7) * 14 * movementScale * dt;
      }

      if (
        e.type !== 'asteroid' &&
        G.state === 'playing' &&
        p.alive
      ) {
        e.fireT -= dt;

        if (e.fireT <= 0 && e.y > 0 && e.y < G.h * 0.72) {
          enemyFire(e);

          const base =
            e.type === 'tank' ? 2.6 :
            e.type === 'striker' ? 2.0 :
            3.0;
          const fireMultiplier = e.eliteKind === 'berserker' ? 0.68 : 1;

          e.fireT = Math.max(
            waveProfile().fireFloor * fireMultiplier,
            (base - G.wave * 0.06) * fireMultiplier
          ) * gameRand(0.75, 1.25);
        }
      }

      if (e.y > G.h + 80) {
        G.enemies.splice(i, 1);
      }
    }
  }

  /* Rotating reactor relays are boss-only targets and hazards. Their timer is
     owned by updateBoss(); this pass keeps their orbit aligned with the boss
     before the player collision pass runs. */
  updateBossRelays(dt);

  /* Powerups */
  for (let i = G.powerups.length - 1; i >= 0; i--) {
    const u = G.powerups[i];

    u.t += dt;
    u.y += 72 * dt;
    u.x += Math.sin(u.t * 2.2) * 26 * dt;

    u.spark -= dt;

    if (u.spark <= 0) {
      u.spark = 0.08;

      const c =
        u.type === 'triple' ? PAL.cyan :
        u.type === 'rapid' ? PAL.amber :
        u.type === 'seeker' ? PAL.crimson :
        u.type === 'piercing' ? [0.78, 0.55, 1] :
        u.type === 'magnet' ? [0.38, 0.96, 0.82] :
        u.type === 'slow' ? [0.54, 0.66, 1] :
        PAL.teal;

      pushP(
        u.x + rand(-16, 16),
        u.y + rand(-16, 16),
        rand(-35, 35),
        rand(-70, -10),
        c[0],
        c[1],
        c[2],
        1.2,
        0.35,
        5,
        0.9
      );
    }

    const dx = p.x - u.x;
    const dy = p.y - u.y;
    const d = Math.hypot(dx, dy);

    const pickupMagnet = p.magnet > 0;
    const pickupRange = G.magnetR * (pickupMagnet ? 2.2 : 1);
    const pickupPull = pickupMagnet ? 520 : 170;

    if (p.alive && d < pickupRange && d > 1) {
      u.x += dx / d * pickupPull * dt;
      u.y += dy / d * pickupPull * dt;
    }

    if (p.alive && d < 34) {
      if (u.type === 'triple') {
        p.triple = POWERUP_DURATION;
        toast('TRIPLE LANCE ENGAGED');
      } else if (u.type === 'rapid') {
        p.rapid = POWERUP_DURATION;
        toast('RAPID CYCLE ENGAGED');
      } else if (u.type === 'seeker') {
        p.missile = POWERUP_DURATION;
        toast('SEEKER SWARM ARMED', 'red');
      } else if (u.type === 'piercing') {
        p.piercing = POWERUP_DURATION;
        toast('PIERCING LANCE ARMED', 'surge');
      } else if (u.type === 'magnet') {
        p.magnet = POWERUP_DURATION;
        toast('SALVAGE MAGNET ONLINE', 'gold');
      } else if (u.type === 'slow') {
        G.timeSlowT = Math.max(G.timeSlowT, TIME_SLOW_DURATION);
        toast('CHRONO BRAKE ENGAGED', 'surge');
      } else {
        p.shield = Math.min(2, p.shield + 1);
        toast('SHIELD CELL +1');
      }

      AU.pickup();

      G.slowT = Math.max(G.slowT, 0.22);

      G.rings.push({
        x: p.x,
        y: p.y,
        r: 16,
        vr: 560,
        a: 1
      });

      burst(p.x, p.y, {
        n: 26,
        spd: 240,
        spdV: 140,
        life: 0.6,
        size: 8,
        cols:
          u.type === 'rapid' ? [PAL.amber, PAL.white] :
          u.type === 'seeker' ? [PAL.crimson, PAL.white] :
          u.type === 'piercing' ? [[0.78, 0.55, 1], PAL.white] :
          u.type === 'magnet' ? [[0.38, 0.96, 0.82], PAL.white] :
          u.type === 'slow' ? [[0.54, 0.66, 1], PAL.white] :
          [PAL.cyan, PAL.white],
        drag: 0.9
      });

      G.powerups.splice(i, 1);
      continue;
    }

    if (u.y > G.h + 40) {
      G.powerups.splice(i, 1);
    }
  }

  /* Rings */
  for (let i = G.rings.length - 1; i >= 0; i--) {
    const r = G.rings[i];

    r.r += r.vr * dt;
    r.a -= dt * 1.7;

    if (r.a <= 0) {
      G.rings.splice(i, 1);
    }
  }

  /* Collisions */
  if (G.state === 'playing' && p.alive) {
    for (let i = G.bullets.length - 1; i >= 0; i--) {
      const b = G.bullets[i];
      let hit = false;

      for (let j = G.bossNodes.length - 1; j >= 0; j--) {
        const node = G.bossNodes[j];

        if (Math.hypot(b.x - node.x, b.y - node.y) < node.r + b.r) {
          if (b.piercing && b.hitTargets?.has(node)) continue;

          if (b.piercing) {
            b.hitTargets ||= new Set();
            b.hitTargets.add(node);
          } else {
            G.bullets.splice(i, 1);
          }

          hit = true;
          G.shotsHit++;
          const destroyed = damageBossRelay(node, projectileDamage(1));

          burst(b.x, b.y, {
            n: 6,
            spd: 110,
            life: 0.28,
            size: 5,
            cols: [PAL.cyan, PAL.surge, PAL.white],
            inten: 1.2,
            drag: 0.88
          });

          if (destroyed) {
            G.shake = Math.min(G.shake + 2, 28);
          }

          break;
        }
      }

      if (hit && !b.piercing) continue;

      for (let j = G.enemies.length - 1; j >= 0; j--) {
        const e = G.enemies[j];

        if (
          enemyIsTargetable(e) &&
          Math.hypot(b.x - e.x, b.y - e.y) < e.r + b.r
        ) {
          if (b.piercing && b.hitTargets?.has(e)) continue;

          if (b.piercing) {
            b.hitTargets ||= new Set();
            b.hitTargets.add(e);
          } else {
            G.bullets.splice(i, 1);
          }

          hit = true;
          G.shotsHit++;

          const destroyed = damageEnemy(e, projectileDamage(1));
          e.flash = 1;

          burst(b.x, b.y, {
            n: 4,
            spd: 90,
            life: 0.25,
            size: 5,
            cols: [PAL.amber, PAL.white],
            inten: 1.2,
            drag: 0.88
          });

          if (destroyed) {
            killEnemy(e, j);

            if (G.state !== 'playing') return;
          }

          break;
        }
      }

      if (hit && !b.piercing) continue;
    }

    for (let i = G.ebullets.length - 1; i >= 0; i--) {
      const b = G.ebullets[i];

      if (Math.hypot(b.x - p.x, b.y - p.y) < p.r + b.r) {
        G.ebullets.splice(i, 1);
        hitPlayer(b.damage);
      }
    }

    for (let j = G.enemies.length - 1; j >= 0; j--) {
      const e = G.enemies[j];

      if (Math.hypot(e.x - p.x, e.y - p.y) < e.r * 0.8 + p.r) {
        hitPlayer();

        const destroyed = damageEnemy(e, 4);
        e.flash = 1;

        if (destroyed) {
          killEnemy(e, j);

          if (G.state !== 'playing') return;
        }
      }
    }
  }

  /* Combo decay */
  G.comboT -= dt;

  if (G.comboT <= 0 && G.combo > 0) {
    G.combo = 0;
    G.mult = 1;
  }
}

/* =========================================================================
   Ambient background particles
   ========================================================================= */

function ambient(dt) {
  G.ambientT -= dt;

  if (G.ambientT <= 0) {
    G.ambientT = 0.25;

    pushP(
      rand(0, G.w),
      G.h + 10,
      rand(-8, 8),
      -rand(18, 45),
      Math.random() < 0.7 ? 0.2 : 0.9,
      0.8,
      Math.random() < 0.7 ? 1 : 0.6,
      0.5,
      rand(3, 6),
      rand(2.5, 5.5),
      1
    );
  }

  G.cometT -= dt;

  if (G.cometT <= 0) {
    G.cometT = rand(1.8, 3.6);

    pushP(
      rand(G.w * 0.15, G.w * 0.85),
      -12,
      rand(-40, 40),
      rand(420, 620),
      1,
      0.9,
      0.75,
      1.3,
      rand(0.9, 1.4),
      rand(4, 6),
      1
    );
  }
}

function bossCrossfire(e, count = 2) {
  const p = G.player;
  if (!p.alive) return;

  const combat = bossCombatProfile(e);
  const base = Math.atan2(p.y - e.y, p.x - e.x);
  const spd = Math.min(
    (190 + G.wave * 6) * combat.projectileSpeedMultiplier,
    480
  );

  for (let i = 0; i < count; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const a = base + side * (0.42 + i * 0.08);

    eb(
      e.x,
      e.y + e.r * 0.35,
      Math.cos(a) * spd,
      Math.sin(a) * spd,
      7,
      combat.damageMultiplier
    );
  }
}

/* =========================================================================
   Master update
   ========================================================================= */

function update(rdt) {
  if (G.hitStop > 0) {
    G.hitStop -= rdt;
    G.time += rdt * 0.3;

    G.shake *= Math.exp(-4 * rdt);

    const shakeVis = SETTINGS.reduceShake ? 0.35 : 1;

    G.offX = (Math.random() * 2 - 1) * G.shake * shakeVis;
    G.offY = (Math.random() * 2 - 1) * G.shake * shakeVis;

    G.aberration *= Math.exp(-3 * rdt);

    AU.music();

    return;
  }

  const frozen = G.state === 'paused' || G.state === 'upgrade';

  G.timeScale = G.slowT > 0 ? 0.28 : G.timeSlowT > 0 ? 0.45 : 1;

  if (!frozen) {
    G.slowT = Math.max(0, G.slowT - rdt);
    G.timeSlowT = Math.max(0, G.timeSlowT - rdt);

    if (G.surgeActive) {
      G.surgeT -= rdt;

      if (G.surgeT <= 0) {
        G.surgeActive = false;
        G.surgeCooldown = 8.0;
        toast('SURGE DEPLETED');
      }
    } else if (G.surgeCooldown > 0) {
      G.surgeCooldown -= rdt;
    }
  }

  G.aberration *= Math.exp(-2 * rdt);

  const dt = frozen ? 0 : rdt * G.timeScale;

  if (!frozen) {
    G.time += dt;

    if (G.state === 'playing') {
      G.runTime += dt;
    }

    G.shake *= Math.exp(-6 * rdt);

    const shakeVis = SETTINGS.reduceShake ? 0.35 : 1;

    G.offX = (Math.random() * 2 - 1) * G.shake * shakeVis;
    G.offY = (Math.random() * 2 - 1) * G.shake * shakeVis;
  }

  if (G.state === 'title') {
    ambient(dt);
  }

  if (G.state === 'playing') {
    updatePlayer(dt);
    updateWaves(dt);
    updateWorld(dt);

    if (!G.player.alive) {
      G.overDelay -= rdt;

      if (G.overDelay <= 0) {
        gameOver();
      }
    }
  }

  if (G.state === 'over') {
    updateWorld(dt);
  }

  AU.music();
}

/* =========================================================================
   Scene building
   ========================================================================= */

function buildScene() {
  instC = 0;
  addC = 0;

  const p = G.player;
  const t = G.time;

  if (G.state === 'title' || G.state === 'hangar') return;

  /* Rings */
  for (const r of G.rings) {
    push(
      addN,
      r.x,
      r.y,
      0,
      10,
      r.r * 2,
      r.r * 2,
      r.a,
      0.55,
      0.93,
      1
    );
  }

  /* Powerups */
  for (const u of G.powerups) {
    const id =
      u.type === 'triple' ? 7 :
      u.type === 'rapid' ? 8 :
      u.type === 'seeker' ? 12 :
      u.type === 'piercing' ? 19 :
      u.type === 'magnet' ? 20 :
      u.type === 'slow' ? 21 :
      9;

    const bob = Math.sin(u.t * 3) * 4;
    const pulse = 1 + Math.sin(u.t * 7) * 0.09;

    const col =
      u.type === 'triple' ? [0.35, 0.95, 1] :
      u.type === 'rapid' ? [1, 0.72, 0.3] :
      u.type === 'seeker' ? [1, 0.36, 0.28] :
      u.type === 'piercing' ? [0.78, 0.55, 1] :
      u.type === 'magnet' ? [0.38, 0.96, 0.82] :
      u.type === 'slow' ? [0.54, 0.66, 1] :
      [0.4, 1, 0.95];

    glow(
      u.x,
      u.y + bob,
      74 * pulse,
      col[0],
      col[1],
      col[2],
      0.55 + 0.25 * Math.sin(u.t * 9)
    );

    glow(
      u.x,
      u.y + bob,
      36,
      1,
      1,
      1,
      0.35 + 0.2 * Math.sin(u.t * 13)
    );

    push(
      instN,
      u.x,
      u.y + bob,
      u.t * 2.4,
      id,
      54 * pulse,
      54 * pulse,
      1,
      1,
      1,
      1
    );
  }

  /* Boss relay objectives orbit the Dreadnought and give the player a clear
     visual target during the overload decision. */
  for (const node of G.bossNodes) {
    const pulse = 1 + Math.sin(t * 9 + node.angle * 2) * 0.12;
    const damaged = 1 - node.hp / Math.max(node.maxHp, 1);
    const flash = node.flash;

    glow(
      node.x,
      node.y,
      node.r * 3.6 * pulse,
      0.35 + damaged * 0.65,
      0.9,
      1,
      0.34 + flash * 0.45
    );

    push(
      addN,
      node.x,
      node.y,
      t * 1.5,
      10,
      node.r * 2.8 * pulse,
      node.r * 2.8 * pulse,
      0.5 + flash * 0.35,
      0.35,
      0.92,
      1
    );

    push(
      instN,
      node.x,
      node.y,
      -t * 1.8,
      19,
      node.r * 1.7,
      node.r * 1.7,
      1,
      0.72 + flash * 0.28,
      0.86 + flash * 0.14,
      1
    );
  }

  /* Enemies */
  for (const e of G.enemies) {
    if (e.type === 'boss') {
      const phaseCol =
        e.phase === 1 ? [1, 0.36, 0.22] :
        e.phase === 2 ? [1, 0.62, 0.28] :
        e.phase === 3 ? [0.82, 0.3, 1] :
        [1, 0.16, 0.48];

      if (e.phaseTransitionT > 0) {
        const pulse = 1 + Math.sin(t * 12) * 0.12;

        glow(
          e.x,
          e.y,
          e.r * 5.4 * pulse,
          1,
          0.7,
          0.18,
          0.34 + 0.12 * Math.sin(t * 10)
        );
      } else if (e.telegraphT > 0) {
        const pulse = 1 + Math.sin(t * 16) * 0.16;

        glow(
          e.x,
          e.y,
          e.r * 5 * pulse,
          1,
          0.2,
          0.16,
          0.3 + 0.16 * Math.sin(t * 14)
        );
      } else if (e.coreOpen) {
        glow(
          e.x,
          e.y,
          e.r * 1.5,
          0.35,
          1,
          0.9,
          0.64 + 0.16 * Math.sin(t * 11)
        );
      }

      glow(
        e.x,
        e.y,
        e.r * 4.3,
        phaseCol[0],
        phaseCol[1],
        phaseCol[2],
        0.26 + 0.1 * Math.sin(t * 3.2)
      );

      glow(
        e.x,
        e.y,
        e.r * 2.2,
        1,
        0.78,
        0.42,
        0.32 + 0.18 * Math.sin(t * 7.4)
      );

      push(
        addN,
        e.x,
        e.y,
        t * 0.7,
        10,
        e.r * 2.55,
        e.r * 2.55,
        0.16 + 0.08 * Math.sin(t * 5),
        phaseCol[0],
        phaseCol[1],
        phaseCol[2]
      );

      const f = e.flash;
      const size = Math.min(330, G.w * 0.52);

      push(
        instN,
        e.x,
        e.y,
        Math.sin(e.t * 0.42) * 0.05,
        14,
        size,
        size,
        1,
        1 + f * 2,
        1 + f * 2,
        1 + f * 2
      );

      continue;
    }

    if (e.elite) {
      const eliteColor = e.eliteColor || [1, 0.45, 0.18];
      const pulse = 1 + Math.sin(t * 5.5 + e.t) * 0.08;

      glow(
        e.x,
        e.y,
        e.r * 4.8 * pulse,
        eliteColor[0],
        eliteColor[1],
        eliteColor[2],
        0.25 + 0.08 * Math.sin(t * 8 + e.t)
      );

      push(
        addN,
        e.x,
        e.y,
        e.t * 0.65,
        10,
        e.r * 2.65 * pulse,
        e.r * 2.65 * pulse,
        0.26 + 0.08 * Math.sin(t * 6 + e.t),
        eliteColor[0],
        eliteColor[1],
        eliteColor[2]
      );

      if (e.eliteKind === 'aegis' && e.shieldHp > 0) {
        push(
          addN,
          e.x,
          e.y,
          t * 0.4,
          11,
          e.r * 2.35,
          e.r * 2.35,
          0.24 + 0.1 * Math.sin(t * 7),
          0.35,
          0.95,
          1
        );
      }
    }

    if (e.type === 'asteroid') {
      glow(
        e.x,
        e.y,
        e.r * 2.2,
        0.8,
        0.6,
        0.4,
        0.12
      );

      const f = e.flash;

      push(
        instN,
        e.x,
        e.y,
        e.rot,
        18,
        e.r * 2.3,
        e.r * 2.3,
        1,
        1 + f * 2,
        1 + f * 2,
        1 + f * 2
      );

      continue;
    }

    const enemyColor = e.elite ? e.eliteColor : [1, 0.38, 0.16];

    glow(
      e.x,
      e.y,
      e.r * 3,
      enemyColor[0],
      enemyColor[1],
      enemyColor[2],
      e.elite ? 0.3 : 0.22
    );

    const f = e.flash;

    const id =
      e.type === 'drone' ? 4 :
      e.type === 'striker' ? 5 :
      6;

    const rot =
      e.type === 'drone' ? Math.cos(e.t * e.freq) * 0.3 :
      e.type === 'striker' ? clamp((p.x - e.x) * 0.0015, -0.5, 0.5) :
      Math.sin(e.t * 0.7) * 0.06;

    const sz =
      e.type === 'tank' ? 104 :
      e.mini ? 46 :
      e.type === 'drone' ? 66 :
      62;

    push(
      instN,
      e.x,
      e.y,
      rot,
      id,
      sz,
      sz,
      1,
      e.elite ? enemyColor[0] + f * 0.7 : 1 + f * 2,
      e.elite ? enemyColor[1] + f * 0.7 : 1 + f * 2,
      e.elite ? enemyColor[2] + f * 0.7 : 1 + f * 2
    );
  }

  /* Player */
  if (p.alive && (p.inv <= 0 || Math.floor(t * 28) % 2 === 0)) {
    const ec = G.engineCol;
    const engine = G.engineProfile || COSMETICS.engines[0];
    const tint = G.shipTint || [1, 1, 1];
    const enginePulse = 1 + Math.sin(t * (engine.pulseSpeed || 40)) * (engine.pulseAmount || .06);
    const engineSize = (engine.glowSize || 56) * enginePulse;
    const coreSize = (engine.coreSize || 34) * enginePulse;
    const engineAlpha = engine.alpha || .45;

    if (G.surgeActive) {
      glow(p.x, p.y + 22, engineSize * 1.28, 1, 0.3, 1, Math.min(0.85, engineAlpha + 0.2));
      glow(p.x, p.y + 31, coreSize * 1.28 + Math.sin(t * 50) * 8, 1, 0.5, 1, 0.8);

      push(
        instN,
        p.x,
        p.y,
        clamp(p.vx * 0.0009, -0.4, 0.4),
        G.shipSprite,
        82,
        82,
        1,
        tint[0],
        tint[1] * 0.7,
        tint[2]
      );
    } else {
      glow(p.x, p.y + 22, engineSize, ec[0], ec[1], ec[2], engineAlpha);
      glow(p.x, p.y + 31, coreSize + Math.sin(t * (engine.pulseSpeed || 40)) * 6, 1, 1, 1, 0.7);
      glow(p.x, p.y + 31, coreSize * 0.62, ec[0], ec[1], ec[2], engineAlpha * 0.78);

      push(
        instN,
        p.x,
        p.y,
        clamp(p.vx * 0.0009, -0.4, 0.4),
        G.shipSprite,
        74,
        74,
        1,
        tint[0],
        tint[1],
        tint[2]
      );
    }

    if (p.shield > 0) {
      const sr = 98 + Math.sin(t * 5) * 4;

      glow(
        p.x,
        p.y,
        sr * 1.2,
        0.35,
        0.85,
        1,
        0.18
      );

      push(
        instN,
        p.x,
        p.y,
        t * 0.4,
        11,
        sr,
        sr,
        0.55 + 0.1 * Math.sin(t * 7),
        1,
        1,
        1
      );
    }
  }

  /* Missiles */
  for (const m of G.missiles) {
    push(
      addN,
      m.x,
      m.y,
      Math.atan2(m.vx, -m.vy),
      13,
      16,
      30,
      1,
      1,
      1,
      1
    );

    glow(
      m.x,
      m.y,
      26,
      1,
      0.5,
      0.25,
      0.5
    );
  }

  /* Enemy bullets */
  for (const b of G.ebullets) {
    push(
      instN,
      b.x,
      b.y,
      0,
      3,
      17,
      17,
      1,
      1,
      1,
      1
    );

    glow(
      b.x,
      b.y,
      30,
      1,
      0.45,
      0.2,
      0.5
    );
  }

  /* Player bullets */
  for (const b of G.bullets) {
    const piercing = b.piercing === true;

    push(
      addN,
      b.x,
      b.y,
      Math.atan2(b.vx, -b.vy),
      piercing ? 22 : 2,
      piercing ? 18 : 15,
      piercing ? 48 : 42,
      1,
      piercing ? 0.86 : 1,
      piercing ? 0.62 : 1,
      1
    );

    glow(
      b.x,
      b.y,
      piercing ? 31 : 26,
      piercing ? 0.78 : 0.4,
      piercing ? 0.55 : 0.9,
      1,
      piercing ? 0.62 : 0.45
    );
  }
}

/* =========================================================================
   Render passes
   ========================================================================= */

function gpuPass(rdt) {
  buildScene();

  const gdt = (G.state === 'paused') ? 0 : rdt * G.timeScale;

  frameF32[0] = $('view').width;
  frameF32[1] = $('view').height;
  frameF32[2] = G.time;
  frameF32[3] = G.dpr;

  frameF32[4] = G.offX * G.dpr;
  frameF32[5] = G.offY * G.dpr;

  frameF32[6] = gdt;
  frameU32[7] = spawnC;

  frameF32[8] = G.aberration;

  const q = device.queue;

  q.writeBuffer(frameBuf, 0, frameF32);

  if (instC) q.writeBuffer(instBufN, 0, instN, 0, instC * 12);
  if (addC) q.writeBuffer(instBufA, 0, addN, 0, addC * 12);
  if (spawnC) q.writeBuffer(spawnBuf, 0, spawnData, 0, spawnC * 12);

  const enc = device.createCommandEncoder();

  const cp = enc.beginComputePass();

  cp.setBindGroup(0, frameBG);
  cp.setBindGroup(1, compBG);

  if (spawnC) {
    cp.setPipeline(spawnPipe);
    cp.dispatchWorkgroups(Math.ceil(spawnC / 128));
  }

  cp.setPipeline(updPipe);
  cp.dispatchWorkgroups(MAXP / 64);

  cp.end();

  const view = ctx.getCurrentTexture().createView();

  const rp = enc.beginRenderPass({
    colorAttachments: [{
      view,
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
      loadOp: 'clear',
      storeOp: 'store'
    }]
  });

  rp.setBindGroup(0, frameBG);

  rp.setPipeline(bgPipe);
  rp.draw(3);

  if (instC) {
    rp.setPipeline(sprNPipe);
    rp.setBindGroup(1, bgN);
    rp.draw(6, instC);
  }

  if (addC) {
    rp.setPipeline(sprAPipe);
    rp.setBindGroup(1, bgA);
    rp.draw(6, addC);
  }

  rp.setPipeline(partPipe);
  rp.setBindGroup(1, partBG);
  rp.draw(6, MAXP);

  rp.end();

  q.submit([enc.finish()]);

  spawnC = 0;

  hud(rdt);
}

function glPass(rdt) {
  buildScene();

  stepParticles((G.state === 'paused') ? 0 : rdt * G.timeScale);

  const c = $('view');

  gl.viewport(0, 0, c.width, c.height);

  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.disable(gl.BLEND);

  gl.useProgram(GL.bg.p);

  gl.uniform2f(GL.bg.uRes, c.width, c.height);
  gl.uniform1f(GL.bg.uTime, G.time);
  gl.uniform2f(GL.bg.uOff, G.offX * G.dpr, G.offY * G.dpr);
  gl.uniform1f(GL.bg.uAberr, G.aberration);

  gl.bindVertexArray(GL.vaoBG);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  gl.enable(gl.BLEND);

  gl.useProgram(GL.sp.p);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, GL.tex);

  gl.uniform1i(GL.sp.uTex, 0);
  gl.uniform2f(GL.sp.uRes, c.width, c.height);
  gl.uniform1f(GL.sp.uDpr, G.dpr);
  gl.uniform2f(GL.sp.uOff, G.offX * G.dpr, G.offY * G.dpr);

  if (instC) {
    gl.bindBuffer(gl.ARRAY_BUFFER, GL.bufN);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, instN, 0, instC * 12);

    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1i(GL.sp.uAdd, 0);

    gl.bindVertexArray(GL.vaoN);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, instC);
  }

  if (addC) {
    gl.bindBuffer(gl.ARRAY_BUFFER, GL.bufA);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, addN, 0, addC * 12);

    gl.blendFunc(gl.ONE, gl.ONE);
    gl.uniform1i(GL.sp.uAdd, 1);

    gl.bindVertexArray(GL.vaoA);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, addC);
  }

  gl.bindVertexArray(null);

  hud(rdt);
}

/* =========================================================================
   HUD
   ========================================================================= */

let fpsT = 0;

function hud(rdt) {
  const inGame =
    G.state === 'playing' ||
    G.state === 'paused' ||
    G.state === 'upgrade' ||
    G.state === 'over';

  setTxt($('hScore'), pad7(G.score));
  setTxt($('hHi'), pad7(G.hi));
  setTxt($('hWave'), String(Math.max(G.wave, 1)).padStart(2, '0'));
  setTxt($('hMult'), '×' + G.mult);

  const dailyActive = G.runMode === 'daily' && !!G.challenge;
  const modeEl = $('hMode');

  if (modeEl) {
    modeEl.classList.toggle('hidden', !dailyActive);
    setTxt(modeEl, dailyActive ? 'DAILY' : '');
  }

  const showLevel = inGame && G.wave > 0;
  setChromeVisible('levelHud', showLevel);
  setTxt($('hLevel'), String(G.runLevel).padStart(2, '0'));
  setTxt($('hXp'), `${Math.floor(G.runXp)} / ${G.runXpNext}`);
  $('xpBar').firstElementChild.style.width =
    clamp(G.runXp / Math.max(G.runXpNext, 1), 0, 1) * 100 + '%';

  const event = activeWaveEvent();
  const showEvent =
    (G.state === 'playing' || G.state === 'paused' || G.state === 'upgrade') &&
    !!event &&
    G.waveState !== 'waiting';

  setChromeVisible('eventHud', showEvent);

  if (showEvent) {
    setTxt($('eventName'), event.name);
    setTxt($('eventDesc'), event.description);
    $('eventHud').classList.toggle('eliteEvent', event.id === 'eliteHunt');
    $('eventHud').classList.toggle('stormEvent', event.id === 'asteroidStorm');
    $('eventHud').classList.toggle('salvageEvent', event.id === 'salvageRun');
  }

  $('comboBar').firstElementChild.style.width =
    (G.mult >= 9 ? 100 : (G.combo % 6) / 6 * 100) + '%';

  $('combo').style.opacity = G.combo >= 2 ? 1 : 0.45;

  setTxt($('surgePct'), Math.floor(G.surge) + '%');

  $('surgeBar').firstElementChild.style.width = G.surge + '%';
  const surgeControl = $('surge');
  const surgeReady =
    G.state === 'playing' &&
    G.surge >= 100 &&
    !G.surgeActive &&
    G.surgeCooldown <= 0;

  surgeControl.classList.toggle('active', G.surgeActive);
  surgeControl.classList.toggle('ready', surgeReady);
  surgeControl.disabled = !surgeReady;
  surgeControl.setAttribute(
    'aria-label',
    surgeReady ? 'Activate Surge — ready' : `Surge charging — ${Math.floor(G.surge)} percent`
  );
  surgeControl.style.opacity = inGame ? 1 : 0.3;

  const boss = G.enemies.find(e => e.type === 'boss');

  const showBoss =
    (G.state === 'playing' || G.state === 'paused' || G.state === 'upgrade') && boss;

  setChromeVisible('boss', !!showBoss);

  if (showBoss) {
    const profile = bossCombatProfile(boss);
    const encounter = bossEncounterProfile(boss.tier);
    const phaseShift = boss.phaseTransitionT > 0;
    const telegraph = boss.telegraphT > 0;
    const relayActive = boss.relayActive && boss.relayRemaining > 0;
    const staggered = boss.staggerT > 0;
    const coreOpen = boss.coreOpen && !phaseShift;

    setTxt(
      $('bossName'),
      'DREADNOUGHT MK-' + Math.max(1, Math.ceil(G.wave / 5)) +
        ' · ' + encounter.variantName
    );

    setTxt($('bossPhase'), 'PHASE ' + boss.phase + ' · ' + profile.name);

    setTxt(
      $('bossStatus'),
      phaseShift ? 'PHASE SHIFT' :
        telegraph ? 'INCOMING — ' + boss.attackName :
          staggered ? 'DREADNOUGHT STAGGERED' :
          relayActive ? 'BREAK RELAYS ' + boss.relayRemaining + '/' + boss.relayTotal :
          coreOpen ? 'CORE EXPOSED' :
            'CORE SHIELDED'
    );

    setTxt(
      $('bossAttack'),
      phaseShift ? 'SYSTEM RECONFIGURATION' :
        relayActive ? 'OVERLOAD IN ' + Math.max(0, Math.ceil(boss.relayTimer)) + 'S' :
        staggered ? 'COUNTERFIRE WINDOW' :
        profile.variantName + ' · ' + profile.attack
    );

    setTxt($('bossRage'), 'RAGE ' + Math.round(profile.rage * 100) + '%');

    $('bossBar').firstElementChild.style.width =
      (clamp(boss.hp / boss.maxHp, 0, 1) * 100) + '%';

    $('boss').classList.toggle('coreOpen', coreOpen);
    $('boss').classList.toggle('telegraph', telegraph);
    $('boss').classList.toggle('phaseShift', phaseShift);
    $('boss').classList.toggle('relay', relayActive);
  }

  const p = G.player;

  const chip = (el, on, pct) => {
    el.classList.toggle('hidden', !on);
    el.inert = !on;

    if (on && pct != null) {
      el.querySelector('.bar i').style.width = (pct * 100) + '%';
    }
  };

  chip($('cTri'), inGame && p.triple > 0, p.triple / POWERUP_DURATION);
  chip($('cRap'), inGame && p.rapid > 0, p.rapid / POWERUP_DURATION);
  chip($('cMis'), inGame && p.missile > 0, p.missile / POWERUP_DURATION);
  chip($('cPierce'), inGame && p.piercing > 0, p.piercing / POWERUP_DURATION);
  chip($('cMag'), inGame && p.magnet > 0, p.magnet / POWERUP_DURATION);
  chip($('cSlow'), inGame && G.timeSlowT > 0, G.timeSlowT / TIME_SLOW_DURATION);
  chip($('cShd'), inGame && p.shield > 0);

  setTxt($('cShdN'), String(p.shield));

  let bloomBase =
    G.shake / 45 +
    (G.surgeActive ? 0.28 : 0) +
    G.aberration * 0.025 +
    (G.slowT > 0 ? 0.12 : 0);

  bloomBase = clamp(bloomBase, 0, 0.6);

  if (SETTINGS.reduceFlash) {
    bloomBase *= 0.4;
  }

  $('fx-bloom').style.opacity = bloomBase.toFixed(3);

  fpsT += rdt;

  if (fpsT > 0.5) {
    fpsT = 0;

    setTxt(
      $('fps'),
      (mode === 'webgpu' ? 'WEBGPU' : 'WEBGL2') +
      ' · FPS ' + Math.min(999, Math.round(1000 / Math.max(emaDt, 1)))
    );
  }
}

/* =========================================================================
   Pause
   ========================================================================= */

function pauseToggle() {
  if (G.state === 'playing') {
    G.state = 'paused';

    show($('ovPause'), true);
    setGameControlsInteractive(false);

    if (AU.ctx) AU.ctx.suspend();

    setPauseButton(true);
  } else if (G.state === 'paused') {
    G.state = 'playing';

    show($('ovPause'), false);
    setGameControlsInteractive(true);

    if (AU.ctx) AU.ctx.resume();

    setPauseButton(false);
  }
}

/* =========================================================================
   Input
   ========================================================================= */

addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  const target = e.target instanceof Element ? e.target : null;
  const interactiveTarget = target && target.closest(
    'button, input, select, textarea, dialog, [role="button"]'
  );
  const rangeTarget = target && target.matches('input[type="range"]');

  if (
    k === 'tab' ||
    k === 'shift' ||
    k === 'control' ||
    k === 'alt' ||
    k === 'meta' ||
    document.querySelector('dialog[open]') ||
    (interactiveTarget && (k === 'enter' || k === ' ')) ||
    (rangeTarget && ['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k))
  ) {
    return;
  }

  if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
    e.preventDefault();
  }

  keys.add(k);

  AU.ensure();

  if (G.state === 'hangar') {
    if (k === 'm') {
      AU.toggle();
      return;
    }

    if (k === 'escape' || k === 'h') {
      closeHangar();
      return;
    }

    if (k === 'enter') {
      resetRun();
      return;
    }

    return;
  }

  if (G.state === 'upgrade') {
    const choiceIndex = Number(k) - 1;

    if (choiceIndex >= 0 && choiceIndex < G.upgradeChoices.length) {
      chooseRunUpgrade(G.upgradeChoices[choiceIndex]);
    }

    return;
  }

  if (k === 'm') {
    AU.toggle();
    return;
  }

  if (k === ' ' && G.state === 'playing') {
    activateSurge();
    return;
  }

  if (G.state === 'title') {
    if (k === 'h') {
      openHangar();
      return;
    }

    if (k === 'enter' || k === ' ') {
      resetRun('standard');
    }

    return;
  }

  if (G.state === 'over') {
    if (k === 'h') {
      openHangar();
      return;
    }

    if (G.overReady && (k === 'enter' || k === ' ' || k === 'r')) {
      resetRun();
    }

    return;
  }

  if (
    (G.state === 'playing' || G.state === 'paused') &&
    (k === 'p' || k === 'escape')
  ) {
    pauseToggle();
    return;
  }

  if (G.state === 'playing' && k === 'r') {
    resetRun();
  }
});

addEventListener('keyup', e => {
  keys.delete(e.key.toLowerCase());
});

const cv = $('view');

cv.addEventListener('pointermove', e => {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  pointer.isTouch = e.pointerType === 'touch';
  pointer.lastMove = G.time;
});

cv.addEventListener('pointerdown', e => {
  AU.ensure();

  const now = performance.now();
  const tapGap = now - pointer.lastTapAt;
  const tapDistance = Math.hypot(e.clientX - pointer.lastTapX, e.clientY - pointer.lastTapY);
  const isTouchDoubleTap = e.pointerType === 'touch' && tapGap < 320 && tapDistance < 70;

  pointer.down = true;
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  pointer.isTouch = e.pointerType === 'touch';
  pointer.lastMove = G.time;

  if (G.state === 'title') {
    resetRun('standard');
  } else if (G.state === 'over' && G.overReady) {
    resetRun();
  } else if (G.state === 'upgrade') {
    pointer.down = false;
  } else if (G.state === 'playing' && isTouchDoubleTap) {
    activateSurge();
  }

  pointer.lastTapAt = now;
  pointer.lastTapX = e.clientX;
  pointer.lastTapY = e.clientY;
});

addEventListener('pointerup', () => {
  pointer.down = false;
  pointer.isTouch = false;
});

addEventListener('pointercancel', () => {
  pointer.down = false;
  pointer.isTouch = false;
});

$('sndBtn').addEventListener('click', e => {
  e.stopPropagation();
  AU.ensure();
  AU.toggle();
  e.currentTarget.blur();
});

$('pauseBtn').addEventListener('click', e => {
  e.stopPropagation();
  AU.ensure();

  if (G.state === 'playing' || G.state === 'paused') {
    pauseToggle();
  }

  e.currentTarget.blur();
});

$('resumeBtn').addEventListener('click', () => {
  AU.ensure();
  if (G.state === 'paused') pauseToggle();
});

$('pauseSoundBtn').addEventListener('click', () => {
  AU.ensure();
  AU.toggle();
});

$('pauseRestartBtn').addEventListener('click', () => {
  AU.ensure();
  resetRun();
});

$('relaunchBtn').addEventListener('click', () => {
  AU.ensure();
  if (G.state === 'over' && G.overReady) resetRun();
});

$('overHangarBtn').addEventListener('click', () => {
  AU.ensure();
  if (G.state === 'over') openHangar();
});

$('surge').addEventListener('click', () => {
  AU.ensure();
  if (G.state === 'playing') activateSurge();
});

$('startPrompt').addEventListener('click', () => {
  AU.ensure();

  if (G.state === 'title') {
    resetRun('standard');
  }
});

$('dailyPrompt').addEventListener('click', () => {
  AU.ensure();

  if (G.state === 'title') {
    resetRun('daily');
  }
});

$('installPrompt').addEventListener('click', async e => {
  e.currentTarget.blur();
  if (!deferredInstallPrompt) return;

  const promptEvent = deferredInstallPrompt;
  deferredInstallPrompt = null;
  setInstallPromptVisible(false);

  try {
    await promptEvent.prompt();
    await promptEvent.userChoice;
  } catch {
    /* The browser owns the install dialog and may dismiss it without a result. */
  }
});

$('hangarBtn').addEventListener('click', e => {
  AU.ensure();
  openHangar();
  e.currentTarget.blur();
});

$('hangarBackBtn').addEventListener('click', () => {
  AU.ensure();
  closeHangar();
});

$('hangarLaunchBtn').addEventListener('click', () => {
  AU.ensure();
  resetRun();
});

$('shareScoreBtn').addEventListener('click', () => {
  AU.ensure();
  shareRunScore();
});

for (const [key, [buttonId]] of Object.entries(SETTING_CONTROLS)) {
  $(buttonId).addEventListener('click', () => {
    AU.ensure();
    toggleSetting(key);
  });
}

const responseRange = $('settingResponseRange');

responseRange.addEventListener('input', () => {
  setInputResponse(responseRange.value);
});

responseRange.addEventListener('change', () => {
  AU.ensure();
  setInputResponse(responseRange.value, true);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && G.state === 'playing') {
    pauseToggle();
  }
});

/* =========================================================================
   Sizing / fatal / boot
   ========================================================================= */

function resize() {
  const c = $('view');

  // Cap DPR to 1.5 to prevent mobile GPU context creation failures
  G.dpr = Math.min(window.devicePixelRatio || 1, 1.5) * quality;

  let w = Math.round(c.clientWidth * G.dpr);
  let h = Math.round(c.clientHeight * G.dpr);

  // Hard cap max resolution to 1920 to prevent mobile compositor crashes
  const maxDim = 1920;
  if (w > maxDim || h > maxDim) {
    const scale = maxDim / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }

  c.width = Math.max(2, w);
  c.height = Math.max(2, h);

  G.w = c.clientWidth;
  G.h = c.clientHeight;
}

addEventListener('resize', resize);

function fatal(why) {
  G.state = 'fatal';
  mode = null;

  $('fatalWhy').textContent = why;

  ['ovTitle', 'ovHangar', 'ovPause', 'ovOver', 'ovProfile', 'ovRecords'].forEach(id => {
    const overlay = $(id);
    if (overlay) show(overlay, false);
  });

  show($('ovFatal'), true);

  ['hud', 'combo', 'chips', 'surge', 'boss'].forEach(id => {
    setChromeVisible(id, false);
  });
}

addEventListener('error', e => {
  if (G.state === 'fatal') return;
  fatal('RUNTIME — ' + (e.message || 'unknown error'));
});

addEventListener('unhandledrejection', e => {
  if (G.state === 'fatal') return;
  fatal('ASYNC — ' + String(e.reason && e.reason.message || e.reason));
});

const withTimeout = (pr, ms, tag) => Promise.race([
  pr,
  new Promise((_, rej) => setTimeout(() => rej(new Error(tag + ' timed out')), ms))
]);

/* =========================================================================
   Main loop
   ========================================================================= */

let lastT = 0;
let emaDt = 16;
let quality = SETTINGS.lowQuality ? 0.66 : 1;

function frame(ts) {
  requestAnimationFrame(frame);

  const now = ts / 1000;
  const rdt = lastT ? Math.min(0.05, now - lastT) : 0.016;

  lastT = now;

  emaDt = emaDt * 0.95 + rdt * 1000 * 0.05;

  if (SETTINGS.lowQuality && quality > 0.66) {
    quality = 0.66;
    resize();
  } else if (quality > 0.6 && now > 5 && emaDt > 24) {
    quality = 0.66;
    resize();
  }

  update(rdt);

  if (mode === 'webgpu') {
    gpuPass(rdt);
  } else if (mode === 'gl') {
    glPass(rdt);
  }
}

/* =========================================================================
   Boot
   ========================================================================= */

(async () => {
  try {
    registerOfflineShell();
    resize();

    const atlasCanvas = buildAtlas();

    let gpuWhy = '';

    if ('gpu' in navigator) {
      const p = initGPU(atlasCanvas);

      p.catch(() => {
        /* Swallow late rejection. */
      });

      try {
        const info = await withTimeout(p, 5000, 'WebGPU adapter');

        mode = 'webgpu';
        bootDone = true;

        $('gpuinfo').textContent =
          'WEBGPU ACTIVE' + (info ? (' · ' + info.toUpperCase().slice(0, 38)) : '');
      } catch (e) {
        gpuWhy = String(e && e.message || e);
      }
    } else {
      gpuWhy = 'navigator.gpu missing';
    }

    if (!mode) {
      try {
        initGL(atlasCanvas);

        mode = 'gl';
        bootDone = true;

        $('badgeTxt').textContent = 'WEBGL2 FALLBACK // CPU PARTICLES';
        $('badge').classList.add('warn');

        $('gpuinfo').textContent =
          'WEBGL2 FALLBACK · WEBGPU: ' + gpuWhy.toUpperCase().slice(0, 30);
      } catch (e) {
        fatal('webgpu: ' + gpuWhy + ' · webgl2: ' + String(e && e.message || e));
        return;
      }
    }

    resize();

    G.player.x = G.w / 2;
    G.player.y = G.h - 110;

    G.state = 'title';

    syncSoundControls();
    setPauseButton(false);

    updateTitleMeta();

    requestAnimationFrame(frame);
  } catch (err) {
    fatal('BOOT FAILURE — ' + String(err && err.message || err));
  }
})();
