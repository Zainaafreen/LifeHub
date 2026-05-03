/* reminders.js — page-specific display code.
   Polling and notification firing are handled globally by app.js. */

let allReminders = [];

document.addEventListener('DOMContentLoaded', () => {
  requireAuth();

  // Pre-fill datetime to now + 1 hour (in local time, not UTC)
  const dtInput = document.getElementById('r-datetime');
  if (dtInput) {
    const now = new Date(Date.now() + 60 * 60 * 1000);
    // datetime-local needs "YYYY-MM-DDTHH:mm" in LOCAL time
    const pad = n => String(n).padStart(2, '0');
    dtInput.value = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }

  loadReminders();

  document.getElementById('add-reminder-btn')?.addEventListener('click', () => openModal('reminder-modal'));
  document.getElementById('reminder-form')?.addEventListener('submit', handleCreateReminder);
  document.getElementById('reminder-filter')?.addEventListener('change', renderReminderList);
  document.getElementById('enable-notif-btn')?.addEventListener('click', requestNotificationPermission);

  // Event delegation for dynamically-rendered reminder buttons
  document.addEventListener('click', (e) => {
    const toggleBtn = e.target.closest('[data-toggle-reminder]');
    if (toggleBtn) {
      const id = Number(toggleBtn.dataset.toggleReminder);
      const reminder = allReminders.find(r => r.id === id);
      // Bug 3 fix: guard on notified only — don't block the API call for past-due
      // but un-notified reminders.  renderReminderList() shows them as "Done"
      // visually (because reminderDate < now) and hides the "✔ Done" button,
      // but the bell-icon element still carries data-toggle-reminder so a click
      // must be allowed through.  Checking only `!reminder.notified` means a
      // past-due reminder that was never PATCH-ed stays stuck in the poller
      // forever.  We now call markReminderDone() whenever notified is still
      // false, regardless of whether the date has passed.
      if (reminder && !reminder.notified) { markReminderDone(id); }
      return;
    }
    const delBtn = e.target.closest('[data-delete-reminder]');
    if (delBtn) { deleteReminder(Number(delBtn.dataset.deleteReminder)); }
  });
  renderNotifBanner();
  // Note: polling is handled globally by app.js — no need to start it here.
  // We do still refresh the list when a reminder fires, via the overridden handler below.
});

// ── Notification permission ─────────────────────────────────
function renderNotifBanner() {
  const banner = document.getElementById('notif-banner');
  if (!banner) return;
  if (Notification.permission === 'granted') {
    banner.innerHTML = `<span style="color:var(--green);font-weight:600">🔔 Browser notifications are ON</span>
      <span class="text-sm text-muted" style="margin-left:8px">You'll be alerted when reminders are due.</span>`;
    banner.style.background = 'var(--mint)';
    banner.style.borderColor = 'var(--mint-border)';
  } else if (Notification.permission === 'denied') {
    banner.innerHTML = `<span style="color:var(--red);font-weight:600">🔕 Notifications blocked</span>
      <span class="text-sm text-muted" style="margin-left:8px">Enable them in your browser settings to receive reminder alerts.</span>`;
    banner.style.background = 'var(--rose)';
    banner.style.borderColor = 'var(--rose-border)';
  } else {
    banner.innerHTML = `
      <span style="font-weight:700;font-size:0.95rem">🔔 Enable notifications to receive reminder alerts</span>
      <span class="text-sm text-muted" style="margin-left:8px;flex:1">Without this, you'll only see a toast when the tab is open.</span>
      <button class="btn btn-sm btn-primary" id="enable-notif-btn" style="margin-left:auto;white-space:nowrap">Enable Notifications</button>`;
    banner.style.background = 'var(--lavender)';
    banner.style.borderColor = 'var(--lavender-border)';
    banner.style.outline = '2px solid var(--purple)';
    document.getElementById('enable-notif-btn')?.addEventListener('click', requestNotificationPermission);
  }
}

async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    showToast('This browser does not support notifications', 'warning');
    return;
  }
  const result = await Notification.requestPermission();
  // permission stored by browser natively;
  renderNotifBanner();
  if (result === 'granted') {
    showToast('Notifications enabled! You\'ll be alerted when reminders are due.', 'success');
    _pollDueRemindersGlobal(); // trigger an immediate check via the global poller
  } else {
    showToast('Notifications blocked. Enable in browser settings.', 'warning');
  }
}

