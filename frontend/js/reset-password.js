/* reset-password.js
 * Two modes:
 *  - No ?token in URL  → show email-request form (calls /api/auth/forgot-password)
 *  - ?token=<hex>      → show password-reset form (calls /api/auth/reset-password)
 */

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const token  = params.get('token');

  const requestSection     = document.getElementById('request-section');
  const requestSentSection = document.getElementById('request-sent-section');
  const resetSection       = document.getElementById('reset-section');
  const successSection     = document.getElementById('success-section');
  const invalidSection     = document.getElementById('invalid-section');

  function show(el) { if (el) el.style.display = ''; }
  function hide(el) { if (el) el.style.display = 'none'; }

  // ── Mode 1: No token — show email request form ───────────
  if (!token || !/^[0-9a-f]{64}$/.test(token)) {
    show(requestSection);

    document.getElementById('forgot-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn   = e.target.querySelector('button[type="submit"]');
      const email = document.getElementById('forgot-email').value.trim();

      if (!email) { showToast('Please enter your email address', 'warning'); return; }

      btn.disabled    = true;
      btn.textContent = 'Sending…';

      try {
        const res = await fetch('https://lifehub-backend-n0y5.onrender.com/api/auth/forgot-password', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ email }),
        });
        const data = await res.json();

        if (res.status === 503) {
          showToast(data.error || 'Email service not configured', 'error');
          return;
        }
        // Always show success (server never reveals if email is registered)
        hide(requestSection);
        show(requestSentSection);
      } catch {
        showToast('Network error — is the server running?', 'error');
      } finally {
        btn.disabled    = false;
        btn.textContent = 'Send reset link';
      }
    });

    return; // Don't wire up the reset form
  }

  // ── Mode 2: Token present — show password-reset form ─────
  show(resetSection);

  document.getElementById('reset-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn      = e.target.querySelector('button[type="submit"]');
    const password = document.getElementById('reset-password').value;
    const confirm  = document.getElementById('reset-confirm').value;

    if (password.length < 8) { showToast('Password must be at least 8 characters', 'warning'); return; }
    if (password !== confirm) { showToast('Passwords do not match', 'warning'); return; }

    btn.disabled    = true;
    btn.textContent = 'Updating…';

    try {
      const res  = await fetch('https://lifehub-backend-n0y5.onrender.com/api/auth/reset-password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token, password }),
      });
      const data = await res.json();

      if (res.status === 400) {
        hide(resetSection);
        show(invalidSection);
        return;
      }
      if (!res.ok) {
        showToast(data.error || 'Something went wrong', 'error');
        return;
      }

      hide(resetSection);
      show(successSection);
    } catch {
      showToast('Network error — is the server running?', 'error');
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Update password';
    }
  });
});