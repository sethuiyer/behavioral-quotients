// Page chrome: reading progress, TOC active-section tracking, theme toggle,
// heading permalinks. Nothing here changes, hides or reorders document text.
(function () {
  'use strict';

  /* ------------------------------------------------------------- theme -- */

  var root = document.documentElement;
  var toggle = document.getElementById('d-theme-toggle');
  var mql = window.matchMedia('(prefers-color-scheme: dark)');

  function storedTheme() {
    try {
      var t = localStorage.getItem('bq-theme');
      return t === 'light' || t === 'dark' ? t : 'auto';
    } catch (e) {
      return 'auto';
    }
  }

  function effectiveTheme() {
    var t = storedTheme();
    if (t !== 'auto') return t;
    return mql.matches ? 'dark' : 'light';
  }

  function applyTheme(t) {
    root.setAttribute('data-theme', t);
    if (toggle) {
      toggle.setAttribute(
        'aria-label',
        'Switch to ' + (effectiveTheme() === 'dark' ? 'light' : 'dark') + ' colour scheme'
      );
    }
  }

  applyTheme(storedTheme());

  if (toggle) {
    toggle.addEventListener('click', function () {
      var next = effectiveTheme() === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem('bq-theme', next);
      } catch (e) {
        /* storage unavailable — the toggle still works for this page view */
      }
      applyTheme(next);
    });
  }

  if (mql.addEventListener) {
    mql.addEventListener('change', function () {
      if (storedTheme() === 'auto') applyTheme('auto');
    });
  }

  /* ---------------------------------------------------- reading progress -- */

  var bar = document.getElementById('d-progress-bar');

  function updateProgress() {
    if (!bar) return;
    var doc = document.documentElement;
    var max = doc.scrollHeight - window.innerHeight;
    var pct = max > 0 ? (window.scrollY / max) * 100 : 0;
    bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
  }

  var ticking = false;
  window.addEventListener(
    'scroll',
    function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(function () {
        updateProgress();
        ticking = false;
      });
    },
    { passive: true }
  );
  window.addEventListener('resize', updateProgress, { passive: true });
  updateProgress();

  /* ------------------------------------------------ toc active section -- */

  var tocLinks = Array.prototype.slice.call(
    document.querySelectorAll('.d-toc-item > a[href^="#"]')
  );
  if (!tocLinks.length || !('IntersectionObserver' in window)) return;

  var byId = {};
  var targets = [];
  tocLinks.forEach(function (a) {
    var id = decodeURIComponent(a.getAttribute('href').slice(1));
    var el = document.getElementById(id);
    if (!el) return;
    byId[id] = a;
    targets.push(el);
  });
  if (!targets.length) return;

  var visible = new Set();

  function refresh() {
    // The active entry is the last heading that has scrolled past the top.
    var activeId = null;
    for (var i = 0; i < targets.length; i++) {
      var r = targets[i].getBoundingClientRect();
      if (r.top <= 120) activeId = targets[i].id;
      else break;
    }
    if (!activeId && visible.size) activeId = targets[0].id;

    tocLinks.forEach(function (a) {
      a.removeAttribute('aria-current');
    });
    var active = activeId && byId[activeId];
    if (active) {
      active.setAttribute('aria-current', 'true');
      if (active.scrollIntoView) {
        // Keep the active entry inside the TOC's own scroll box.
        var nav = active.closest('.d-toc');
        if (nav && nav.scrollHeight > nav.clientHeight) {
          var top = active.offsetTop - nav.clientHeight / 2;
          nav.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
        }
      }
    }
  }

  var observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) visible.add(e.target.id);
        else visible.delete(e.target.id);
      });
      refresh();
    },
    { rootMargin: '-120px 0px -70% 0px', threshold: 0 }
  );
  targets.forEach(function (t) {
    observer.observe(t);
  });
  window.addEventListener('scroll', refresh, { passive: true });
  refresh();

  /* --------------------------------------------------- heading anchors -- */

  document.addEventListener('click', function (ev) {
    var a = ev.target.closest && ev.target.closest('a.d-anchor');
    if (!a) return;
    var url = new URL(window.location.href);
    url.hash = a.getAttribute('href');
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(url.toString()).catch(function () {});
    }
  });
})();
