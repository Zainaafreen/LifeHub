/* tasks.js */

let allTasks = [];

document.addEventListener('DOMContentLoaded', () => {
  requireAuth();
  loadTasks();

  document.getElementById('add-task-btn')?.addEventListener('click', () => openModal('task-modal'));
  document.getElementById('task-form')?.addEventListener('submit', handleCreateTask);
  document.getElementById('edit-task-form')?.addEventListener('submit', handleEditTask);
  document.getElementById('task-filter')?.addEventListener('change', renderTaskList);
  document.getElementById('priority-filter')?.addEventListener('change', renderTaskList);

  // Event delegation — handles clicks on task-check, Edit, and Delete buttons
  document.getElementById('tasks-list')?.addEventListener('click', (e) => {
    // Toggle checkbox
    const check = e.target.closest('.task-check[data-task-id]');
    if (check) {
      const id = Number(check.dataset.taskId);
      const completed = check.dataset.completed === 'true';
      toggleTask(id, !completed);
      return;
    }

    // Edit button
    const editBtn = e.target.closest('.btn-edit-task');
    if (editBtn) {
      openEditModal(Number(editBtn.dataset.taskId));
      return;
    }

    // Delete button
    const deleteBtn = e.target.closest('.btn-delete-task');
    if (deleteBtn) {
      deleteTask(Number(deleteBtn.dataset.taskId));
      return;
    }
  });
});

async function loadTasks() {
  const el = document.getElementById('tasks-list');
  el.innerHTML = spinner();
  try {
    const res = await apiFetch('/tasks');
    if (!res || !res.ok) { el.innerHTML = '<p class="text-muted text-sm">Failed to load tasks.</p>'; return; }
    allTasks = await res.json();
    renderStats();
    renderTaskList();
  } catch (e) {
    el.innerHTML = '<p class="text-muted text-sm">Failed to load tasks.</p>';
  }
}

function renderStats() {
  const total     = allTasks.length;
  const completed = allTasks.filter(t => t.completed).length;
  const high      = allTasks.filter(t => t.priority === 'high' && !t.completed).length;
  document.getElementById('tstat-total').textContent     = total;
  document.getElementById('tstat-completed').textContent = completed;
  document.getElementById('tstat-pending').textContent   = total - completed;
  document.getElementById('tstat-high').textContent      = high;
}

function renderTaskList() {
  const el            = document.getElementById('tasks-list');
  const statusFilter  = document.getElementById('task-filter')?.value   || 'all';
  const priorityFilter = document.getElementById('priority-filter')?.value || 'all';

  let tasks = allTasks;
  if (statusFilter   === 'pending')   tasks = tasks.filter(t => !t.completed);
  if (statusFilter   === 'completed') tasks = tasks.filter(t => t.completed);
  if (priorityFilter !== 'all')       tasks = tasks.filter(t => t.priority === priorityFilter);

  if (!tasks.length) {
    el.innerHTML = emptyState('✅', 'No tasks here', 'Try a different filter or add a new task.');
    return;
  }

  el.innerHTML = '<div class="task-list">' +
    tasks.map(t =>
      '<div class="task-item" id="task-row-' + t.id + '">' +
        '<div class="task-check ' + (t.completed ? 'checked' : '') + '"' +
             ' data-task-id="' + t.id + '"' +
             ' data-completed="' + t.completed + '"' +
             ' style="cursor:pointer">' +
          (t.completed ? '✓' : '') +
        '</div>' +
        '<div class="task-info">' +
          '<div class="task-title ' + (t.completed ? 'done' : '') + '">' +
            escHtml(t.title) +
            '<span class="priority-pill" style="background:' + PRIORITY_BG[t.priority] + ';color:' + PRIORITY_COLOR[t.priority] + ';' +
              'font-size:0.65rem;font-weight:700;padding:2px 7px;border-radius:20px;' +
              'margin-left:6px;text-transform:uppercase;letter-spacing:0.5px;vertical-align:middle">' +
              t.priority +
            '</span>' +
          '</div>' +
          '<div class="task-meta">Added ' + fmtDate(t.created_at) + '</div>' +
        '</div>' +
        '<div class="table-actions">' +
          '<button class="btn btn-sm btn-outline btn-edit-task" data-task-id="' + t.id + '">Edit</button>' +
          '<button class="btn btn-sm btn-danger btn-delete-task" data-task-id="' + t.id + '">Delete</button>' +
        '</div>' +
      '</div>'
    ).join('') +
  '</div>';
}

