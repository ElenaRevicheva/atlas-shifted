/* skin.js — shared behaviour for WHITESPACE + Atlas (19 Oct 2026).
   1. backdrop(): two <video> elements cross-fade AIdeazz AI Lab promo-shoot footage (already rendered, zero new
      spend; one film per page, Elena's pick). Phones get 640x360 encodes; reduced-motion / Data Saver / 2g get the still.
   2. examples(): the 7 creatives Atlas shipped in June–July, as a permanent gallery. A static list on
      purpose, so no lane filter or data change can hide them; the server refuses to re-render them.
   3. leadForm(): the public's way in (weekly tracking, quota ran out, diagnostic) → POST api/atlas/lead.
   4. music(): the ambient track and its round sound button, the same behaviour as aideazz.xyz/api. */
(function () {
  'use strict';
  var Skin = (window.Skin = {});
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };
  Skin.esc = esc;

  /** Owner token: read once from ?token= (or ?ship_token=), kept in this tab's sessionStorage so
   *  both pages share it, and removed from the address bar so it is never copied into a link. */
  Skin.ownerToken = (function () {
    var tk = '';
    try {
      var u = new URL(location.href);
      tk = u.searchParams.get('token') || u.searchParams.get('ship_token') || '';
      if (tk) {
        try { sessionStorage.setItem('ws_owner', tk); } catch (e) {}
        u.searchParams.delete('token'); u.searchParams.delete('ship_token');
        history.replaceState(null, '', u.pathname + u.search + u.hash);
      }
      if (!tk) { try { tk = sessionStorage.getItem('ws_owner') || ''; } catch (e) {} }
    } catch (e) {}
    return tk;
  })();

  /* ── 1. film backdrop ─────────────────────────────────────────────────────── */
  Skin.backdrop = function (names) {
    var A = document.getElementById('va'), B = document.getElementById('vb');
    if (!A || !B || !names || !names.length) return;
    // One film: it plays through both elements in turn, so each loop dissolves into itself instead of jumping.
    if (names.length === 1) names = [names[0], names[0]];
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var c = navigator.connection;
    if (c && (c.saveData === true || /^(slow-)?2g$/.test(c.effectiveType || ''))) return;
    // Phones held upright get a sharp 9:16 crop (-p); small landscape screens the 640x360 cut (-m).
    var ext = window.innerWidth < 860 ? (window.innerHeight > window.innerWidth ? '-p.mp4' : '-m.mp4') : '.mp4';
    var R = names.map(function (n) { return 'media/' + n + ext; });
    // X = dissolve length; LEAD = how close to the end the next film starts (the outgoing film is shown in full,
    // then holds its last frame while the next one fades in over it).
    var cur = A, nxt = B, i = 0, hand = false, X = 1.2, LEAD = 0.25;
    var bad = {}; // clip index -> failed once (a missing clip is skipped, never retried)
    function nextGood(from) {
      for (var k = 1; k <= R.length; k++) { var j = (from + k) % R.length; if (!bad[j]) return j; }
      return -1;
    }
    function pre() {
      var j = nextGood(i);
      if (j < 0 || j === i) return; // nothing else to cue: the current clip loops
      if (nxt.dataset.src !== R[j]) { nxt.dataset.src = R[j]; nxt.dataset.idx = j; nxt.src = R[j]; nxt.load(); }
    }
    function handoff() {
      if (hand || dead) return;
      var nj = nextGood(i);
      if (nj < 0 || nj === i) { cur.loop = true; cur.currentTime = 0; cur.play().catch(function () {}); return; } // one good clip left: it loops
      if (nxt.dataset.src !== R[nj]) { pre(); cur.currentTime = 0; cur.play().catch(function () {}); return; } // next not cued yet: replay
      hand = true;
      nxt.currentTime = 0;
      nxt.play().then(function () {
        nxt.style.opacity = 1; cur.style.opacity = 0;
        setTimeout(function () {
          var f = cur; cur = nxt; nxt = f; i = +cur.dataset.idx; f.pause(); hand = false; pre();
        }, X * 1000);
      }).catch(function () { hand = false; });
    }
    function tick() {
      if (hand || !cur.duration) return;
      if (cur.duration - cur.currentTime <= LEAD) handoff();
    }
    var dead = false;
    function stop() {
      dead = true;
      [A, B].forEach(function (v) { v.removeEventListener('timeupdate', tick); v.removeEventListener('error', err); v.pause(); v.removeAttribute('src'); v.style.opacity = 0; });
    }
    function err(ev) {
      if (dead) return;
      var el = (ev && ev.target) || cur;
      var idx = +el.dataset.idx;
      if (!isNaN(idx)) bad[idx] = true;
      var j = nextGood(isNaN(idx) ? i : idx);
      if (j < 0) { stop(); return; } // every distinct clip failed: keep the still, stop asking
      el.dataset.src = '';
      if (el === nxt) { pre(); return; } // the hidden one failed: cue the next good clip, the visible film keeps playing
      i = j; cur.dataset.idx = j; cur.dataset.src = R[j]; cur.src = R[j]; cur.load();
      cur.play().then(function () { cur.style.opacity = 1; }).catch(function () {});
      pre();
    }
    // A film that reached its end before a timeupdate caught it hands off now (never restarts under a fade).
    function ended() { if (this === cur && !dead && !hand) handoff(); }
    [A, B].forEach(function (v) { v.muted = true; v.addEventListener('timeupdate', tick); v.addEventListener('error', err); v.addEventListener('ended', ended); });
    A.preload = 'auto'; B.preload = 'auto'; A.src = R[0]; A.dataset.src = R[0]; A.dataset.idx = 0;
    A.play().then(function () { A.style.opacity = 1; pre(); }).catch(function () { /* the poster stays */ });
  };

  /* ── 2. the 7 shipped creatives ───────────────────────────────────────────── */
  Skin.EXAMPLES = [
    { id: 'geo_aeo_tech_seo_makers', en: 'GEO / AEO / Tech SEO', es: 'GEO / AEO / SEO técnico', at: '2026-06-27', model: 'Flux 1.1 Pro → Runway Seedance 2' },
    { id: 'ai_marketing_studios', en: 'AI marketing studios', es: 'Estudios de marketing con IA', at: '2026-06-28', model: 'Flux 1.1 Pro → Runway Seedance 2' },
    { id: 'ai_augmented_product_building', en: 'AI-augmented product building', es: 'Producto construido con IA', at: '2026-07-01', model: 'Flux 1.1 Pro → Gemini Omni' },
    { id: 'expat_language', en: 'Expat language learning', es: 'Idiomas para expatriados', at: '2026-06-25', model: 'Flux 1.1 Pro → Runway Seedance 2' },
    { id: 'debt_finance', en: 'Debt relief', es: 'Alivio de deudas', at: '2026-06-28', model: 'Flux 1.1 Pro → Runway Seedance 2', us: true },
    { id: 'auto_insurance', en: 'Auto insurance', es: 'Seguro de auto', at: '2026-06-25', model: 'Flux 1.1 Pro → Runway Seedance 2', us: true },
    { id: 'medicare_advantage_enrollment', en: 'Medicare Advantage', es: 'Medicare Advantage', at: '2026-07-02', model: 'Flux 1.1 Pro → Runway Seedance 2', us: true },
  ];
  var EX_T = {
    en: { made: 'rendered', demo: 'US-market demo' },
    es: { made: 'renderizado', demo: 'demo mercado EE.UU.' },
  };
  Skin.examples = function (el, lang) {
    if (!el) return;
    var T = EX_T[lang] || EX_T.en;
    el.innerHTML = Skin.EXAMPLES.map(function (x) {
      return '<figure class="reel" style="margin:0">' +
        (x.us ? '<span class="tagdemo">' + esc(T.demo) + '</span>' : '') +
        '<video muted loop playsinline preload="none" poster="assets/' + x.id + '.jpg" data-src="assets/' + x.id + '.mp4"></video>' +
        '<figcaption class="cap"><b>' + esc(x[lang] || x.en) + '</b><span>' + esc(T.made) + ' ' + esc(x.at) + ' · ' + esc(x.model) + '</span></figcaption></figure>';
    }).join('');
    var vids = el.querySelectorAll('video');
    if (!('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var v = e.target;
        if (e.isIntersecting) {
          if (!v.src) v.src = v.dataset.src;
          v.play().catch(function () {});
        } else if (!v.paused) v.pause();
      });
    }, { threshold: 0.55 });
    vids.forEach(function (v) { io.observe(v); });
  };

  /* ── 3. lead capture ──────────────────────────────────────────────────────── */
  var LEAD_T = {
    en: {
      email: 'Your email', wa: 'WhatsApp (optional)', send: 'Send', sending: 'Sending…',
      ok: 'Received — we get back to you by email or WhatsApp. You can also book the $100 diagnostic now:',
      okBtn: 'Book the $100 diagnostic', bad: 'Please check the email address.', fail: 'Could not send — try again in a minute.',
    },
    es: {
      email: 'Tu email', wa: 'WhatsApp (opcional)', send: 'Enviar', sending: 'Enviando…',
      ok: 'Recibido — te contactamos por email o WhatsApp. También puedes reservar ya el diagnóstico de $100:',
      okBtn: 'Reservar el diagnóstico de $100', bad: 'Revisa el email, por favor.', fail: 'No se pudo enviar — inténtalo en un minuto.',
    },
  };
  /** opts: { kind, lang, intro (html), market(), country() } */
  Skin.leadForm = function (el, opts) {
    if (!el) return;
    var T = LEAD_T[opts.lang] || LEAD_T.en;
    el.innerHTML =
      (opts.intro ? '<p>' + opts.intro + '</p>' : '') +
      '<form class="inrow" novalidate>' +
      '<input class="field" type="email" name="email" required placeholder="' + esc(T.email) + '" autocomplete="email">' +
      '<input class="field" type="tel" name="whatsapp" placeholder="' + esc(T.wa) + '" autocomplete="tel" style="max-width:220px">' +
      '<input class="hp" type="text" name="website_hp" tabindex="-1" autocomplete="off" aria-hidden="true">' +
      '<button class="btn" type="submit">' + esc(T.send) + ' →</button></form><div class="msg" style="margin-top:10px"></div>';
    var f = el.querySelector('form'), msg = el.querySelector('.msg'), btn = f.querySelector('button');
    f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var email = f.email.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { msg.innerHTML = '<div class="err">' + esc(T.bad) + '</div>'; return; }
      btn.disabled = true; btn.textContent = T.sending;
      fetch('api/atlas/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: opts.kind, email: email, whatsapp: f.whatsapp.value.trim(), website_hp: f.website_hp.value,
          market: opts.market ? opts.market() : '', country: opts.country ? opts.country() : '', lang: opts.lang,
        }),
      }).then(function (r) { return r.json(); }).then(function (j) {
        if (!j || !j.ok) throw new Error('x');
        f.style.display = 'none';
        msg.innerHTML = '<div class="okmsg">' + esc(T.ok) + '</div><div style="margin-top:12px"><a class="btn" href="' +
          esc(j.next || ('https://aideazz.xyz/pay/analisis-tecnico?sku=diagnostic_call&lng=' + opts.lang)) + '" target="_blank" rel="noopener">' + esc(T.okBtn) + ' →</a></div>';
      }).catch(function () {
        btn.disabled = false; btn.textContent = T.send + ' →';
        msg.innerHTML = '<div class="err">' + esc(T.fail) + '</div>';
      });
    });
  };

  /* ── 4. paid layers (only real offers; the $100 diagnostic checkout is aideazz.xyz/pay) ── */
  var TIER_T = {
    en: {
      t1: ['Free', 'Whitespace scan', '$0', ['2 scans a day · 10 LatAm markets + Spain + US', 'Crowded lanes + the open angle', 'Ad copy or a GEO/AEO content brief', 'Evidence links to the live units'], 'Scan a market'],
      t2: ['Start here', 'AI Growth diagnostic', '$100', ['3-question intake: website, how customers reach you, typical sale', 'Written results on how AI search, Google and your WhatsApp treat your business', '45-minute call to walk through it', 'Credited if you continue to the full audit'], 'Book the diagnostic'],
      t3: ['Managed', 'Weekly scans + AI Growth Operator', 'Scoped on a call', ['Your market and country scanned every week, results sent to you', 'Campaign copy for the open angle; creative rendered on request', 'Set up with you inside the tools you already use: WhatsApp Business, Google Maps, Instagram', 'Website or not'], 'Ask for it'],
      contact: 'Tell us where to reach you and we get back to you.',
    },
    es: {
      t1: ['Gratis', 'Escaneo whitespace', '$0', ['2 escaneos al día · 10 mercados de LatAm + España + EE.UU.', 'Carriles saturados + el ángulo abierto', 'Copy de anuncio o brief de contenido GEO/AEO', 'Enlaces a la evidencia en vivo'], 'Escanear un mercado'],
      t2: ['Empieza aquí', 'Diagnóstico AI Growth', '$100', ['3 preguntas: sitio web, cómo te contactan, venta típica', 'Resultados escritos: cómo te tratan la búsqueda con IA, Google y tu WhatsApp', 'Llamada de 45 minutos para revisarlo', 'Se acredita si continúas a la auditoría completa'], 'Reservar el diagnóstico'],
      t3: ['Gestionado', 'Escaneos semanales + AI Growth Operator', 'Se define en una llamada', ['Tu mercado y país escaneados cada semana, resultados enviados a ti', 'Copy de campaña para el ángulo abierto; creativo renderizado a pedido', 'Configurado contigo dentro de las herramientas que ya usas: WhatsApp Business, Google Maps, Instagram', 'Con o sin sitio web'], 'Solicitarlo'],
      contact: 'Dinos dónde contactarte y te respondemos.',
    },
  };
  /** opts: { lang, freeHref, market(), country() } — contactEl opens the lead form for the managed tier. */
  Skin.tiers = function (el, contactEl, opts) {
    if (!el) return;
    var T = TIER_T[opts.lang] || TIER_T.en;
    var card = function (x, href, hot, id) {
      return '<div class="card tier' + (hot ? ' hot' : '') + '"><span class="n">' + esc(x[0]) + '</span><h3>' + esc(x[1]) + '</h3><div class="price' + (/^\$/.test(x[2]) ? '' : ' txt') + '">' + esc(x[2]) + '</div><ul>' +
        x[3].map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul><a class="btn' + (hot ? '' : ' ghost') + '"' + (id ? ' id="' + id + '"' : '') +
        ' href="' + esc(href) + '"' + (/^https?:/.test(href) ? ' target="_blank" rel="noopener"' : '') + '>' + esc(x[4]) + ' →</a></div>';
    };
    el.innerHTML = card(T.t1, opts.freeHref || './', false) +
      card(T.t2, 'https://aideazz.xyz/pay/analisis-tecnico?sku=diagnostic_call&lng=' + opts.lang, true) +
      card(T.t3, '#', false, 'askManaged');
    var ask = document.getElementById('askManaged');
    if (ask && contactEl) ask.onclick = function (e) {
      e.preventDefault();
      contactEl.style.display = 'block';
      Skin.leadForm(contactEl, { kind: 'contact', lang: opts.lang, intro: esc(T.contact), market: opts.market, country: opts.country });
      contactEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
  };

  /* ── 4. ambient music — the same behaviour as aideazz.xyz/api ─────────────────
     Browsers refuse sound until the visitor has touched the page, so this TRIES once on load (that works for a
     returning visitor the browser already trusts), then starts on the first real tap, click or key. A gesture the
     browser does not count (a scroll) leaves it armed for the next one instead of giving up. Whoever mutes stays
     muted on the next visit (localStorage); reduced-motion visitors are never started automatically. The button
     follows the <audio> element itself, so it can never claim music that is not playing. preload="none": nothing
     is downloaded for anyone it never plays for. Track: free Pixabay licence, already in the AIdeazz library. */
  Skin.music = function (base, vol) {
    var nav = document.querySelector('.nav');
    if (!nav) return;
    var KEY = 'aidz_ambient_muted', VOL = vol || 0.45, muted = false, wasOn = false, ramp = 0;
    try { muted = localStorage.getItem(KEY) === '1'; } catch (e) {}
    var calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var au = document.createElement('audio');
    au.loop = true; au.preload = 'none'; au.setAttribute('playsinline', '');
    [['.webm', 'audio/webm; codecs=opus'], ['.m4a', 'audio/mp4']].forEach(function (s) {
      var so = document.createElement('source'); so.src = base + s[0]; so.type = s[1]; au.appendChild(so);
    });
    var SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"/>';
    var ON = SVG + '<path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
    var OFF = SVG + '<path d="m16 9 5 6M21 9l-5 6"/></svg>';
    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'sndbtn';
    function paint() {
      var on = !au.paused, es = (document.documentElement.lang || '').slice(0, 2) === 'es';
      var l = on ? (es ? 'Silenciar música' : 'Mute music') : (es ? 'Activar música' : 'Play music');
      btn.innerHTML = on ? ON : OFF;
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.setAttribute('aria-label', l); btn.title = l;
    }
    function store(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }
    function play() {
      // a short volume ramp so the music arrives instead of jumping in (iOS ignores volume; harmless there)
      au.volume = 0; clearInterval(ramp);
      var t0 = Date.now();
      ramp = setInterval(function () {
        var k = Math.min(1, (Date.now() - t0) / 1400);
        au.volume = VOL * k;
        if (k >= 1) clearInterval(ramp);
      }, 70);
      var p = au.play();
      return p && p.then ? p : Promise.resolve();
    }
    var EV = ['pointerdown', 'pointerup', 'mousedown', 'touchend', 'keydown', 'click'];
    function disarm() { EV.forEach(function (e) { window.removeEventListener(e, onGesture, true); }); }
    function onGesture(ev) {
      if (ev.target && ev.target.closest && ev.target.closest('.sndbtn')) return; // the button decides for itself
      if (muted) { disarm(); return; }
      play().then(disarm).catch(function () {});
    }
    btn.onclick = function () {
      disarm();
      if (au.paused) { muted = false; store('0'); play().catch(function () {}); }
      else { muted = true; store('1'); au.pause(); }
    };
    // a hidden tab (phone locked, another tab) goes quiet and picks up again when the visitor comes back
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { wasOn = !au.paused; if (wasOn) au.pause(); }
      else if (wasOn && !muted) play().catch(function () {});
    });
    au.addEventListener('play', paint); au.addEventListener('pause', paint);
    try { new MutationObserver(paint).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] }); } catch (e) {}
    nav.appendChild(btn); // right after EN/ES, so the two page controls stay together when the nav wraps on a phone
    document.body.appendChild(au); // no controls attribute: in the page (like /api), never visible
    paint();
    if (muted || calm) return;
    play().catch(function () { EV.forEach(function (e) { window.addEventListener(e, onGesture, true); }); });
  };

  Skin.ticker = function (el, items) {
    if (!el) return;
    var row = items.map(function (s) { return '<span>' + s + '</span>'; }).join('');
    var twin = items.map(function (s) { return '<span aria-hidden="true">' + s + '</span>'; }).join('');
    el.innerHTML = '<div class="track">' + row + twin + '</div>';
  };
})();
