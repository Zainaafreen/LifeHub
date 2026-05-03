/* health.js — Emergency alerts, smart validation, trend analysis */

let allRecords = [];

const CLASS_LABEL = { normal: 'Normal', moderate: 'Moderate', high: 'High', critical: 'Critical', low: 'Low' };
const CLASS_COLOR = {
  normal:   { bg: 'var(--mint)',   text: 'var(--mint-text)',   border: 'var(--mint-border)'   },
  moderate: { bg: 'var(--butter)', text: 'var(--butter-text)', border: 'var(--butter-border)' },
  high:     { bg: 'var(--rose)',   text: 'var(--rose-text)',   border: 'var(--rose-border)'   },
  critical: { bg: 'var(--rose)',   text: 'var(--red)',         border: 'var(--rose-border)'   },
  low:      { bg: 'var(--sky)',    text: 'var(--sky-text)',    border: 'var(--sky-border)'    },
};

// ── Fix #5: Thresholds fetched from /api/health/thresholds ──
// No more hardcoded duplicates — the backend is the single source of truth.
// T is populated once on page load; functions that need it wait for tReady.
let T = null;
let tReady = null; // Promise that resolves once T is loaded

async function loadThresholds() {
  try {
    const res = await apiFetch('/health/thresholds');
    T = await res.json();
  } catch (_) {
    // Fallback so the page still works if the request fails
    T = {
      hr:    { emergencyLow: 50, criticalLow: 40, criticalHigh: 150, high: 100, moderateHigh: 90 },
      bp:    { emergencySys: 80, emergencyDia: 50, criticalSys: 180, criticalDia: 120,
               highSys: 140, highDia: 90, moderateSys: 130, moderateDia: 80, lowSys: 90, lowDia: 60 },
      sugar: { emergency: 70, critical: 300, high: 140, moderate: 100, low: 70 },
    };
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  requireAuth();

  // Fetch thresholds first, then load records (so classifiers have T ready)
  tReady = loadThresholds();
  await tReady;

  loadRecords();

  document.getElementById('add-health-btn')?.addEventListener('click', () => openModal('health-modal'));
  document.getElementById('health-form')?.addEventListener('submit', handleCreateRecord);

  // ── Real-time input validation warnings ──────────────────
  ['h-heart', 'h-systolic', 'h-diastolic', 'h-sugar'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', validateInputsLive);
  });

  // ── Event delegation for dynamically-rendered table buttons ──
  document.addEventListener('click', (e) => {
    const analyseBtn = e.target.closest('[data-analyse-id]');
    if (analyseBtn) { showAnalysis(Number(analyseBtn.dataset.analyseId)); return; }

    const deleteBtn = e.target.closest('[data-delete-health]');
    if (deleteBtn) { deleteRecord(Number(deleteBtn.dataset.deleteHealth)); return; }

    const pageBtn = e.target.closest('[data-health-page]');
    if (pageBtn && !pageBtn.disabled) { loadRecords(Number(pageBtn.dataset.healthPage)); }
  });
});

// ── Live validation: warn before user even submits ──────────
function validateInputsLive() {
  if (!T) return; // thresholds not loaded yet
  const hr  = parseFloat(document.getElementById('h-heart')?.value)    || null;
  const sys = parseFloat(document.getElementById('h-systolic')?.value)  || null;
  const dia = parseFloat(document.getElementById('h-diastolic')?.value) || null;
  const bs  = parseFloat(document.getElementById('h-sugar')?.value)     || null;

  const warnings = [];

  if (hr !== null) {
    if (hr < T.hr.criticalLow || hr > T.hr.criticalHigh) {
      warnings.push(`🚨 Heart rate of ${hr} bpm is a critical value. Please re-check your reading before saving.`);
    } else if (hr < T.hr.emergencyLow) {
      warnings.push(`⚠️ Heart rate of ${hr} bpm is dangerously low (bradycardia). Please confirm this is correct.`);
    }
  }

  if (sys !== null) {
    if (sys < T.bp.emergencySys) {
      warnings.push(`🚨 Systolic BP of ${sys} mmHg is critically low — life-threatening. Please re-check before saving.`);
    }
    if (sys > T.bp.criticalSys) {
      warnings.push(`🚨 Systolic BP of ${sys} mmHg is dangerously high. Please re-check before saving.`);
    }
  }
  if (dia !== null && dia < T.bp.emergencyDia && sys !== null) {
    warnings.push(`⚠️ Diastolic BP of ${dia} mmHg is very low. Please confirm this reading.`);
  }

  if (bs !== null && bs < T.sugar.emergency) {
    warnings.push(`⚠️ Blood sugar of ${bs} mg/dL is below ${T.sugar.emergency} — hypoglycaemia risk. Confirm reading and eat immediately if correct.`);
  }

  // Multi-metric combined warning
  const dangerCount = [
    hr  !== null && hr  < T.hr.emergencyLow,
    sys !== null && sys < T.bp.emergencySys,
    bs  !== null && bs  < T.sugar.emergency,
  ].filter(Boolean).length;
  if (dangerCount >= 2) {
    warnings.unshift('🚨 MULTIPLE critical values detected. If these readings are accurate, call emergency services immediately.');
  }

  renderValidationWarnings(warnings);
}

