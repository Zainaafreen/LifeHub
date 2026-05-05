(async () => {
  // Stop immediately if not logged in (requireAuth will redirect)
  await requireAuth();
  if (!isLoggedIn()) return;

  // ── Load profile ─────────────────────────────────────────
  async function loadProfile() {
    const res = await apiFetch('/profile');
    if (!res || !res.ok) {
      showToast('Could not load profile data', 'error');
      return;
    }
    const u = await res.json();

    // Keep localStorage fresh so sidebar works on all pages
    setUser({ id: u.id, name: u.name, email: u.email });

    // Update sidebar (initSidebar already ran from app.js, refresh with API data)
    const nameEl  = document.getElementById('sidebar-user-name');
    const emailEl = document.getElementById('sidebar-user-email');
    if (nameEl)  nameEl.textContent  = u.name;
    if (emailEl) emailEl.textContent = u.email;

    // Identity card
    document.getElementById('profile-avatar-lg').textContent     = u.name.charAt(0).toUpperCase();
    document.getElementById('profile-name-display').textContent  = u.name;
    document.getElementById('profile-email-display').textContent = u.email;
    document.getElementById('profile-since').textContent =
      new Date(u.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

    // Chips
    const chips = document.getElementById('profile-chips');
    chips.innerHTML = '';
    if (u.age)         chips.innerHTML += chip('🎂', u.age + ' yrs');
    if (u.gender)      chips.innerHTML += chip('👤', fmtGender(u.gender));
    if (u.blood_group) chips.innerHTML += chip('🩸', u.blood_group);

    // Pre-fill form fields
    document.getElementById('inp-name').value       = u.name                || '';
    document.getElementById('inp-email').value      = u.email               || '';
    document.getElementById('inp-age').value        = u.age                 || '';
    document.getElementById('inp-gender').value     = u.gender              || '';
    document.getElementById('inp-blood').value      = u.blood_group         || '';
    document.getElementById('inp-emergency').value  = u.emergency_contact   || '';
    document.getElementById('inp-conditions').value = u.health_conditions   || '';
  }

  function chip(icon, text) {
    return '<span class="profile-meta-chip">' + icon + ' <span>' + escHtml(text) + '</span></span>';
  }
  function fmtGender(g) {
    return ({ male: 'Male', female: 'Female', other: 'Other', prefer_not_to_say: 'Prefer not to say' })[g] || g;
  }

  await loadProfile();

  // ── Status helper ─────────────────────────────────────────
  function showStatus(id, msg, isError) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    el.className = 'save-status visible' + (isError ? ' error' : '');
    setTimeout(function() { el.className = 'save-status'; }, 3500);
  }

  // ── Generic save helper ───────────────────────────────────
  async function saveSection(payload, statusId, btnId, btnLabel) {
    btnLabel = btnLabel || 'Save changes';
    const btn = document.getElementById(btnId);
    btn.disabled    = true;
    btn.textContent = 'Saving...';
    try {
      const res = await apiFetch('/profile', {
        method: 'PATCH',
        body:   JSON.stringify(payload),
      });
      if (!res) {
        showStatus(statusId, 'No response — are you logged in?', true);
        showToast('Save failed — please log in again', 'error');
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        showStatus(statusId, data.error || 'Failed to save', true);
        showToast(data.error || 'Failed to save', 'error');
      } else {
        if (data.user) {
          var stored = getUser();
          setUser(Object.assign({}, stored || {}, { name: data.user.name, email: data.user.email }));
        }
        showStatus(statusId, 'Saved');
        showToast('Changes saved', 'success');
        await loadProfile();
      }
    } catch (e) {
      showStatus(statusId, 'Network error', true);
      showToast('Network error — could not save', 'error');
    } finally {
      btn.disabled    = false;
      btn.textContent = btnLabel;
    }
  }

  // ── Personal info ─────────────────────────────────────────
  document.getElementById('save-personal').addEventListener('click', async function() {
    var name   = document.getElementById('inp-name').value.trim();
    var email  = document.getElementById('inp-email').value.trim();
    var age    = document.getElementById('inp-age').value;
    var gender = document.getElementById('inp-gender').value;

    if (!name)  { showStatus('status-personal', 'Name is required', true); return; }
    if (!email) { showStatus('status-personal', 'Email is required', true); return; }

    await saveSection(
      { name: name, email: email, age: age ? parseInt(age, 10) : null, gender: gender || null },
      'status-personal', 'save-personal', 'Save changes'
    );
  });

  // ── Health info ───────────────────────────────────────────
  document.getElementById('save-health').addEventListener('click', async function() {
    var blood      = document.getElementById('inp-blood').value;
    var emergency  = document.getElementById('inp-emergency').value.trim();
    var conditions = document.getElementById('inp-conditions').value.trim();

    await saveSection(
      { blood_group: blood || null, emergency_contact: emergency || null, health_conditions: conditions || null },
      'status-health', 'save-health', 'Save changes'
    );
  });

  // ── Change password ───────────────────────────────────────
  document.getElementById('save-password').addEventListener('click', async function() {
    var btn     = document.getElementById('save-password');
    var current = document.getElementById('inp-cur-pw').value;
    var newPw   = document.getElementById('inp-new-pw').value;
    var confirm = document.getElementById('inp-confirm-pw').value;

    if (!current)         { showStatus('status-password', 'Enter your current password', true); return; }
    if (!newPw)           { showStatus('status-password', 'Enter a new password', true); return; }
    if (newPw.length < 8) { showStatus('status-password', 'Password must be at least 8 characters', true); return; }
    if (newPw !== confirm) { showStatus('status-password', 'Passwords do not match', true); return; }

    btn.disabled    = true;
    btn.textContent = 'Updating...';
    try {
      var res = await apiFetch('/auth/change-password', {
        method: 'PATCH',
        body:   JSON.stringify({ currentPassword: current, newPassword: newPw }),
      });
      if (!res) return;
      var data = await res.json();
      if (!res.ok) {
        showStatus('status-password', data.error || 'Failed', true);
        showToast(data.error || 'Password update failed', 'error');
      } else {
        document.getElementById('inp-cur-pw').value     = '';
        document.getElementById('inp-new-pw').value     = '';
        document.getElementById('inp-confirm-pw').value = '';
        showStatus('status-password', 'Password updated');
        showToast('Password updated successfully', 'success');
      }
    } catch (e) {
      showStatus('status-password', 'Network error', true);
      showToast('Network error', 'error');
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Update password';
    }
  });
})();