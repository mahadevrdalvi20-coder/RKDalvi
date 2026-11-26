(function () {
  'use strict';
  var csrf = document.body.dataset.csrf;
  window.RKD = window.RKD || {};
  RKD.csrf = csrf;

  var toastEl = document.getElementById('toast'), toastTimer;
  RKD.toast = function (msg, type) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.className = 'toast show ' + (type || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.className = 'toast'; }, 3200);
  };

  RKD.post = function (url, data) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify(data || {}),
      credentials: 'same-origin',
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401) { RKD.toast('Session ended — please log in again.', 'error'); setTimeout(function () { location.href = '/admin/login?next=' + encodeURIComponent(location.pathname); }, 1500); }
        if (!r.ok) throw new Error(j.error || 'Something went wrong');
        return j;
      });
    });
  };

  // "Are you sure?" confirmations
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (f.dataset.confirm && !confirm(f.dataset.confirm)) e.preventDefault();
  }, true);
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-confirm-btn]');
    if (b && !confirm(b.dataset.confirmBtn)) e.preventDefault();
  });

  // flash auto-hide
  var flash = document.querySelector('.a-main > .flash');
  if (flash) setTimeout(function () { flash.classList.add('fade'); }, 6000);

  // ---- push notifications ----
  var box = document.getElementById('push-box');
  if (box) {
    var status = box.querySelector('[data-push-status]');
    var enable = box.querySelector('[data-push-enable]');
    var test = box.querySelector('[data-push-test]');
    var key = box.dataset.key;
    var supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    var b64 = function (s) {
      var pad = '='.repeat((4 - (s.length % 4)) % 4);
      var raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
      var out = new Uint8Array(raw.length);
      for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
      return out;
    };
    if (!supported) {
      status.textContent = 'This browser does not support notifications. On Android, open the app from the home screen or use Chrome.';
    } else {
      navigator.serviceWorker.register('/sw.js').then(function () { return navigator.serviceWorker.ready; }).then(function (reg) {
        return reg.pushManager.getSubscription().then(function (sub) {
          if (sub && Notification.permission === 'granted') {
            status.textContent = '✓ Notifications are ON for this device.';
            test.hidden = false;
            RKD.post('/admin/api/push/subscribe', { subscription: sub.toJSON() }).catch(function () {});
          } else if (Notification.permission === 'denied') {
            status.textContent = 'Notifications are blocked. Allow them in your browser / phone settings for this site.';
          } else enable.hidden = false;
          enable.addEventListener('click', function () {
            Notification.requestPermission().then(function (perm) {
              if (perm !== 'granted') { status.textContent = 'Permission was not given.'; return; }
              return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) }).then(function (s) {
                return RKD.post('/admin/api/push/subscribe', { subscription: s.toJSON() });
              }).then(function () {
                status.textContent = '✓ Notifications are ON for this device.';
                enable.hidden = true; test.hidden = false;
                RKD.toast('Notifications turned on', 'success');
              });
            }).catch(function (err) { status.textContent = 'Could not turn on notifications: ' + err.message; });
          });
          test.addEventListener('click', function () {
            RKD.post('/admin/api/push/test').then(function (r) { RKD.toast(r.sent ? 'Test sent — check your notifications' : 'No device subscribed yet'); });
          });
        });
      }).catch(function () {});
    }
  }
})();