// ── Data loading ────────────────────────────────────────────
// When the global poller (app.js) fires a notification it broadcasts
// a 'notified' message. If the user is on this page, we listen for
// that event and refresh the local list so badge updates instantly.
// This replaces the old monkey-patch approach and works cleanly
// even when a different tab is the poller leader.
if (typeof BroadcastChannel !== 'undefined') {
  const _reminderPageCh = new BroadcastChannel('lh_reminder_poller');
  _reminderPageCh.onmessage = async (e) => {
    if (e.data === 'notified') {
      if (allReminders.length || document.getElementById('reminders-list')) {
        await loadReminders();
      }
    }
  };
}

async function loadReminders() {
  const el = document.getElementById('reminders-list');
  el.innerHTML = spinner();
  try {
    const res = await apiFetch('/reminders');
    if (!res || !res.ok) {
      el.innerHTML = '<p class="text-muted text-sm">Failed to load reminders.</p>';
      return;
    }
    allReminders = await res.json();
    renderStats();
    renderReminderList();
  } catch (e) {
    el.innerHTML = '<p class="text-muted text-sm">Failed to load reminders.</p>';
  }
}

function renderStats() {
  const now      = new Date();
  const upcoming = allReminders.filter(r => new Date(r.remind_at) >= now && !r.notified);
  const past     = allReminders.filter(r => new Date(r.remind_at) < now || r.notified);
  document.getElementById('rstat-total').textContent    = allReminders.length;
  document.getElementById('rstat-upcoming').textContent = upcoming.length;
  document.getElementById('rstat-past').textContent     = past.length;
}

