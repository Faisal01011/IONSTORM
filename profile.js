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
    } catch {
      return fallback;
    }
  }

  function saveJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
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

  function nonNegativeInt(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
  }

  /* =======================================================================
     Profile / board / stats state
     ======================================================================= */

  const PROFILE = Object.assign({
    pilotId: uid(),
    callsign: 'PILOT',
    createdAt: Date.now()
  }, loadJSON(PROFILE_KEY, {}));

  if (typeof PROFILE.pilotId !== 'string' || !PROFILE.pilotId) {
    PROFILE.pilotId = uid();
  }

  PROFILE.callsign = cleanCallsign(PROFILE.callsign);
  PROFILE.createdAt = nonNegativeInt(PROFILE.createdAt, Date.now());

  let BOARD = loadJSON(BOARD_KEY, []);

  if (!Array.isArray(BOARD)) {
    BOARD = [];
  }

  BOARD = BOARD
    .filter(entry => entry && typeof entry === 'object')
    .map(entry => ({
      id: typeof entry.id === 'string' && entry.id ? entry.id : uid(),
      pilotId: typeof entry.pilotId === 'string' ? entry.pilotId : '',
      name: cleanCallsign(entry.name),
      score: nonNegativeInt(entry.score),
      wave: nonNegativeInt(entry.wave, 1),
      kills: nonNegativeInt(entry.kills),
      maxCombo: nonNegativeInt(entry.maxCombo),
      ship: ['vanguard', 'interceptor', 'bastion'].includes(entry.ship)
        ? entry.ship
        : 'vanguard',
      date: nonNegativeInt(entry.date, Date.now())
    }))
    .sort((a, b) => (
      b.score - a.score ||
      b.wave - a.wave ||
      b.kills - a.kills ||
      a.date - b.date
    ))
    .slice(0, 10);

  const storedStats = loadJSON(STATS_KEY, {});
  const STATS = {};

  [
    'runs',
    'totalKills',
    'bestScore',
    'bestWave',
    'bestCombo',
    'bossKills',
    'asteroidKills',
    'surgeActivations'
  ].forEach(key => {
    STATS[key] = nonNegativeInt(storedStats && storedStats[key]);
  });

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
      width: min(720px, 100%);
      max-height: min(88dvh, 820px);
      overflow: auto;
      margin: auto;
      padding: clamp(24px, 4vw, 36px);
      display: flex;
      flex-direction: column;
      gap: 16px;
      align-items: center;
      text-align: center;
      box-shadow: var(--shadow-panel), var(--shadow-cyan);
      scrollbar-color: rgba(95, 242, 255, .38) rgba(2, 8, 15, .45);
      scrollbar-width: thin;
    }

    #ovRecords .recordsBox {
      width: min(900px, 100%);
    }

    .profileLead {
      max-width: 460px;
      color: var(--dim);
      font-size: .9rem;
      line-height: 1.45;
      letter-spacing: .04em;
    }

    .profileInput {
      width: 100%;
      max-width: 390px;
      min-height: 50px;
      background: rgba(2, 8, 15, .78);
      border: 1px solid var(--line);
      color: var(--ink);
      font-family: 'Orbitron';
      font-size: .78rem;
      letter-spacing: .18em;
      text-transform: uppercase;
      padding: .85em 1em;
      clip-path: var(--cham);
      outline: none;
      text-align: center;
      caret-color: var(--cyan);
    }

    .profileInput:focus {
      border-color: var(--cyan);
      box-shadow: 0 0 18px rgba(95, 242, 255, .18);
    }

    .profileBtns,
    .recordsBtns {
      width: 100%;
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }

    .profileBtns {
      max-width: 390px;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .profileBtns .cham,
    .recordsBtns .cham {
      width: 100%;
      min-width: 0;
      padding-inline: .75em;
    }

    .recordsList {
      width: 100%;
      display: grid;
      gap: 7px;
      max-height: 38dvh;
      overflow-x: hidden;
      overflow-y: auto;
      padding-right: 4px;
      text-align: left;
      scrollbar-color: rgba(95, 242, 255, .38) rgba(2, 8, 15, .45);
      scrollbar-width: thin;
      overscroll-behavior: contain;
    }

    .recordRow {
      display: grid;
      grid-template-columns: 42px minmax(0, 1fr) auto;
      gap: 12px;
      align-items: center;
      padding: 11px 13px;
    }

    .recordRow.me {
      border-color: rgba(255, 180, 84, .55);
      background:
        linear-gradient(90deg, rgba(255, 180, 84, .08), transparent 58%),
        var(--panel);
      box-shadow: 0 0 16px rgba(255, 180, 84, .1);
    }

    .recordRank {
      font-family: 'Orbitron';
      color: var(--amber);
      font-size: .7rem;
      letter-spacing: .1em;
    }

    .recordName {
      font-family: 'Orbitron';
      font-size: .66rem;
      letter-spacing: .1em;
    }

    .recordSub {
      font-family: 'Rajdhani';
      color: var(--dim);
      font-size: .7rem;
      line-height: 1.3;
      letter-spacing: .075em;
      margin-top: 3px;
    }

    .recordScore {
      font-family: 'Orbitron';
      color: var(--cyan);
      font-size: .74rem;
      letter-spacing: .06em;
    }

    .statsGrid {
      width: 100%;
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
    }

    .statBox {
      min-height: 70px;
      padding: 10px;
      display: grid;
      place-content: center;
      text-align: center;
    }

    .statBox .lbl {
      display: block;
      margin-bottom: 5px;
      font-size: .46rem;
    }

    .statBox .val {
      font-size: .86rem;
    }

    .smallNote {
      font-family: 'Orbitron';
      font-size: .48rem;
      line-height: 1.5;
      letter-spacing: .18em;
      color: rgba(143, 180, 201, .72);
      text-align: center;
    }

    .confirmDialog {
      width: min(430px, calc(100% - 28px));
      margin: auto;
      padding: 0;
      color: var(--ink);
      background: rgba(7, 16, 28, .98);
      border: 1px solid rgba(255, 92, 71, .42);
      clip-path: var(--cham);
      box-shadow: 0 24px 80px rgba(0, 0, 0, .58);
    }

    .confirmDialog::backdrop {
      background: rgba(1, 4, 10, .78);
      -webkit-backdrop-filter: blur(6px);
      backdrop-filter: blur(6px);
    }

    .confirmBody {
      padding: 26px;
      display: grid;
      gap: 14px;
      text-align: center;
    }

    .confirmBody h3 {
      font-family: 'Orbitron';
      font-size: 1rem;
      letter-spacing: .12em;
      color: var(--ember);
    }

    .confirmBody p {
      color: var(--dim);
      font-size: .9rem;
      line-height: 1.45;
      letter-spacing: .035em;
    }

    .confirmActions {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }

    .confirmActions .cham {
      width: 100%;
      min-width: 0;
    }

    @media (max-width: 720px), (max-height: 560px) and (pointer: coarse) {
      #ovProfile .profileBox,
      #ovRecords .recordsBox {
        width: 100%;
        max-height: 100%;
        padding: 22px 14px;
        gap: 13px;
      }

      .profileLead {
        font-size: .8rem;
      }

      .recordsList {
        max-height: 42dvh;
      }

      .recordRow {
        grid-template-columns: 34px minmax(0, 1fr);
        gap: 8px;
        padding: 10px;
      }

      .recordScore {
        grid-column: 2;
        margin-top: 2px;
      }

      .recordSub {
        font-size: .65rem;
      }

      .statsGrid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .profileBtns .cham,
      .recordsBtns .cham {
        min-height: 48px;
      }

      .recordsBtns {
        grid-template-columns: 1fr;
      }

      .confirmBody {
        padding: 22px 16px;
      }
    }

    @media (max-height: 560px) and (min-width: 600px) and (pointer: coarse) {
      #ovProfile .profileBox,
      #ovRecords .recordsBox {
        max-height: calc(100dvh - 16px);
        padding: 16px 20px;
        gap: 9px;
      }

      #ovRecords .recordsBox {
        width: min(900px, 100%);
      }

      .recordsList {
        max-height: 32dvh;
      }

      .statsGrid {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      .recordsBtns {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
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
    el.inert = true;
    el.innerHTML = innerHTML;
    document.body.appendChild(el);
    return el;
  }

  const ovProfile = makeOverlay('ovProfile', `
    <div class="panel profileBox">
      <div class="overlayStatus"><i aria-hidden="true"></i> LOCAL PILOT IDENTITY</div>
      <h2 class="big hold" id="profileTitle">PILOT PROFILE</h2>
      <p class="profileLead">Choose the callsign shown in your local records and mission summaries.</p>

      <div class="lbl">CALLSIGN</div>
      <input
        id="profileInput"
        class="profileInput"
        aria-label="Callsign"
        maxlength="14"
        autocomplete="off"
        spellcheck="false"
        placeholder="ENTER CALLSIGN"
      >

      <div class="smallNote">
        LOCAL ONLY · DO NOT USE YOUR REAL NAME
      </div>

      <div class="profileBtns">
        <button type="button" class="cham" id="profileSaveBtn">SAVE</button>
        <button type="button" class="cham secondary" id="profileBackBtn">BACK</button>
      </div>
    </div>
  `);

  const ovRecords = makeOverlay('ovRecords', `
    <div class="panel recordsBox">
      <div class="overlayStatus"><i aria-hidden="true"></i> LOCAL ARCHIVE ONLINE</div>
      <h2 class="big hold" id="recordsTitle">RECORDS</h2>
      <div class="smallNote">STORED ON THIS DEVICE · TOP 10 RUNS</div>

      <div class="lbl">LOCAL LEADERBOARD</div>
      <div id="recordsList" class="recordsList"></div>

      <div class="lbl">PILOT STATS</div>
      <div id="pilotStats" class="statsGrid"></div>

      <div class="recordsBtns">
        <button type="button" class="cham secondary" id="recordsBackBtn">BACK</button>
        <button type="button" class="cham secondary" id="recordsProfileBtn">EDIT PILOT</button>
        <button type="button" class="cham danger" id="recordsClearBtn">CLEAR RECORDS</button>
      </div>
    </div>
  `);

  ovProfile.setAttribute('role', 'dialog');
  ovProfile.setAttribute('aria-modal', 'true');
  ovProfile.setAttribute('aria-labelledby', 'profileTitle');

  ovRecords.setAttribute('role', 'dialog');
  ovRecords.setAttribute('aria-modal', 'true');
  ovRecords.setAttribute('aria-labelledby', 'recordsTitle');

  const clearRecordsDialog = document.createElement('dialog');
  clearRecordsDialog.id = 'clearRecordsDialog';
  clearRecordsDialog.className = 'confirmDialog';
  clearRecordsDialog.setAttribute('aria-labelledby', 'clearRecordsTitle');
  clearRecordsDialog.innerHTML = `
    <div class="confirmBody">
      <div class="overlayStatus dangerStatus"><i aria-hidden="true"></i> DESTRUCTIVE ACTION</div>
      <h3 id="clearRecordsTitle">CLEAR LOCAL RECORDS?</h3>
      <p>This permanently removes the local leaderboard on this device. Pilot stats and upgrades are not affected.</p>
      <div class="confirmActions">
        <button type="button" class="cham secondary" id="clearRecordsCancelBtn">CANCEL</button>
        <button type="button" class="cham danger" id="clearRecordsConfirmBtn">CLEAR</button>
      </div>
    </div>
  `;
  document.body.appendChild(clearRecordsDialog);

  /* =======================================================================
     Inject UI hooks into existing screens
     ======================================================================= */

  /* Pilot name in title meta */
  const titleMeta = document.querySelector('#ovTitle .meta');

  if (titleMeta) {
    const span = document.createElement('span');
    span.className = 'metaItem';
    span.innerHTML = '<small>PILOT</small><b id="tPilot">PILOT</b>';
    titleMeta.appendChild(span);
  }

  /* Title buttons */
  const titleBtns = document.querySelector('.titleBtns');

  if (titleBtns) {
    const profileBtn = document.createElement('button');
    profileBtn.type = 'button';
    profileBtn.className = 'cham secondary';
    profileBtn.textContent = 'PILOT';

    const recordsBtn = document.createElement('button');
    recordsBtn.type = 'button';
    recordsBtn.className = 'cham secondary';
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
    profileBtn.type = 'button';
    profileBtn.className = 'cham secondary';
    profileBtn.textContent = 'PILOT';

    const recordsBtn = document.createElement('button');
    recordsBtn.type = 'button';
    recordsBtn.className = 'cham secondary';
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
  const overActions = document.querySelector('#ovOver .gameOverActions');

  if (overActions) {
    const recordsBtn = document.createElement('button');
    recordsBtn.type = 'button';
    recordsBtn.className = 'cham secondary';
    recordsBtn.textContent = 'RECORDS';

    overActions.appendChild(recordsBtn);

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
      if (el && window.setChromeVisible) window.setChromeVisible(el, false);
    });
  }

  function showGameHUDForOver() {
    ['hud', 'combo', 'chips', 'surge'].forEach(id => {
      const el = $(id);
      if (el && window.setChromeVisible) window.setChromeVisible(el, true);
    });

    if (window.setGameControlsInteractive) {
      window.setGameControlsInteractive(false);
    }
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

  function requestClearRecords() {
    if (!clearRecordsDialog.open) {
      clearRecordsDialog.showModal();
      $('clearRecordsCancelBtn').focus();
    }
  }

  function clearRecords() {
    BOARD = [];
    saveBoard();

    renderRecords();
    clearRecordsDialog.close();

    if (window.toast) toast('LOCAL RECORDS CLEARED', 'red');
    if (typeof AU !== 'undefined' && AU.uiConfirm) AU.uiConfirm();
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
  $('recordsClearBtn').addEventListener('click', requestClearRecords);
  $('clearRecordsCancelBtn').addEventListener('click', () => clearRecordsDialog.close());
  $('clearRecordsConfirmBtn').addEventListener('click', clearRecords);

  clearRecordsDialog.addEventListener('click', e => {
    if (e.target === clearRecordsDialog) clearRecordsDialog.close();
  });

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

  window.killEnemy = function (e) {
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
  saveBoard();
  saveStats();

  if (window.updateTitleMeta) {
    updateTitleMeta();
  }
})();
