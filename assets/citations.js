// Citation hover/focus tooltips.
//
// Reference text is read out of the page's own reference list (#ref-N), so the
// bibliography exists exactly once in the document. Nothing is duplicated here
// and no data is fetched.
(function () {
  'use strict';

  var tips = null;

  function getTip() {
    if (!tips) {
      tips = document.createElement('div');
      tips.className = 'd-cite-tip';
      tips.setAttribute('role', 'tooltip');
      tips.hidden = true;
      document.body.appendChild(tips);
    }
    return tips;
  }

  /** Visible text of a reference entry, minus the backlink arrow. */
  function refText(n) {
    var li = document.getElementById('ref-' + n);
    if (!li) return null;
    var clone = li.cloneNode(true);
    var back = clone.querySelector('.d-ref-back');
    if (back) back.remove();
    return clone.textContent.replace(/\s+/g, ' ').trim();
  }

  function show(anchor) {
    var refs = (anchor.getAttribute('data-refs') || '')
      .split(',')
      .map(function (s) {
        return parseInt(s, 10);
      })
      .filter(function (n) {
        return !isNaN(n);
      });
    if (!refs.length) return;

    var entries = refs
      .map(function (n) {
        var t = refText(n);
        return t ? { n: n, text: t } : null;
      })
      .filter(Boolean);
    if (!entries.length) return;

    var tip = getTip();
    tip.textContent = '';
    if (entries.length === 1) {
      tip.textContent = entries[0].text;
    } else {
      var ol = document.createElement('ol');
      entries.forEach(function (e) {
        var li = document.createElement('li');
        var num = document.createElement('span');
        num.className = 'd-tip-n';
        num.textContent = '[' + e.n + '] ';
        li.appendChild(num);
        li.appendChild(document.createTextNode(e.text));
        ol.appendChild(li);
      });
      tip.appendChild(ol);
    }

    tip.hidden = false;
    position(anchor, tip);
  }

  function position(anchor, tip) {
    var r = anchor.getBoundingClientRect();
    var tr = tip.getBoundingClientRect();
    var left = window.scrollX + r.left;
    var maxLeft = window.scrollX + document.documentElement.clientWidth - tr.width - 12;
    left = Math.max(window.scrollX + 8, Math.min(left, maxLeft));
    var top = window.scrollY + r.bottom + 8;
    if (r.bottom + tr.height + 16 > window.innerHeight) {
      top = window.scrollY + r.top - tr.height - 8;
    }
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }

  function hide() {
    if (tips) tips.hidden = true;
  }

  var current = null;

  document.addEventListener('mouseover', function (ev) {
    var a = ev.target.closest && ev.target.closest('a.d-cite');
    if (!a || a === current) return;
    current = a;
    show(a);
  });

  document.addEventListener('mouseout', function (ev) {
    var a = ev.target.closest && ev.target.closest('a.d-cite');
    if (!a || a !== current) return;
    var to = ev.relatedTarget;
    if (to && (to === tips || (tips && tips.contains(to)))) return;
    current = null;
    hide();
  });

  document.addEventListener('focusin', function (ev) {
    var a = ev.target.closest && ev.target.closest('a.d-cite');
    if (a) {
      current = a;
      show(a);
    }
  });

  document.addEventListener('focusout', function () {
    current = null;
    hide();
  });

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') {
      current = null;
      hide();
    }
  });

  window.addEventListener('scroll', hide, { passive: true });
})();
