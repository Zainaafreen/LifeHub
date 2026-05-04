document.addEventListener('DOMContentLoaded', () => {
  redirectIfLoggedIn();

  const loginForm    = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const forgotForm   = document.getElementById('forgot-form');

  const loginSection      = document.getElementById('login-section');
  const regSection        = document.getElementById('register-section');
  const verifySection     = document.getElementById('verify-section');
  const forgotSection     = document.getElementById('forgot-section');
  const forgotSentSection = document.getElementById('forgot-sent-section');
  const resendSection     = document.getElementById('resend-section');

  let _lastEmail = '';

  function showSection(name) {
    loginSection.style.display      = name === 'login'       ? '' : 'none';
    regSection.style.display        = name === 'reg'         ? '' : 'none';
    verifySection.style.display     = name === 'verify'      ? '' : 'none';
    forgotSection.style.display     = name === 'forgot'      ? '' : 'none';
    forgotSentSection.style.display = name === 'forgot-sent' ? '' : 'none';
    if (resendSection) resendSection.style.display = 'none';
  }

  document.getElementById('show-register')?.addEventListener('click', (e) => { e.preventDefault(); showSection('reg'); });
  document.getElementById('show-login')?.addEventListener('click',    (e) => { e.preventDefault(); showSection('login'); });
  document.getElementById('back-to-login')?.addEventListener('click', ()  => showSection('login'));
  document.getElementById('show-forgot')?.addEventListener('click',   (e) => { e.preventDefault(); showSection('forgot'); });
  document.getElementById('forgot-back')?.addEventListener('click',   (e) => { e.preventDefault(); showSection('login'); });
  document.getElementById('forgot-sent-back')?.addEventListener('click', () => showSection('login'));

  // ── LOGIN ──────────────────────────────────────────────────
  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn      = loginForm.querySelector('button[type="submit"]');
    const email    = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    if (!email || !password) { showToast('Please fill all fields', 'warning'); return; }

    _lastEmail      = email;
    btn.disabled    = true;
    btn.textContent = 'Signing in…';
    if (resendSection) resendSection.style.display = 'none';

    try {
      const res  = await fetch('https://lifehub-backend-n0y5.onrender.com/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        if (data.code === 'EMAIL_NOT_VERIFIED') {
          showToast(data.error, 'warning');
          if (resendSection) resendSection.style.display = 'block';
        } else {
          showToast(data.error || 'Login failed', 'error');
        }
        return;
      }

      markLoggedIn();
      setUser(data.user);
      window.location.href = '/index.html';
    } catch {
      showToast('Network error — is the server running?', 'error');
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Sign in';
    }
  });

  // ── REGISTER ───────────────────────────────────────────────
  registerForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn      = registerForm.querySelector('button[type="submit"]');
    const name     = document.getElementById('reg-name').value.trim();
    const email    = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;
    const confirm  = document.getElementById('reg-confirm').value;

    if (!name || !email || !password)              { showToast('Please fill all fields', 'warning'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showToast('Please enter a valid email address', 'warning'); return; }
    if (password !== confirm)                      { showToast('Passwords do not match', 'warning'); return; }
    if (password.length < 8)                       { showToast('Password must be at least 8 characters', 'warning'); return; }

    _lastEmail      = email;
    btn.disabled    = true;
    btn.textContent = 'Creating account…';

    try {
      const res  = await fetch('https://lifehub-backend-n0y5.onrender.com/api/auth/register', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name, email, password }),
      });
      const data = await res.json();

      if (!res.ok) { showToast(data.error || 'Registration failed', 'error'); return; }

      const verifyMsg = document.getElementById('verify-message');
      if (verifyMsg) {
        verifyMsg.textContent = data.devVerifyToken
          ? `Dev mode: no SMTP configured. Your verify token is shown in the server console. You can also call: GET /api/auth/verify-email?token=${data.devVerifyToken}`
          : `We've sent a verification link to ${email}. Click it to activate your account, then sign in.`;
      }
      showSection('verify');
    } catch {
      showToast('Network error — is the server running?', 'error');
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Create account';
    }
  });

  // ── FORGOT PASSWORD ────────────────────────────────────────
  forgotForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn   = forgotForm.querySelector('button[type="submit"]');
    const email = document.getElementById('forgot-email').value.trim();

    if (!email) { showToast('Please enter your email', 'warning'); return; }

    _lastEmail      = email;
    btn.disabled    = true;
    btn.textContent = 'Sending…';

    try {
      await fetch('https://lifehub-backend-n0y5.onrender.com/api/auth/forgot-password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      // Always show success — API always returns 200 to avoid email enumeration
      showSection('forgot-sent');
    } catch {
      showToast('Network error — is the server running?', 'error');
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Send reset link';
    }
  });

  // ── RESEND VERIFICATION ────────────────────────────────────
  async function doResend(btn, originalText) {
    if (!_lastEmail) { showToast('Please enter your email first', 'warning'); return; }
    btn.disabled    = true;
    btn.textContent = 'Sending…';
    try {
      await fetch('https://lifehub-backend-n0y5.onrender.com/api/auth/resend-verification', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: _lastEmail }),
      });
      showToast('Verification email sent — check your inbox', 'success');
    } catch {
      showToast('Could not send email — try again later', 'error');
    } finally {
      btn.disabled    = false;
      btn.textContent = originalText;
    }
  }

  document.getElementById('resend-btn')?.addEventListener('click', (e) => doResend(e.target, 'Resend verification email'));
  document.getElementById('verify-resend')?.addEventListener('click', async (e) => {
    e.preventDefault();
    doResend(e.target, 'Resend');
  });
});