function renderValidationWarnings(warnings) {
  let box = document.getElementById('input-warnings');
  if (!warnings.length) { if (box) box.remove(); return; }

  if (!box) {
    box = document.createElement('div');
    box.id = 'input-warnings';
    const form = document.getElementById('health-form');
    form.insertBefore(box, form.querySelector('.modal-footer'));
  }
  box.innerHTML = warnings.map(w => `
    <div style="background:var(--rose);border:1px solid var(--rose-border);
                border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:8px;
                font-size:0.83rem;color:var(--red);font-weight:500">
      ${w}
    </div>`).join('');
}

// ── Load records + trigger trend panel ─────────────────────
let healthCurrentPage = 1;
let healthTotalPages  = 1;
const HEALTH_PAGE_SIZE = 50;

async function loadRecords(page = 1) {
  healthCurrentPage = page;
  const el = document.getElementById('health-table-body');
  if (el) el.innerHTML = `<tr><td colspan="7">${spinner()}</td></tr>`;

  try {
    const [recRes, trendRes] = await Promise.all([
      apiFetch(`/health?page=${page}&limit=${HEALTH_PAGE_SIZE}`),
      apiFetch('/health/trend'),
    ]);
    const recData = await recRes.json();
    const trend   = await trendRes.json();

    allRecords = Array.isArray(recData) ? recData : (recData.data || []);
    if (recData.pagination) {
      healthTotalPages = recData.pagination.pages || 1;
    }

    renderLatestStats();
    renderTrendPanel(trend);
    renderTable();
    renderHealthPagination();
  } catch (e) {
    showToast('Failed to load health records', 'error');
  }
}

function renderHealthPagination() {
  let container = document.getElementById('health-pagination');
  if (!container) {
    container = document.createElement('div');
    container.id = 'health-pagination';
    container.style.cssText = 'display:flex;justify-content:center;align-items:center;gap:12px;padding:16px 0;';
    document.getElementById('health-table-body')?.closest('table')?.insertAdjacentElement('afterend', container);
  }
  if (healthTotalPages <= 1) { container.innerHTML = ''; return; }

  container.innerHTML = `
    <button class="btn btn-sm" data-health-page="${healthCurrentPage - 1}" ${healthCurrentPage <= 1 ? 'disabled' : ''}>← Prev</button>
    <span style="color:var(--text-muted);font-size:0.875rem">Page ${healthCurrentPage} of ${healthTotalPages}</span>
    <button class="btn btn-sm" data-health-page="${healthCurrentPage + 1}" ${healthCurrentPage >= healthTotalPages ? 'disabled' : ''}>Next →</button>
  `;
}

function renderLatestStats() {
  if (!allRecords.length) return;
  const r = allRecords[0];
  document.getElementById('hstat-heart').textContent    = r.heartbeat   ? `${r.heartbeat} bpm`                       : '—';
  document.getElementById('hstat-systolic').textContent = r.systolic    ? `${r.systolic}/${r.diastolic || '?'} mmHg`  : '—';
  document.getElementById('hstat-sugar').textContent    = r.blood_sugar ? `${r.blood_sugar} mg/dL`                    : '—';
  document.getElementById('hstat-date').textContent     = fmtDateTime(r.recorded_at);

  colourStatCard('hstat-heart-card',    classifyHR(r.heartbeat));
  colourStatCard('hstat-bp-card',       classifyBP(r.systolic, r.diastolic));
  colourStatCard('hstat-sugar-card',    classifySugar(r.blood_sugar));
}