async function handleCreateTask(e) {
  e.preventDefault();
  const title    = document.getElementById('task-title').value.trim();
  const priority = document.getElementById('task-priority').value;
  if (!title) { showToast('Task title is required', 'warning'); return; }

  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    const res  = await apiFetch('/tasks', { method: 'POST', body: JSON.stringify({ title, priority }) });
    if (!res || !res.ok) {
      let msg = 'Failed to create task';
      try { const body = await res?.json(); msg = body?.error || msg; } catch (_) {}
      showToast(msg, 'error');
      return;
    }
    const task = await res.json();
    allTasks.unshift(task);
    renderStats();
    renderTaskList();
    closeModal('task-modal');
    e.target.reset();
    showToast('Task created!', 'success');
  } catch (e) { showToast('Network error', 'error'); }
  finally { btn.disabled = false; }
}

async function toggleTask(id, completed) {
  id = Number(id);
  completed = (completed === true || completed === 'true');
  const idx = allTasks.findIndex(t => Number(t.id) === id);
  if (idx === -1) return;
  const previous = { ...allTasks[idx] };
  allTasks[idx] = { ...allTasks[idx], completed };
  renderStats();
  renderTaskList();

  try {
    const res = await apiFetch('/tasks/' + id, { method: 'PATCH', body: JSON.stringify({ completed }) });
    if (!res || !res.ok) {
      allTasks[idx] = previous;
      renderStats();
      renderTaskList();
      showToast('Failed to update task', 'error');
      return;
    }
    const updated = await res.json();
    allTasks[idx] = updated;
    renderStats();
    renderTaskList();
  } catch (e) {
    allTasks[idx] = previous;
    renderStats();
    renderTaskList();
    showToast('Network error', 'error');
  }
}

function openEditModal(id) {
  const task = allTasks.find(t => t.id === id);
  if (!task) return;
  document.getElementById('edit-task-id').value       = id;
  document.getElementById('edit-task-title').value    = task.title;
  document.getElementById('edit-task-priority').value = task.priority || 'medium';
  openModal('edit-task-modal');
}

async function handleEditTask(e) {
  e.preventDefault();
  const id       = document.getElementById('edit-task-id').value;
  const title    = document.getElementById('edit-task-title').value.trim();
  const priority = document.getElementById('edit-task-priority').value;
  if (!title) { showToast('Title is required', 'warning'); return; }

  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    const res = await apiFetch('/tasks/' + id, { method: 'PATCH', body: JSON.stringify({ title, priority }) });
    if (!res || !res.ok) {
      let msg = 'Update failed';
      try { const body = await res?.json(); msg = body?.error || msg; } catch (_) {}
      showToast(msg, 'error');
      return;
    }
    const updated = await res.json();
    const idx = allTasks.findIndex(t => t.id == id);
    if (idx !== -1) allTasks[idx] = updated;
    renderStats();
    renderTaskList();
    closeModal('edit-task-modal');
    showToast('Task updated!', 'success');
  } catch (e) { showToast('Network error', 'error'); }
  finally { btn.disabled = false; }
}

async function deleteTask(id) {
  if (!confirm('Delete this task?')) return;
  try {
    const res = await apiFetch('/tasks/' + id, { method: 'DELETE' });
    if (!res || !res.ok) { showToast('Failed to delete task', 'error'); return; }
    allTasks = allTasks.filter(t => t.id !== id);
    renderStats();
    renderTaskList();
    showToast('Task deleted', 'success');
  } catch (e) { showToast('Network error', 'error'); }
}

// escHtml is defined in app.js