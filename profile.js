'use strict';

/* =========================================================================
   IONSTORM — Local Pilot Profile + Local Leaderboard + Pilot Stats
   Add-on module. Load after game.js.
   ========================================================================= */

(function () {
  if (window.__ionstormProfileLoaded) return;
  window.__ionstormProfileLoaded = true;
    
  if (typeof G === 'undefined' || typeof $ === 'undefined') {
    console.warn('IONSTORM profile add-on requires game.js to load first.');
    return;
  }
  /* =======================================================================
     Storage keys
     ======================================================================= */

  const PROFILE_KEY = 'ionstorm.profile';
  const BOARD_KEY = 'ionstorm.board';
  const STATS_KEY = 'ionstorm.stats';

  /* =======================================================================
     Storage helpers
     ======================================================================= */

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw) || fallback;
    } catch (err) {
      return fallback;
    }
  }

  function saveJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      /* Ignore storage failures. */
    }
  }

  function uid() {
    if (window.crypto && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }

    return 'id-' +
      Date.now().toString(36) +
      '-' +
      Math.random().toString(36).slice(2, 10);
  }

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* =======================================================================
     Profile / board / stats state
     ======================================================================= */

  let PROFILE = Object.assign({
    pilotId: uid(),
    callsign: 'PILOT',
    createdAt: Date.now()
  }, loadJSON(PROFILE_KEY, {}));

  if (!PROFILE.pilotId) {
    PROFILE.pilotId = uid();
  }

  if (!PROFILE.callsign) {
    PROFILE.callsign = 'PILOT';
  }

  let BOARD = loadJSON(BOARD_KEY, []);

  if (!Array.isArray(BOARD)) {
    BOARD = [];
  }

  let STATS = Object.assign({
    runs: 0,
    totalKills: 0,
    bestScore: 0,
    bestWave: 0,
    bestCombo: 0,
    bossKills: 0,
    asteroidKills: 0,
    surgeActivations: 0
  }, loadJSON(STATS_KEY, {}));

  function saveProfileData() {
    saveJSON(PROFILE_KEY, PROFILE);
  }

  function saveBoard() {
    saveJSON(BOARD_KEY, BOARD);
  }

  function saveStats() {
    saveJSON(STATS_KEY, STATS);
  }

  function cleanCallsign(value) {
    let v = String(value || '')
      .toUpperCase()
      .replace(/[^A-Z0-9\-_ ]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 14);

    return v || 'PILOT';
  }

  /* =======================================================================
     Inject styles
     ======================================================================= */

  const style = document.createElement('style');

  style.textContent = `
    #ovProfile .profileBox,
    #ovRecords .recordsBox {
      width: min(680px, 94vw);
      max-height: 88vh;
      overflow: auto;
      padding: 22px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      align-items: center;
    }

    .profileInput {
      width: 100%;
      max-width: 340px;
      background: rgba(4, 12, 20, .82);
      border: 1px solid var(--line);
      color: var(--ink);
      font-family: 'Orbitron';
      letter-spacing: .18em;
      text-transform: uppercase;
      padding: .85em 1em;
      clip-path: var(--cham);
      outline: none;
      text-align: center;
    }

    .profileInput:focus {
      border-color: var(--cyan);
      box-shadow: 0 0 18px rgba(95, 242, 255, .18);
    }

    .profileBtns,
    .recordsBtns {
      display: flex;
      gap: 10px;
      justify-content: center;
      flex-wrap: wrap;
    }

    .recordsList {
      width: 100%;
      display: grid;
      gap: 6px;
      max-height: 36vh;
      overflow: auto;
      padding-right: 4px;
    }

    .recordRow {
      display: grid;
      grid-template-columns: 42px 1fr auto;
      gap: 10px;
      align-items: center;
      padding: 9px 12px;
    }

    .recordRow.me {
      border-color: rgba(255, 180, 84, .55);
      box-shadow: 0 0 16px rgba(255, 180, 84, .12);
    }

    .recordRank {
      font-family: 'Orbitron';
      color: var(--amber);
      font-size: .72rem;
      letter-spacing: .1em;
    }

    .recordName {
      font-family: 'Orbitron';
      font-size: .68rem;
      letter-spacing: .12em;
    }

    .recordSub {
      font-family: 'Rajdhani';
      color: var(--dim);
      font-size: .72rem;
      letter-spacing: .12em;
      margin-top: 3px;
    }

    .recordScore {
      font-family: 'Orbitron';
      color: var(--cyan);
      font-size: .78rem;
      letter-spacing: .08em;
    }

    .statsGrid {
      width: 100%;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
      gap: 8px;
    }

    .statBox {
      padding: 10px;
      text-align: center;
    }

    .statBox .lbl {
      display: block;
      margin-bottom: 5px;
      font-size: .54rem;
    }

    .statBox .val {
      font-size: .95rem;
    }

    .smallNote {
      font-size: .62rem;
      letter-spacing: .22em;
      color: rgba(143, 180, 201, .72);
      text-align: center;
    }

    .overExtraBtns {
      display: flex;
      gap: 12px;
      justify-content: center;
      flex-wrap: wrap;
    }
  `;

  document.head.appendChild(style);

  /* =======================================================================
     Overlay creation helpers
     ======================================================================= */

  function makeOverlay(id, innerHTML) {
    const el = document.createElement('section');
    el.id = id;
    el.className = 'ov';
    el.innerHTML = innerHTML;
    document.body.appendChild(el);
    return el;
  }

  const ovProfile = makeOverlay('ovProfile', `
    <div class="panel profileBox">
      <h2 class="big hold" style="font-size:1.8rem">PILOT PROFILE</h2>

      <div class="lbl">CALLSIGN</div>
      <input
        id="profileInput"
        class="profileInput"
        maxlength="14"
        autocomplete="off"
        spellcheck="false"
        placeholder="ENTER CALLSIGN"
      >

      <div class="smallNote">
        LOCAL ONLY · DO NOT USE YOUR REAL NAME
      </div>

      <div class="profileBtns">
        <button class="cham" id="profileSaveBtn">SAVE</button>
        <button class="cham" id="profileBackBtn">BACK</button>
      </div>
    </div>
  `);

  const ovRecords = makeOverlay('ovRecords', `
    <div class="panel recordsBox">
      <h2 class="big hold" style="font-size:1.8rem">RECORDS</h2>

      <div class="lbl">LOCAL LEADERBOARD</div>
      <div id="recordsList" class="recordsList"></div>

      <div class="lbl">PILOT STATS</div>
      <div id="pilotStats" class="statsGrid"></div>

      <div class="recordsBtns">
        <button class="cham" id="recordsBackBtn">BACK</button>
        <button class="cham" id="recordsProfileBtn">EDIT PILOT</button>
        <button class="cham" id="recordsClearBtn">CLEAR RECORDS</button>
      </div>
    </div>
  `);

  /* =======================================================================
     Inject UI hooks into existing screens
     ======================================================================= */

  /* Pilot name in title meta */
  const titleMeta = document.querySelector('#ovTitle .meta');

  if (titleMeta) {
    const span = document.createElement('span');
    span.innerHTML = '&nbsp;·&nbsp; PILOT <b id="tPilot">PILOT</b>';
    titleMeta.appendChild(span);
  }

  /* Title buttons */
  const titleBtns = document.querySelector('.titleBtns');

  if (titleBtns) {
    const profileBtn = document.createElement('button');
    profileBtn.className = 'cham';
    profileBtn.textContent = 'PILOT';

    const recordsBtn = document.createElement('button');
    recordsBtn.className = 'cham';
    recordsBtn.textContent = 'RECORDS';

    titleBtns.appendChild(profileBtn);
    titleBtns.appendChild(recordsBtn);

    profileBtn.addEventListener('click', () => openProfile());
    recordsBtn.addEventListener('click', () => openRecords());
  }

  /* Hangar buttons */
  const hangarBtns = document.querySelector('.hangarBtns');

  if (hangarBtns) {
    const profileBtn = document.createElement('button');
    profileBtn.className = 'cham';
    profileBtn.textContent = 'PILOT';

    const recordsBtn = document.createElement('button');
    recordsBtn.className = 'cham';
    recordsBtn.textContent = 'RECORDS';

    hangarBtns.insertBefore(recordsBtn, hangarBtns.firstChild);
    hangarBtns.insertBefore(profileBtn, hangarBtns.firstChild);

    profileBtn.addEventListener('click', () => openProfile());
    recordsBtn.addEventListener('click', () => openRecords());
  }

  /* Game over rank row */
  const overStats = document.querySelector('#ovOver .stats');

  if (overStats) {
    overStats.insertAdjacentHTML(
      'beforeend',
      '<span class="lbl">LOCAL RANK</span><span class="val" id="sRank">--</span>'
    );
  }

  /* Game over records button */
  const overStart = document.querySelector('#ovOver .start');

  if (overStart) {
    const wrap = document.createElement('div');
    wrap.className = 'overExtraBtns';

    const recordsBtn = document.createElement('button');
    recordsBtn.className = 'cham';
    recordsBtn.textContent = 'RECORDS';

    wrap.appendChild(recordsBtn);
    overStart.insertAdjacentElement('afterend', wrap);

    recordsBtn.addEventListener('click', () => openRecords());
  }

  /* =======================================================================
     Menu state helpers
     ======================================================================= */

  let uiReturn = 'title';

  function hideAllMenus() {
    const ids = [
      'ovTitle',
      'ovHangar',
      'ovOver',
      'ovProfile',
      'ovRecords'
    ];

    ids.forEach(id => {
      const el = $(id);
      if (el && window.show) window.show(el, false);
    });
  }

  function hideGameHUD() {
    ['hud', 'combo', 'chips', 'surge', 'boss'].forEach(id => {
      const el = $(id);
      if (el) el.classList.add('hidden');
    });
  }

  function showGameHUDForOver() {
    ['hud', 'combo', 'chips', 'surge'].forEach(id => {
      const el = $(id);
      if (el) el.classList.remove('hidden');
    });
  }

  function restoreReturn() {
    hideAllMenus();

    if (uiReturn === 'over') {
      G.state = 'over';
      window.show($('ovOver'), true);
      showGameHUDForOver();
      return;
    }

    if (uiReturn === 'hangar') {
      G.state = 'hangar';
      window.show($('ovHangar'), true);
      hideGameHUD();
      return;
    }

    if (uiReturn === 'records') {
      G.state = 'records';
      window.show($('ovRecords'), true);
      hideGameHUD();
      return;
    }

    G.state = 'title';
    window.show($('ovTitle'), true);
    hideGameHUD();
  }

  /* =======================================================================
     Profile UI
     ======================================================================= */

  function openProfile() {
    if (!['title', 'over', 'hangar', 'records'].includes(G.state)) return;

    uiReturn = G.state;
    G.state = 'profile';

    hideAllMenus();
    hideGameHUD();

    window.show($('ovProfile'), true);

    const input = $('profileInput');

    if (input) {
      input.value = PROFILE.callsign;
      setTimeout(() => input.focus(), 40);
    }
  }

  function closeProfile() {
    restoreReturn();
  }

  function saveProfile() {
    const input = $('profileInput');

    PROFILE.callsign = cleanCallsign(input ? input.value : PROFILE.callsign);

    saveProfileData();

    if (window.toast) toast('CALLSIGN SAVED', 'gold');
    if (typeof AU !== 'undefined' && AU.uiConfirm) AU.uiConfirm();

    if (window.updateTitleMeta) updateTitleMeta();

    closeProfile();
  }

  /* =======================================================================
     Records UI
     ======================================================================= */

  function openRecords() {
    if (!['title', 'over', 'hangar', 'profile'].includes(G.state)) return;

    uiReturn = G.state === 'profile' ? uiReturn : G.state;
    G.state = 'records';

    hideAllMenus();
    hideGameHUD();

    renderRecords();

    window.show($('ovRecords'), true);
  }

  function closeRecords() {
    restoreReturn();
  }

  function renderRecords() {
    const list = $('recordsList');

    if (!list) return;

    if (!BOARD.length) {
      list.innerHTML = `
        <div class="panel recordRow">
          <span class="recordName">NO RECORDS YET</span>
        </div>
      `;
    } else {
      list.innerHTML = BOARD.map((entry, i) => {
        const me = entry.pilotId === PROFILE.pilotId ? ' me' : '';

        return `
          <div class="panel recordRow${me}">
            <span class="recordRank">${String(i + 1).padStart(2, '0')}</span>
            <span>
              <span class="recordName">${esc(entry.name)}</span>
              <div class="recordSub">
                WAVE ${String(entry.wave).padStart(2, '0')}
                · KILLS ${entry.kills}
                · COMBO ×${entry.maxCombo}
                · ${esc(String(entry.ship || 'vanguard').toUpperCase())}
              </div>
            </span>
            <span class="recordScore">${window.pad7 ? pad7(entry.score) : entry.score}</span>
          </div>
        `;
      }).join('');
    }

    const stats = $('pilotStats');

    if (!stats) return;

    const items = [
      ['RUNS', STATS.runs],
      ['TOTAL KILLS', STATS.totalKills],
      ['BEST SCORE', window.pad7 ? pad7(STATS.bestScore) : STATS.bestScore],
      ['BEST WAVE', STATS.bestWave],
      ['BEST COMBO', '×' + STATS.bestCombo],
      ['BOSS KILLS', STATS.bossKills],
      ['ASTEROIDS', STATS.asteroidKills],
      ['SURGES', STATS.surgeActivations]
    ];

    stats.innerHTML = items.map(([label, value]) => {
      return `
        <div class="panel statBox">
          <span class="lbl">${label}</span>
          <span class="val">${value}</span>
        </div>
      `;
    }).join('');
  }

  function clearRecords() {
    if (!confirm('Clear local leaderboard records?')) return;

    BOARD = [];
    saveBoard();

    renderRecords();

    if (window.toast) toast('LOCAL RECORDS CLEARED', 'red');
  }

  /* =======================================================================
     Run recording
     ======================================================================= */

  function recordRun() {
    const score = G.score || 0;

    STATS.bestScore = Math.max(STATS.bestScore, score);
    STATS.bestWave = Math.max(STATS.bestWave, G.wave || 0);
    STATS.bestCombo = Math.max(STATS.bestCombo, G.maxCombo || 0);

    saveStats();

    if (score <= 0) return null;

    const entry = {
      id: uid(),
      pilotId: PROFILE.pilotId,
      name: PROFILE.callsign,
      score: score,
      wave: G.wave || 1,
      kills: G.kills || 0,
      maxCombo: G.maxCombo || 0,
      ship: (typeof META !== 'undefined' && META.ship) ? META.ship : 'vanguard',
      date: Date.now()
    };

    BOARD.push(entry);

    BOARD.sort((a, b) => {
      return (
        b.score - a.score ||
        b.wave - a.wave ||
        b.kills - a.kills ||
        a.date - b.date
      );
    });

    BOARD = BOARD.slice(0, 10);

    saveBoard();

    const idx = BOARD.findIndex(x => x.id === entry.id);

    return idx >= 0 ? idx + 1 : null;
  }

  /* =======================================================================
     Events
     ======================================================================= */

  $('profileSaveBtn').addEventListener('click', saveProfile);
  $('profileBackBtn').addEventListener('click', closeProfile);
  $('recordsBackBtn').addEventListener('click', closeRecords);
  $('recordsProfileBtn').addEventListener('click', openProfile);
  $('recordsClearBtn').addEventListener('click', clearRecords);

  ovProfile.addEventListener('click', e => {
    if (e.target === ovProfile) closeProfile();
  });

  ovRecords.addEventListener('click', e => {
    if (e.target === ovRecords) closeRecords();
  });

  const profileInput = $('profileInput');

  if (profileInput) {
    profileInput.addEventListener('keydown', e => {
      e.stopPropagation();

      if (e.key === 'Enter') {
        saveProfile();
      } else if (e.key === 'Escape') {
        closeProfile();
      }
    });
  }

  window.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();

    if (G.state === 'records' && k === 'escape') {
      closeRecords();
      return;
    }

    if (
      G.state === 'profile' &&
      k === 'escape' &&
      document.activeElement !== $('profileInput')
    ) {
      closeProfile();
    }
  });

  window.addEventListener('beforeunload', () => {
    saveStats();
  });

  /* =======================================================================
     Hook into existing game functions
     ======================================================================= */

  /* Update pilot name in title */
  const _updateTitleMeta = window.updateTitleMeta;

  window.updateTitleMeta = function () {
    if (_updateTitleMeta) {
      _updateTitleMeta.apply(this, arguments);
    }

    const el = $('tPilot');

    if (el) {
      el.textContent = PROFILE.callsign;
    }
  };

  /* Count runs */
  const _resetRun = window.resetRun;

  window.resetRun = function () {
    STATS.runs++;
    saveStats();

    if (_resetRun) {
      return _resetRun.apply(this, arguments);
    }
  };

  /* Track kills by type */
  const _killEnemy = window.killEnemy;

  window.killEnemy = function (e, i) {
    if (e && e.type) {
      STATS.totalKills++;

      if (e.type === 'boss') {
        STATS.bossKills++;
      }

      if (e.type === 'asteroid') {
        STATS.asteroidKills++;
      }
    }

    if (_killEnemy) {
      return _killEnemy.apply(this, arguments);
    }
  };

  /* Track SURGE activations */
  const _activateSurge = window.activateSurge;

  window.activateSurge = function () {
    if (
      G.surge >= 100 &&
      !G.surgeActive &&
      G.surgeCooldown <= 0
    ) {
      STATS.surgeActivations++;
    }

    if (_activateSurge) {
      return _activateSurge.apply(this, arguments);
    }
  };

  /* Save run after game over */
  const _gameOver = window.gameOver;

  window.gameOver = function () {
    if (_gameOver) {
      _gameOver.apply(this, arguments);
    }

    const rank = recordRun();

    const rankEl = $('sRank');

    if (rankEl) {
      rankEl.textContent = rank ? '#' + String(rank).padStart(2, '0') : '--';
    }

    saveStats();

    if (window.updateTitleMeta) {
      updateTitleMeta();
    }
  };

  /* =======================================================================
     Init
     ======================================================================= */

  saveProfileData();

  if (window.updateTitleMeta) {
    updateTitleMeta();
  }
})();