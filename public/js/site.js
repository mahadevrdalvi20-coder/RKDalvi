(function () {
  'use strict';
  // mobile nav
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('main-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('open')) { nav.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); toggle.focus(); }
    });
  }

  // hero slideshow
  var show = document.querySelector('[data-slideshow]');
  if (show) {
    var slides = show.querySelectorAll('.hero-slide');
    var dots = document.querySelectorAll('.hero-dots button');
    var i = 0, timer;
    var go = function (n) {
      slides[i].classList.remove('is-active'); if (dots[i]) dots[i].classList.remove('is-active');
      i = (n + slides.length) % slides.length;
      slides[i].classList.add('is-active'); if (dots[i]) dots[i].classList.add('is-active');
    };
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var start = function () { if (slides.length > 1 && !reduce) timer = setInterval(function () { go(i + 1); }, 5500); };
    dots.forEach(function (d) { d.addEventListener('click', function () { clearInterval(timer); go(Number(d.dataset.go)); start(); }); });
    // swipe
    var x0 = null;
    show.parentElement.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    show.parentElement.addEventListener('touchend', function (e) {
      if (x0 === null) return; var dx = e.changedTouches[0].clientX - x0; x0 = null;
      if (Math.abs(dx) > 50) { clearInterval(timer); go(i + (dx < 0 ? 1 : -1)); start(); }
    });
    document.addEventListener('visibilitychange', function () { clearInterval(timer); if (!document.hidden) start(); });
    start();
  }

  // auto-submit selects
  document.querySelectorAll('[data-autosubmit]').forEach(function (el) { el.addEventListener('change', function () { el.form.submit(); }); });

  // share buttons
  document.querySelectorAll('[data-share]').forEach(function (b) {
    b.addEventListener('click', function () {
      var url = b.dataset.url || location.href, title = b.dataset.title || document.title;
      if (navigator.share) { navigator.share({ title: title, url: url }).catch(function () {}); return; }
      window.open('https://wa.me/?text=' + encodeURIComponent(title + ' ' + url), '_blank', 'noopener');
    });
  });

  // before / after
  document.querySelectorAll('[data-ba]').forEach(function (ba) {
    var r = ba.querySelector('.ba-range');
    var set = function () { ba.style.setProperty('--pos', r.value + '%'); };
    r.addEventListener('input', set); set();
  });

  // enquiry form: file limit + prevent double submit
  var files = document.querySelector('input[type=file][data-max-files]');
  if (files) {
    files.addEventListener('change', function () {
      var max = Number(files.dataset.maxFiles), hint = document.querySelector('[data-file-hint]');
      var big = Array.prototype.some.call(files.files, function (f) { return f.size > 10 * 1024 * 1024; });
      if (files.files.length > max || big) {
        alert(big ? 'Each file must be under 10 MB.' : 'You can attach up to ' + max + ' files.');
        files.value = '';
      } else if (hint && files.files.length) hint.textContent = files.files.length + ' file(s) selected';
    });
  }
  // Compress attached photos in the browser so enquiries upload fast and stay under the size limit.
  function shrink(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 600 * 1024 || !window.createImageBitmap) return Promise.resolve(file);
    return createImageBitmap(file, { imageOrientation: 'from-image' }).then(function (bmp) {
      var s = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
      var c = document.createElement('canvas');
      c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      return new Promise(function (res) {
        c.toBlob(function (b) { res(b && b.size < file.size ? new File([b], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file); }, 'image/jpeg', 0.82);
      });
    }).catch(function () { return file; });
  }
  document.querySelectorAll('form').forEach(function (f) {
    f.addEventListener('submit', function (e) {
      var input = f.querySelector('input[type=file][data-max-files]');
      var max = Number(f.dataset.maxTotal || 0);
      if (input && input.files.length && !f.dataset.ready && window.DataTransfer) {
        e.preventDefault();
        var b = f.querySelector('[data-submit]');
        if (b) { b.disabled = true; b.textContent = 'Preparing files…'; }
        Promise.all(Array.prototype.map.call(input.files, shrink)).then(function (files) {
          var total = files.reduce(function (a, x) { return a + x.size; }, 0);
          if (max && total > max - 200 * 1024) {
            alert('The attached files are too large (' + (total / 1048576).toFixed(1) + ' MB). Please attach fewer files, or send drawings on WhatsApp after submitting.');
            if (b) { b.disabled = false; b.textContent = 'Send enquiry'; }
            return;
          }
          var dt = new DataTransfer();
          files.forEach(function (x) { dt.items.add(x); });
          input.files = dt.files;
          f.dataset.ready = '1';
          if (b) b.textContent = 'Sending…';
          HTMLFormElement.prototype.submit.call(f);
        });
        return;
      }
      var btn = f.querySelector('[data-submit]');
      if (btn) { setTimeout(function () { btn.disabled = true; btn.textContent = 'Sending…'; }, 0); }
    });
  });

  // PWA service worker
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });
  }
})();
