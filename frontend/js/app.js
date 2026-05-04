const API = 'https://lifehub-backend-n0y5.onrender.com/api';

(function installErrorTracker() {
  const MAX_STORED = 50;

  function loadLog() {
    try { return JSON.parse(sessionStorage.getItem('lh_errors') || '[]'); }
    catch { return []; }
  }

  function storeEntry(entry) {
    try {
      const log = loadLog();
      log.push(entry);
      if (log.length > MAX_STORED) log.splice(0, log.length - MAX_STORED);
      sessionStorage.setItem('lh_errors', JSON.stringify(log));
    } catch { /* storage full — ignore */ }
  }

  function sendError(entry) {
    storeEntry(entry);
    // Best-effort — don't await, don't throw
    try {
      navigator.sendBeacon(`${API}/client-errors`, JSON.stringify(entry));
    } catch { /* sendBeacon unavailable */ }
  }

  window.onerror = function (message, source, lineno, colno, error) {
    sendError({
      type: 'uncaught',
      message: String(message),
      source, lineno, colno,
      stack: error?.stack ?? null,
      url: location.href,
      ts: Date.now(),
    });
    return false; // don't suppress the default console output
  };

  window.onunhandledrejection = function (event) {
    const reason = event.reason;
    sendError({
      type: 'unhandledRejection',
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : null,
      url: location.href,
      ts: Date.now(),
    });
  };

  // Expose so other modules can log intentional errors
  window.__trackError = sendError;
})();

// ── Shared constants ────────────────────────────────────────
const PRIORITY_COLOR = { high: '#D93F3F', medium: '#C97400', low: '#22936A' };
const PRIORITY_BG    = { high: 'var(--rose)', medium: 'var(--butter)', low: 'var(--mint)' };

// ── Security helpers ────────────────────────────────────────
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Toast keyframe (injected once) ──────────────────────────
(function injectToastStyle() {
  if (document.getElementById('lh-toast-style')) return;
  const style = document.createElement('style');
  style.id = 'lh-toast-style';
  style.textContent = `@keyframes toastIn { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:none; } }`;
  document.head.appendChild(style);
})();

// ── Cold-start guard ────────────────────────────────────────
// Render free tier spins down after inactivity. On first load the backend
// can return 401 while it wakes up. We suppress apiFetch 401-redirects
// during a short grace window so the pollers don't evict a legitimate user.
const _PAGE_LOAD_TS      = Date.now();
const _COLD_START_GRACE_MS = 15_000; // 15 s — covers typical Render cold start
let _authConfirmed       = false;    // set true once /auth/me returns 200

function _inColdStartGrace() {
  return !_authConfirmed && (Date.now() - _PAGE_LOAD_TS < _COLD_START_GRACE_MS);
}

function getToken()   { return null;  } // cookie is httpOnly — not readable by JS
function setToken(_)  { /* no-op: server sets the httpOnly cookie */ }
function clearToken() {
  // Remove the UX flags; the actual cookie is cleared by the server on logout
  localStorage.removeItem('lh_loggedin');
  localStorage.removeItem('lh_user');
}

function isLoggedIn() {
  return localStorage.getItem('lh_loggedin') === '1';
}
function markLoggedIn() { localStorage.setItem('lh_loggedin', '1'); }

function getUser() {
  try { return JSON.parse(localStorage.getItem('lh_user')); } catch { return null; }
}
function setUser(u) { localStorage.setItem('lh_user', JSON.stringify(u)); }

