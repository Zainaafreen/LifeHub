/* dashboard.js */

let dashTasks = [];

// Listen for reminder notifications from the poller or reminders page
// so the dashboard count and list update without a full page reload.
if (typeof BroadcastChannel !== 'undefined') {
  const _dashCh = new BroadcastChannel('lh_reminder_poller');
  _dashCh.onmessage = async (e) => {
    if (e.data === 'notified') {
      // Re-fetch just the reminder section from the dashboard API
      try {
        const res = await apiFetch('/dashboard');
        if (res && res.ok) {
          const data = await res.json();
          document.getElementById('stat-reminders').textContent = data.upcomingReminders.length;
          renderReminders(data.upcomingReminders);
        }
      } catch (_) {}
    }
  };
}

document.addEventListener('DOMContentLoaded', async () => {
  requireAuth();

  if (!getUser()) {
    try {
      const res = await apiFetch('/auth/me');
      if (res && res.ok) { const u = await res.json(); setUser(u); initSidebar(); }
    } catch (_) {}
  }

  // Fix #2: make every stat card navigate to its page
  document.querySelectorAll('.stats-grid .stat-card').forEach(card => {
    card.style.cursor = 'pointer';
  });
  document.querySelector('.stat-card.peach')?.addEventListener('click',
    () => window.location.href = '/pages/tasks.html');
  document.querySelector('.stat-card.mint')?.addEventListener('click',
    () => window.location.href = '/pages/expenses.html');
  document.querySelector('.stat-card.rose')?.addEventListener('click',
    () => window.location.href = '/pages/health.html');
  document.querySelector('.stat-card.lavender')?.addEventListener('click',
    () => window.location.href = '/pages/reminders.html');

  loadDashboard();
});

async function loadDashboard() {
  try {
    const res = await apiFetch('/dashboard');
    if (!res || !res.ok) { showToast('Failed to load dashboard', 'error'); return; }
    const data = await res.json();
    renderStats(data);
    renderTasks();
    renderReminders(data.upcomingReminders);
    renderExpenses();
    renderHealth();
  } catch (err) {
    console.error('Dashboard error:', err);
    showToast('Dashboard load failed', 'error');
  }
}

function renderStats(data) {
  document.getElementById('stat-tasks').textContent     = data.tasks.total;
  document.getElementById('stat-tasks-sub').textContent = data.tasks.completed + ' done · ' + data.tasks.pending + ' pending';
  document.getElementById('stat-balance').textContent     = fmtCurrency(data.balance);
  document.getElementById('stat-balance-sub').textContent = data.balance >= 0 ? 'Net positive' : 'Net negative';
  const h = data.latestHealth;
  document.getElementById('stat-heart').textContent = h ? ((h.heartbeat || '—') + ' bpm') : '—';
  document.getElementById('stat-reminders').textContent = data.upcomingReminders.length;
}

/* Fix #1 — load tasks with interactive checkboxes */
async function renderTasks() {
  const el = document.getElementById('dash-tasks');
  el.innerHTML = spinner();
  try {
    const res = await apiFetch('/tasks');
    if (!res || !res.ok) {
      el.innerHTML = '<p class="text-muted text-sm">Could not load tasks.</p>';
      return;
    }
    dashTasks = await res.json();
    if (!Array.isArray(dashTasks)) { dashTasks = []; }
    if (!dashTasks.length) {
      el.innerHTML = emptyState('✅', 'No tasks yet', 'Add your first task on the Tasks page.');
      return;
    }
    paintDashTasks(el);

    // Event delegation for task checkbox toggle — attached once here
    el.addEventListener('click', (e) => {
      const check = e.target.closest('.task-check[data-task-id]');
      if (check) {
        const id = Number(check.dataset.taskId);
        const completed = check.dataset.completed === 'true';
        dashToggleTask(id, !completed);
      }
    });
  } catch (e) {
    el.innerHTML = '<p class="text-muted text-sm">Could not load tasks.</p>';
  }
}