function renderReminderList() {
  const el     = document.getElementById('reminders-list');
  const filter = document.getElementById('reminder-filter')?.value || 'all';
  const now    = new Date();

  let items = allReminders;
  // Bug 3 fix: filters use notified (DB truth) for "done", not the date alone.
  // "upcoming" = not yet notified AND still in the future.
  // "past"     = either notified (done) OR past-due (overdue, needs acknowledgement).
  if (filter === 'upcoming') items = allReminders.filter(r => !r.notified && new Date(r.remind_at) >= now);
  if (filter === 'past')     items = allReminders.filter(r =>  r.notified || new Date(r.remind_at) < now);

  if (!items.length) {
    el.innerHTML = emptyState('🔔', 'No reminders here', 'Add a reminder to stay on schedule.');
    return;
  }

  el.innerHTML = `<div class="task-list">
    ${items.map(r => {
      const reminderDate = new Date(r.remind_at);
      // Bug 3 fix: a reminder is visually "done" only when notified=true in the DB.
      // A past-due reminder that hasn't been PATCH-ed yet must still show the
      // "✔ Done" button so the user can mark it, and so the guard above can
      // call the API and set notified=true — stopping the poller from re-firing it.
      const isDone       = r.notified;                    // NOT: r.notified || reminderDate < now
      const isPastDue    = !isDone && reminderDate < now; // date passed but not yet acknowledged
      const msLeft       = reminderDate - now;
      const minsLeft     = Math.round(msLeft / 60000);
      const isSoon       = !isDone && !isPastDue && minsLeft < 60;
      const isToday      = !isDone && !isPastDue && minsLeft < 1440;

      const badgeClass = isDone    ? 'badge-muted'
                       : isPastDue ? 'badge-warning'   // overdue — needs acknowledgement
                       : isSoon    ? 'badge-warning'
                       : isToday   ? 'badge-info'
                       : 'badge-success';
      const badgeLabel = isDone    ? 'Done'
                       : isPastDue ? 'Overdue'          // clearly signals action is needed
                       : isSoon    ? `${minsLeft}m left`
                       : isToday   ? 'Today'
                       : 'Upcoming';

      const timeStr = isDone    ? fmtDateTime(r.remind_at)
                    : isPastDue ? `Was due ${fmtDateTime(r.remind_at)}`
                    : isSoon    ? `Due in ${minsLeft} min — ${fmtDateTime(r.remind_at)}`
                    : fmtDateTime(r.remind_at);

      return `<div class="task-item ${isDone ? 'opacity-60' : ''}" data-id="${r.id}">
        <div class="task-check" data-toggle-reminder="${r.id}"
             style="font-size:1rem;cursor:${isDone ? 'default' : 'pointer'}"
             title="${isDone ? 'Already done' : isPastDue ? 'Mark as done (overdue)' : 'Mark as done'}">
          ${isDone ? '✔' : isPastDue ? '⚠️' : '🔔'}
        </div>
        <div class="task-info">
          <div class="task-title">
            ${escHtml(r.title)}
            <span class="badge ${badgeClass}" style="margin-left:6px">${badgeLabel}</span>
          </div>
          <div class="task-meta">${timeStr}${r.description ? ' · ' + escHtml(r.description) : ''}</div>
        </div>
        <div class="table-actions">
          ${!isDone ? `<button class="btn btn-sm btn-success" data-toggle-reminder="${r.id}">✔ Done</button>` : ''}
          <button class="btn btn-sm btn-danger" data-delete-reminder="${r.id}">Delete</button>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

// ── CRUD ────────────────────────────────────────────────────
async function handleCreateReminder(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;

  const payload = {
    title:       document.getElementById('r-title').value.trim(),
    description: document.getElementById('r-description').value.trim() || null,
    // datetime-local gives "YYYY-MM-DDTHH:mm" with NO timezone — treat it as
    // local time by constructing a Date (which uses the browser's local timezone),
    // then convert to a full ISO string so the backend stores the correct UTC time.
    remind_at:   new Date(document.getElementById('r-datetime').value).toISOString(),
  };

  if (!payload.title || !payload.remind_at) {
    showToast('Title and date/time are required', 'warning');
    btn.disabled = false;
    return;
  }

  try {
    const res  = await apiFetch('/reminders', { method: 'POST', body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Failed to create reminder', 'error'); return; }

    allReminders.push(data);
    allReminders.sort((a, b) => new Date(a.remind_at) - new Date(b.remind_at));
    renderStats();
    renderReminderList();
    closeModal('reminder-modal');
    e.target.reset();
    // Reset datetime to 1h from now (local time)
    const dt = document.getElementById('r-datetime');
    if (dt) {
      const nxt = new Date(Date.now() + 60 * 60 * 1000);
      const pad = n => String(n).padStart(2, '0');
      dt.value = `${nxt.getFullYear()}-${pad(nxt.getMonth()+1)}-${pad(nxt.getDate())}T${pad(nxt.getHours())}:${pad(nxt.getMinutes())}`;
    }
    showToast('Reminder created!', 'success');

    // Prompt for notification permission if not yet decided
    if (Notification.permission === 'default') {
      setTimeout(requestNotificationPermission, 800);
    }
  } catch (err) {
    showToast('Network error', 'error');
  } finally {
    btn.disabled = false;
  }
}

async function markReminderDone(id) {
  try {
    const res = await apiFetch(`/reminders/${id}/notify`, { method: 'PATCH', body: '{}' });
    if (!res || !res.ok) { showToast('Failed to mark as done', 'error'); return; }
    const updated = await res.json();
    const idx = allReminders.findIndex(r => r.id === id);
    if (idx !== -1) allReminders[idx] = updated;
    renderStats();
    renderReminderList();
    showToast('Reminder marked as done ✔', 'success');
    // Notify other tabs (e.g. dashboard) so they refresh their reminder count
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        const ch = new BroadcastChannel('lh_reminder_poller');
        ch.postMessage('notified');
        ch.close();
      } catch (_) {}
    }
  } catch (e) { showToast('Network error', 'error'); }
}

async function deleteReminder(id) {
  if (!confirm('Delete this reminder?')) return;
  try {
    const res = await apiFetch(`/reminders/${id}`, { method: 'DELETE' });
    if (!res.ok) { showToast('Failed to delete', 'error'); return; }
    allReminders = allReminders.filter(r => r.id !== id);
    renderStats();
    renderReminderList();
    showToast('Reminder deleted', 'success');
  } catch (e) { showToast('Network error', 'error'); }
}

// escHtml is defined in app.js