async function requireAuth() {
  if (!isLoggedIn()) {
    window.location.href = '/pages/login.html';
    return;
  }
  // Retry up to 3 times with increasing delays to handle Render cold-start 401s.
  // A genuine session expiry will still redirect after all retries fail.
  const delays = [0, 2000, 4000];
  for (let i = 0; i < delays.length; i++) {
    if (delays[i] > 0) await new Promise(r => setTimeout(r, delays[i]));
    try {
      const res = await fetch(`${API}/auth/me`, { credentials: 'include' });
      if (res.ok) { _authConfirmed = true; return; } // session valid — continue
      if (res.status === 401 && i < delays.length - 1) continue; // cold start — retry
      // Final attempt failed or non-401 error
      clearToken();
      window.location.href = '/pages/login.html';
      return;
    } catch (_) {
      // Network error — leave the user on the page; they'll get 401s on
      // the next API call and be redirected then.
      return;
    }
  }
}
function redirectIfLoggedIn() {
  if (isLoggedIn()) { window.location.href = '/index.html'; }
}

let _csrfToken = null;

async function loadCsrfToken() {
  try {
    const res  = await fetch(`${API}/csrf-token`, { credentials: 'include' });
    const data = await res.json();
    _csrfToken = data.csrfToken || null;
  } catch (_) {
    // If the request fails, requests will still go through for GET/HEAD/OPTIONS
    // and will be rejected by the server for mutating verbs — that is correct.
    console.warn('Could not load CSRF token');
  }
}

// Kick off the CSRF fetch immediately (non-blocking)
loadCsrfToken();

async function apiFetch(path, options = {}) {
  const method  = (options.method || 'GET').toUpperCase();
  const headers = { 'Content-Type': 'application/json', ...options.headers };

  // Attach CSRF token for mutating requests
  const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'];
  if (mutating.includes(method) && !_csrfToken) {
    await loadCsrfToken();
  }
  if (mutating.includes(method) && _csrfToken) {
    headers['X-CSRF-Token'] = _csrfToken;
  }

  let res = await fetch(API + path, {
    ...options,
    headers,
    credentials: 'include',  // send the httpOnly cookie on every request
  });

  // If the CSRF cookie/token pair expired or wasn't loaded yet, refresh once and retry.
  if (res.status === 403 && mutating.includes(method)) {
    await loadCsrfToken();
    if (_csrfToken) {
      headers['X-CSRF-Token'] = _csrfToken;
      res = await fetch(API + path, {
        ...options,
        headers,
        credentials: 'include',
      });
    }
  }

  if (res.status === 401) {
    // During Render cold-start, the backend can return 401 before the session
    // cookie is recognised. Don't redirect while requireAuth is still retrying.
    if (_inColdStartGrace()) return null;
    clearToken();
    window.location.href = '/pages/login.html';
    return null;
  }

  // Log non-OK responses to the error tracker
  if (!res.ok && window.__trackError) {
    window.__trackError({ type: 'apiFetch', status: res.status, url: API + path, method, ts: Date.now() });
  }

  // Refresh CSRF token if the server signals it's been rotated
  const newToken = res.headers.get('X-CSRF-Token');
  if (newToken) _csrfToken = newToken;

  return res;
}