function colourStatCard(cardId, cls) {
  const el = document.getElementById(cardId);
  if (!el) return;
  const palette = { normal:'mint', moderate:'butter', high:'rose', critical:'rose', low:'sky' };
  el.className = `stat-card ${palette[cls] || 'rose'}`;
}

// ── Trend Panel ─────────────────────────────────────────────
function renderTrendPanel(trend) {
  const panel = document.getElementById('trend-panel');
  const content = document.getElementById('trend-content');
  if (!panel || !content) return;
  if (!trend || !trend.analysed || !trend.analysed.length) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = '';

  const RISK_META = {
    emergency: { label: '🚨 EMERGENCY',    bg: 'var(--rose)',   text: 'var(--red)',          border: 'var(--rose-border)'   },
    critical:  { label: '🚨 Critical',     bg: 'var(--rose)',   text: 'var(--red)',          border: 'var(--rose-border)'   },
    high:      { label: '⚠️ High Risk',    bg: 'var(--butter)', text: 'var(--butter-text)',  border: 'var(--butter-border)' },
    moderate:  { label: '🟡 Moderate',     bg: 'var(--butter)', text: 'var(--butter-text)',  border: 'var(--butter-border)' },
    normal:    { label: '✅ Normal',        bg: 'var(--mint)',   text: 'var(--mint-text)',    border: 'var(--mint-border)'   },
  };

  const risk = RISK_META[trend.overallRisk] || RISK_META.normal;

  const trendArrow = { up: '↑', down: '↓', stable: '→' };
  const trendColor = {
    heartbeat:   { up: 'var(--amber)', down: 'var(--blue)', stable: 'var(--text-muted)' },
    systolic:    { up: 'var(--red)',   down: 'var(--green)', stable: 'var(--text-muted)' },
    blood_sugar: { up: 'var(--amber)', down: 'var(--blue)', stable: 'var(--text-muted)' },
  };

  const allAlerts    = [...new Set(trend.analysed.flatMap(a => a.alerts))];
  const hasSOS       = trend.analysed.some(a => a.sosRequired);
  const hasEmergency = trend.analysed.some(a => a.emergencyRequired);

  content.innerHTML = `
    <div style="background:${risk.bg};border:1px solid ${risk.border};
                border-radius:var(--radius-sm);padding:14px 18px;
                display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <div>
        <div style="font-weight:700;font-size:1.1rem;color:${risk.text}">${risk.label}</div>
        <div style="font-size:0.8rem;color:var(--text-muted);margin-top:2px">
          Based on your last ${trend.analysed.length} reading${trend.analysed.length > 1 ? 's' : ''}
        </div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px">
      ${[
        ['❤️', 'Heart Rate',   'heartbeat',   trend.trends.heartbeat],
        ['🩸', 'Blood Press.', 'systolic',    trend.trends.systolic],
        ['🩺', 'Blood Sugar',  'blood_sugar', trend.trends.blood_sugar],
      ].map(([icon, label, key, dir]) => `
        <div style="background:var(--surface);border:1px solid var(--border);
                    border-radius:var(--radius-sm);padding:10px 12px;text-align:center">
          <div style="font-size:1.1rem">${icon}</div>
          <div style="font-size:0.72rem;color:var(--text-muted);margin:2px 0">${label}</div>
          <div style="font-size:1.3rem;font-weight:700;
                      color:${(trendColor[key] || {})[dir] || 'var(--text-muted)'}">
            ${trendArrow[dir] || '→'}
          </div>
          <div style="font-size:0.7rem;color:var(--text-muted)">${dir}</div>
        </div>`).join('')}
    </div>

    ${allAlerts.length ? `
    <div style="background:var(--rose);border:1px solid var(--rose-border);
                border-radius:var(--radius-sm);padding:12px 16px;margin-bottom:14px">
      <div style="font-weight:700;color:var(--red);margin-bottom:8px">⚠️ Alerts from recent readings</div>
      ${allAlerts.map(a => `
        <div style="font-size:0.83rem;color:var(--rose-text);margin-bottom:5px;padding-left:8px;
                    border-left:2px solid var(--red)">${escHtml(a)}</div>`).join('')}
    </div>` : ''}

    ${trend.suggestions.length ? `
    <div style="background:var(--sky);border:1px solid var(--sky-border);
                border-radius:var(--radius-sm);padding:12px 16px;margin-bottom:14px">
      <div style="font-weight:700;color:var(--blue);margin-bottom:8px">💡 Advice</div>
      ${trend.suggestions.map(s => `
        <div style="font-size:0.83rem;color:var(--sky-text);margin-bottom:5px">• ${escHtml(s)}</div>`).join('')}
    </div>` : ''}

    ${(hasSOS || hasEmergency) ? `
    <a href="tel:112" style="display:block;background:var(--red);color:#fff;
                              border-radius:var(--radius-sm);padding:14px;text-align:center;
                              font-weight:700;font-size:1rem;text-decoration:none;margin-top:4px">
      🆘 Call Emergency Services (112)
    </a>` : ''}
  `;
}

