(function () {
  'use strict';
  var grid = document.querySelector('[data-media-grid]');
  if (!grid) return;
  var projectId = grid.dataset.project;
  var tpl = document.getElementById('media-item-tpl');
  var queueBox = document.querySelector('[data-queue]');
  var qList = document.querySelector('[data-uq-list]');
  var qBar = document.querySelector('[data-uq-bar]');
  var qTitle = document.querySelector('[data-uq-title]');
  var retryAll = document.querySelector('[data-retry-all]');
  var wm = document.querySelector('[data-watermark]');
  var countEl = document.querySelector('[data-media-count]');
  var MAX_SIDE = 2560, CONCURRENCY = 3, MAX_TRIES = 4;
  var queue = [], active = 0;

  function updateCount() { if (countEl) countEl.textContent = grid.children.length + ' items'; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ---------- upload queue ----------
  document.querySelectorAll('[data-upload]').forEach(function (input) {
    input.addEventListener('change', function () {
      Array.prototype.forEach.call(input.files, addToQueue);
      input.value = '';
      pump();
    });
  });

  function addToQueue(file) {
    var li = document.createElement('li');
    li.className = 'uq-item';
    li.innerHTML = '<span class="uq-name">' + esc(file.name || 'photo') + '</span><span class="uq-state">Waiting…</span><span class="uq-p"><span></span></span>';
    qList.appendChild(li);
    queue.push({ file: file, el: li, state: 'waiting', tries: 0, loaded: 0, total: file.size, watermark: wm && wm.checked });
    queueBox.hidden = false;
    refresh();
  }

  function refresh() {
    var done = queue.filter(function (q) { return q.state === 'done'; }).length;
    var failed = queue.filter(function (q) { return q.state === 'failed'; }).length;
    var total = queue.length;
    var bytes = queue.reduce(function (a, q) { return a + q.total; }, 0) || 1;
    var loaded = queue.reduce(function (a, q) { return a + (q.state === 'done' ? q.total : Math.min(q.loaded, q.total)); }, 0);
    qBar.style.width = Math.round((loaded / bytes) * 100) + '%';
    var busy = queue.some(function (q) { return q.state === 'waiting' || q.state === 'uploading' || q.state === 'preparing' || q.state === 'retrying'; });
    qTitle.textContent = busy ? 'Uploading ' + (done + 1 > total ? total : done + 1) + ' of ' + total + '…' : failed ? done + ' uploaded, ' + failed + ' failed' : '✓ All ' + total + ' uploaded';
    retryAll.hidden = !failed || busy;
    if (!busy && !failed && total) setTimeout(function () { if (!queue.some(function (q) { return q.state !== 'done'; })) { queueBox.hidden = true; qList.innerHTML = ''; queue = []; } }, 2500);
  }

  function setState(item, state, text) {
    item.state = state;
    item.el.className = 'uq-item uq-' + state;
    item.el.querySelector('.uq-state').textContent = text;
    refresh();
  }

  function pump() {
    while (active < CONCURRENCY) {
      var next = queue.find(function (q) { return q.state === 'waiting'; });
      if (!next) return;
      active++;
      run(next).then(function () { active--; pump(); });
    }
  }

  retryAll.addEventListener('click', function () {
    queue.forEach(function (q) { if (q.state === 'failed') { q.tries = 0; q.loaded = 0; setState(q, 'waiting', 'Waiting…'); } });
    pump();
  });

  window.addEventListener('beforeunload', function (e) {
    if (queue.some(function (q) { return ['waiting', 'uploading', 'preparing', 'retrying'].indexOf(q.state) >= 0; })) { e.preventDefault(); e.returnValue = ''; }
  });

  // Resize big photos on the phone before upload: much faster on mobile data.
  function prepareImage(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || !window.createImageBitmap) return Promise.resolve(file);
    return createImageBitmap(file, { imageOrientation: 'from-image' }).then(function (bmp) {
      var scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
      if (scale === 1 && file.size < 3 * 1024 * 1024) { bmp.close && bmp.close(); return file; }
      var c = document.createElement('canvas');
      c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
      var ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close && bmp.close();
      return new Promise(function (res) { c.toBlob(function (b) { res(b && b.size < file.size ? new File([b], (file.name || 'photo').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file); }, 'image/jpeg', 0.92); });
    }).catch(function () { return file; });
  }

  function videoPoster(file) {
    return new Promise(function (resolve) {
      var v = document.createElement('video');
      var url = URL.createObjectURL(file);
      var done = function (b) { URL.revokeObjectURL(url); resolve(b); };
      v.muted = true; v.playsInline = true; v.preload = 'metadata'; v.src = url;
      v.addEventListener('loadeddata', function () { v.currentTime = Math.min(1, (v.duration || 2) / 2); });
      v.addEventListener('seeked', function () {
        try {
          var c = document.createElement('canvas');
          var s = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight));
          c.width = v.videoWidth * s; c.height = v.videoHeight * s;
          c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
          c.toBlob(function (b) { done(b); }, 'image/jpeg', 0.85);
        } catch (e) { done(null); }
      });
      v.addEventListener('error', function () { done(null); });
      setTimeout(function () { done(null); }, 8000);
    });
  }

  function run(item) {
    var f = item.file;
    var isVideo = /^video\//.test(f.type);
    setState(item, 'preparing', isVideo ? 'Preparing video…' : 'Optimising…');
    var prep = isVideo ? videoPoster(f).then(function (p) { return { file: f, poster: p }; }) : prepareImage(f).then(function (x) { return { file: x }; });
    return prep.then(function (p) {
      item.total = p.file.size;
      return attempt(item, p);
    });
  }

  function attempt(item, p) {
    item.tries++;
    setState(item, 'uploading', 'Uploading…');
    return new Promise(function (resolve) {
      var fd = new FormData();
      fd.append('file', p.file, p.file.name || 'upload');
      if (p.poster) fd.append('poster', p.poster, 'poster.jpg');
      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/admin/api/projects/' + projectId + '/media?watermark=' + (item.watermark ? '1' : '0'));
      xhr.setRequestHeader('X-CSRF-Token', RKD.csrf);
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.timeout = 10 * 60 * 1000;
      xhr.upload.onprogress = function (e) {
        if (e.lengthComputable) { item.loaded = e.loaded; item.el.querySelector('.uq-p span').style.width = Math.round((e.loaded / e.total) * 100) + '%'; refresh(); }
      };
      var fail = function (msg, retryable) {
        if (retryable && item.tries < MAX_TRIES) {
          var wait = Math.pow(2, item.tries) * 1000;
          setState(item, 'retrying', 'Connection problem — retrying in ' + wait / 1000 + 's…');
          setTimeout(function () { attempt(item, p).then(resolve); }, wait);
        } else { setState(item, 'failed', msg); resolve(); }
      };
      xhr.onload = function () {
        var j = {};
        try { j = JSON.parse(xhr.responseText); } catch (e) { /* ignore */ }
        if (xhr.status === 200 && j.media) {
          addMediaItem(j.media);
          setState(item, 'done', 'Done');
          resolve();
        } else if (xhr.status === 401) {
          fail('Session ended — log in again in a new tab, then tap Retry.', false);
        } else fail(j.error || 'Upload failed (' + xhr.status + ')', xhr.status >= 500 || xhr.status === 0);
      };
      xhr.onerror = function () { fail('No internet connection', true); };
      xhr.ontimeout = function () { fail('Upload timed out', true); };
      xhr.send(fd);
    });
  }

  function addMediaItem(m) {
    var node = tpl.content.firstElementChild.cloneNode(true);
    node.dataset.id = m.id;
    node.dataset.kind = m.kind;
    var img = node.querySelector('img');
    if (m.kind === 'video') {
      var holder = node.querySelector('.mi-img');
      if (m.thumb) img.src = '/media/' + m.thumb; else img.replaceWith(Object.assign(document.createElement('div'), { className: 'mi-vid' }));
      var play = document.createElement('span'); play.className = 'mi-play'; play.innerHTML = '&#9654;'; holder.appendChild(play);
      node.querySelector('.mi-tag').hidden = true;
      node.querySelector('.mi-cover').hidden = true;
    } else img.src = '/media/' + m.thumb;
    grid.appendChild(node);
    if (!grid.dataset.cover && !grid.querySelector('.is-cover') && m.kind === 'photo') node.classList.add('is-cover');
    updateCount();
  }

  // ---------- item actions ----------
  grid.addEventListener('click', function (e) {
    var li = e.target.closest('.mi');
    if (!li) return;
    var id = li.dataset.id;
    if (e.target.closest('.mi-del')) {
      if (!confirm('Delete this ' + (li.dataset.kind === 'video' ? 'video' : 'photo') + '? This cannot be undone.')) return;
      RKD.post('/admin/api/media/' + id + '/delete').then(function () {
        var wasCover = li.classList.contains('is-cover');
        li.remove(); updateCount();
        if (wasCover) { grid.dataset.cover = ''; var first = grid.querySelector('.mi[data-kind=photo]'); if (first) first.classList.add('is-cover'); }
        RKD.toast('Deleted');
      }).catch(function (err) { RKD.toast(err.message, 'error'); });
    } else if (e.target.closest('.mi-cover')) {
      RKD.post('/admin/api/media/' + id + '/cover').then(function () {
        grid.querySelectorAll('.is-cover').forEach(function (x) { x.classList.remove('is-cover'); });
        li.classList.add('is-cover'); grid.dataset.cover = id;
        RKD.toast('Cover photo updated');
      }).catch(function (err) { RKD.toast(err.message, 'error'); });
    }
  });
  grid.addEventListener('change', function (e) {
    var li = e.target.closest('.mi');
    if (!li) return;
    if (e.target.classList.contains('mi-caption') || e.target.classList.contains('mi-tag')) {
      RKD.post('/admin/api/media/' + li.dataset.id, { caption: li.querySelector('.mi-caption').value, tag: li.querySelector('.mi-tag').value })
        .then(function () { RKD.toast('Saved'); })
        .catch(function (err) { RKD.toast(err.message, 'error'); });
    }
  });

  // ---------- drag to reorder ----------
  function initSortable() {
    if (!window.Sortable) return setTimeout(initSortable, 100);
    Sortable.create(grid, {
      handle: '.mi-handle',
      animation: 160,
      ghostClass: 'mi-ghost',
      delay: 120,
      delayOnTouchOnly: true,
      onEnd: function () {
        var ids = Array.prototype.map.call(grid.children, function (x) { return Number(x.dataset.id); });
        RKD.post('/admin/api/projects/' + projectId + '/reorder', { ids: ids }).then(function () { RKD.toast('Order saved'); }).catch(function (err) { RKD.toast(err.message, 'error'); });
      },
    });
  }
  initSortable();
})();