// ── Greeting time ───────────────────────────────────────────
function greetingTime() {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

// ── Format helpers ──────────────────────────────────────────
function fmtDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtDateTime(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtCurrency(n) {
  return '₹' + parseFloat(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Toast notifications ─────────────────────────────────────
function showToast(message, type = 'success') {
  const existing = document.getElementById('lh-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'lh-toast';
  toast.className = `toast toast-${type}`;
  toast.textContent = message;

  const colors = { success: 'var(--green)', error: 'var(--red)', warning: 'var(--amber)', info: 'var(--blue)' };
  Object.assign(toast.style, {
    position: 'fixed', bottom: '24px', right: '24px', zIndex: '9999',
    background: 'var(--surface)', color: 'var(--text)',
    padding: '12px 18px', borderRadius: 'var(--radius-sm)',
    boxShadow: 'var(--shadow-md)', fontSize: '0.875rem', fontWeight: '500',
    borderLeft: `4px solid ${colors[type] || colors.info}`,
    maxWidth: '340px', animation: 'toastIn 0.25s ease',
  });

  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

// ── Alert banner (for health alerts) ───────────────────────
function showAlertBanner(alerts) {
  const existing = document.getElementById('health-alerts');
  if (existing) existing.remove();
  if (!alerts || alerts.length === 0) return;

  const banner = document.createElement('div');
  banner.id = 'health-alerts';
  Object.assign(banner.style, {
    background: 'var(--red-light)', border: '1px solid var(--rose-border)',
    borderRadius: 'var(--radius-sm)', padding: '14px 18px',
    marginBottom: '20px', color: 'var(--red)',
  });

  const heading = document.createElement('strong');
  heading.textContent = '⚠️ Health Alerts';

  const list = document.createElement('ul');
  list.style.cssText = 'margin:8px 0 0 18px;font-size:0.875rem';
  alerts.forEach(a => {
    const li = document.createElement('li');
    li.textContent = a;   // textContent — never innerHTML — for user-derived strings
    list.appendChild(li);
  });

  banner.appendChild(heading);
  banner.appendChild(list);

  const main = document.querySelector('.main-content');
  if (main) main.insertBefore(banner, main.firstChild);
}

// ── Sidebar: user info + logout ─────────────────────────────
function initSidebar() {
  const user = getUser();
  const nameEl   = document.getElementById('sidebar-user-name');
  const emailEl  = document.getElementById('sidebar-user-email');
  const avatarEl = document.getElementById('sidebar-avatar');

  if (user) {
    if (nameEl)  nameEl.textContent  = user.name;
    if (emailEl) emailEl.textContent = user.email;
    if (avatarEl) avatarEl.textContent = user.name.charAt(0).toUpperCase();
  }

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try { await apiFetch('/auth/logout', { method: 'POST' }); } catch (_) {}
      stopGlobalReminderPoller();
      stopGlobalReminderFallback();
      clearToken();
      if (typeof _pollerChannel !== 'undefined' && _pollerChannel) {
        _pollerChannel.close();
      }
      window.location.href = '/pages/login.html';
    });
  }

  // Mobile nav toggle
  const toggle  = document.getElementById('nav-toggle');
  const sidebar = document.getElementById('sidebar');
  if (toggle && sidebar) {
    toggle.addEventListener('click', () => sidebar.classList.toggle('open'));
    document.addEventListener('click', (e) => {
      if (!sidebar.contains(e.target) && !toggle.contains(e.target)) {
        sidebar.classList.remove('open');
      }
    });
  }
}

// ── Modal helpers ───────────────────────────────────────────
function openModal(id)  { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }

function initModalClosers() {
  document.querySelectorAll('.modal-close, [data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('.modal-overlay')?.classList.remove('open');
    });
  });
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('open');
    });
  });
}

// ── Spinner helper ──────────────────────────────────────────
function spinner() { return '<div class="spinner"></div>'; }
function emptyState(icon, title, text) {
  return `<div class="empty-state"><div class="empty-icon">${icon}</div><h3>${title}</h3><p>${text}</p></div>`;
}

// ── Global reminder poller ──────────────────────────────────
let _globalPollInterval            = null;
let _pollerMonitorInterval         = null;
let _pollerHeartbeat               = null;
let _globalReminderFallbackInterval = null;
let _isPollerLeader                = false;
let _pollerChannel                 = null;
const _POLLER_CH_NAME      = 'lh_reminder_poller';
const _POLLER_LOCK_KEY     = 'lh_reminder_poller_lock';
const _POLLER_LOCK_TTL     = 90_000;
const _POLLER_MONITOR_MS   = 10_000;
const _POLLER_HEARTBEAT_MS = 20_000;
const _POLLER_INTERVAL_MS  = 15_000;
const _REMINDER_FALLBACK_MS = 10_000;
const _pollerTabId         = Math.random().toString(36).slice(2);
const _fallbackReminderIds = new Set();