// ── History table ───────────────────────────────────────────
function renderTable() {
  const tbody = document.getElementById('health-table-body');
  if (!allRecords.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-muted)">No records yet. Log your first reading!</td></tr>`;
    return;
  }

  tbody.innerHTML = allRecords.map(r => {
    const hrCls    = classifyHR(r.heartbeat);
    const bpCls    = classifyBP(r.systolic, r.diastolic);
    const sugarCls = classifySugar(r.blood_sugar);
    const isEmergency = [hrCls, bpCls, sugarCls].some(c => c === 'critical');

    function pill(val, unit, cls) {
      if (!val) return '<span style="color:var(--text-light)">—</span>';
      const c = CLASS_COLOR[cls] || CLASS_COLOR.normal;
      return `<span style="background:${c.bg};color:${c.text};border:1px solid ${c.border};
                           padding:2px 8px;border-radius:20px;font-size:0.78rem;font-weight:600">
        ${val}${unit} <span style="opacity:.7;font-size:0.65rem">${CLASS_LABEL[cls] || ''}</span>
      </span>`;
    }

    return `<tr ${isEmergency ? 'style="background:var(--rose)"' : ''}>
      <td>
        ${isEmergency ? '<span style="color:var(--red);font-weight:700;font-size:0.75rem">🚨 EMERGENCY<br></span>' : ''}
        ${fmtDateTime(r.recorded_at)}
      </td>
      <td>${pill(r.heartbeat,   ' bpm',   hrCls)}</td>
      <td>${r.systolic ? pill(`${r.systolic}/${r.diastolic || '?'}`, ' mmHg', bpCls) : '<span style="color:var(--text-light)">—</span>'}</td>
      <td>${pill(r.blood_sugar, ' mg/dL', sugarCls)}</td>
      <td>${escHtml(r.notes || '—')}</td>
      <td><button class="btn btn-sm btn-outline" data-analyse-id="${r.id}">Analyse</button></td>
      <td><button class="btn btn-sm btn-danger" data-delete-health="${r.id}">Delete</button></td>
    </tr>`;
  }).join('');
}

// ── Per-record analysis modal ───────────────────────────────
function showAnalysis(id) {
  const r = allRecords.find(rec => rec.id === id);
  if (!r) return;
  renderAnalysisPanel(r, derivedAnalysis(r.heartbeat, r.systolic, r.diastolic, r.blood_sugar));
  openModal('analysis-modal');
}

