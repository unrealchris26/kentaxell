/* ═══════════════════════════════════════════
   Kent Axell — site behaviour
   ═══════════════════════════════════════════ */
(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── sticky header state ─────────────────── */
  var header = document.getElementById('header');
  var onScroll = function () {
    header.classList.toggle('stuck', window.scrollY > 24);
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ── mobile nav ──────────────────────────── */
  var burger = document.getElementById('burger');
  var nav = document.getElementById('nav');

  var setNav = function (open) {
    nav.classList.toggle('open', open);
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    document.body.style.overflow = open ? 'hidden' : '';
  };

  burger.addEventListener('click', function () {
    setNav(burger.getAttribute('aria-expanded') !== 'true');
  });

  nav.addEventListener('click', function (e) {
    if (e.target.closest('a')) setNav(false);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && nav.classList.contains('open')) {
      setNav(false);
      burger.focus();
    }
  });

  /* ── scroll reveal ───────────────────────── */
  var items = document.querySelectorAll('.reveal');

  if (reduced || !('IntersectionObserver' in window)) {
    items.forEach(function (el) { el.classList.add('in'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('in');
        io.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });

    items.forEach(function (el) { io.observe(el); });
  }

  /* ── FAQ: one open at a time ─────────────── */
  var faqs = Array.prototype.slice.call(document.querySelectorAll('.faq details'));
  faqs.forEach(function (d) {
    d.addEventListener('toggle', function () {
      if (!d.open) return;
      faqs.forEach(function (other) { if (other !== d) other.open = false; });
    });
  });

  /* ── testimonial dots (mobile rail) ──────── */
  var rail = document.getElementById('quoteRail');
  var dotWrap = document.getElementById('quoteDots');

  if (rail && dotWrap) {
    var quotes = Array.prototype.slice.call(rail.children);

    quotes.forEach(function (q, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-label', 'Show testimonial ' + (i + 1));
      if (i === 0) b.setAttribute('aria-current', 'true');
      b.addEventListener('click', function () {
        rail.scrollTo({ left: q.offsetLeft - rail.offsetLeft, behavior: reduced ? 'auto' : 'smooth' });
      });
      dotWrap.appendChild(b);
    });

    var dots = Array.prototype.slice.call(dotWrap.children);
    var syncing;
    rail.addEventListener('scroll', function () {
      window.cancelAnimationFrame(syncing);
      syncing = window.requestAnimationFrame(function () {
        var mid = rail.scrollLeft + rail.clientWidth / 2;
        var active = 0;
        var best = Infinity;
        quotes.forEach(function (q, i) {
          var d = Math.abs((q.offsetLeft - rail.offsetLeft) + q.offsetWidth / 2 - mid);
          if (d < best) { best = d; active = i; }
        });
        dots.forEach(function (b, i) {
          if (i === active) b.setAttribute('aria-current', 'true');
          else b.removeAttribute('aria-current');
        });
      });
    }, { passive: true });
  }

  /* ── forms ────────────────────────────────────────
     Both POST JSON to the serverless handler, which talks to GoHighLevel.
     See netlify/functions/lead.mjs. Change ENDPOINT if you host elsewhere.  */
  var ENDPOINT = '/.netlify/functions/lead';
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  var collect = function (form) {
    var out = {};
    new FormData(form).forEach(function (v, k) { out[k] = v; });
    out.page = window.location.pathname;
    return out;
  };

  var send = function (payload) {
    return fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r;
    });
  };

  var wireForm = function (formSel, msgId, onValid) {
    var form = document.querySelector(formSel);
    var msg = document.getElementById(msgId);
    if (!form || !msg) return;

    var busy = false;

    var say = function (text, ok) {
      msg.textContent = text;
      msg.style.color = ok ? '' : '#E7A5A5';
      msg.classList.add('show');
      if (ok) window.setTimeout(function () { msg.classList.remove('show'); }, 5000);
    };

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (busy) return;

      var btn = form.querySelector('button[type="submit"]');
      var lock = function (state) {
        busy = state;
        if (btn) btn.disabled = state;
        form.setAttribute('aria-busy', state ? 'true' : 'false');
      };

      onValid(form, say, lock);
    });
  };

  /* newsletter */
  wireForm('.signup__form', 'signupMsg', function (form, say, lock) {
    var input = form.querySelector('input[type="email"]');
    if (!EMAIL.test(input.value.trim())) return say('Please enter a valid email address.', false);

    var data = collect(form);
    data.source = 'Website — newsletter';

    lock(true);
    say('Adding you…', true);

    send(data).then(function () {
      input.value = '';
      say('Thank you — you are on the list.', true);
    }).catch(function () {
      say('Something went wrong. Please email book@kentaxell.com.', false);
    }).then(function () { lock(false); });
  });

  /* booking enquiry */
  wireForm('.book__form', 'bookMsg', function (form, say, lock) {
    var name = form.querySelector('#bName');
    var email = form.querySelector('#bEmail');

    if (!name.value.trim()) { name.focus(); return say('Please add your name.', false); }
    if (!EMAIL.test(email.value.trim())) { email.focus(); return say('Please enter a valid email address.', false); }

    var data = collect(form);
    data.source = 'Website — booking enquiry';

    lock(true);
    say('Sending…', true);

    send(data).then(function () {
      form.reset();
      say('Enquiry received — Kent will reply within one business day.', true);
    }).catch(function () {
      say('Something went wrong. Please email book@kentaxell.com.', false);
    }).then(function () { lock(false); });
  });

  /* ── footer year ─────────────────────────── */
  var yr = document.getElementById('yr');
  if (yr) yr.textContent = new Date().getFullYear();

})();