function paintDashTasks(el) {
  const visible = dashTasks.slice(0, 5);
  el.innerHTML = '<div class="task-list">' +
    visible.map(t =>
      '<div class="task-item" id="dtask-' + t.id + '">' +
        '<div class="task-check ' + (t.completed ? 'checked' : '') + '"' +
             ' data-task-id="' + t.id + '"' +
             ' data-completed="' + t.completed + '"' +
             ' title="' + (t.completed ? 'Mark incomplete' : 'Mark complete') + '"' +
             ' style="cursor:pointer">' +
          (t.completed ? '✓' : '') +
        '</div>' +
        '<div class="task-info">' +
          '<div class="task-title ' + (t.completed ? 'done' : '') + '">' +
            '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;' +
                         'background:' + (PRIORITY_COLOR[t.priority] || PRIORITY_COLOR.medium) + ';' +
                         'margin-right:6px;vertical-align:middle"></span>' + escHtml(t.title) +
          '</div>' +
          '<div class="task-meta">' + fmtDate(t.created_at) + ' · ' + capitalize(t.priority || 'medium') + ' priority</div>' +
        '</div>' +
      '</div>'
    ).join('') +
    (dashTasks.length > 5
      ? '<div style="padding:10px 0 2px;text-align:center">' +
          '<a href="/pages/tasks.html" class="text-sm text-purple font-semibold">+ ' + (dashTasks.length - 5) + ' more →</a>' +
        '</div>'
      : '') +
  '</div>';
}

/* Fix #1 — toggle hits API, updates state, re-paints */
async function dashToggleTask(id, completed) {
  id = Number(id);
  completed = (completed === true || completed === 'true');
  const item = document.getElementById('dtask-' + id);
  if (item) item.style.opacity = '0.5';
  try {
    const res = await apiFetch('/tasks/' + id, {
      method: 'PATCH',
      body: JSON.stringify({ completed }),
    });
    if (!res || !res.ok) {
      showToast('Failed to update task', 'error');
      if (item) item.style.opacity = '';
      return;
    }
    const updated = await res.json();
    const idx = dashTasks.findIndex(t => Number(t.id) === id);
    if (idx !== -1) dashTasks[idx] = updated;
    paintDashTasks(document.getElementById('dash-tasks'));
    const doneCount = dashTasks.filter(t => t.completed).length;
    document.getElementById('stat-tasks').textContent     = dashTasks.length;
    document.getElementById('stat-tasks-sub').textContent = doneCount + ' done · ' + (dashTasks.length - doneCount) + ' pending';
    showToast(completed ? 'Task completed ✓' : 'Marked incomplete', 'success');
  } catch (e) {
    showToast('Network error', 'error');
    if (item) item.style.opacity = '';
  }
}

function renderReminders(reminders) {
  const el = document.getElementById('dash-reminders');
  if (!reminders || !reminders.length) {
    el.innerHTML = emptyState('🔔', 'No upcoming reminders', 'Create reminders to stay on track.');
    return;
  }
  el.innerHTML = '<div class="task-list">' +
    reminders.map(r => {
      const msLeft   = new Date(r.remind_at) - Date.now();
      const minsLeft = Math.round(msLeft / 60000);
      const timeLabel = minsLeft < 60
        ? 'in ' + minsLeft + ' min'
        : minsLeft < 1440
          ? 'in ' + Math.round(minsLeft / 60) + 'h'
          : fmtDateTime(r.remind_at);
      return '<div class="task-item dash-reminder-item" style="cursor:pointer">' +
        '<div class="task-check">🔔</div>' +
        '<div class="task-info">' +
          '<div class="task-title">' + escHtml(r.title) + '</div>' +
          '<div class="task-meta">' + timeLabel + '</div>' +
        '</div>' +
      '</div>';
    }).join('') +
  '</div>';

  // Event delegation for reminder navigation
  el.addEventListener('click', (e) => {
    if (e.target.closest('.dash-reminder-item')) {
      window.location.href = '/pages/reminders.html';
    }
  });
}