function derivedAnalysis(heartbeat, systolic, diastolic, blood_sugar) {
  const t = T; // use fetched thresholds
  if (!t) return { alerts: [], suggestions: [], classifications: {}, sosRequired: false, emergencyRequired: false };

  const alerts = [], suggestions = [], classifications = {};
  let emergencyRequired = false, sosRequired = false;

  if (heartbeat) {
    const hr = Number(heartbeat);
    if (hr < t.hr.criticalLow || hr > t.hr.criticalHigh) {
      classifications.heartbeat = 'critical'; alerts.push(`Critical heart rate: ${hr} bpm — call emergency services.`); sosRequired = true;
    } else if (hr < t.hr.emergencyLow) {
      classifications.heartbeat = 'critical'; alerts.push(`Dangerously low heart rate: ${hr} bpm (bradycardia) — seek emergency care.`); emergencyRequired = true;
    } else if (hr > t.hr.high) {
      classifications.heartbeat = 'high'; alerts.push(`Elevated heart rate: ${hr} bpm (normal: 50–100 bpm).`); suggestions.push('Rest 15 min, avoid caffeine, re-measure.');
    } else if (hr > t.hr.moderateHigh) {
      classifications.heartbeat = 'moderate'; suggestions.push('Mildly elevated HR — try slow deep breathing.');
    } else {
      classifications.heartbeat = 'normal';
    }
  }

  if (systolic) {
    const sys = Number(systolic), dia = Number(diastolic || 0);
    if (sys > t.bp.criticalSys || dia > t.bp.criticalDia) {
      classifications.bp = 'critical'; alerts.push(`Hypertensive crisis: ${sys}/${dia} mmHg — call emergency services.`); sosRequired = true;
    } else if (sys < t.bp.emergencySys || dia < t.bp.emergencyDia) {
      classifications.bp = 'critical'; alerts.push(`Life-threatening low BP: ${sys}/${dia} mmHg — call emergency services.`); emergencyRequired = true;
    } else if (sys > t.bp.highSys || dia > t.bp.highDia) {
      classifications.bp = 'high'; alerts.push(`High BP: ${sys}/${dia} mmHg.`); suggestions.push('Reduce salt, rest, consult a doctor.');
    } else if (sys > t.bp.moderateSys || dia > t.bp.moderateDia) {
      classifications.bp = 'moderate'; suggestions.push('BP slightly elevated — monitor and limit caffeine.');
    } else if (sys < t.bp.lowSys || dia < t.bp.lowDia) {
      classifications.bp = 'low'; alerts.push(`Low BP: ${sys}/${dia} mmHg — dizziness risk.`); suggestions.push('Stay hydrated, eat small meals.');
    } else {
      classifications.bp = 'normal';
    }
  }

  if (blood_sugar) {
    const bs = parseFloat(blood_sugar);
    if (bs > t.sugar.critical) {
      classifications.blood_sugar = 'critical'; alerts.push(`Critically high blood sugar: ${bs} mg/dL — seek emergency care.`); sosRequired = true;
    } else if (bs > t.sugar.high) {
      classifications.blood_sugar = 'high'; alerts.push(`High blood sugar: ${bs} mg/dL.`); suggestions.push('Walk 15 min, avoid sugary foods.');
    } else if (bs > t.sugar.moderate) {
      classifications.blood_sugar = 'moderate'; suggestions.push('Slightly above normal — reduce refined carbs.');
    } else if (bs < t.sugar.emergency) {
      classifications.blood_sugar = 'low'; alerts.push(`Low blood sugar: ${bs} mg/dL — hypoglycaemia risk.`); suggestions.push('Eat 15g fast-acting carbs and re-test in 15 min.'); emergencyRequired = true;
    } else {
      classifications.blood_sugar = 'normal';
    }
  }

  const dangerCount = [
    classifications.heartbeat === 'critical',
    classifications.bp === 'critical',
    classifications.blood_sugar === 'low' || classifications.blood_sugar === 'critical',
  ].filter(Boolean).length;
  if (dangerCount >= 2) { emergencyRequired = true; alerts.unshift('⚠️ Multiple critical metrics — this is a medical emergency.'); }
  if (emergencyRequired) sosRequired = true;

  const conditions = [];
  if (classifications.bp === 'critical' && systolic < t.bp.emergencySys) conditions.push('Hypotension');
  if (classifications.blood_sugar === 'low')              conditions.push('Hypoglycaemia');
  if (classifications.heartbeat === 'critical' && heartbeat < t.hr.emergencyLow) conditions.push('Bradycardia');
  if (conditions.length >= 2) suggestions.unshift(`Possible combined condition: ${conditions.join(' + ')}. Do not wait — call emergency services.`);

  return { alerts, suggestions, classifications, sosRequired, emergencyRequired };
}