function _readPollerLock() {
  try {
    const raw = localStorage.getItem(_POLLER_LOCK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.id !== 'string' || typeof parsed.expiresAt !== 'number') {
      return null;
    }
    return parsed;
  } catch (_) {
    return null;
  }
}

function _writePollerLock(expiresAt = Date.now() + _POLLER_LOCK_TTL) {
  try {
    localStorage.setItem(_POLLER_LOCK_KEY, JSON.stringify({ id: _pollerTabId, expiresAt }));
    return true;
  } catch (_) {
    return false;
  }
}

function _claimPollerLock() {
  const now  = Date.now();
  const lock = _readPollerLock();

  if (lock && lock.id !== _pollerTabId && lock.expiresAt > now) {
    return false;
  }

  if (!_writePollerLock(now + _POLLER_LOCK_TTL)) {
    return false;
  }

  const verified = _readPollerLock();
  return !!verified && verified.id === _pollerTabId;
}

function _renewPollerLock() {
  const lock = _readPollerLock();
  if (!lock || lock.id !== _pollerTabId) return false;
  return _writePollerLock(Date.now() + _POLLER_LOCK_TTL);
}

function _releasePollerLock() {
  try {
    const lock = _readPollerLock();
    if (lock && lock.id === _pollerTabId) {
      localStorage.removeItem(_POLLER_LOCK_KEY);
    }
  } catch (_) {}
}

function _startPollingAsLeader() {
  if (_isPollerLeader && _globalPollInterval && _pollerHeartbeat) return;

  _isPollerLeader = true;
  _renewPollerLock();
  _pollDueRemindersGlobal();

  if (_globalPollInterval) clearInterval(_globalPollInterval);
  _globalPollInterval = setInterval(_pollDueRemindersGlobal, _POLLER_INTERVAL_MS);

  if (_pollerHeartbeat) clearInterval(_pollerHeartbeat);
  _pollerHeartbeat = setInterval(() => {
    if (!_renewPollerLock()) {
      _stopPollingAsLeader(false);
    }
  }, _POLLER_HEARTBEAT_MS);
}

function _stopPollingAsLeader(releaseLock = true) {
  _isPollerLeader = false;

  if (_globalPollInterval) {
    clearInterval(_globalPollInterval);
    _globalPollInterval = null;
  }

  if (_pollerHeartbeat) {
    clearInterval(_pollerHeartbeat);
    _pollerHeartbeat = null;
  }

  if (releaseLock) {
    _releasePollerLock();
  }
}

function _ensurePollerLeadership() {
  if (!isLoggedIn()) {
    _stopPollingAsLeader();
    return;
  }

  const now  = Date.now();
  const lock = _readPollerLock();

  if (lock && lock.id === _pollerTabId && lock.expiresAt > now) {
    if (!_isPollerLeader) _startPollingAsLeader();
    else _renewPollerLock();
    return;
  }

  if (!lock || lock.expiresAt <= now) {
    if (_claimPollerLock()) {
      _startPollingAsLeader();
      return;
    }
  }

  if (_isPollerLeader) {
    _stopPollingAsLeader(false);
  }
}

function startGlobalReminderPoller() {
  if (!isLoggedIn()) return;

  if (!_pollerChannel && typeof BroadcastChannel !== 'undefined') {
    _pollerChannel = new BroadcastChannel(_POLLER_CH_NAME);
  }

  _ensurePollerLeadership();

  if (_pollerMonitorInterval) clearInterval(_pollerMonitorInterval);
  _pollerMonitorInterval = setInterval(_ensurePollerLeadership, _POLLER_MONITOR_MS);
}

function stopGlobalReminderPoller() {
  if (_pollerMonitorInterval) {
    clearInterval(_pollerMonitorInterval);
    _pollerMonitorInterval = null;
  }
  _stopPollingAsLeader();
}

