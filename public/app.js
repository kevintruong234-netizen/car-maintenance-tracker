(function () {
  'use strict';

  const STORAGE_KEY = 'garagelog_state_v1';
  const {
    SERVICE_PRESETS,
    evaluateTaskStatus,
    createSamplePhotoDataUrl,
    createInitialSeedData
  } = window.MaintenanceEngine;

  const appState = {
    updatedAt: null,
    cars: [],
    tasks: [],
    logs: [],
    selectedCarId: 'all',
    taskStatusFilter: 'all',
    taskViewMode: 'table',
    historySearch: '',
    historyCategory: 'all',
    historyPhotoFilter: 'all',
    stagedPhotos: [],
    apiAvailable: false
  };

  /* =========================================================================
     Modern Web Guidance Fallbacks (`light-dismiss-a-dialog` & `validate-input-after-interaction`)
     ========================================================================= */
  function initDialogEnhancements() {
    const dialogs = document.querySelectorAll('dialog');
    for (const dialog of dialogs) {
      dialog.addEventListener('close', () => {
        dialog.returnValue = '';
      });
    }

    // Fallback for browsers without <dialog closedby="any"> support
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      for (const dialog of document.querySelectorAll('dialog[closedby="any"]')) {
        dialog.addEventListener('click', (event) => {
          if (event.target !== dialog) return;
          const rect = dialog.getBoundingClientRect();
          const isDialogContent =
            rect.top <= event.clientY &&
            event.clientY <= rect.top + rect.height &&
            rect.left <= event.clientX &&
            event.clientX <= rect.left + rect.width;
          if (isDialogContent) return;
          dialog.close();
        });
      }
    }

    document.querySelectorAll('[data-close-dialog]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-close-dialog');
        const dlg = document.getElementById(targetId);
        if (dlg && dlg.open) dlg.close();
      });
    });

    // Offline / non-native fallback for declarative `commandfor` popover buttons (`declarative-dialog-popover-control`)
    if (!('commandForElement' in HTMLButtonElement.prototype)) {
      document.addEventListener('click', (event) => {
        const button = event.composedPath().find((el) => el.matches?.('button[commandfor]'));
        if (!button) return;
        const target = document.getElementById(button.getAttribute('commandfor'));
        const command = button.getAttribute('command');
        if (!target || !command) return;
        if (command === 'toggle-popover' && typeof target.togglePopover === 'function') {
          target.togglePopover();
        } else if (command === 'hide-popover' && typeof target.hidePopover === 'function') {
          target.hidePopover();
        } else if (command === 'show-popover' && typeof target.showPopover === 'function') {
          target.showPopover();
        }
      });
    }

    // IntersectionObserver `.is-stuck` fallback for sticky header (`state-aware-sticky-headers`)
    function getScrollParent(node) {
      if (node == null || node === document.body || node === document.documentElement) {
        return null;
      }
      if (node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth) {
        const overflow = getComputedStyle(node).overflow;
        if (overflow !== 'visible' && overflow !== 'clip') {
          return node;
        }
      }
      return getScrollParent(node.parentNode);
    }

    if (typeof IntersectionObserver !== 'undefined') {
      document.querySelectorAll('.app-header').forEach((container) => {
        const root = getScrollParent(container);
        const topOffset = parseFloat(getComputedStyle(container).top) || 0;
        const observer = new IntersectionObserver(
          ([e]) => {
            e.target.classList.toggle('is-stuck', e.intersectionRatio < 1);
          },
          {
            root,
            threshold: [1],
            rootMargin: `-${topOffset + 1}px 0px 0px 0px`
          }
        );
        observer.observe(container);
      });
    }
  }

  const UserInvalidFallback = (() => {
    const dirtyState = new WeakMap();

    const updateState = (input) => {
      const isValid = input.checkValidity();
      input.classList.toggle('user-invalid-fallback', !isValid);
      input.classList.toggle('user-valid-fallback', isValid);
      if (!isValid) {
        input.setAttribute('aria-invalid', 'true');
      } else {
        input.removeAttribute('aria-invalid');
      }
    };

    const handleEvent = (event) => {
      const input = event.target;
      if (event.type === 'reset') {
        const controls = input.elements || [];
        for (const control of controls) {
          dirtyState.delete(control);
          control.classList.remove('user-invalid-fallback', 'user-valid-fallback');
          control.removeAttribute('aria-invalid');
        }
        return;
      }
      if (!input || !input.checkValidity) return;

      if (event.type === 'input' || event.type === 'change') {
        const state = dirtyState.get(input) || { hasInteracted: false, hasBlurred: false };
        state.hasInteracted = true;
        dirtyState.set(input, state);
        if (state.hasBlurred) updateState(input);
      } else if (event.type === 'blur') {
        const state = dirtyState.get(input) || { hasInteracted: false, hasBlurred: false };
        state.hasBlurred = true;
        dirtyState.set(input, state);
        if (state.hasInteracted) updateState(input);
      }
    };

    const init = (root = document) => {
      // Sync aria-invalid with native :user-invalid when supported
      const syncAria = (el) => {
        if (!el || typeof el.matches !== 'function') return;
        try {
          if (CSS.supports('selector(:user-invalid)')) {
            el.setAttribute('aria-invalid', el.matches(':user-invalid') ? 'true' : 'false');
          }
        } catch {
          // ignore
        }
      };

      root.addEventListener('blur', (e) => syncAria(e.target), true);
      root.addEventListener('input', (e) => {
        if (e.target && e.target.hasAttribute && e.target.hasAttribute('aria-invalid')) {
          syncAria(e.target);
        }
      });

      if (typeof CSS !== 'undefined' && CSS.supports('selector(:user-invalid)')) return;
      root.addEventListener('blur', handleEvent, true);
      root.addEventListener('input', handleEvent);
      root.addEventListener('change', handleEvent);
      root.addEventListener('reset', handleEvent, true);
    };

    return { init };
  })();

  /* =========================================================================
     Data Persistence Layer (SQLite API + IndexedDB + LocalStorage Fallback)
     ========================================================================= */
  const IDB_NAME = 'garagelog_idb_v1';
  const IDB_STORE = 'garage_state';
  const IDB_KEY = 'current';

  function openGarageIdb() {
    return new Promise((resolve) => {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      try {
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(IDB_STORE)) {
            db.createObjectStore(IDB_STORE);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async function idbLoadState() {
    const db = await openGarageIdb();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const store = tx.objectStore(IDB_STORE);
        const getReq = store.get(IDB_KEY);
        getReq.onsuccess = () => resolve(getReq.result || null);
        getReq.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async function idbSaveState(snapshot) {
    const db = await openGarageIdb();
    if (!db) return;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        const store = tx.objectStore(IDB_STORE);
        store.put(snapshot, IDB_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  const SYNC_CONFIG_KEY = 'garagelog_github_sync_v1';
  const GIST_FILENAME = 'garagelog-cloud-sync.json';
  let cloudPushTimer = null;
  let isInitialLoading = true;

  function getSyncConfig() {
    try {
      const raw = localStorage.getItem(SYNC_CONFIG_KEY);
      if (!raw) return { token: '', gistId: '', lastSyncedAt: null };
      const parsed = JSON.parse(raw);
      return {
        token: String(parsed.token || '').trim(),
        gistId: String(parsed.gistId || '').trim(),
        lastSyncedAt: parsed.lastSyncedAt || null
      };
    } catch {
      return { token: '', gistId: '', lastSyncedAt: null };
    }
  }

  function saveSyncConfig(partial) {
    const next = { ...getSyncConfig(), ...partial };
    try {
      localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(next));
    } catch {
      // ignore storage quota errors
    }
    return next;
  }

  function clearSyncConfig() {
    try {
      localStorage.removeItem(SYNC_CONFIG_KEY);
    } catch {
      // ignore
    }
    updateSyncStatusUi('disconnected', 'Disconnected from GitHub Cloud Sync. Data remains saved locally on this device.');
  }

  function consumeUrlSyncHash() {
    if (!window.location.hash || !window.location.hash.includes('syncToken=')) {
      return false;
    }
    try {
      const params = new URLSearchParams(window.location.hash.slice(1));
      const token = (params.get('syncToken') || '').trim();
      const gistId = (params.get('gistId') || '').trim();
      if (token) {
        saveSyncConfig({ token, gistId: gistId || getSyncConfig().gistId });
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
        return true;
      }
    } catch {
      // ignore malformed hash
    }
    return false;
  }

  function updateSyncStatusUi(status, bannerMessage) {
    const dots = [
      document.getElementById('sync-header-dot'),
      document.getElementById('sync-mobile-dot'),
      document.getElementById('sync-menu-dot')
    ];
    dots.forEach((dot) => {
      if (!dot) return;
      dot.classList.remove('connected', 'syncing', 'error');
      if (status === 'connected' || status === 'syncing' || status === 'error') {
        dot.classList.add(status);
      }
    });

    const headerLabel = document.getElementById('sync-header-label');
    const menuLabel = document.getElementById('sync-menu-label');
    if (headerLabel) {
      headerLabel.textContent =
        status === 'connected'
          ? 'Cloud Synced'
          : status === 'syncing'
            ? 'Syncing…'
            : status === 'error'
              ? 'Sync Error'
              : 'Cloud Sync';
    }
    if (menuLabel) {
      menuLabel.textContent =
        status === 'connected'
          ? 'Cloud Sync (Connected)'
          : status === 'syncing'
            ? 'Cloud Sync (Syncing…)'
            : 'Private GitHub Cloud Sync';
    }

    const banner = document.getElementById('sync-status-banner');
    if (banner && bannerMessage) {
      banner.classList.remove('connected', 'error');
      if (status === 'connected') banner.classList.add('connected');
      if (status === 'error') banner.classList.add('error');
      banner.textContent = bannerMessage;
    }
  }

  async function githubApiFetch(path, token, options = {}) {
    const res = await fetch(`https://api.github.com${path}`, {
      ...options,
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.headers || {})
      }
    });
    if (!res.ok) {
      throw new Error(`GitHub API HTTP ${res.status}`);
    }
    return res.json();
  }

  async function discoverOrCreateBackupGist(token, preferredGistId) {
    if (preferredGistId) {
      try {
        const gist = await githubApiFetch(`/gists/${encodeURIComponent(preferredGistId)}`, token);
        if (gist && gist.id) return gist;
      } catch {
        // Fallback to discovery if Gist ID was not found
      }
    }

    const list = await githubApiFetch('/gists?per_page=100', token);
    const match = Array.isArray(list)
      ? list.find((g) => g && g.files && g.files[GIST_FILENAME])
      : null;

    if (match && match.id) {
      return githubApiFetch(`/gists/${encodeURIComponent(match.id)}`, token);
    }

    const initialPayload = JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        cars: appState.cars,
        tasks: appState.tasks,
        logs: appState.logs
      },
      null,
      2
    );

    return githubApiFetch('/gists', token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: 'GarageLog Private Cloud Backup (Multi-Vehicle Maintenance Tracker)',
        public: false,
        files: {
          [GIST_FILENAME]: { content: initialPayload }
        }
      })
    });
  }

  async function pullFromGitHubGist({ force = false } = {}) {
    const cfg = getSyncConfig();
    if (!cfg.token) return false;

    updateSyncStatusUi('syncing', 'Connecting to GitHub and syncing your private garage backup…');
    try {
      const gist = await discoverOrCreateBackupGist(cfg.token, cfg.gistId);
      const fileObj = gist.files && gist.files[GIST_FILENAME];
      const nowIso = new Date().toISOString();
      saveSyncConfig({ gistId: gist.id, lastSyncedAt: nowIso });

      const gistInput = document.getElementById('sync-gist-id-input');
      if (gistInput) gistInput.value = gist.id;

      if (fileObj && fileObj.content) {
        const parsed = JSON.parse(fileObj.content);
        if (parsed && Array.isArray(parsed.cars)) {
          const remoteUpdatedAt = parsed.updatedAt || null;
          const localUpdatedAt = appState.updatedAt || null;

          // If not forced and local state has newer edits/deletions than the Gist, push local to Gist instead of overwriting
          if (!force && localUpdatedAt && (!remoteUpdatedAt || localUpdatedAt > remoteUpdatedAt)) {
            return await pushToGitHubGist();
          }

          applyStatePayload(parsed, { skipCloudPush: true, preserveTimestamp: true });
        }
      }

      const timeLabel = new Date(nowIso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      updateSyncStatusUi(
        'connected',
        `Connected to Private GitHub Gist (${gist.id.slice(0, 8)}…) • Last synced at ${timeLabel}`
      );
      return true;
    } catch (err) {
      updateSyncStatusUi(
        'error',
        `GitHub Cloud Sync failed (${err.message || 'Check token & gist permissions'}). Local data is still safe.`
      );
      return false;
    }
  }

  async function pushToGitHubGist() {
    const cfg = getSyncConfig();
    if (!cfg.token) return false;

    if (cloudPushTimer) {
      clearTimeout(cloudPushTimer);
      cloudPushTimer = null;
    }

    updateSyncStatusUi('syncing', 'Saving changes to your Private GitHub Gist…');
    try {
      let targetGistId = cfg.gistId;
      if (!targetGistId) {
        const gist = await discoverOrCreateBackupGist(cfg.token, '');
        targetGistId = gist.id;
      }

      const nowIso = new Date().toISOString();
      appState.updatedAt = nowIso;
      const content = JSON.stringify(
        {
          updatedAt: nowIso,
          cars: appState.cars,
          tasks: appState.tasks,
          logs: appState.logs
        },
        null,
        2
      );

      const patchBody = JSON.stringify({
        description: 'GarageLog Private Cloud Backup (Multi-Vehicle Maintenance Tracker)',
        files: {
          [GIST_FILENAME]: { content }
        }
      });

      try {
        await githubApiFetch(`/gists/${encodeURIComponent(targetGistId)}`, cfg.token, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: patchBody
        });
      } catch {
        const discovered = await discoverOrCreateBackupGist(cfg.token, '');
        targetGistId = discovered.id;
        await githubApiFetch(`/gists/${encodeURIComponent(targetGistId)}`, cfg.token, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: patchBody
        });
      }

      saveLocalState({ skipCloudPush: true, preserveTimestamp: true });
      saveSyncConfig({ gistId: targetGistId, lastSyncedAt: nowIso });
      const gistInput = document.getElementById('sync-gist-id-input');
      if (gistInput) gistInput.value = targetGistId;

      const timeLabel = new Date(nowIso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      updateSyncStatusUi(
        'connected',
        `Auto-synced to Private GitHub Gist (${targetGistId.slice(0, 8)}…) at ${timeLabel}`
      );
      return true;
    } catch (err) {
      updateSyncStatusUi(
        'error',
        `Could not push to GitHub (${err.message || 'offline'}). Saved locally on device.`
      );
      return false;
    }
  }

  function scheduleCloudPush() {
    const cfg = getSyncConfig();
    if (!cfg.token || isInitialLoading) return;
    if (cloudPushTimer) clearTimeout(cloudPushTimer);
    cloudPushTimer = setTimeout(() => {
      pushToGitHubGist().catch(() => {});
    }, 200);
  }

  function saveLocalState({ skipCloudPush = false, preserveTimestamp = false } = {}) {
    if (!preserveTimestamp && !isInitialLoading) {
      appState.updatedAt = new Date().toISOString();
    }
    const snapshot = {
      updatedAt: appState.updatedAt,
      cars: appState.cars,
      tasks: appState.tasks,
      logs: appState.logs
    };
    idbSaveState(snapshot).catch(() => {});
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // Quota exceeded (e.g., >5MB of photos in localStorage); IndexedDB handles large storage
    }
    if (!skipCloudPush) {
      scheduleCloudPush();
    }
  }

  function applyStatePayload(data, { skipCloudPush = false, preserveTimestamp = false } = {}) {
    if (preserveTimestamp) {
      appState.updatedAt = data.updatedAt || null;
    }
    appState.cars = Array.isArray(data.cars) ? data.cars : [];
    appState.tasks = Array.isArray(data.tasks) ? data.tasks : [];
    appState.logs = Array.isArray(data.logs) ? data.logs : [];
    if (appState.cars.length === 0) {
      appState.selectedCarId = 'all';
    } else if (
      appState.selectedCarId === 'all' &&
      appState.cars.length >= 1
    ) {
      appState.selectedCarId = appState.cars[0].id;
    } else if (
      appState.selectedCarId !== 'all' &&
      !appState.cars.some((c) => c.id === appState.selectedCarId)
    ) {
      appState.selectedCarId = appState.cars[0]?.id || 'all';
    }
    saveLocalState({ skipCloudPush, preserveTimestamp });
    renderAll();
  }

  async function loadInitialData() {
    const pairedFromUrl = consumeUrlSyncHash();
    const syncCfg = getSyncConfig();
    if (syncCfg.token) {
      updateSyncStatusUi(
        'connected',
        `Configured with Private GitHub Gist${syncCfg.gistId ? ` (${syncCfg.gistId.slice(0, 8)}…)` : ''}`
      );
    }

    try {
      const response = await fetch('/api/state', { headers: { Accept: 'application/json' } });
      if (response.ok) {
        const data = await response.json();
        appState.apiAvailable = true;
        applyStatePayload(data, { skipCloudPush: true, preserveTimestamp: true });
        isInitialLoading = false;
        return;
      }
    } catch {
      appState.apiAvailable = false;
    }

    // 1. Check IndexedDB first (supports large photo libraries & empty-garage deletions on iOS Safari)
    let loadedLocal = false;
    try {
      const idbData = await idbLoadState();
      if (idbData && Array.isArray(idbData.cars)) {
        applyStatePayload(idbData, { skipCloudPush: true, preserveTimestamp: true });
        loadedLocal = true;
      }
    } catch {
      // ignore IndexedDB errors
    }

    // 2. Fallback to localStorage (and auto-migrate to IndexedDB)
    if (!loadedLocal) {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.cars)) {
            applyStatePayload(parsed, { skipCloudPush: true, preserveTimestamp: true });
            loadedLocal = true;
          }
        }
      } catch {
        // ignore parse errors
      }
    }

    if (!loadedLocal) {
      applyStatePayload(createInitialSeedData(), { skipCloudPush: true, preserveTimestamp: true });
    }

    isInitialLoading = false;

    // 3. If Private GitHub Sync is configured (or just paired via URL hash), sync with Gist
    if (syncCfg.token || pairedFromUrl) {
      await pullFromGitHubGist({ force: false });
    }
  }

  async function apiRequest(url, method, body) {
    if (appState.apiAvailable) {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
      });
      if (res.ok) {
        const updated = await res.json();
        applyStatePayload(updated);
        return;
      }
    }
    // Offline / static fallback mutations handled by caller if API not running
  }

  /* =========================================================================
     Formatting & Escaping Helpers
     ========================================================================= */
  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatNumber(num) {
    return Number(num || 0).toLocaleString('en-US');
  }

  function formatCurrency(num) {
    const val = Number(num || 0);
    return '$' + val.toFixed(2);
  }

  function getCarById(carId) {
    return appState.cars.find((c) => c.id === carId) || null;
  }

  function getCarDisplayName(car) {
    if (!car) return 'Unknown Vehicle';
    const base = `${car.year} ${car.make} ${car.model}`;
    return car.nickname ? `${base} (${car.nickname})` : base;
  }

  /* =========================================================================
     Rendering Functions
     ========================================================================= */
  function renderAll() {
    renderKpiBar();
    renderFleetSidebar();
    renderActiveCarPanel();
    renderTasksGrid();
    renderHistoryTable();
  }

  function renderKpiBar() {
    const kpiGrid = document.getElementById('kpi-grid');
    const filteredCars =
      appState.selectedCarId === 'all'
        ? appState.cars
        : appState.cars.filter((c) => c.id === appState.selectedCarId);

    const carIds = new Set(filteredCars.map((c) => c.id));
    const visibleTasks = appState.tasks.filter((t) => carIds.has(t.carId));
    const visibleLogs = appState.logs.filter((l) => carIds.has(l.carId));

    let overdueCount = 0;
    let dueSoonCount = 0;
    for (const task of visibleTasks) {
      const car = getCarById(task.carId);
      const evalResult = evaluateTaskStatus(task, car);
      if (evalResult.status === 'overdue') overdueCount++;
      else if (evalResult.status === 'due-soon') dueSoonCount++;
    }

    const totalCost = visibleLogs.reduce((sum, log) => sum + Number(log.cost || 0), 0);
    const totalPhotos = visibleLogs.reduce(
      (sum, log) => sum + (Array.isArray(log.photos) ? log.photos.length : 0),
      0
    );

    kpiGrid.innerHTML = `
      <div class="kpi-card">
        <div class="kpi-label">Active Vehicles</div>
        <div class="kpi-value">${filteredCars.length} <span style="font-size:0.95rem;color:var(--text-muted)">/ ${appState.cars.length} total</span></div>
        <div class="kpi-sub">${appState.selectedCarId === 'all' ? 'Viewing entire garage fleet' : escapeHtml(getCarDisplayName(filteredCars[0]))}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Recurring Schedules</div>
        <div class="kpi-value">${visibleTasks.length}</div>
        <div class="kpi-sub">
          <span style="color:#fda4af;font-weight:600">${overdueCount} overdue</span> •
          <span style="color:#fcd34d;font-weight:600">${dueSoonCount} due soon</span>
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Completed Services</div>
        <div class="kpi-value">${visibleLogs.length}</div>
        <div class="kpi-sub">${totalPhotos} photo attachment${totalPhotos === 1 ? '' : 's'} logged</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Logged Service Spend</div>
        <div class="kpi-value">${formatCurrency(totalCost)}</div>
        <div class="kpi-sub">Across ${visibleLogs.length} maintenance record${visibleLogs.length === 1 ? '' : 's'}</div>
      </div>
    `;
  }

  const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function formatShortMonthYear(dateStr) {
    if (!dateStr) return '';
    const parts = String(dateStr).split('-').map(Number);
    if (parts.length < 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) return String(dateStr);
    const monthName = SHORT_MONTHS[Math.max(0, Math.min(11, parts[1] - 1))];
    return `${monthName} ${parts[0]}`;
  }

  function formatIntervalNote(task) {
    const miles = Number(task.intervalMiles || 0);
    const months = Number(task.intervalMonths || 0);
    let monthLabel = '';
    if (months > 0) {
      if (months % 12 === 0) {
        const yrs = months / 12;
        monthLabel = yrs === 1 ? '1 year' : `${yrs} years`;
      } else {
        monthLabel = `${months} mo`;
      }
    }
    if (miles > 0 && months > 0) {
      return `${formatNumber(miles)} / ${monthLabel}`;
    }
    if (miles > 0) {
      return formatNumber(miles);
    }
    if (months > 0) {
      return monthLabel;
    }
    return '—';
  }

  function renderFleetSidebar() {
    const fleetList = document.getElementById('fleet-list');
    if (appState.cars.length === 0) {
      fleetList.innerHTML = '';
      return;
    }

    let html = '';
    for (const car of appState.cars) {
      const isSelected = appState.selectedCarId === car.id;
      html += `
        <button
          type="button"
          class="fleet-pill ${isSelected ? 'active' : ''}"
          data-select-car="${escapeHtml(car.id)}"
          aria-pressed="${isSelected}"
        >
          <span class="car-badge-dot" style="background:${escapeHtml(car.colorAccent || '#0ea5e9')}"></span>
          <span>${escapeHtml(car.year)} ${escapeHtml(car.make)} ${escapeHtml(car.model)}</span>
        </button>
      `;
    }

    if (appState.cars.length > 1) {
      const isAll = appState.selectedCarId === 'all';
      html += `
        <button
          type="button"
          class="fleet-pill ${isAll ? 'active' : ''}"
          data-select-car="all"
          aria-pressed="${isAll}"
        >
          <span>All (${appState.cars.length})</span>
        </button>
      `;
    }

    fleetList.innerHTML = html;

    fleetList.querySelectorAll('[data-select-car]').forEach((el) => {
      el.addEventListener('click', () => {
        appState.selectedCarId = el.getAttribute('data-select-car');
        renderAll();
      });
    });
  }

  function renderActiveCarPanel() {
    const panel = document.getElementById('active-car-panel');
    if (appState.cars.length === 0) {
      panel.hidden = false;
      panel.innerHTML = `
        <div class="note-empty-car">
          <p style="margin:0;color:var(--text-secondary);">No vehicles in your garage yet.</p>
          <button type="button" class="btn btn-sm btn-primary" id="btn-empty-add-car">+ Add Vehicle</button>
        </div>
      `;
      document.getElementById('btn-empty-add-car').addEventListener('click', () => openCarDialog());
      return;
    }

    if (appState.selectedCarId === 'all') {
      panel.hidden = false;
      panel.innerHTML = `
        <div class="note-car-sheet">
          <div class="note-car-title-row">
            <h2 class="note-car-title">All Garage Vehicles (${appState.cars.length})</h2>
          </div>
          <div class="note-car-meta">
            <div>Viewing combined maintenance schedules &amp; service history</div>
          </div>
        </div>
      `;
      return;
    }

    const car = getCarById(appState.selectedCarId);
    if (!car) {
      panel.hidden = true;
      return;
    }

    const carTasks = appState.tasks.filter((t) => t.carId === car.id);
    let overdueCount = 0;
    let dueSoonCount = 0;
    for (const t of carTasks) {
      const st = evaluateTaskStatus(t, car).status;
      if (st === 'overdue') overdueCount++;
      else if (st === 'due-soon') dueSoonCount++;
    }

    panel.hidden = false;
    panel.innerHTML = `
      <div class="note-car-sheet">
        <div class="note-car-title-row">
          <h2 class="note-car-title">
            <span class="car-badge-dot" style="background:${escapeHtml(car.colorAccent || '#0ea5e9')}"></span>
            ${escapeHtml(getCarDisplayName(car))}
          </h2>
          <div class="note-car-actions">
            <button type="button" class="btn btn-sm btn-ghost" id="btn-edit-active-car">Edit</button>
          </div>
        </div>

        <div class="note-car-meta">
          <div>VIN: <span class="note-mono">${escapeHtml(car.vin || '—')}</span></div>
          <div>License Plate: <span class="note-mono">${escapeHtml(car.licensePlate || '—')}</span></div>
        </div>

        <div class="note-odometer-bar">
          <form id="quick-odometer-form" class="note-odometer-form">
            <label for="quick-odometer-input">Odometer:</label>
            <input
              type="number"
              id="quick-odometer-input"
              min="0"
              max="2000000"
              value="${Number(car.currentMileage || 0)}"
              required
              inputmode="numeric"
              aria-label="Current odometer mileage"
            >
            <span class="note-odometer-unit">mi</span>
            <button type="submit" class="btn btn-sm btn-secondary note-odo-btn">Update</button>
          </form>
          <div class="note-status-summary">
            <span>${carTasks.length} items</span>
            ${overdueCount > 0 ? `<span class="note-summary-overdue">• ${overdueCount} due</span>` : '<span class="note-summary-ok">• All on track</span>'}
          </div>
        </div>
      </div>
    `;

    document.getElementById('btn-edit-active-car').addEventListener('click', () => openCarDialog(car));
    document.getElementById('quick-odometer-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const newMileage = Math.max(0, Math.round(Number(document.getElementById('quick-odometer-input').value) || 0));
      if (appState.apiAvailable) {
        await apiRequest(`/api/cars/${encodeURIComponent(car.id)}/mileage`, 'PATCH', {
          currentMileage: newMileage
        });
      } else {
        car.currentMileage = newMileage;
        saveLocalState();
        renderAll();
      }
    });
  }

  function renderTasksGrid() {
    const container = document.getElementById('tasks-container');

    const enriched = appState.tasks
      .filter((task) => appState.selectedCarId === 'all' || task.carId === appState.selectedCarId)
      .map((task) => {
        const car = getCarById(task.carId);
        const evaluation = evaluateTaskStatus(task, car);
        return { task, car, evaluation };
      })
      .filter((item) => {
        if (appState.taskStatusFilter === 'all') return true;
        return item.evaluation.status === appState.taskStatusFilter;
      });

    if (enriched.length === 0) {
      container.className = 'tasks-container';
      container.innerHTML = `
        <div style="text-align:center;padding:1.25rem;color:var(--text-muted);background:var(--bg-elevated);border-radius:var(--radius-md);font-size:0.88rem;">
          No maintenance items match the current filter. Tap <strong>+ Item</strong> to add one.
        </div>
      `;
      return;
    }

    if (appState.taskViewMode === 'table') {
      container.className = 'tasks-container';
      const rowsHtml = enriched
        .map(({ task, car, evaluation }) => {
          const hasMileage = task.lastCompletedMileage != null;
          const hasDate = Boolean(task.lastCompletedDate);
          let completedPrimary = 'n/a';
          let completedDateTag = '';
          if (hasMileage && hasDate) {
            completedPrimary = formatNumber(task.lastCompletedMileage);
            completedDateTag = formatShortMonthYear(task.lastCompletedDate);
          } else if (hasMileage) {
            completedPrimary = formatNumber(task.lastCompletedMileage);
          } else if (hasDate) {
            completedPrimary = formatShortMonthYear(task.lastCompletedDate);
          }

          let dueSubHtml = '';
          if (evaluation.nextDueMileage != null && hasMileage) {
            const rem = evaluation.milesRemaining;
            const dueClass = evaluation.status;
            const dueLabel =
              rem <= 0
                ? `Due ${formatNumber(evaluation.nextDueMileage)} (${formatNumber(Math.abs(rem))} over)`
                : `Due ${formatNumber(evaluation.nextDueMileage)}`;
            dueSubHtml = `<div class="note-due-sub ${dueClass}">${escapeHtml(dueLabel)}</div>`;
          } else if (evaluation.status === 'overdue' && evaluation.nextDueMileage != null) {
            dueSubHtml = `<div class="note-due-sub overdue">Due ${formatNumber(evaluation.nextDueMileage)}</div>`;
          }

          const showCarLabel = appState.selectedCarId === 'all' && appState.cars.length > 1 && car;

          return `
            <tr class="note-row status-${evaluation.status}">
              <th scope="row" class="note-cell-item">
                <button type="button" class="note-cell-edit-btn" data-edit-task="${escapeHtml(task.id)}">
                  <span class="note-item-main">
                    <span class="status-dot ${evaluation.status}" title="${escapeHtml(evaluation.statusLabel)}"></span>
                    <span class="note-item-title">${escapeHtml(task.title)}</span>
                  </span>
                  ${task.notes ? `<span class="note-item-sub">${escapeHtml(task.notes)}</span>` : ''}
                  ${showCarLabel ? `<span class="note-item-sub">${escapeHtml(car.year)} ${escapeHtml(car.make)} ${escapeHtml(car.model)}</span>` : ''}
                </button>
              </th>
              <td class="note-cell-completed">
                <button type="button" class="note-cell-edit-btn" data-edit-task="${escapeHtml(task.id)}">
                  <span class="note-completed-val ${!hasMileage && !hasDate ? 'is-na' : ''}">
                    ${escapeHtml(completedPrimary)}${completedDateTag ? ` <span class="note-completed-date">${escapeHtml(completedDateTag)}</span>` : ''}
                  </span>
                  ${dueSubHtml}
                </button>
              </td>
              <td class="note-cell-interval">
                <div class="note-interval-wrap">
                  <button type="button" class="note-cell-edit-btn note-interval-text" data-edit-task="${escapeHtml(task.id)}">
                    ${escapeHtml(formatIntervalNote(task))}
                  </button>
                  <button
                    type="button"
                    class="note-log-btn"
                    data-complete-task="${escapeHtml(task.id)}"
                    title="Log completed ${escapeHtml(task.title)}"
                    aria-label="Log completed ${escapeHtml(task.title)}"
                  >✓</button>
                </div>
              </td>
            </tr>
          `;
        })
        .join('');

      container.innerHTML = `
        <div tabindex="0" role="region" aria-labelledby="recurring-heading" class="note-table-wrapper">
          <table class="note-maint-table">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Work completed at</th>
                <th scope="col">Recommended interval</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      `;
    } else {
      container.className = 'tasks-grid';
      const sortedForCards = [...enriched].sort((a, b) => b.evaluation.urgencyScore - a.evaluation.urgencyScore);
      container.innerHTML = sortedForCards
        .map(({ task, car, evaluation }) => {
          const intervalParts = [];
          if (task.intervalMiles > 0) intervalParts.push(`Every ${formatNumber(task.intervalMiles)} mi`);
          if (task.intervalMonths > 0) intervalParts.push(`Every ${task.intervalMonths} mo`);
          const intervalSummary = intervalParts.join(' or ') || 'Custom schedule';

          let milesText = 'n/a';
          if (evaluation.nextDueMileage != null) {
            const diff = evaluation.milesRemaining;
            milesText =
              diff <= 0
                ? `${formatNumber(Math.abs(diff))} mi overdue (Due @ ${formatNumber(evaluation.nextDueMileage)} mi)`
                : `In ${formatNumber(diff)} mi (@ ${formatNumber(evaluation.nextDueMileage)} mi)`;
          }

          let dateText = 'n/a';
          if (evaluation.nextDueDate != null) {
            const days = evaluation.daysRemaining;
            dateText =
              days < 0
                ? `${Math.abs(days)}d overdue (${evaluation.nextDueDate})`
                : `In ${days}d (${evaluation.nextDueDate})`;
          }

          const lastDoneInfo =
            task.lastCompletedDate || task.lastCompletedMileage != null
              ? `${task.lastCompletedMileage != null ? formatNumber(task.lastCompletedMileage) + ' mi' : ''}${task.lastCompletedDate ? ' ' + formatShortMonthYear(task.lastCompletedDate) : ''}`.trim()
              : 'n/a';

          return `
            <article class="task-card status-${evaluation.status}">
              <div>
                <div class="task-header">
                  <div>
                    <h3 class="task-title">${escapeHtml(task.title)}</h3>
                    <div class="task-car-tag">
                      <span class="car-badge-dot" style="background:${escapeHtml(car?.colorAccent || '#0ea5e9')}"></span>
                      <span>${escapeHtml(car ? `${car.year} ${car.make} ${car.model}` : 'Vehicle')}</span>
                      <span>• ${escapeHtml(task.category || 'General')}</span>
                    </div>
                  </div>
                  <span class="status-badge ${evaluation.status}">${escapeHtml(evaluation.statusLabel)}</span>
                </div>

                <div class="task-metrics" style="margin-block-start:0.8rem;">
                  <div class="metric-item">
                    <span>Next Mileage Due</span>
                    <strong>${escapeHtml(milesText)}</strong>
                  </div>
                  <div class="metric-item">
                    <span>Next Date Due</span>
                    <strong>${escapeHtml(dateText)}</strong>
                  </div>
                  <div class="metric-item">
                    <span>Interval Rule</span>
                    <strong>${escapeHtml(intervalSummary)}</strong>
                  </div>
                  <div class="metric-item">
                    <span>Work Completed At</span>
                    <strong>${escapeHtml(lastDoneInfo)}</strong>
                  </div>
                </div>

                <div class="progress-track" style="margin-block-start:0.75rem;" aria-hidden="true">
                  <div class="progress-fill ${evaluation.status}" style="inline-size:${Math.min(100, Math.max(6, evaluation.overallProgressPct))}%"></div>
                </div>

                ${task.notes ? `<p class="task-notes" style="margin-block-start:0.65rem;">${escapeHtml(task.notes)}</p>` : ''}
              </div>

              <div class="task-footer">
                <div style="display:flex;gap:0.4rem;">
                  <button type="button" class="btn btn-sm btn-ghost" data-edit-task="${escapeHtml(task.id)}">Edit</button>
                  <button type="button" class="btn btn-sm btn-ghost" data-delete-task="${escapeHtml(task.id)}">Delete</button>
                </div>
                <button type="button" class="btn btn-sm btn-primary" data-complete-task="${escapeHtml(task.id)}">
                  ✓ Mark Complete
                </button>
              </div>
            </article>
          `;
        })
        .join('');
    }

    container.querySelectorAll('[data-complete-task]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const task = appState.tasks.find((t) => t.id === btn.getAttribute('data-complete-task'));
        if (task) openCompleteDialog({ task });
      });
    });

    container.querySelectorAll('[data-edit-task]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const task = appState.tasks.find((t) => t.id === btn.getAttribute('data-edit-task'));
        if (task) openTaskDialog(task);
      });
    });

    container.querySelectorAll('[data-delete-task]').forEach((btn) => {
      btn.addEventListener('click', () => {
        handleDeleteTask(btn.getAttribute('data-delete-task'));
      });
    });
  }

  function renderHistoryTable() {
    const tbody = document.getElementById('history-tbody');
    const query = appState.historySearch.trim().toLowerCase();

    const filteredLogs = appState.logs
      .filter((log) => {
        if (appState.selectedCarId !== 'all' && log.carId !== appState.selectedCarId) return false;
        if (appState.historyCategory !== 'all' && log.category !== appState.historyCategory) return false;
        if (appState.historyPhotoFilter === 'with-photos') {
          if (!Array.isArray(log.photos) || log.photos.length === 0) return false;
        }
        if (query) {
          const car = getCarById(log.carId);
          const haystack = [
            log.taskTitle,
            log.category,
            log.notes,
            log.performedBy,
            log.completedDate,
            String(log.mileage),
            car ? `${car.year} ${car.make} ${car.model} ${car.nickname}` : ''
          ]
            .join(' ')
            .toLowerCase();
          if (!haystack.includes(query)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (b.completedDate !== a.completedDate) {
          return b.completedDate.localeCompare(a.completedDate);
        }
        return Number(b.mileage || 0) - Number(a.mileage || 0);
      });

    if (filteredLogs.length === 0) {
      tbody.innerHTML = `
        <tr>
          <th scope="row">No Matching Service Records</th>
          <td colspan="6">Try adjusting your search filters or click <strong>Log Completed Service</strong> to record maintenance.</td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = filteredLogs
      .map((log) => {
        const car = getCarById(log.carId);
        const photos = Array.isArray(log.photos) ? log.photos : [];
        const photosHtml =
          photos.length === 0
            ? `<span style="color:var(--text-muted);font-size:0.82rem;">None</span>`
            : `<div class="photo-thumb-list">
                ${photos
                  .map(
                    (photo, idx) => `
                  <button
                    type="button"
                    class="photo-thumb-btn"
                    data-view-photo-log="${escapeHtml(log.id)}"
                    data-view-photo-idx="${idx}"
                    aria-label="View photo: ${escapeHtml(photo.caption || photo.name || 'Service photo')}"
                  >
                    <img src="${escapeHtml(photo.dataUrl)}" alt="${escapeHtml(photo.caption || photo.name || 'Service attachment')}" width="58" height="42" loading="lazy">
                  </button>
                `
                  )
                  .join('')}
              </div>`;

        return `
          <tr>
            <th scope="row">
              <div style="font-weight:700;color:var(--text-primary);">${escapeHtml(log.taskTitle)}</div>
              <div style="font-size:0.8rem;color:var(--text-muted);display:flex;align-items:center;gap:0.35rem;margin-block-start:0.2rem;">
                <span class="car-badge-dot" style="background:${escapeHtml(car?.colorAccent || '#0ea5e9')}"></span>
                <span>${escapeHtml(car ? `${car.year} ${car.make} ${car.model}` : 'Vehicle')}</span>
                <span>• ${escapeHtml(log.category || 'General')}</span>
              </div>
            </th>
            <td>
              <span style="font-weight:600;color:var(--text-primary);">${escapeHtml(log.completedDate)}</span>
            </td>
            <td>
              <span class="fleet-mileage">${formatNumber(log.mileage)} mi</span>
            </td>
            <td style="max-inline-size:360px;">
              ${log.performedBy ? `<div style="font-size:0.78rem;color:var(--accent-hover);font-weight:600;margin-block-end:0.2rem;">Shop / Tech: ${escapeHtml(log.performedBy)}</div>` : ''}
              <div>${log.notes ? escapeHtml(log.notes) : '<span style="color:var(--text-muted)">No notes</span>'}</div>
            </td>
            <td>${photosHtml}</td>
            <td style="font-weight:600;color:var(--text-primary);">
              ${log.cost ? formatCurrency(log.cost) : '—'}
            </td>
            <td>
              <div style="display:flex;gap:0.35rem;flex-wrap:wrap;">
                <button type="button" class="btn btn-sm btn-secondary" data-edit-log="${escapeHtml(log.id)}">Edit / +Photo</button>
                <button type="button" class="btn btn-sm btn-ghost" data-delete-log="${escapeHtml(log.id)}">Delete</button>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');

    tbody.querySelectorAll('[data-view-photo-log]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const logId = btn.getAttribute('data-view-photo-log');
        const idx = Number(btn.getAttribute('data-view-photo-idx') || 0);
        const log = appState.logs.find((l) => l.id === logId);
        if (log && Array.isArray(log.photos) && log.photos[idx]) {
          openPhotoLightbox(log.photos[idx], log);
        }
      });
    });

    tbody.querySelectorAll('[data-edit-log]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const log = appState.logs.find((l) => l.id === btn.getAttribute('data-edit-log'));
        if (log) openCompleteDialog({ existingLog: log });
      });
    });

    tbody.querySelectorAll('[data-delete-log]').forEach((btn) => {
      btn.addEventListener('click', () => {
        handleDeleteLog(btn.getAttribute('data-delete-log'));
      });
    });
  }

  /* =========================================================================
     Modal Dialog Controllers
     ========================================================================= */
  function openCarDialog(carToEdit = null) {
    const dialog = document.getElementById('car-dialog');
    const form = document.getElementById('car-form');
    form.reset();

    document.getElementById('car-dialog-title').textContent = carToEdit
      ? `Edit ${carToEdit.year} ${carToEdit.make} ${carToEdit.model}`
      : 'Add Vehicle to Garage';

    document.getElementById('car-id').value = carToEdit ? carToEdit.id : '';
    document.getElementById('car-year').value = carToEdit ? carToEdit.year : new Date().getFullYear();
    document.getElementById('car-mileage').value = carToEdit ? carToEdit.currentMileage : '';
    document.getElementById('car-make').value = carToEdit ? carToEdit.make : '';
    document.getElementById('car-model').value = carToEdit ? carToEdit.model : '';
    document.getElementById('car-nickname').value = carToEdit ? carToEdit.nickname || '' : '';
    document.getElementById('car-color').value = carToEdit ? carToEdit.colorAccent || '#0ea5e9' : '#0ea5e9';
    document.getElementById('car-plate').value = carToEdit ? carToEdit.licensePlate || '' : '';
    document.getElementById('car-vin').value = carToEdit ? carToEdit.vin || '' : '';
    document.getElementById('car-notes').value = carToEdit ? carToEdit.notes || '' : '';

    const deleteCarBtn = document.getElementById('btn-modal-delete-car');
    if (deleteCarBtn) {
      deleteCarBtn.hidden = !carToEdit;
      deleteCarBtn.onclick = carToEdit
        ? async () => {
            await handleDeleteCar(carToEdit.id);
            dialog.close();
          }
        : null;
    }

    dialog.showModal();
  }

  function populateVehicleSelect(selectEl, preferredCarId) {
    selectEl.innerHTML = appState.cars
      .map(
        (car) =>
          `<option value="${escapeHtml(car.id)}" ${car.id === preferredCarId ? 'selected' : ''}>${escapeHtml(getCarDisplayName(car))} (${formatNumber(car.currentMileage)} mi)</option>`
      )
      .join('');
  }

  function openTaskDialog(taskToEdit = null) {
    if (appState.cars.length === 0) {
      openCarDialog();
      return;
    }

    const dialog = document.getElementById('task-dialog');
    const form = document.getElementById('task-form');
    form.reset();

    const defaultCarId =
      taskToEdit?.carId ||
      (appState.selectedCarId !== 'all' ? appState.selectedCarId : appState.cars[0].id);

    populateVehicleSelect(document.getElementById('task-car-id'), defaultCarId);
    const selectedCar = getCarById(defaultCarId);

    document.getElementById('task-dialog-title').textContent = taskToEdit
      ? `Edit Maintenance Item: ${taskToEdit.title}`
      : 'Add Maintenance Item';

    document.getElementById('task-id').value = taskToEdit ? taskToEdit.id : '';
    document.getElementById('task-title').value = taskToEdit ? taskToEdit.title : '';
    document.getElementById('task-category').value = taskToEdit ? taskToEdit.category || 'Engine' : 'Engine';
    document.getElementById('task-interval-miles').value =
      taskToEdit != null ? taskToEdit.intervalMiles : 6000;
    document.getElementById('task-interval-months').value =
      taskToEdit != null ? taskToEdit.intervalMonths : 0;
    document.getElementById('task-last-date').value = taskToEdit ? taskToEdit.lastCompletedDate || '' : '';
    document.getElementById('task-last-mileage').value =
      taskToEdit != null
        ? taskToEdit.lastCompletedMileage != null
          ? taskToEdit.lastCompletedMileage
          : ''
        : selectedCar?.currentMileage ?? '';
    document.getElementById('task-notes').value = taskToEdit ? taskToEdit.notes || '' : '';

    const deleteTaskBtn = document.getElementById('btn-modal-delete-task');
    if (deleteTaskBtn) {
      deleteTaskBtn.hidden = !taskToEdit;
      deleteTaskBtn.onclick = taskToEdit
        ? async () => {
            await handleDeleteTask(taskToEdit.id);
            dialog.close();
          }
        : null;
    }

    dialog.showModal();
  }

  function populateLinkedTaskSelect(carId, selectedTaskId = '') {
    const selectEl = document.getElementById('complete-task-select');
    const tasksForCar = appState.tasks.filter((t) => t.carId === carId);
    selectEl.innerHTML =
      `<option value="">— One-Off / Unscheduled Service —</option>` +
      tasksForCar
        .map(
          (t) =>
            `<option value="${escapeHtml(t.id)}" ${t.id === selectedTaskId ? 'selected' : ''}>${escapeHtml(t.title)} (Every ${formatNumber(t.intervalMiles)} mi / ${t.intervalMonths} mo)</option>`
        )
        .join('');
  }

  function renderStagedPhotos() {
    const grid = document.getElementById('photo-staging-grid');
    if (appState.stagedPhotos.length === 0) {
      grid.innerHTML = '';
      return;
    }

    grid.innerHTML = appState.stagedPhotos
      .map(
        (photo, idx) => `
        <div class="staged-photo-card">
          <img src="${escapeHtml(photo.dataUrl)}" alt="${escapeHtml(photo.caption || photo.name || 'Staged photo')}" width="160" height="95">
          <input
            type="text"
            value="${escapeHtml(photo.caption || '')}"
            placeholder="Photo caption (e.g., Receipt)"
            data-photo-caption-idx="${idx}"
            aria-label="Photo caption"
          >
          <button type="button" class="btn btn-sm btn-danger" data-remove-photo-idx="${idx}">Remove Photo</button>
        </div>
      `
      )
      .join('');

    grid.querySelectorAll('[data-photo-caption-idx]').forEach((input) => {
      input.addEventListener('input', () => {
        const idx = Number(input.getAttribute('data-photo-caption-idx'));
        if (appState.stagedPhotos[idx]) {
          appState.stagedPhotos[idx].caption = input.value;
        }
      });
    });

    grid.querySelectorAll('[data-remove-photo-idx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-remove-photo-idx'));
        appState.stagedPhotos.splice(idx, 1);
        renderStagedPhotos();
      });
    });
  }

  function openCompleteDialog({ task = null, existingLog = null } = {}) {
    if (appState.cars.length === 0) {
      openCarDialog();
      return;
    }

    const dialog = document.getElementById('complete-dialog');
    const form = document.getElementById('complete-form');
    form.reset();

    const carId =
      existingLog?.carId ||
      task?.carId ||
      (appState.selectedCarId !== 'all' ? appState.selectedCarId : appState.cars[0].id);

    const car = getCarById(carId);
    populateVehicleSelect(document.getElementById('complete-car-id'), carId);
    populateLinkedTaskSelect(carId, existingLog?.taskId || task?.id || '');

    document.getElementById('complete-log-id').value = existingLog ? existingLog.id : '';
    document.getElementById('complete-task-id').value = existingLog?.taskId || task?.id || '';

    document.getElementById('complete-dialog-title').textContent = existingLog
      ? `Edit Service Record: ${existingLog.taskTitle}`
      : task
        ? `Mark Complete: ${task.title}`
        : 'Log Completed Maintenance Service';

    document.getElementById('complete-submit-btn').textContent = existingLog
      ? 'Save Updated Service Record'
      : 'Mark Complete & Save to History';

    document.getElementById('complete-title').value =
      existingLog?.taskTitle || task?.title || '';
    document.getElementById('complete-category').value =
      existingLog?.category || task?.category || 'Engine';
    document.getElementById('complete-date').value =
      existingLog?.completedDate || new Date().toISOString().slice(0, 10);
    document.getElementById('complete-mileage').value =
      existingLog?.mileage != null ? existingLog.mileage : car?.currentMileage || 0;
    document.getElementById('complete-cost').value =
      existingLog?.cost != null && existingLog.cost > 0 ? existingLog.cost : '';
    document.getElementById('complete-shop').value = existingLog?.performedBy || '';
    document.getElementById('complete-notes').value =
      existingLog?.notes || (task?.notes ? `Completed per schedule: ${task.notes}` : '');

    appState.stagedPhotos = existingLog && Array.isArray(existingLog.photos)
      ? existingLog.photos.map((p) => ({ ...p }))
      : [];
    renderStagedPhotos();

    dialog.showModal();
  }

  function openPhotoLightbox(photo, log) {
    const dialog = document.getElementById('photo-dialog');
    const car = getCarById(log.carId);
    document.getElementById('photo-dialog-title').textContent =
      photo.caption || photo.name || log.taskTitle;
    const img = document.getElementById('lightbox-img');
    img.src = photo.dataUrl;
    img.alt = photo.caption || photo.name || 'Maintenance photo';
    document.getElementById('lightbox-caption').textContent = `${log.taskTitle} • ${getCarDisplayName(car)} • Completed ${log.completedDate} at ${formatNumber(log.mileage)} miles`;
    dialog.showModal();
  }

  /* =========================================================================
     Client-Side Image Compression & File Reading
     ========================================================================= */
  function readFileAsCompressedDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Failed to read image file'));
      reader.onload = () => {
        const rawUrl = reader.result;
        if (file.type === 'image/svg+xml') {
          resolve(rawUrl);
          return;
        }
        const img = new Image();
        img.onerror = () => resolve(rawUrl);
        img.onload = () => {
          const maxDim = 960;
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            const scale = Math.min(maxDim / width, maxDim / height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        img.src = rawUrl;
      };
      reader.readAsDataURL(file);
    });
  }

  /* =========================================================================
     Form Submissions & Actions
     ========================================================================= */
  async function handleDeleteCar(carId) {
    const car = getCarById(carId);
    if (!car) return;
    if (appState.apiAvailable) {
      await apiRequest(`/api/cars/${encodeURIComponent(carId)}`, 'DELETE');
    } else {
      appState.cars = appState.cars.filter((c) => c.id !== carId);
      appState.tasks = appState.tasks.filter((t) => t.carId !== carId);
      appState.logs = appState.logs.filter((l) => l.carId !== carId);
      appState.selectedCarId = 'all';
      saveLocalState();
      renderAll();
    }
  }

  async function handleDeleteTask(taskId) {
    if (appState.apiAvailable) {
      await apiRequest(`/api/tasks/${encodeURIComponent(taskId)}`, 'DELETE');
    } else {
      appState.tasks = appState.tasks.filter((t) => t.id !== taskId);
      saveLocalState();
      renderAll();
    }
  }

  async function handleDeleteLog(logId) {
    if (appState.apiAvailable) {
      await apiRequest(`/api/logs/${encodeURIComponent(logId)}`, 'DELETE');
    } else {
      appState.logs = appState.logs.filter((l) => l.id !== logId);
      saveLocalState();
      renderAll();
    }
  }

  function wireEventListeners() {
    // Populate preset options in task modal
    const presetSelect = document.getElementById('task-preset');
    presetSelect.innerHTML =
      `<option value="">— Custom Recurring Task —</option>` +
      SERVICE_PRESETS.map(
        (p, idx) =>
          `<option value="${idx}">${escapeHtml(p.title)} (${formatNumber(p.intervalMiles)} mi / ${p.intervalMonths} mo)</option>`
      ).join('');

    presetSelect.addEventListener('change', () => {
      const idx = presetSelect.value;
      if (idx === '') return;
      const preset = SERVICE_PRESETS[Number(idx)];
      if (!preset) return;
      document.getElementById('task-title').value = preset.title;
      document.getElementById('task-category').value = preset.category;
      document.getElementById('task-interval-miles').value = preset.intervalMiles;
      document.getElementById('task-interval-months').value = preset.intervalMonths;
      document.getElementById('task-notes').value = preset.defaultNotes;
    });

    // Header & section buttons
    document.getElementById('btn-add-car').addEventListener('click', () => openCarDialog());
    document.getElementById('btn-sidebar-add-car').addEventListener('click', () => openCarDialog());
    document.getElementById('btn-add-task').addEventListener('click', () => openTaskDialog());
    document.getElementById('btn-section-add-task').addEventListener('click', () => openTaskDialog());
    document.getElementById('btn-log-service').addEventListener('click', () => openCompleteDialog());
    document.getElementById('btn-section-log-service').addEventListener('click', () => openCompleteDialog());

    const cloudSyncBtn = document.getElementById('btn-cloud-sync');
    if (cloudSyncBtn) {
      cloudSyncBtn.addEventListener('click', () => openSyncDialog());
    }

    function openSyncDialog() {
      const dialog = document.getElementById('sync-dialog');
      if (!dialog) return;
      const cfg = getSyncConfig();
      const tokenInput = document.getElementById('sync-token-input');
      const gistInput = document.getElementById('sync-gist-id-input');
      if (tokenInput) {
        tokenInput.value = cfg.token || '';
        tokenInput.type = 'password';
      }
      const toggleBtn = document.getElementById('toggle-sync-token');
      if (toggleBtn) {
        toggleBtn.setAttribute('aria-pressed', 'false');
        toggleBtn.textContent = 'Show';
      }
      if (gistInput) {
        gistInput.value = cfg.gistId || '';
      }
      dialog.showModal();
    }

    // Show / Hide token toggle per `forms` Section 8
    const toggleTokenBtn = document.getElementById('toggle-sync-token');
    if (toggleTokenBtn) {
      toggleTokenBtn.addEventListener('click', () => {
        const tokenInput = document.getElementById('sync-token-input');
        if (!tokenInput) return;
        const isShowing = tokenInput.type === 'text';
        tokenInput.type = isShowing ? 'password' : 'text';
        toggleTokenBtn.setAttribute('aria-pressed', String(!isShowing));
        toggleTokenBtn.setAttribute('aria-label', isShowing ? 'Show token' : 'Hide token');
        toggleTokenBtn.textContent = isShowing ? 'Show' : 'Hide';
      });
    }

    // Save & Sync Form Submit
    const syncForm = document.getElementById('sync-form');
    if (syncForm) {
      syncForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!syncForm.checkValidity()) {
          syncForm.reportValidity();
          return;
        }
        const token = document.getElementById('sync-token-input').value.trim();
        const gistId = document.getElementById('sync-gist-id-input').value.trim();
        saveSyncConfig({ token, gistId });
        if (appState.updatedAt) {
          await pushToGitHubGist();
        } else {
          await pullFromGitHubGist({ force: false });
        }
      });
    }

    // Pull & Push quick action buttons inside Cloud Sync modal
    const pullBtn = document.getElementById('btn-sync-pull');
    if (pullBtn) {
      pullBtn.addEventListener('click', async () => {
        const token = document.getElementById('sync-token-input').value.trim();
        const gistId = document.getElementById('sync-gist-id-input').value.trim();
        if (token) saveSyncConfig({ token, gistId });
        await pullFromGitHubGist({ force: true });
      });
    }

    const pushBtn = document.getElementById('btn-sync-push');
    if (pushBtn) {
      pushBtn.addEventListener('click', async () => {
        const token = document.getElementById('sync-token-input').value.trim();
        const gistId = document.getElementById('sync-gist-id-input').value.trim();
        if (token) saveSyncConfig({ token, gistId });
        await pushToGitHubGist();
      });
    }

    const copySetupLinkBtn = document.getElementById('btn-copy-setup-link');
    if (copySetupLinkBtn) {
      copySetupLinkBtn.addEventListener('click', async () => {
        const token = document.getElementById('sync-token-input').value.trim() || getSyncConfig().token;
        const gistId = document.getElementById('sync-gist-id-input').value.trim() || getSyncConfig().gistId;
        if (!token) {
          updateSyncStatusUi('error', 'Enter your GitHub Token first before copying a New-Phone Setup Link.');
          return;
        }
        const base = window.location.origin + window.location.pathname;
        const hashParams = new URLSearchParams({ syncToken: token });
        if (gistId) hashParams.set('gistId', gistId);
        const setupUrl = `${base}#${hashParams.toString()}`;
        try {
          await navigator.clipboard.writeText(setupUrl);
          updateSyncStatusUi(
            'connected',
            'Copied New-Phone Setup Link! Open that link on your iPhone to connect Private GitHub Sync in 1 tap.'
          );
        } catch {
          updateSyncStatusUi('connected', `Setup Link: ${setupUrl}`);
        }
      });
    }

    const disconnectBtn = document.getElementById('btn-sync-disconnect');
    if (disconnectBtn) {
      disconnectBtn.addEventListener('click', () => {
        clearSyncConfig();
        document.getElementById('sync-token-input').value = '';
        document.getElementById('sync-gist-id-input').value = '';
      });
    }

    // Export JSON
    document.getElementById('btn-export-json').addEventListener('click', () => {
      const payload = JSON.stringify(
        { cars: appState.cars, tasks: appState.tasks, logs: appState.logs },
        null,
        2
      );
      const blob = new Blob([payload], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `garagelog-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });

    // Import JSON (restore backup from Files / iCloud Drive)
    const importBtn = document.getElementById('btn-import-json');
    const importInput = document.getElementById('import-json-input');
    if (importBtn && importInput) {
      importBtn.addEventListener('click', () => importInput.click());
      importInput.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
          const text = await file.text();
          const parsed = JSON.parse(text);
          if (
            parsed &&
            typeof parsed === 'object' &&
            (Array.isArray(parsed.cars) || Array.isArray(parsed.tasks) || Array.isArray(parsed.logs))
          ) {
            if (appState.apiAvailable) {
              await apiRequest('/api/state', 'PUT', parsed);
            } else {
              applyStatePayload(parsed);
            }
          }
        } catch {
          // Ignore malformed JSON files
        } finally {
          e.target.value = '';
        }
      });
    }

    // Reset Demo
    document.getElementById('btn-reset-demo').addEventListener('click', async () => {
      if (appState.apiAvailable) {
        await apiRequest('/api/reset', 'POST');
      } else {
        applyStatePayload(createInitialSeedData());
      }
    });

    // Mobile popover menu & bottom bar actions
    const mobilePopover = document.getElementById('mobile-actions-popover');
    document.querySelectorAll('[data-mobile-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-mobile-action');
        if (mobilePopover && typeof mobilePopover.hidePopover === 'function') {
          try {
            mobilePopover.hidePopover();
          } catch {
            // ignore if already hidden
          }
        }
        if (action === 'cloud-sync') {
          openSyncDialog();
        } else if (action === 'add-car') {
          openCarDialog();
        } else if (action === 'add-task') {
          openTaskDialog();
        } else if (action === 'log-service') {
          openCompleteDialog();
        } else if (action === 'export-json') {
          document.getElementById('btn-export-json').click();
        } else if (action === 'import-json') {
          document.getElementById('import-json-input').click();
        } else if (action === 'reset-demo') {
          document.getElementById('btn-reset-demo').click();
        }
      });
    });

    // Task status filter pills
    document.querySelectorAll('[data-task-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-task-filter]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        appState.taskStatusFilter = btn.getAttribute('data-task-filter');
        renderTasksGrid();
      });
    });

    // Task view mode toggle pills (Table vs Cards)
    document.querySelectorAll('[data-task-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-task-view]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        appState.taskViewMode = btn.getAttribute('data-task-view');
        renderTasksGrid();
      });
    });

    // History search & filters
    const filterForm = document.getElementById('history-filter-form');
    filterForm.addEventListener('submit', (e) => e.preventDefault());

    document.getElementById('history-search-input').addEventListener('input', (e) => {
      appState.historySearch = e.target.value;
      renderHistoryTable();
    });

    document.getElementById('history-category-filter').addEventListener('change', (e) => {
      appState.historyCategory = e.target.value;
      renderHistoryTable();
    });

    document.getElementById('history-photo-filter').addEventListener('change', (e) => {
      appState.historyPhotoFilter = e.target.value;
      renderHistoryTable();
    });

    // Vehicle change inside Complete dialog updates linked tasks & default mileage
    document.getElementById('complete-car-id').addEventListener('change', (e) => {
      const newCarId = e.target.value;
      const car = getCarById(newCarId);
      populateLinkedTaskSelect(newCarId, '');
      if (car && !document.getElementById('complete-log-id').value) {
        document.getElementById('complete-mileage').value = car.currentMileage;
      }
    });

    // Linked task change inside Complete dialog populates title & category
    document.getElementById('complete-task-select').addEventListener('change', (e) => {
      const taskId = e.target.value;
      document.getElementById('complete-task-id').value = taskId;
      const task = appState.tasks.find((t) => t.id === taskId);
      if (task) {
        document.getElementById('complete-title').value = task.title;
        document.getElementById('complete-category').value = task.category || 'General';
      }
    });

    // Photo file input
    document.getElementById('complete-photos').addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      for (const file of files) {
        const dataUrl = await readFileAsCompressedDataUrl(file);
        appState.stagedPhotos.push({
          id: 'photo-' + Math.random().toString(36).slice(2, 10),
          name: file.name,
          caption: file.name.replace(/\.[^.]+$/, ''),
          dataUrl
        });
      }
      e.target.value = '';
      renderStagedPhotos();
    });

    // Instant Sample Receipt / Inspection Photo Generator button
    document.getElementById('btn-generate-sample-photo').addEventListener('click', () => {
      const carId = document.getElementById('complete-car-id').value;
      const car = getCarById(carId);
      const title = document.getElementById('complete-title').value || 'Maintenance Service';
      const dateStr = document.getElementById('complete-date').value || new Date().toISOString().slice(0, 10);
      const mileage = document.getElementById('complete-mileage').value || car?.currentMileage || 0;
      const shop = document.getElementById('complete-shop').value || 'Verified Garage Service';

      const dataUrl = createSamplePhotoDataUrl(
        title,
        `${car ? `${car.year} ${car.make} ${car.model}` : 'Vehicle'} • ${formatNumber(mileage)} mi • ${dateStr}`,
        car?.colorAccent || '#0ea5e9',
        [
          `Performed By: ${shop}`,
          `Odometer Reading: ${formatNumber(mileage)} miles`,
          `Completion Date: ${dateStr}`,
          `Status: Completed & Inspected`
        ]
      );

      appState.stagedPhotos.push({
        id: 'photo-' + Math.random().toString(36).slice(2, 10),
        name: 'service-inspection-snapshot.svg',
        caption: `${title} receipt & odometer (${formatNumber(mileage)} mi)`,
        dataUrl
      });
      renderStagedPhotos();
    });

    // Form 1: Save Vehicle
    document.getElementById('car-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      const payload = {
        id: document.getElementById('car-id').value || undefined,
        year: Number(document.getElementById('car-year').value),
        make: document.getElementById('car-make').value.trim(),
        model: document.getElementById('car-model').value.trim(),
        nickname: document.getElementById('car-nickname').value.trim(),
        currentMileage: Number(document.getElementById('car-mileage').value),
        colorAccent: document.getElementById('car-color').value,
        licensePlate: document.getElementById('car-plate').value.trim().toUpperCase(),
        vin: document.getElementById('car-vin').value.trim().toUpperCase(),
        notes: document.getElementById('car-notes').value.trim()
      };

      if (appState.apiAvailable) {
        await apiRequest('/api/cars', 'POST', payload);
      } else {
        const id = payload.id || 'car-' + Math.random().toString(36).slice(2, 10);
        const existingIdx = appState.cars.findIndex((c) => c.id === id);
        if (existingIdx >= 0) {
          appState.cars[existingIdx] = { ...appState.cars[existingIdx], ...payload, id };
        } else {
          appState.cars.push({ ...payload, id });
        }
        appState.selectedCarId = id;
        saveLocalState();
        renderAll();
      }

      document.getElementById('car-dialog').close();
    });

    // Form 2: Save Recurring Task
    document.getElementById('task-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      const payload = {
        id: document.getElementById('task-id').value || undefined,
        carId: document.getElementById('task-car-id').value,
        title: document.getElementById('task-title').value.trim(),
        category: document.getElementById('task-category').value,
        intervalMiles: Number(document.getElementById('task-interval-miles').value || 0),
        intervalMonths: Number(document.getElementById('task-interval-months').value || 0),
        lastCompletedDate: document.getElementById('task-last-date').value || null,
        lastCompletedMileage:
          document.getElementById('task-last-mileage').value !== ''
            ? Number(document.getElementById('task-last-mileage').value)
            : null,
        notes: document.getElementById('task-notes').value.trim()
      };

      if (appState.apiAvailable) {
        await apiRequest('/api/tasks', 'POST', payload);
      } else {
        const id = payload.id || 'task-' + Math.random().toString(36).slice(2, 10);
        const existingIdx = appState.tasks.findIndex((t) => t.id === id);
        if (existingIdx >= 0) {
          appState.tasks[existingIdx] = {
            ...appState.tasks[existingIdx],
            ...payload,
            baselineDate: payload.lastCompletedDate,
            baselineMileage: payload.lastCompletedMileage,
            id
          };
        } else {
          appState.tasks.push({
            ...payload,
            id,
            baselineDate: payload.lastCompletedDate,
            baselineMileage: payload.lastCompletedMileage,
            completionCount: 0
          });
        }
        saveLocalState();
        renderAll();
      }

      document.getElementById('task-dialog').close();
    });

    // Form 3: Mark Task Complete / Save History Log
    document.getElementById('complete-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      const existingLogId = document.getElementById('complete-log-id').value;
      const payload = {
        id: existingLogId || undefined,
        carId: document.getElementById('complete-car-id').value,
        taskId: document.getElementById('complete-task-id').value || null,
        taskTitle: document.getElementById('complete-title').value.trim(),
        category: document.getElementById('complete-category').value,
        completedDate: document.getElementById('complete-date').value,
        mileage: Number(document.getElementById('complete-mileage').value || 0),
        cost: Number(document.getElementById('complete-cost').value || 0),
        performedBy: document.getElementById('complete-shop').value.trim(),
        notes: document.getElementById('complete-notes').value.trim(),
        photos: appState.stagedPhotos.map((p) => ({ ...p }))
      };

      if (appState.apiAvailable) {
        await apiRequest('/api/logs', 'POST', payload);
      } else {
        const id = payload.id || 'log-' + Math.random().toString(36).slice(2, 10);
        const existingIdx = appState.logs.findIndex((l) => l.id === id);
        if (existingIdx >= 0) {
          appState.logs[existingIdx] = { ...appState.logs[existingIdx], ...payload, id };
        } else {
          appState.logs.unshift({ ...payload, id });
        }

        if (payload.taskId) {
          const linked = appState.tasks.find((t) => t.id === payload.taskId);
          if (linked) {
            linked.lastCompletedDate =
              !linked.lastCompletedDate || payload.completedDate >= linked.lastCompletedDate
                ? payload.completedDate
                : linked.lastCompletedDate;
            linked.lastCompletedMileage = Math.max(
              Number(linked.lastCompletedMileage || 0),
              payload.mileage
            );
            linked.completionCount = Number(linked.completionCount || 0) + 1;
          }
        }

        const car = getCarById(payload.carId);
        if (car && payload.mileage > Number(car.currentMileage || 0)) {
          car.currentMileage = payload.mileage;
        }

        saveLocalState();
        renderAll();
      }

      document.getElementById('complete-dialog').close();
    });
  }

  function initPwaStorageAndServiceWorker() {
    if (navigator.storage && typeof navigator.storage.persist === 'function') {
      navigator.storage.persist().catch(() => {});
    }
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    initDialogEnhancements();
    UserInvalidFallback.init(document);
    wireEventListeners();
    initPwaStorageAndServiceWorker();
    loadInitialData();
  });
})();
