const pool   = require('../config/db');
const logger = require('../config/logger');

// ── Thresholds ──────────────────────────────────────────────
// Tiered: emergency → high → moderate → low → normal
//
// SINGLE SOURCE OF TRUTH: these values are served verbatim by the
// GET /api/health/thresholds endpoint (see getThresholds below).
// The frontend fetches them on page load via loadThresholds() in
// frontend/js/health.js — do NOT hard-code these values anywhere
// else.  Change them here and the client picks up the new values
// automatically on its next page load.
const THRESHOLDS = {
  hr: {
    emergencyLow:  50,   // < 50 bpm  → EMERGENCY
    criticalLow:   40,   // < 40 bpm  → critical (subset of emergency)
    criticalHigh: 150,   // > 150 bpm → critical
    high:         100,   // > 100 bpm → high
    moderateHigh:  90,   // > 90 bpm  → moderate
  },
  bp: {
    emergencySys:  80,   // sys < 80  → EMERGENCY
    emergencyDia:  50,   // dia < 50  → EMERGENCY
    criticalSys:  180,   // sys > 180 → critical
    criticalDia:  120,   // dia > 120 → critical
    highSys:      140,
    highDia:       90,
    moderateSys:  130,
    moderateDia:   80,
    lowSys:        90,
    lowDia:        60,
  },
  sugar: {
    emergency:     70,   // < 70 mg/dL → EMERGENCY
    critical:     300,   // > 300      → critical
    high:         140,
    moderate:     100,
    low:           70,
  },
};

