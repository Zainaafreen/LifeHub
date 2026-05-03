/* expenses.js */

let allExpenses = [];
let currentPage = 1;
let totalPages  = 1;
const PAGE_SIZE = 50;

document.addEventListener('DOMContentLoaded', () => {
  requireAuth();
  loadExpenses(1);

  // Pre-fill today's date
  const d = document.getElementById('exp-date');
  if (d) d.value = new Date().toISOString().split('T')[0];

  document.getElementById('add-expense-btn')?.addEventListener('click', () => openModal('expense-modal'));
  document.getElementById('expense-form')?.addEventListener('submit', handleCreateExpense);
  document.getElementById('expense-filter')?.addEventListener('change', () => loadExpenses(1));

  // Event delegation for dynamically-rendered table buttons and pagination
  document.addEventListener('click', (e) => {
    // Pagination
    const pageBtn = e.target.closest('[data-page]');
    if (pageBtn && !pageBtn.disabled) {
      loadExpenses(Number(pageBtn.dataset.page));
      return;
    }
    // Delete expense
    const delBtn = e.target.closest('[data-delete-expense]');
    if (delBtn) {
      deleteExpense(Number(delBtn.dataset.deleteExpense));
    }
  });
});

async function loadExpenses(page = 1) {
  currentPage = page;
  const el = document.getElementById('expenses-table-body');
  if (el) el.innerHTML = `<tr><td colspan="6">${spinner()}</td></tr>`;

  try {
    const filter = document.getElementById('expense-filter')?.value || 'all';
    const typeParam = filter !== 'all' ? `&type=${filter}` : '';
    const [expRes, sumRes] = await Promise.all([
      apiFetch(`/expenses?page=${page}&limit=${PAGE_SIZE}${typeParam}`),
      apiFetch('/expenses/summary'),
    ]);

    if (!expRes || !expRes.ok || !sumRes || !sumRes.ok) {
      if (el) el.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-muted)">Failed to load expenses.</td></tr>`;
      showToast('Failed to load expenses', 'error');
      return;
    }

    const expData = await expRes.json();
    const summary = await sumRes.json();

    // Handle paginated response shape { data, pagination }
    allExpenses = Array.isArray(expData) ? expData : (expData.data || []);
    if (expData.pagination) {
      totalPages = expData.pagination.pages || 1;
    }

    renderSummary(summary);
    renderExpenseTable();
    renderPagination();
  } catch (e) {
    showToast('Failed to load expenses', 'error');
  }
}

function renderPagination() {
  let container = document.getElementById('expenses-pagination');
  if (!container) {
    container = document.createElement('div');
    container.id = 'expenses-pagination';
    container.style.cssText = 'display:flex;justify-content:center;align-items:center;gap:12px;padding:16px 0;';
    document.getElementById('expenses-table-body')?.closest('table')?.insertAdjacentElement('afterend', container);
  }
  if (totalPages <= 1) { container.innerHTML = ''; return; }

  container.innerHTML = `
    <button class="btn btn-sm" data-page="${currentPage - 1}" ${currentPage <= 1 ? 'disabled' : ''}>← Prev</button>
    <span style="color:var(--text-muted);font-size:0.875rem">Page ${currentPage} of ${totalPages}</span>
    <button class="btn btn-sm" data-page="${currentPage + 1}" ${currentPage >= totalPages ? 'disabled' : ''}>Next →</button>
  `;
}

function renderSummary(s) {
  document.getElementById('estat-income').textContent   = fmtCurrency(s.total_income);
  document.getElementById('estat-expense').textContent  = fmtCurrency(s.total_expenses);
  document.getElementById('estat-balance').textContent  = fmtCurrency(s.balance);
  const balCard = document.getElementById('balance-stat-card');
  if (balCard) {
    balCard.className = `stat-card ${s.balance >= 0 ? 'mint' : 'rose'}`;
  }
}

function renderExpenseTable() {
  const tbody  = document.getElementById('expenses-table-body');
  const rows = allExpenses;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-muted)">No transactions found.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(e => `
    <tr>
      <td>${fmtDate(e.date)}</td>
      <td><span class="badge ${e.type === 'income' ? 'badge-success' : 'badge-danger'}">${e.type}</span></td>
      <td>${escHtml(e.category)}</td>
      <td>${escHtml(e.description || '—')}</td>
      <td class="${e.type === 'income' ? 'text-success' : 'text-danger'} font-semibold">
        ${e.type === 'income' ? '+' : '-'}${fmtCurrency(e.amount)}
      </td>
      <td>
        <button class="btn btn-sm btn-danger" data-delete-expense="${e.id}">Delete</button>
      </td>
    </tr>`).join('');
}

async function handleCreateExpense(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;

  const payload = {
    type:        document.getElementById('exp-type').value,
    category:    document.getElementById('exp-category').value.trim(),
    amount:      parseFloat(document.getElementById('exp-amount').value),
    description: document.getElementById('exp-description').value.trim() || null,
    date:        document.getElementById('exp-date').value || undefined,
  };

  if (!payload.category || !payload.amount) {
    showToast('Category and amount are required', 'warning');
    btn.disabled = false;
    return;
  }

  try {
    const res = await apiFetch('/expenses', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Failed to add', 'error'); return; }

    closeModal('expense-modal');
    e.target.reset();

    // Reload page 1 to include the new record
    await loadExpenses(1);
    showToast('Transaction added!', 'success');
  } catch (err) {
    showToast('Network error', 'error');
  } finally {
    btn.disabled = false;
  }
}

async function deleteExpense(id) {
  if (!confirm('Delete this transaction?')) return;
  try {
    const res = await apiFetch(`/expenses/${id}`, { method: 'DELETE' });
    if (!res.ok) { showToast('Failed to delete', 'error'); return; }

    // If last item on page > 1, go back a page
    const newPage = (allExpenses.length === 1 && currentPage > 1) ? currentPage - 1 : currentPage;
    await loadExpenses(newPage);
    showToast('Transaction deleted', 'success');
  } catch (e) { showToast('Network error', 'error'); }
}