function renderAnalysisPanel(record, analysis) {
  const { alerts, suggestions, classifications, sosRequired, emergencyRequired } = analysis;

  const overallCls = emergencyRequired ? 'critical'
    : sosRequired ? 'critical'
    : Object.values(classifications).includes('high')     ? 'high'
    : Object.values(classifications).includes('moderate') ? 'moderate'
    : 'normal';

  const overallLabel = {
    critical: emergencyRequired ? '🚨 EMERGENCY — Seek Help Now' : '🚨 Critical',
    high:     '⚠️ High Risk',
    moderate: '🟡 Moderate',
    normal:   '✅ Normal',
  };
  const col = CLASS_COLOR[overallCls] || CLASS_COLOR.normal;

  let html = `
    <div style="background:${col.bg};border:1px solid ${col.border};
                border-radius:var(--radius-sm);padding:14px 18px;margin-bottom:16px;text-align:center">
      <div style="font-size:1.3rem;font-weight:700;color:${col.text}">${overallLabel[overallCls]}</div>
      <div style="font-size:0.8rem;color:var(--text-muted);margin-top:4px">${fmtDateTime(record.recorded_at)}</div>
    </div>`;

  const metrics = [
    { label: 'Heart Rate',     val: record.heartbeat   ? `${record.heartbeat} bpm`                    : null, cls: classifications.heartbeat   },
    { label: 'Blood Pressure', val: record.systolic    ? `${record.systolic}/${record.diastolic} mmHg` : null, cls: classifications.bp          },
    { label: 'Blood Sugar',    val: record.blood_sugar ? `${record.blood_sugar} mg/dL`                 : null, cls: classifications.blood_sugar },
  ].filter(m => m.val);

  if (metrics.length) {
    html += `<div style="display:grid;gap:8px;margin-bottom:16px">`;
    metrics.forEach(m => {
      const c = CLASS_COLOR[m.cls] || CLASS_COLOR.normal;
      html += `<div style="display:flex;align-items:center;justify-content:space-between;
                           background:${c.bg};border:1px solid ${c.border};
                           border-radius:var(--radius-sm);padding:10px 14px">
        <span style="font-weight:600;font-size:0.875rem">${m.label}</span>
        <span style="font-weight:700;color:${c.text}">${m.val}
          <span style="font-size:0.7rem;margin-left:4px;opacity:.8">${CLASS_LABEL[m.cls] || ''}</span>
        </span>
      </div>`;
    });
    html += `</div>`;
  }

  if (alerts.length) {
    html += `<div style="background:var(--rose);border:1px solid var(--rose-border);
                         border-radius:var(--radius-sm);padding:12px 16px;margin-bottom:14px">
      <div style="font-weight:700;color:var(--red);margin-bottom:8px">⚠️ Alerts</div>
      ${alerts.map(a => `<div style="font-size:0.83rem;color:var(--rose-text);margin-bottom:5px;
                                     padding-left:8px;border-left:2px solid var(--red)">${escHtml(a)}</div>`).join('')}
    </div>`;
  }

  if (suggestions.length) {
    html += `<div style="background:var(--sky);border:1px solid var(--sky-border);
                         border-radius:var(--radius-sm);padding:12px 16px;margin-bottom:14px">
      <div style="font-weight:700;color:var(--blue);margin-bottom:8px">💡 Suggestions</div>
      ${suggestions.map(s => `<div style="font-size:0.83rem;color:var(--sky-text);margin-bottom:4px">• ${escHtml(s)}</div>`).join('')}
    </div>`;
  }

  if (sosRequired || emergencyRequired) {
    html += `<a href="tel:112"
      style="display:block;background:var(--red);color:#fff;border-radius:var(--radius-sm);
             padding:14px;text-align:center;font-weight:700;font-size:1rem;
             text-decoration:none;margin-top:8px">
      🆘 Call Emergency Services (112)
    </a>`;
  }

  document.getElementById('analysis-content').innerHTML = html;
}

// ── Create record ───────────────────────────────────────────
async function handleCreateRecord(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;

  const heartRaw   = document.getElementById('h-heart').value;
  const sysRaw     = document.getElementById('h-systolic').value;
  const diaRaw     = document.getElementById('h-diastolic').value;
  const sugarRaw   = document.getElementById('h-sugar').value;

  const payload = {
    heartbeat:   heartRaw   ? parseInt(heartRaw,   10) : null,
    systolic:    sysRaw     ? parseInt(sysRaw,     10) : null,
    diastolic:   diaRaw     ? parseInt(diaRaw,     10) : null,
    blood_sugar: sugarRaw   ? parseFloat(sugarRaw)     : null,
    notes:       document.getElementById('h-notes').value.trim() || null,
  };

  if (!payload.heartbeat && !payload.systolic && !payload.blood_sugar) {
    showToast('Please enter at least one health metric', 'warning');
    btn.disabled = false;
    return;
  }

  const warningBox = document.getElementById('input-warnings');
  if (warningBox && warningBox.children.length > 0) {
    const confirmed = confirm('⚠️ One or more values appear critically abnormal.\n\nAre these readings correct? Press OK to save and see full analysis, or Cancel to re-check.');
    if (!confirmed) { btn.disabled = false; return; }
  }

  try {
    const res  = await apiFetch('/health', { method: 'POST', body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Failed to save', 'error'); return; }

    allRecords.unshift(data.record);
    renderLatestStats();
    renderTable();
    closeModal('health-modal');
    e.target.reset();
    renderValidationWarnings([]);
    showToast('Health record saved!', 'success');

    renderAnalysisPanel(data.record, {
      alerts:            data.alerts           || [],
      suggestions:       data.suggestions      || [],
      classifications:   data.classifications  || {},
      sosRequired:       data.sosRequired      || false,
      emergencyRequired: data.emergencyRequired || false,
    });
    openModal('analysis-modal');

    try {
      const trendRes = await apiFetch('/health/trend');
      renderTrendPanel(await trendRes.json());
    } catch (_) {}
  } catch (err) {
    showToast('Network error', 'error');
  } finally {
    btn.disabled = false;
  }
}

// ── Delete record ───────────────────────────────────────────
async function deleteRecord(id) {
  if (!confirm('Delete this health record?')) return;
  try {
    const res = await apiFetch(`/health/${id}`, { method: 'DELETE' });
    if (!res.ok) { showToast('Failed to delete', 'error'); return; }
    allRecords = allRecords.filter(r => r.id !== id);
    renderLatestStats();
    renderTable();
    showToast('Record deleted', 'success');
    try { renderTrendPanel(await (await apiFetch('/health/trend')).json()); } catch (_) {}
  } catch (e) { showToast('Network error', 'error'); }
}

// ── Client-side classifiers — use fetched T ─────────────────
function classifyHR(hr) {
  if (!hr || !T) return 'normal';
  if (hr < T.hr.criticalLow || hr > T.hr.criticalHigh) return 'critical';
  if (hr < T.hr.emergencyLow)  return 'critical';
  if (hr > T.hr.high)          return 'high';
  if (hr > T.hr.moderateHigh)  return 'moderate';
  return 'normal';
}
function classifyBP(sys, dia) {
  if (!sys || !T) return 'normal';
  if (sys > T.bp.criticalSys  || (dia && dia > T.bp.criticalDia))  return 'critical';
  if (sys < T.bp.emergencySys || (dia && dia < T.bp.emergencyDia)) return 'critical';
  if (sys > T.bp.highSys      || (dia && dia > T.bp.highDia))      return 'high';
  if (sys > T.bp.moderateSys  || (dia && dia > T.bp.moderateDia))  return 'moderate';
  if (sys < T.bp.lowSys       || (dia && dia < T.bp.lowDia))       return 'low';
  return 'normal';
}
function classifySugar(bs) {
  if (!bs || !T) return 'normal';
  bs = parseFloat(bs);
  if (bs > T.sugar.critical) return 'critical';
  if (bs > T.sugar.high)     return 'high';
  if (bs > T.sugar.moderate) return 'moderate';
  if (bs < T.sugar.emergency) return 'low';
  return 'normal';
}

// escHtml is defined in app.js