// ── Classification logic ────────────────────────────────────
function analyseHealth(record) {
  const alerts          = [];
  const suggestions     = [];
  const classifications = {};
  let emergencyRequired = false; // true when ANY metric alone is life-threatening
  let sosRequired       = false; // true when combination or single extreme

  // ── Heart Rate ──
  if (record.heartbeat) {
    const hr = record.heartbeat;
    if (hr < THRESHOLDS.hr.criticalLow || hr > THRESHOLDS.hr.criticalHigh) {
      classifications.heartbeat = 'critical';
      alerts.push(`Critical heart rate: ${hr} bpm — call emergency services now.`);
      sosRequired = true;
    } else if (hr < THRESHOLDS.hr.emergencyLow) {
      classifications.heartbeat = 'critical';
      alerts.push(`Dangerously low heart rate: ${hr} bpm (bradycardia) — seek emergency care immediately.`);
      emergencyRequired = true;
    } else if (hr > THRESHOLDS.hr.high) {
      classifications.heartbeat = 'high';
      alerts.push(`Elevated heart rate: ${hr} bpm (normal: 50–100 bpm).`);
      suggestions.push('Rest for 15 min, avoid caffeine, and re-measure. Consult a doctor if it persists.');
    } else if (hr > THRESHOLDS.hr.moderateHigh) {
      classifications.heartbeat = 'moderate';
      suggestions.push('Heart rate is mildly elevated. Try slow deep breathing or a short rest.');
    } else {
      classifications.heartbeat = 'normal';
    }
  }

  // ── Blood Pressure ──
  if (record.systolic) {
    const sys = record.systolic;
    const dia = record.diastolic || 0;

    if (sys > THRESHOLDS.bp.criticalSys || dia > THRESHOLDS.bp.criticalDia) {
      classifications.bp = 'critical';
      alerts.push(`Hypertensive crisis: ${sys}/${dia} mmHg — call emergency services now.`);
      sosRequired = true;
    } else if (sys < THRESHOLDS.bp.emergencySys || dia < THRESHOLDS.bp.emergencyDia) {
      classifications.bp = 'critical';
      alerts.push(`Life-threatening low BP: ${sys}/${dia} mmHg — risk of shock. Call emergency services now.`);
      emergencyRequired = true;
    } else if (sys > THRESHOLDS.bp.highSys || dia > THRESHOLDS.bp.highDia) {
      classifications.bp = 'high';
      alerts.push(`High blood pressure: ${sys}/${dia} mmHg (normal ≤140/90 mmHg).`);
      suggestions.push('Reduce salt intake, avoid strenuous activity, and consult a doctor if this persists.');
    } else if (sys > THRESHOLDS.bp.moderateSys || dia > THRESHOLDS.bp.moderateDia) {
      classifications.bp = 'moderate';
      suggestions.push('Blood pressure slightly elevated. Limit caffeine and monitor over the next few days.');
    } else if (sys < THRESHOLDS.bp.lowSys || dia < THRESHOLDS.bp.lowDia) {
      classifications.bp = 'low';
      alerts.push(`Low blood pressure: ${sys}/${dia} mmHg — you may feel dizzy or faint.`);
      suggestions.push('Stay hydrated, eat small frequent meals, and avoid standing up quickly.');
    } else {
      classifications.bp = 'normal';
    }
  }

  // ── Blood Sugar ──
  if (record.blood_sugar) {
    const bs = parseFloat(record.blood_sugar);

    if (bs > THRESHOLDS.sugar.critical) {
      classifications.blood_sugar = 'critical';
      alerts.push(`Critically high blood sugar: ${bs} mg/dL — seek emergency care.`);
      sosRequired = true;
    } else if (bs > THRESHOLDS.sugar.high) {
      classifications.blood_sugar = 'high';
      alerts.push(`High blood sugar: ${bs} mg/dL (normal post-meal ≤140 mg/dL).`);
      suggestions.push('Walk for 15 min. Avoid sugary foods and drinks until re-tested.');
    } else if (bs > THRESHOLDS.sugar.moderate) {
      classifications.blood_sugar = 'moderate';
      suggestions.push('Blood sugar slightly above fasting normal. Consider reducing refined carbohydrates.');
    } else if (bs < THRESHOLDS.sugar.emergency) {
      classifications.blood_sugar = 'low';
      alerts.push(`Low blood sugar: ${bs} mg/dL — risk of hypoglycaemia.`);
      suggestions.push('Eat 15g of fast-acting carbs (glucose tablets, fruit juice) and re-test in 15 min.');
      emergencyRequired = true;
    } else {
      classifications.blood_sugar = 'normal';
    }
  }

  // ── Combined emergency escalation ──────────────────────────
  // Any single emergency metric already sets emergencyRequired.
  // Additionally escalate when multiple dangerous metrics co-occur.
  const dangerousCount = [
    classifications.heartbeat   === 'critical',
    classifications.bp          === 'critical',
    classifications.blood_sugar === 'low' || classifications.blood_sugar === 'critical',
  ].filter(Boolean).length;

  if (dangerousCount >= 2) {
    emergencyRequired = true;
    alerts.unshift('⚠️ Multiple critical metrics detected simultaneously — this is a medical emergency.');
  }

  // emergencyRequired is a superset of sosRequired
  if (emergencyRequired) sosRequired = true;

  // ── Combined condition labels ──────────────────────────────
  const combinedConditions = [];
  if (classifications.bp === 'critical' && record.systolic < THRESHOLDS.bp.emergencySys) {
    combinedConditions.push('Hypotension (critically low blood pressure)');
  }
  if (classifications.blood_sugar === 'low') {
    combinedConditions.push('Hypoglycaemia (low blood sugar)');
  }
  if (classifications.heartbeat === 'critical' && record.heartbeat < THRESHOLDS.hr.emergencyLow) {
    combinedConditions.push('Bradycardia (low heart rate)');
  }
  if (combinedConditions.length >= 2) {
    suggestions.unshift(`Possible combined condition: ${combinedConditions.join(' + ')}. Do not wait — call emergency services.`);
  }

  return { alerts, suggestions, classifications, sosRequired, emergencyRequired };
}

// ── Trend analysis (last N records) ────────────────────────
function analyseTrend(records) {
  if (!records.length) return null;

  const recent = records.slice(0, 5);

  // Classify each record
  const analysed = recent.map(r => ({ record: r, ...analyseHealth(r) }));

  // Overall risk across all recent readings
  const hasEmergency = analysed.some(a => a.emergencyRequired);
  const hasCritical  = analysed.some(a => a.sosRequired);
  const hasHigh      = analysed.some(a =>
    Object.values(a.classifications).some(c => c === 'high'));
  const hasModerate  = analysed.some(a =>
    Object.values(a.classifications).some(c => c === 'moderate'));

  const overallRisk = hasEmergency ? 'emergency'
    : hasCritical ? 'critical'
    : hasHigh     ? 'high'
    : hasModerate ? 'moderate'
    : 'normal';

  // Simple direction for each metric (latest vs previous)
  function trend(key, extractor) {
    const vals = recent.map(extractor).filter(v => v != null);
    if (vals.length < 2) return 'stable';
    const delta = vals[0] - vals[1];
    return delta > 0 ? 'up' : delta < 0 ? 'down' : 'stable';
  }

  const trends = {
    heartbeat:   trend('heartbeat',   r => r.heartbeat),
    systolic:    trend('systolic',    r => r.systolic),
    blood_sugar: trend('blood_sugar', r => r.blood_sugar ? parseFloat(r.blood_sugar) : null),
  };

  // Collect all unique suggestions across recent readings
  const allSuggestions = [...new Set(analysed.flatMap(a => a.suggestions))];

  return { overallRisk, trends, analysed, suggestions: allSuggestions };
}

