'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const GAME_SOURCE = fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8');
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
      AU,
      COMPUTE_WGSL,
      PART_WGSL,
      initGPU,
      resetRun,
      gameOver,
      resize,
      toggleSetting,
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