async function _pollDueRemindersGlobal() {
  if (!isLoggedIn()) return;
  if (!_isPollerLeader) return;
  try {
    const res = await apiFetch('/reminders/due');
    if (!res || !res.ok) return;
    const due = await res.json();
    if (!due.length) return;

    for (const r of due) {
      _fireReminderNotification(r);
      await apiFetch(`/reminders/${r.id}/notify`, { method: 'PATCH', body: '{}' });
    }

    // Broadcast to other tabs
    if (_pollerChannel) _pollerChannel.postMessage('notified');

    // Also refresh THIS tab's dashboard reminder count if we're on the dashboard
    const badge = document.getElementById('stat-reminders');
    if (badge) {
      try {
        const dashRes = await apiFetch('/dashboard');
        if (dashRes && dashRes.ok) {
          const data = await dashRes.json();
          badge.textContent = data.upcomingReminders.length;
          // Re-render dashboard reminders list if the function is available
          if (typeof renderReminders === 'function') {
            renderReminders(data.upcomingReminders);
          }
        }
      } catch (_) {
        // Fallback: decrement badge
        const current = parseInt(badge.textContent, 10) || 0;
        badge.textContent = Math.max(0, current - due.length);
      }
    }

    // Refresh the reminders page list if we're on it
    if (typeof loadReminders === 'function') {
      loadReminders();
    }
  } catch (_) {}
}

function showReminderOverlay(reminder) {
  const existing = document.getElementById(`lh-reminder-overlay-${reminder.id}`);
  if (existing) return;

  const overlay = document.createElement('div');
  overlay.id = `lh-reminder-overlay-${reminder.id}`;
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    background: 'rgba(15, 23, 42, 0.45)',
    zIndex: '10000',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
  });

  const card = document.createElement('div');
  Object.assign(card.style, {
    width: 'min(460px, 100%)',
    background: 'var(--surface, #fff)',
    color: 'var(--text, #111)',
    borderRadius: '14px',
    boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
    padding: '20px',
    border: '2px solid var(--purple, #7c3aed)',
  });

  card.innerHTML = `
    <div style="font-size:1.2rem;font-weight:800;margin-bottom:8px">⏰ Reminder Due</div>
    <div style="font-size:1rem;font-weight:600;margin-bottom:6px">${escHtml(reminder.title)}</div>
    <div style="font-size:0.9rem;color:var(--text-muted,#666);margin-bottom:18px">${escHtml(reminder.description || 'This reminder is due now.')}</div>
    <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap">
      <button type="button" data-reminder-open style="padding:10px 14px;border:none;border-radius:8px;background:var(--purple,#7c3aed);color:#fff;cursor:pointer;font-weight:700">Open Reminders</button>
      <button type="button" data-reminder-dismiss style="padding:10px 14px;border:1px solid var(--border,#ddd);border-radius:8px;background:transparent;cursor:pointer;font-weight:600">Dismiss</button>
    </div>
  `;

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  card.querySelector('[data-reminder-open]')?.addEventListener('click', () => {
    window.location.href = '/pages/reminders.html';
    close();
  });
  card.querySelector('[data-reminder-dismiss]')?.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
}

function playReminderSound() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const notes = [880, 988, 880];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.22);
      gain.gain.exponentialRampToValueAtTime(0.18, now + i * 0.22 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.22 + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.22);
      osc.stop(now + i * 0.22 + 0.2);
    });

    setTimeout(() => { try { ctx.close(); } catch (_) {} }, 1200);
  } catch (_) {}
}