// ── GET /api/health/latest ──────────────────────────────────
async function getLatest(req, res) {
  try {
    const result = await pool.query(
      'SELECT * FROM health_records WHERE user_id = $1 ORDER BY recorded_at DESC LIMIT 1',
      [req.userId]
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    logger.error({ err }, 'getLatest error:', err.message);
    res.status(500).json({ error: 'Failed to fetch latest health record' });
  }
}

// ── GET /api/health ─────────────────────────────────────────
// Supports ?page=N&limit=N (default: page 1, 50 records per page)
async function getRecords(req, res) {
  try {
    const limit  = Math.min(Math.max(parseInt(req.query.limit)  || 50, 1), 200);
    const page   = Math.max(parseInt(req.query.page) || 1, 1);
    const offset = (page - 1) * limit;

    const [dataResult, countResult] = await Promise.all([
      pool.query(
        'SELECT * FROM health_records WHERE user_id = $1 ORDER BY recorded_at DESC LIMIT $2 OFFSET $3',
        [req.userId, limit, offset]
      ),
      pool.query(
        'SELECT COUNT(*)::int AS total FROM health_records WHERE user_id = $1',
        [req.userId]
      ),
    ]);

    const total = countResult.rows[0].total;
    res.json({
      data: dataResult.rows,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    logger.error({ err }, 'getRecords error:', err.message);
    res.status(500).json({ error: 'Failed to fetch health records' });
  }
}

// ── GET /api/health/trend ───────────────────────────────────
async function getTrend(req, res) {
  try {
    const result = await pool.query(
      'SELECT * FROM health_records WHERE user_id = $1 ORDER BY recorded_at DESC LIMIT 5',
      [req.userId]
    );
    const trend = analyseTrend(result.rows);
    res.json(trend);
  } catch (err) {
    logger.error({ err }, 'getTrend error:', err.message);
    res.status(500).json({ error: 'Failed to calculate trend' });
  }
}

// ── POST /api/health ────────────────────────────────────────
async function createRecord(req, res) {
  try {
    const { heartbeat, systolic, diastolic, blood_sugar, notes } = req.body;

    if (!heartbeat && !systolic && !blood_sugar) {
      return res.status(400).json({ error: 'Please provide at least one health metric' });
    }
    if (notes && notes.length > 1000) {
      return res.status(400).json({ error: 'Notes must be 1000 characters or fewer' });
    }

    const result = await pool.query(
      `INSERT INTO health_records (user_id, heartbeat, systolic, diastolic, blood_sugar, notes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        req.userId,
        heartbeat   ? parseInt(heartbeat)    : null,
        systolic    ? parseInt(systolic)      : null,
        diastolic   ? parseInt(diastolic)     : null,
        blood_sugar ? parseFloat(blood_sugar) : null,
        notes?.trim() || null,
      ]
    );

    const record   = result.rows[0];
    const analysis = analyseHealth(record);

    res.status(201).json({ record, ...analysis });
  } catch (err) {
    logger.error({ err }, 'createRecord error:', err.message);
    res.status(500).json({ error: 'Failed to save health record' });
  }
}

// ── DELETE /api/health/:id ──────────────────────────────────
async function deleteRecord(req, res) {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM health_records WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Record not found' });
    }
    res.json({ message: 'Record deleted', id: result.rows[0].id });
  } catch (err) {
    logger.error({ err }, 'deleteRecord error:', err.message);
    res.status(500).json({ error: 'Failed to delete record' });
  }
}

// ── GET /api/health/thresholds ──────────────────────────────
// Returns the canonical threshold values so the frontend can consume
// them directly — no more duplicated EMERGENCY/THRESHOLDS objects.
function getThresholds(req, res) {
  res.json(THRESHOLDS);
}

module.exports = { getLatest, getRecords, getTrend, createRecord, deleteRecord, getThresholds };
