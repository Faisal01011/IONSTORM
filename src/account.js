'use strict';

/* =========================================================================
   IONSTORM — Optional account and cloud-save layer

   This module is deliberately progressive enhancement. If Supabase is not
   configured, or its CDN script is unavailable, the game remains a complete
   guest/offline experience and keeps using its local saves.
   ========================================================================= */

(function () {
  if (window.__ionstormAccountLoaded) return;
  window.__ionstormAccountLoaded = true;

  const CONFIG = window.IONSTORM_SUPABASE_CONFIG || {};
  const SDK = window.supabase;
  const ACCOUNT_PREFERENCE_KEY = 'ionstorm.account.preference';
  const PROMPT_SEEN_KEY = 'ionstorm.account.prompt-seen';
  const SYNC_DELAY = 900;
  const VALID_SHIPS = ['vanguard', 'interceptor', 'bastion'];
  const COSMETIC_CATEGORIES = ['colors', 'trails', 'engines', 'victories'];
  const UPGRADE_IDS = ['hull', 'rapid', 'surge', 'shield', 'seeker', 'magnet', 'speed'];
  const STAT_KEYS = [
    'runs',
    'totalKills',
    'bestScore',
    'bestWave',
    'bestCombo',
    'bossKills',
    'asteroidKills',
    'surgeActivations',
    'dailyRuns',
    'bestDailyScore',
    'eliteKills',
    'totalDamage',
    'systemsInstalled',
    'shotsFired',
    'shotsHit'
  ];

  function configuredValue(value) {
    return typeof value === 'string' && value.trim() &&
      !/^YOUR[_ -]|^REPLACE[_ -]|^https?:\/\/YOUR/i.test(value.trim());
  }

  const isConfigured = configuredValue(CONFIG.url) &&
    configuredValue(CONFIG.anonKey) &&
    !/service[_ -]?role|sb_secret/i.test(CONFIG.anonKey);

  let supabaseClient = null;

  if (isConfigured && SDK && typeof SDK.createClient === 'function') {
    try {
      supabaseClient = SDK.createClient(CONFIG.url.trim(), CONFIG.anonKey.trim(), {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: true
        }
      });
    } catch (error) {
      console.warn('IONSTORM cloud link could not start:', error);
    }
  }

  let session = null;
  let signUpMode = false;
  let loading = false;
  let syncing = false;
  let queuedSync = false;
  let applyingSnapshot = false;
  let syncTimer = 0;
  let statusMessage = '';
  let statusKind = '';
  let overlay;
  let accountButton;
  let accountForm;
  let accountEmail;
  let accountPassword;
  let accountCallsign;
  let accountSubmit;
  let accountModeToggle;
  let accountGoogle;
  let accountGuest;
  let accountClose;
  let accountSignedOut;
  let accountSignedIn;
  let accountIdentity;
  let accountSyncNow;
  let accountSignOut;
  let accountStatus;

  function $(id) {
    return document.getElementById(id);
  }

  function safeGet(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function safeSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* Guest mode still works when browser storage is unavailable. */
    }
  }

  function safeRemove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* Ignore storage failures. */
    }
  }

  function clone(value, fallback = {}) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return fallback;
    }
  }

  function nonNegativeInt(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
  }

  function cleanCallsign(value) {
    const cleaned = String(value || '')
      .toUpperCase()
      .replace(/[^A-Z0-9\-_ ]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 14);

    return cleaned || 'PILOT';
  }

  function setMessage(message, kind = '') {
    statusMessage = String(message || '');
    statusKind = kind;

    if (accountStatus) {
      accountStatus.textContent = statusMessage;
      accountStatus.className = 'accountStatus' + (statusKind ? ' ' + statusKind : '');
    }
  }

  function formatUser(user) {
    if (!user) return 'GUEST PILOT';
    const metadata = user.user_metadata || {};
    return cleanCallsign(metadata.callsign || user.email?.split('@')[0] || 'PILOT');
  }

  function localSnapshot() {
    const game = window.ionstormGame && typeof window.ionstormGame.getSnapshot === 'function'
      ? window.ionstormGame.getSnapshot()
      : { highScore: nonNegativeInt(safeGet('ionstorm.hi')), meta: {} };
    const profile = window.ionstormProfile && typeof window.ionstormProfile.getSnapshot === 'function'
      ? window.ionstormProfile.getSnapshot()
      : { profile: { callsign: 'PILOT' }, board: [], stats: {} };

    return {
      schemaVersion: 1,
      savedAt: Date.now(),
      game: clone(game),
      profile: clone(profile)
    };
  }

  function mergeMeta(local = {}, cloud = {}) {
    const localUpgrades = local.upgrades || {};
    const cloudUpgrades = cloud.upgrades || {};
    const achievements = {};
    const upgrades = {};

    UPGRADE_IDS.forEach(id => {
      upgrades[id] = Math.max(
        nonNegativeInt(localUpgrades[id]),
        nonNegativeInt(cloudUpgrades[id])
      );
    });

    [local.achievements, cloud.achievements].forEach(source => {
      if (!source || typeof source !== 'object') return;

      Object.entries(source).forEach(([id, unlocked]) => {
        if (unlocked === true) achievements[id] = true;
      });
    });

    const cosmetics = {};

    COSMETIC_CATEGORIES.forEach(category => {
      const localSelection = local.cosmetics && local.cosmetics[category];
      const cloudSelection = cloud.cosmetics && cloud.cosmetics[category];
      cosmetics[category] = cloudSelection || localSelection ||
        ({ colors: 'ship', trails: 'ion', engines: 'standard', victories: 'burst' }[category]);
    });

    return {
      scrap: Math.max(nonNegativeInt(local.scrap), nonNegativeInt(cloud.scrap)),
      ship: VALID_SHIPS.includes(cloud.ship)
        ? cloud.ship
        : VALID_SHIPS.includes(local.ship) ? local.ship : 'vanguard',
      upgrades,
      achievements,
      cosmetics
    };
  }

  function mergeDaily(local = {}, cloud = {}) {
    const bestByDate = {};
    const sources = [local.bestByDate, cloud.bestByDate];

    sources.forEach(source => {
      if (!source || typeof source !== 'object') return;

      Object.entries(source).forEach(([date, score]) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
        bestByDate[date] = Math.max(bestByDate[date] || 0, nonNegativeInt(score));
      });
    });

    return { bestByDate };
  }

  function mergeStats(local = {}, cloud = {}) {
    const stats = {};
    const keys = new Set([...STAT_KEYS, ...Object.keys(local), ...Object.keys(cloud)]);

    keys.forEach(key => {
      stats[key] = Math.max(nonNegativeInt(local[key]), nonNegativeInt(cloud[key]));
    });

    return stats;
  }

  function recordKey(entry) {
    if (entry && entry.id) return String(entry.id);
    return [entry?.pilotId, entry?.date, entry?.score, entry?.wave].join(':');
  }

  function mergeBoard(local = [], cloud = []) {
    const byId = new Map();

    [...(Array.isArray(local) ? local : []), ...(Array.isArray(cloud) ? cloud : [])]
      .filter(entry => entry && typeof entry === 'object')
      .forEach(entry => {
        const key = recordKey(entry);
        const previous = byId.get(key);
        if (!previous || nonNegativeInt(entry.score) > nonNegativeInt(previous.score)) {
          byId.set(key, clone(entry));
        }
      });

    return [...byId.values()]
      .sort((a, b) => (
        nonNegativeInt(b.score) - nonNegativeInt(a.score) ||
        nonNegativeInt(b.wave) - nonNegativeInt(a.wave) ||
        nonNegativeInt(b.kills) - nonNegativeInt(a.kills) ||
        nonNegativeInt(a.date) - nonNegativeInt(b.date)
      ))
      .slice(0, 10);
  }

  function mergeSnapshots(local, cloud) {
    const localSnapshotValue = local && typeof local === 'object' ? local : localSnapshot();
    const cloudSnapshot = cloud && typeof cloud === 'object' ? cloud : {};
    const localGame = localSnapshotValue.game || {};
    const cloudGame = cloudSnapshot.game || {};
    const localProfile = localSnapshotValue.profile || {};
    const cloudProfile = cloudSnapshot.profile || {};
    const localIdentity = localProfile.profile || {};
    const cloudIdentity = cloudProfile.profile || {};

    const cloudCallsign = cleanCallsign(cloudIdentity.callsign);
    const localCallsign = cleanCallsign(localIdentity.callsign);

    return {
      schemaVersion: 1,
      savedAt: Math.max(
        nonNegativeInt(localSnapshotValue.savedAt),
        nonNegativeInt(cloudSnapshot.savedAt)
      ),
      game: {
        highScore: Math.max(
          nonNegativeInt(localGame.highScore),
          nonNegativeInt(cloudGame.highScore)
        ),
        meta: mergeMeta(localGame.meta, cloudGame.meta),
        daily: mergeDaily(localGame.daily, cloudGame.daily)
      },
      profile: {
        profile: {
          pilotId: typeof cloudIdentity.pilotId === 'string' && cloudIdentity.pilotId
            ? cloudIdentity.pilotId
            : localIdentity.pilotId,
          callsign: cloudCallsign !== 'PILOT' ? cloudCallsign : localCallsign,
          createdAt: Math.min(
            nonNegativeInt(localIdentity.createdAt, Date.now()),
            nonNegativeInt(cloudIdentity.createdAt, Date.now())
          )
        },
        board: mergeBoard(localProfile.board, cloudProfile.board),
        stats: mergeStats(localProfile.stats, cloudProfile.stats)
      }
    };
  }

  function makeOverlay() {
    overlay = document.createElement('section');
    overlay.id = 'ovAccount';
    overlay.className = 'ov accountOverlay';
    overlay.inert = true;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'accountTitle');
    overlay.innerHTML = `
      <div class="panel accountBox">
        <div class="accountTopline">
          <div class="overlayStatus"><i aria-hidden="true"></i> PILOT NETWORK</div>
          <button type="button" class="accountClose" id="accountClose" aria-label="Close account panel">×</button>
        </div>

        <h2 class="big hold" id="accountTitle">SYNC YOUR PILOT</h2>
        <p class="accountLead" id="accountLead">
          Keep your callsign, achievements, Hangar upgrades, cosmetics, and records with you on every device.
        </p>

        <div class="accountSignedOut" id="accountSignedOut">
          <button type="button" class="cham accountGoogle" id="accountGoogle">
            <span aria-hidden="true">G</span> CONTINUE WITH GOOGLE
          </button>

          <div class="accountDivider"><span>OR USE EMAIL</span></div>

          <form class="accountForm" id="accountForm">
            <label class="accountField">
              <span>EMAIL</span>
              <input id="accountEmail" type="email" autocomplete="email" required placeholder="pilot@example.com">
            </label>

            <label class="accountField">
              <span>PASSWORD</span>
              <input id="accountPassword" type="password" minlength="6" autocomplete="current-password" required placeholder="6+ characters">
            </label>

            <label class="accountField accountCallsignField" id="accountCallsignField">
              <span>CALLSIGN</span>
              <input id="accountCallsign" type="text" maxlength="14" autocomplete="nickname" placeholder="PILOT">
            </label>

            <button type="submit" class="cham primaryAction" id="accountSubmit">SIGN IN</button>
          </form>

          <button type="button" class="accountModeToggle" id="accountModeToggle">NEED AN ACCOUNT? CREATE ONE</button>
          <button type="button" class="cham secondary accountGuest" id="accountGuest">PLAY AS GUEST</button>
        </div>

        <div class="accountSignedIn hidden" id="accountSignedIn">
          <div class="accountIdentity">
            <span class="accountIdentityMark" aria-hidden="true">✓</span>
            <span>
              <small>CONNECTED PILOT</small>
              <strong id="accountIdentity">—</strong>
            </span>
          </div>
          <p class="accountLead accountLeadSmall">Cloud progression is protected by your account and private row-level access rules.</p>
          <div class="accountSignedInActions">
            <button type="button" class="cham" id="accountSyncNow">SYNC NOW</button>
            <button type="button" class="cham secondary" id="accountSignOut">SIGN OUT</button>
          </div>
        </div>

        <p class="accountStatus" id="accountStatus" role="status" aria-live="polite"></p>
        <p class="accountFinePrint">Guest play stays local. Never enter a service-role or secret key in the browser.</p>
      </div>
    `;

    document.body.appendChild(overlay);

    accountForm = $('accountForm');
    accountEmail = $('accountEmail');
    accountPassword = $('accountPassword');
    accountCallsign = $('accountCallsign');
    accountSubmit = $('accountSubmit');
    accountModeToggle = $('accountModeToggle');
    accountGoogle = $('accountGoogle');
    accountGuest = $('accountGuest');
    accountClose = $('accountClose');
    accountSignedOut = $('accountSignedOut');
    accountSignedIn = $('accountSignedIn');
    accountIdentity = $('accountIdentity');
    accountSyncNow = $('accountSyncNow');
    accountSignOut = $('accountSignOut');
    accountStatus = $('accountStatus');

    accountForm.addEventListener('submit', submitCredentials);
    accountModeToggle.addEventListener('click', () => {
      signUpMode = !signUpMode;
      render();
      (signUpMode ? accountCallsign : accountEmail).focus();
    });
    accountGoogle.addEventListener('click', signInWithGoogle);
    accountGuest.addEventListener('click', continueAsGuest);
    accountClose.addEventListener('click', closeAccount);
    accountSyncNow.addEventListener('click', () => {
      void syncWithCloud('manual');
    });
    accountSignOut.addEventListener('click', signOut);

    overlay.addEventListener('click', event => {
      if (event.target === overlay) closeAccount();
    });
  }

  function injectTitleButton() {
    const titleButtons = document.querySelector('.titleBtns');
    if (!titleButtons || document.getElementById('accountBtn')) return;

    accountButton = document.createElement('button');
    accountButton.type = 'button';
    accountButton.id = 'accountBtn';
    accountButton.className = 'cham secondary accountTitleButton';
    accountButton.addEventListener('click', openAccount);
    titleButtons.appendChild(accountButton);
  }

  function render() {
    if (!accountSignedOut) return;

    const signedIn = !!session;
    accountSignedOut.classList.toggle('hidden', signedIn);
    accountSignedIn.classList.toggle('hidden', !signedIn);
    accountIdentity.textContent = signedIn ? formatUser(session.user) : '—';
    accountSubmit.textContent = signUpMode ? 'CREATE ACCOUNT' : 'SIGN IN';
    accountModeToggle.textContent = signUpMode
      ? 'ALREADY REGISTERED? SIGN IN'
      : 'NEED AN ACCOUNT? CREATE ONE';
    document.getElementById('accountCallsignField').classList.toggle('hidden', !signUpMode);

    const disabled = loading || !supabaseClient;
    accountGoogle.disabled = disabled;
    accountSubmit.disabled = disabled;
    accountSyncNow.disabled = loading;
    accountSignOut.disabled = loading;

    if (accountButton) {
      accountButton.textContent = signedIn ? 'PILOT: ' + formatUser(session.user) :
        supabaseClient ? 'SYNC PILOT' : 'ACCOUNT SETUP';
      accountButton.classList.toggle('accountConnected', signedIn);
    }

    if (statusMessage) {
      accountStatus.textContent = statusMessage;
      accountStatus.className = 'accountStatus' + (statusKind ? ' ' + statusKind : '');
    }
  }

  function openAccount() {
    if (!overlay) return;
    overlay.classList.add('on');
    overlay.inert = false;
    safeSet(PROMPT_SEEN_KEY, '1');
    render();

    if (!supabaseClient) {
      setMessage(
        isConfigured
          ? 'CLOUD SDK UNAVAILABLE — GUEST MODE READY'
          : 'ADD YOUR SUPABASE URL AND PUBLISHABLE KEY TO ENABLE SYNC',
        'warn'
      );
    }

    window.setTimeout(() => {
      (session ? accountClose : accountEmail)?.focus();
    }, 30);
  }

  function closeAccount() {
    if (!overlay) return;
    overlay.classList.remove('on');
    overlay.inert = true;
  }

  function setLoading(value) {
    loading = !!value;
    render();
  }

  function authError(error) {
    return String(error?.message || error || 'AUTHENTICATION FAILED')
      .replace(/\s+/g, ' ')
      .slice(0, 180);
  }

  async function submitCredentials(event) {
    event.preventDefault();
    if (!supabaseClient) {
      setMessage('CLOUD LINK IS NOT CONFIGURED — PLAY AS GUEST FOR LOCAL PROGRESS', 'warn');
      return;
    }

    const email = String(accountEmail.value || '').trim();
    const password = String(accountPassword.value || '');
    const callsign = cleanCallsign(accountCallsign.value);

    if (!email || password.length < 6) {
      setMessage('ENTER A VALID EMAIL AND A PASSWORD OF AT LEAST 6 CHARACTERS', 'error');
      return;
    }

    setLoading(true);
    setMessage(signUpMode ? 'CREATING PILOT ACCOUNT…' : 'AUTHENTICATING PILOT…');

    try {
      const result = signUpMode
        ? await supabaseClient.auth.signUp({
          email,
          password,
          options: {
            data: { callsign },
            emailRedirectTo: window.location.href.split('#')[0]
          }
        })
        : await supabaseClient.auth.signInWithPassword({ email, password });

      if (result.error) throw result.error;

      if (signUpMode && !result.data?.session) {
        setMessage('ACCOUNT CREATED — CHECK YOUR EMAIL TO CONFIRM THE PILOT LINK', 'success');
      } else {
        setMessage('PILOT LINK ACCEPTED — LOADING CLOUD PROGRESSION…', 'success');
      }
    } catch (error) {
      setMessage(authError(error), 'error');
    } finally {
      setLoading(false);
    }
  }

  async function signInWithGoogle() {
    if (!supabaseClient) {
      setMessage('CLOUD LINK IS NOT CONFIGURED — GOOGLE SIGN-IN IS DISABLED', 'warn');
      return;
    }

    setLoading(true);
    setMessage('OPENING GOOGLE PILOT LINK…');

    try {
      const { error } = await supabaseClient.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.href.split('#')[0]
        }
      });

      if (error) throw error;
    } catch (error) {
      setLoading(false);
      setMessage(authError(error), 'error');
    }
  }

  function continueAsGuest() {
    safeSet(ACCOUNT_PREFERENCE_KEY, 'guest');
    safeSet(PROMPT_SEEN_KEY, '1');
    closeAccount();

    if (typeof window.toast === 'function') {
      window.toast('GUEST PILOT — LOCAL SAVE ACTIVE', 'gold');
    }
  }

  async function signOut() {
    if (!supabaseClient) return;
    setLoading(true);

    try {
      const { error } = await supabaseClient.auth.signOut();
      if (error) throw error;
      setMessage('SIGNED OUT — LOCAL GUEST PROGRESS REMAINS ON THIS DEVICE', 'success');
    } catch (error) {
      setMessage(authError(error), 'error');
    } finally {
      setLoading(false);
    }
  }

  async function readCloudSnapshot() {
    const { data, error } = await supabaseClient
      .from('pilot_saves')
      .select('snapshot, updated_at')
      .eq('user_id', session.user.id)
      .maybeSingle();

    if (error) throw error;
    return data?.snapshot && typeof data.snapshot === 'object' ? data.snapshot : null;
  }

  async function writeCloudSnapshot(snapshot) {
    const now = new Date().toISOString();
    const callsign = cleanCallsign(snapshot.profile?.profile?.callsign || formatUser(session.user));

    const profileResult = await supabaseClient
      .from('profiles')
      .upsert({
        id: session.user.id,
        callsign,
        updated_at: now
      }, { onConflict: 'id' });

    if (profileResult.error) throw profileResult.error;

    const saveResult = await supabaseClient
      .from('pilot_saves')
      .upsert({
        user_id: session.user.id,
        snapshot: { ...snapshot, savedAt: Date.now() },
        updated_at: now
      }, { onConflict: 'user_id' });

    if (saveResult.error) throw saveResult.error;
  }

  function applySnapshot(snapshot) {
    applyingSnapshot = true;

    try {
      if (window.ionstormGame && typeof window.ionstormGame.applySnapshot === 'function') {
        window.ionstormGame.applySnapshot(snapshot.game || {});
      }

      if (window.ionstormProfile && typeof window.ionstormProfile.applySnapshot === 'function') {
        window.ionstormProfile.applySnapshot(snapshot.profile || {});
      }
    } finally {
      applyingSnapshot = false;
    }
  }

  async function syncWithCloud(reason = 'background') {
    if (!supabaseClient || !session) return false;

    if (syncing) {
      queuedSync = true;
      return false;
    }

    syncing = true;
    render();
    setMessage(reason === 'manual' ? 'SYNCING PILOT PROGRESSION…' : 'SAVING PILOT PROGRESSION…');

    try {
      const local = localSnapshot();
      const cloud = await readCloudSnapshot();
      const merged = mergeSnapshots(local, cloud);

      applySnapshot(merged);

      const finalSnapshot = localSnapshot();
      finalSnapshot.savedAt = Date.now();
      await writeCloudSnapshot(finalSnapshot);

      setMessage('CLOUD SYNCED · ' + new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
      }), 'success');
      return true;
    } catch (error) {
      setMessage('SYNC PAUSED · ' + authError(error), 'error');
      return false;
    } finally {
      syncing = false;
      render();

      if (queuedSync) {
        queuedSync = false;
        scheduleSync('queued');
      }
    }
  }

  function scheduleSync(reason = 'background') {
    if (!session || !supabaseClient || applyingSnapshot) return;
    window.clearTimeout(syncTimer);
    syncTimer = window.setTimeout(() => {
      void syncWithCloud(reason);
    }, SYNC_DELAY);
  }

  async function writeRun(run) {
    if (!supabaseClient || !session || !run || nonNegativeInt(run.score) <= 0) return;

    const row = {
      user_id: session.user.id,
      client_run_id: String(run.id || [run.date, run.score, run.wave].join('-')).slice(0, 120),
      score: nonNegativeInt(run.score),
      wave: Math.max(1, nonNegativeInt(run.wave, 1)),
      kills: nonNegativeInt(run.kills),
      max_combo: nonNegativeInt(run.maxCombo),
      mode: run.mode === 'daily' ? 'daily' : 'standard',
      challenge_date: run.challengeDate || null,
      ship: VALID_SHIPS.includes(run.ship) ? run.ship : 'vanguard',
      accuracy: Math.max(0, Math.min(100, nonNegativeInt(run.accuracy))),
      damage: nonNegativeInt(run.damage)
    };

    const { error } = await supabaseClient
      .from('runs')
      .upsert(row, { onConflict: 'user_id,client_run_id' });

    if (error) {
      setMessage('RUN SAVED LOCALLY · CLOUD RUN ARCHIVE PAUSED', 'warn');
    }
  }

  async function handleSession(nextSession) {
    if (!nextSession) {
      render();
      return;
    }

    safeRemove(ACCOUNT_PREFERENCE_KEY);
    render();
    await syncWithCloud('sign-in');
  }

  function registerAuthListener() {
    if (!supabaseClient) return;

    supabaseClient.auth.onAuthStateChange((_event, nextSession) => {
      session = nextSession;
      render();

      /* Supabase recommends deferring follow-up work from this callback. */
      window.setTimeout(() => {
        void handleSession(nextSession);
      }, 0);
    });

    window.setTimeout(async () => {
      const { data, error } = await supabaseClient.auth.getSession();

      if (error) {
        setMessage('SESSION RESTORE PAUSED · ' + authError(error), 'warn');
        return;
      }

      session = data.session;
      render();
      await handleSession(session);
    }, 0);
  }

  function maybePrompt() {
    if (!supabaseClient || session || safeGet(ACCOUNT_PREFERENCE_KEY) === 'guest') return;
    if (safeGet(PROMPT_SEEN_KEY) === '1') return;

    window.setTimeout(() => {
      if (!session) openAccount();
    }, 650);
  }

  function init() {
    makeOverlay();
    injectTitleButton();

    if (!supabaseClient) {
      setMessage(
        isConfigured
          ? 'CLOUD SDK UNAVAILABLE · LOCAL GUEST MODE READY'
          : 'LOCAL GUEST MODE READY · CLOUD SYNC OPTIONAL',
        'warn'
      );
    } else {
      setMessage('CLOUD LINK READY · SIGN IN TO SYNC PROGRESSION', 'success');
    }

    render();
    registerAuthListener();

    window.addEventListener('ionstorm:progress-changed', () => {
      scheduleSync('background');
    });

    window.addEventListener('ionstorm:run-ended', event => {
      const run = event.detail && event.detail.run;
      void writeRun(run);
      scheduleSync('run');
    });

    maybePrompt();
  }

  window.ionstormAccount = {
    isConfigured: () => !!supabaseClient,
    getSession: () => session,
    getLocalSnapshot: localSnapshot,
    mergeSnapshots,
    open: openAccount,
    close: closeAccount,
    syncNow: () => syncWithCloud('manual'),
    continueAsGuest
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