function _fireReminderNotification(reminder) {
  playReminderSound();
  showReminderOverlay(reminder);

  // Show a persistent toast that stays until clicked (not auto-dismissed)
  const existing = document.getElementById('lh-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'lh-toast';
  Object.assign(toast.style, {
    position: 'fixed', bottom: '24px', right: '24px', zIndex: '9999',
    background: 'var(--surface)', color: 'var(--text)',
    padding: '14px 18px', borderRadius: 'var(--radius-sm)',
    boxShadow: '0 4px 20px rgba(0,0,0,0.18)', fontSize: '0.9rem', fontWeight: '500',
    borderLeft: '4px solid var(--blue, #2563eb)',
    maxWidth: '360px', cursor: 'pointer',
    animation: 'toastIn 0.25s ease',
  });
  toast.innerHTML = `<div style="font-weight:700;margin-bottom:4px">⏰ Reminder Due</div><div>${escHtml(reminder.title)}</div><div style="font-size:0.75rem;color:var(--text-muted,#888);margin-top:4px">Click to dismiss</div>`;
  toast.addEventListener('click', () => toast.remove());
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 15000);

  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      const n = new Notification(`⏰ ${reminder.title}`, {
        body:               reminder.description || 'LifeHub reminder is due now.',
        icon:               '/favicon.svg',
        tag:                `lh-reminder-${reminder.id}`,
        requireInteraction: true,
      });
      n.onclick = () => {
        window.focus();
        window.location.href = '/pages/reminders.html';
        n.close();
      };
    } catch (_) {
      showToast(`⏰ ${reminder.title} is due now`, 'warning');
    }
  } else if ('Notification' in window && Notification.permission === 'default') {
    showToast(`🔔 ${reminder.title} — enable notifications to get background alerts`, 'warning');
  } else {
    showToast(`⏰ ${reminder.title} is due now`, 'warning');
  }
}

async function _refreshReminderUiAfterNotify() {
  if (_pollerChannel) _pollerChannel.postMessage('notified');

  const badge = document.getElementById('stat-reminders');
  if (badge) {
    try {
      const dashRes = await apiFetch('/dashboard');
      if (dashRes && dashRes.ok) {
        const data = await dashRes.json();
        badge.textContent = data.upcomingReminders.length;
        if (typeof renderReminders === 'function') {
          renderReminders(data.upcomingReminders);
        }
      }
    } catch (_) {}
  }

  if (typeof loadReminders === 'function') {
    loadReminders();
  }
}

async function _checkDueRemindersFallback() {
  if (!isLoggedIn()) return;

  try {
    const res = await apiFetch('/reminders');
    if (!res || !res.ok) return;

    const reminders = await res.json();
    const now = Date.now();
    const due = reminders.filter(r =>
      !r.notified &&
      new Date(r.remind_at).getTime() <= now &&
      !_fallbackReminderIds.has(r.id)
    );

    for (const r of due) {
      _fallbackReminderIds.add(r.id);
      _fireReminderNotification(r);

      const notifyRes = await apiFetch(`/reminders/${r.id}/notify`, { method: 'PATCH', body: '{}' });
      if (!notifyRes || !notifyRes.ok) {
        _fallbackReminderIds.delete(r.id);
        continue;
      }

      await _refreshReminderUiAfterNotify();
    }
  } catch (_) {}
}

function startGlobalReminderFallback() {
  if (!isLoggedIn()) return;
  if (_globalReminderFallbackInterval) clearInterval(_globalReminderFallbackInterval);
  _checkDueRemindersFallback();
  _globalReminderFallbackInterval = setInterval(_checkDueRemindersFallback, _REMINDER_FALLBACK_MS);
}

function stopGlobalReminderFallback() {
  if (_globalReminderFallbackInterval) {
    clearInterval(_globalReminderFallbackInterval);
    _globalReminderFallbackInterval = null;
  }
}

