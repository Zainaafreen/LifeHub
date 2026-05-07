/**
 * push-client.js — Web Push subscription manager
 *
 * Add this as a new file at:  frontend/js/push-client.js
 * Then include it in reminders.html BEFORE reminders.js:
 *   <script src="/js/push-client.js"></script>
 *
 * This replaces the basic Notification.requestPermission() flow with one
 * that also registers a Service Worker and subscribes to Web Push,
 * so notifications arrive even when the browser tab is closed.
 */

// ── Service Worker + Push setup ───────────────────────────────

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    // Wait until the SW is active
    await navigator.serviceWorker.ready;
    return reg;
  } catch (err) {
    console.warn('SW registration failed:', err);
    return null;
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function getVapidPublicKey() {
  try {
    const res = await apiFetch('/push/vapid-key');
    if (!res || !res.ok) return null;
    const { publicKey } = await res.json();
    return publicKey;
  } catch { return null; }
}

async function subscribeToPush(swRegistration) {
  const publicKey = await getVapidPublicKey();
  if (!publicKey) { console.warn('Could not fetch VAPID public key'); return null; }

  try {
    const existing = await swRegistration.pushManager.getSubscription();
    if (existing) return existing; // already subscribed

    const subscription = await swRegistration.pushManager.subscribe({
      userVisibleOnly:      true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    return subscription;
  } catch (err) {
    if (err.name === 'AbortError') {
      showToast(
        'Push notifications unavailable in Brave. Enable "Use Google services for push messaging" in Brave settings, or try Chrome/Edge. Your browser or network may also be blocking push services.',
        'warning'
      );
    } else {
      console.error('[Push] subscribe failed:', err.name, err.message);
    }
  }
  return null;
}

async function savePushSubscription(subscription) {

  try {

    // Ensure fresh CSRF token exists before POST
    if (typeof loadCsrfToken === 'function') {
      await loadCsrfToken();
    }

    const subJson = subscription.toJSON();

    const res = await apiFetch('/push/subscribe', {
      method: 'POST',
      body: JSON.stringify(subJson),
    });

    if (!res || !res.ok) {

      const body = await res?.text();

      console.error(
        '[Push] Subscribe failed:',
        res?.status,
        body
      );

      return false;
    }

    return true;

  } catch (err) {

    console.error(
      '[Push] savePushSubscription threw:',
      err
    );

    return false;
  }
}

async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    showToast('This browser does not support notifications', 'warning');
    return;
  }

  const isBrave =
  navigator.brave &&
  await navigator.brave.isBrave();

if (isBrave) {

  showToast(
    'Brave browser may block background notifications. For reliable alerts, use Chrome or Edge.',
    'warning'
  );

}

  // Step 1: ask for permission
  const permission = await Notification.requestPermission();
  renderNotifBanner();   // update the UI banner

  if (permission !== 'granted') {
    showToast('Notifications blocked. Enable in browser settings.', 'warning');
    return;
  }

  // Step 2: register Service Worker
  const swReg = await registerServiceWorker();
  if (!swReg) {
    // SW not supported — fall back to in-tab notifications only
    showToast('Notifications enabled (tab must stay open)', 'info');
    return;
  }

  // Step 3: subscribe to Web Push
  const subscription = await subscribeToPush(swReg);
  if (!subscription) {
    showToast('Notifications enabled (tab must stay open)', 'info');
    return;
  }

  // Step 4: save to backend
  const saved = await savePushSubscription(subscription);
  if (saved) {
    showToast('🔔 Notifications enabled! Works even when Chrome is closed.', 'success');
  } else {
    showToast('Notifications enabled (tab must stay open)', 'info');
  }
}

// Auto-register the SW on page load (silently — no permission prompt yet).
// This ensures the SW is ready before the user clicks "Enable Notifications".
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => registerServiceWorker());
}