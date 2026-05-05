/**
 * sw.js — LifeHub Service Worker
 * Handles background push notifications even when the browser is closed.
 * Place this file at the ROOT of your frontend (same level as index.html).
 */

const CACHE_NAME = 'lifehub-v1';

// ── Install & activate ────────────────────────────────────────
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// ── Push event — fired by the browser even when no tab is open ─
self.addEventListener('push', (event) => {
  let data = { title: 'LifeHub Reminder', body: 'You have a reminder due!', reminderId: null };

  if (event.data) {
    try { data = { ...data, ...event.data.json() }; } catch (_) {}
  }

  const options = {
    body:    data.body,
    icon:    '/favicon.svg',          // adjust if you have a PNG icon
    badge:   '/favicon.svg',
    tag:     `reminder-${data.reminderId || Date.now()}`,   // collapses duplicates
    renotify: false,
    data:    { reminderId: data.reminderId, url: '/pages/reminders.html' },
    actions: [
      { action: 'open',   title: '📋 View' },
      { action: 'dismiss', title: '✕ Dismiss' },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// ── Notification click ────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const targetUrl = event.notification.data?.url || '/pages/reminders.html';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus existing tab if one is open
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          client.navigate(targetUrl);
          return;
        }
      }
      // Otherwise open a new tab
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});