function _promptNotificationPermission() {
  // Show a subtle persistent banner on every page (not just reminders)
  // until the user makes a decision. Browsers require a user gesture to
  // call requestPermission(), so we show a banner with a button rather
  // than calling it automatically.
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'default') return;

  // Don't show on the login page
  if (window.location.pathname.includes('login')) return;

  // Don't show if banner already exists
  if (document.getElementById('global-notif-banner')) return;

  const banner = document.createElement('div');
  banner.id = 'global-notif-banner';
  Object.assign(banner.style, {
    position: 'fixed',
    bottom: '0',
    left: '0',
    right: '0',
    zIndex: '9998',
    background: 'var(--surface, #fff)',
    borderTop: '2px solid var(--purple, #7c3aed)',
    padding: '10px 20px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    fontSize: '0.875rem',
    boxShadow: '0 -2px 12px rgba(0,0,0,0.10)',
  });

  banner.innerHTML = `
    <span>🔔 <strong>Enable notifications</strong> to get alerted when your reminders are due — even in the background.</span>
    <button id="global-notif-enable" style="margin-left:auto;padding:6px 14px;border-radius:6px;border:none;background:var(--purple,#7c3aed);color:#fff;cursor:pointer;font-weight:600;font-size:0.85rem">Enable</button>
    <button id="global-notif-dismiss" style="padding:6px 10px;border-radius:6px;border:1px solid var(--border,#ddd);background:none;cursor:pointer;font-size:0.85rem;color:var(--text-muted,#888)">Not now</button>
  `;

  document.body.appendChild(banner);

  document.getElementById('global-notif-enable').addEventListener('click', async () => {
    const result = await Notification.requestPermission();
    banner.remove();
    if (result === 'granted') {
      showToast('Notifications enabled! You\'ll be alerted when reminders are due.', 'success');
      _pollDueRemindersGlobal(); // immediate check
    }
  });

  document.getElementById('global-notif-dismiss').addEventListener('click', () => {
    banner.remove();
    // Remember dismissal for 7 days so we don't re-nag immediately,
    // but still prompt again eventually in case they change their mind.
    localStorage.setItem('lh_notif_dismissed_until', Date.now() + 7 * 24 * 60 * 60 * 1000);
  });
}

// ── Init on DOM ready ───────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initSidebar();
  initModalClosers();

  window.addEventListener('storage', (e) => {
    if (e.key === _POLLER_LOCK_KEY) {
      _ensurePollerLeadership();
    }
  });

  window.addEventListener('focus', () => {
    if (!isLoggedIn()) return;
    _ensurePollerLeadership();
    if (_isPollerLeader) _pollDueRemindersGlobal();
  });

  document.addEventListener('visibilitychange', () => {
    if (!isLoggedIn() || document.visibilityState !== 'visible') return;
    _ensurePollerLeadership();
    if (_isPollerLeader) _pollDueRemindersGlobal();
  });

  window.addEventListener('beforeunload', () => {
    stopGlobalReminderPoller();
    stopGlobalReminderFallback();
    if (_pollerChannel) {
      _pollerChannel.close();
      _pollerChannel = null;
    }
  });

  const greetEl = document.getElementById('greeting-time');
  if (greetEl) greetEl.textContent = greetingTime();

  const dateEl = document.getElementById('today-date');
  if (dateEl) {
    dateEl.textContent = new Date().toLocaleDateString('en-IN', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
  }

  if (isLoggedIn()) {
    // Show notification prompt unless user dismissed it recently (within 7 days)
    const dismissedUntil = parseInt(localStorage.getItem('lh_notif_dismissed_until') || '0', 10);
    if (Date.now() > dismissedUntil) {
      setTimeout(_promptNotificationPermission, 1500);
    }
    // Start pollers only AFTER requireAuth confirms the session is live.
    // This prevents the pollers from firing 401s during Render cold-start
    // and triggering a spurious logout redirect via apiFetch.
    // requireAuth is called by each page's own script (e.g. dashboard.js);
    // we hook into it here by waiting for _authConfirmed to be set or the
    // grace window to expire before starting background polling.
    const _startPollersWhenReady = () => {
      if (_authConfirmed) {
        startGlobalReminderPoller();
        startGlobalReminderFallback();
      } else if (_inColdStartGrace()) {
        setTimeout(_startPollersWhenReady, 1000);
      }
      // If grace expired and still not confirmed, don't start pollers —
      // requireAuth will have already redirected the user to login.
    };
    setTimeout(_startPollersWhenReady, 1000);
  }
});