async function renderExpenses() {
  const el = document.getElementById('dash-expenses');
  el.innerHTML = spinner();
  try {
    const res = await apiFetch('/expenses/summary');
    const s = await res.json();
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:grid;gap:10px;cursor:pointer';
    wrapper.innerHTML =
      '<div class="stat-card mint" style="border-radius:var(--radius-sm)">' +
        '<div class="stat-icon">⬆️</div>' +
        '<div class="stat-info">' +
          '<div class="stat-label">Income</div>' +
          '<div class="stat-value" style="font-size:1.2rem">' + fmtCurrency(s.total_income) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="stat-card rose" style="border-radius:var(--radius-sm)">' +
        '<div class="stat-icon">⬇️</div>' +
        '<div class="stat-info">' +
          '<div class="stat-label">Expenses</div>' +
          '<div class="stat-value" style="font-size:1.2rem">' + fmtCurrency(s.total_expenses) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="stat-card ' + (s.balance >= 0 ? 'lavender' : 'peach') + '" style="border-radius:var(--radius-sm)">' +
        '<div class="stat-icon">💰</div>' +
        '<div class="stat-info">' +
          '<div class="stat-label">Balance</div>' +
          '<div class="stat-value" style="font-size:1.2rem">' + fmtCurrency(s.balance) + '</div>' +
        '</div>' +
      '</div>';
    wrapper.addEventListener('click', () => window.location.href = '/pages/expenses.html');
    el.innerHTML = '';
    el.appendChild(wrapper);
  } catch (e) { el.innerHTML = '<p class="text-muted text-sm">Could not load expenses.</p>'; }
}

async function renderHealth() {
  const el = document.getElementById('dash-health');
  el.innerHTML = spinner();
  try {
    const res = await apiFetch('/health/latest');
    const r = await res.json();
    if (!r) {
      el.innerHTML = emptyState('❤️', 'No health records', 'Log your first health reading.');
      return;
    }
    const CLASS_COLORS = { normal:'var(--green)', moderate:'var(--amber)', high:'var(--red)', critical:'var(--red)', low:'var(--blue)' };
    function miniCard(label, value, cls) {
      return '<div style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 12px">' +
        '<div class="stat-label">' + label + '</div>' +
        '<div style="font-weight:700;font-size:1rem;color:' + (CLASS_COLORS[cls] || 'var(--text)') + '">' + value + '</div>' +
      '</div>';
    }

    const container = document.createElement('div');
    const metaDiv = document.createElement('div');
    metaDiv.className = 'task-meta mb-2';
    metaDiv.style.cursor = 'pointer';
    metaDiv.innerHTML = fmtDateTime(r.recorded_at) + ' — <span class="text-purple">View full analysis →</span>';
    metaDiv.addEventListener('click', () => window.location.href = '/pages/health.html');

    const gridDiv = document.createElement('div');
    gridDiv.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;cursor:pointer';
    gridDiv.innerHTML =
      (r.heartbeat   ? miniCard('Heart Rate',     r.heartbeat + ' bpm',           r.hr_class    || 'normal') : '') +
      (r.systolic    ? miniCard('Blood Pressure', r.systolic + '/' + r.diastolic, r.bp_class    || 'normal') : '') +
      (r.blood_sugar ? miniCard('Blood Sugar',    r.blood_sugar + ' mg/dL',       r.sugar_class || 'normal') : '');
    gridDiv.addEventListener('click', () => window.location.href = '/pages/health.html');

    container.appendChild(metaDiv);
    container.appendChild(gridDiv);
    if (r.notes) {
      const notes = document.createElement('p');
      notes.className = 'text-sm text-muted mt-3';
      notes.textContent = r.notes;
      container.appendChild(notes);
    }

    el.innerHTML = '';
    el.appendChild(container);
  } catch (e) { el.innerHTML = '<p class="text-muted text-sm">Could not load health data.</p>'; }
}

function capitalize(s) { return String(s).charAt(0).toUpperCase() + String(s).slice(1); }