/* skin.js — shared behaviour for WHITESPACE + Atlas (19 Oct 2026).
   1. backdrop(): two <video> elements cross-fade AIdeazz AI Lab promo-shoot footage (already rendered, zero new
      spend; one film per page, Elena's pick). Phones get 640x360 encodes; reduced-motion / Data Saver / 2g get the still.
   2. examples(): the 7 creatives Atlas shipped in June–July, as a permanent gallery. A static list on
      purpose, so no lane filter or data change can hide them; the server refuses to re-render them.
   3. leadForm(): the public's way in (weekly tracking, quota ran out, diagnostic) → POST api/atlas/lead.
   4. music(): the ambient track and its round sound button, the same behaviour as aideazz.xyz/api.
   5. hubspot() + whatsapp(): the two chat bubbles of aideazz.xyz/api.
   6. footer(): the footer links of aideazz.xyz/api.
   7. countUp(): numbers that run up from 0, like the /api counters.
   8. lightField(): the cursor-lit dot field + drifting light of aideazz.xyz/api.
   9. nav() + faq() + lane() (21 Oct 2026): the shared header (Tools dropdown, phone panel), the FAQ list, and plain
      names for lane ids. Skin.NAME is the ONE place in this repo where the Atlas product name lives. */
(function () {
  'use strict';
  var Skin = (window.Skin = {});
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };
  Skin.esc = esc;

  /* The Atlas product name (Elena's pick, 20 Oct 2026). The wordmark stays ATLAS SHIFTED; this is the product line. */
  var NAME = (Skin.NAME = {
    en: 'The Monday Move', es: 'La Jugada del Lunes',
    tagEn: 'Your ad move this week: enter, watch, or avoid.',
    tagEs: 'Tu jugada publicitaria de la semana: entrar, vigilar o evitar.',
  });
  var PAY = 'https://aideazz.xyz/pay/analisis-tecnico?sku=diagnostic_call&lng=';
  var OP_PDF = function (lang) { return 'https://aideazz.xyz/AIdeazz_AI_Growth_Operator_2026' + (lang === 'es' ? '_ES' : '') + '.pdf'; };

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

  /* aideazz.xyz/atlas frames these pages: tell it which page is showing, so its address bar follows (radar <-> finder).
     Posted only to https://aideazz.xyz, and only after the owner token above has left location.search. */
  try {
    if (window.top !== window.self) window.parent.postMessage({ ws: 'nav', page: /atlas\.html$/.test(location.pathname) ? 'atlas' : 'finder', search: location.search }, 'https://aideazz.xyz');
  } catch (e) {}

  /* GA4 key events. This page has no GA4 of its own: framed by aideazz.xyz/atlas, the shell page fires the event on
     its property (G-TL5S8V23LT). Two names only, never personal data (no email, no phone, no typed market). */
  var TRACKED = { generate_lead: 1, contact_whatsapp: 1 };
  Skin.track = function (name, params) {
    if (!TRACKED[name]) return;
    try { if (window.gtag) window.gtag('event', name, params || {}); } catch (e) {}
    try { if (window.top !== window.self) window.parent.postMessage({ ws: 'event', name: name, params: params || {} }, 'https://aideazz.xyz'); } catch (e) {}
  };

  /* ── 1. film backdrop ─────────────────────────────────────────────────────── */
  Skin.backdrop = function (names) {
    if (window.__wsFwd) return; // the page is moving to aideazz.xyz/atlas: start nothing here
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
      '<form class="inrow" novalidate data-hs-do-not-collect="true">' +
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
        Skin.track('generate_lead', { form: opts.kind || '', lang: opts.lang || '' });
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
    if (window.__wsFwd) return; // the page is moving to aideazz.xyz/atlas: start nothing here
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

  /* ── 5. chat bubbles — the same two channels as aideazz.xyz/api ─────────────────
     HubSpot chat sits bottom-RIGHT (the portal's chatflow targets every URL, so the loader alone shows it). WhatsApp
     sits bottom-LEFT, because HubSpot's launcher is anchored bottom-right above everything and would cover it. No
     WhatsApp API and no backend: a wa.me link. Outside Panama business hours it stops promising a fast reply and offers
     a booking link instead, so a late visitor still has a concrete next step. Ported from WhatsAppFloat.tsx. */
  Skin.hubspot = function () {
    if (window.__wsFwd) return; // the page is moving to aideazz.xyz/atlas: start nothing here
    if (document.getElementById('hs-script-loader')) return;
    var s = document.createElement('script');
    s.id = 'hs-script-loader'; s.async = true; s.defer = true;
    // ?v= is a fresh cache key: on 26 Jul HubSpot's edge served a copy without the chat (see aideazz index.html)
    s.src = 'https://js-na1.hs-scripts.com/51409153.js?v=20260726';
    document.body.appendChild(s);
  };

  var WA_PHONE = '50761666716';
  var WA_T = {
    en: { header: 'Chat on WhatsApp', online: 'Online', away: 'Away',
      hiOn: 'Hello 👋 Thanks for looking at my work. Message me directly — I usually reply fast.',
      hiAway: 'I’m offline right now 🌙 Leave a message and I’ll reply as soon as I’m back — or grab a time that works for you below.',
      open: 'Open Chat', send: 'Send a Message', book: 'Book a Call', close: 'Close chat', launch: 'Open WhatsApp chat',
      prefill: 'Hi Elena — I saw your AIdeazz portfolio and I’d like to talk.' },
    es: { header: 'Chatea por WhatsApp', online: 'En línea', away: 'Ausente',
      hiOn: '¡Hola! 👋 Gracias por ver mi trabajo. Escríbeme directamente — suelo responder rápido.',
      hiAway: 'Ahora estoy desconectada 🌙 Déjame un mensaje y te respondo en cuanto vuelva — o agenda un horario que te convenga abajo.',
      open: 'Abrir chat', send: 'Enviar mensaje', book: 'Agendar una llamada', close: 'Cerrar chat', launch: 'Abrir chat de WhatsApp',
      prefill: 'Hola Elena — vi tu portafolio de AIdeazz y me gustaría conversar.' }
  };
  /** The same wa.me link + label the bubble uses, for an in-page "Chat on WhatsApp" link (FAQ "Still have questions?"). */
  Skin.waLink = function (lang, prefill) {
    var L = WA_T[lang === 'es' ? 'es' : 'en'];
    var msg = (prefill && prefill[lang === 'es' ? 'es' : 'en']) || L.prefill;
    return { url: 'https://wa.me/' + WA_PHONE + '?text=' + encodeURIComponent(msg), label: L.header };
  };

  Skin.whatsapp = function (opts) {
    if (window.__wsFwd) return; // the page is moving to aideazz.xyz/atlas: start nothing here
    opts = opts || {};
    var PHONE = WA_PHONE, TZ = 'America/Panama', OPEN = 9, CLOSE = 17, DAYS = [1, 2, 3, 4, 5, 6];
    var BOOK = 'https://calendly.com/elena_revicheva/coffee-chat';
    var T = WA_T;
    function svg(d, n) {
      return '<svg viewBox="0 0 24 24" width="' + n + '" height="' + n + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
    }
    var MSG = '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>', X = '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>';
    var SEND = '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>';
    var CAL = '<path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h5"/><path d="M17.5 17.5 16 16.3V14"/><circle cx="16" cy="16" r="6"/>';
    // Hour and weekday in Panama, whatever the visitor's own clock says.
    function nowInZone() {
      try {
        var parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hour12: false, weekday: 'short' }).formatToParts(new Date());
        var h = '0', w = '';
        parts.forEach(function (p) { if (p.type === 'hour') h = p.value; if (p.type === 'weekday') w = p.value; });
        var map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
        return { hour: parseInt(h, 10) % 24, day: w in map ? map[w] : new Date().getDay() };
      } catch (e) { var d = new Date(); return { hour: d.getHours(), day: d.getDay() }; }
    }
    function lang() { return (document.documentElement.lang || '').slice(0, 2) === 'es' ? 'es' : 'en'; }
    var root = document.createElement('div');
    root.className = 'wafloat';
    root.innerHTML = '<div class="wacard" hidden></div><div class="walaunch"><span class="waping"></span><span class="waping two"></span>' +
      '<button type="button" class="wabtn" aria-expanded="false"></button></div>';
    document.body.appendChild(root);
    var card = root.querySelector('.wacard'), btn = root.querySelector('.wabtn'), isOpen = false;
    function paint() {
      var lg = lang(), L = T[lg], z = nowInZone();
      var on = DAYS.indexOf(z.day) >= 0 && z.hour >= OPEN && z.hour <= CLOSE;
      var msg = (opts.prefill && opts.prefill[lg]) || L.prefill;
      var url = 'https://wa.me/' + PHONE + '?text=' + encodeURIComponent(msg);
      card.innerHTML = '<div class="wahead">' + svg(MSG, 20) + '<b>' + esc(L.header) + '</b>' +
        '<span class="wastat' + (on ? ' on' : '') + '"><i class="wadot"></i>' + esc(on ? L.online : L.away) + '</span>' +
        '<button type="button" class="wax" aria-label="' + esc(L.close) + '">' + svg(X, 16) + '</button></div>' +
        '<div class="wabody"><div class="wamsg">' + esc(on ? L.hiOn : L.hiAway) + '</div>' +
        '<a class="wacta" href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(on ? L.open : L.send) + ' ' + svg(SEND, 16) + '</a>' +
        (on ? '' : '<a class="wabook" href="' + BOOK + '" target="_blank" rel="noopener">' + svg(CAL, 16) + ' ' + esc(L.book) + '</a>') + '</div>';
      card.querySelector('.wax').onclick = function () { set(false); };
      card.querySelector('.wacta').onclick = function () {
        Skin.track('contact_whatsapp', { placement: 'float', state: on ? 'online' : 'away', page: opts.page || '' });
      };
      btn.setAttribute('aria-label', isOpen ? L.close : L.launch);
      btn.innerHTML = isOpen ? svg(X, 24) : svg(MSG, 28);
    }
    // online / away is worked out again on every open, not only at page load
    function set(v) { isOpen = v; root.classList.toggle('open', v); card.hidden = !v; btn.setAttribute('aria-expanded', v ? 'true' : 'false'); paint(); }
    btn.onclick = function () { set(!isOpen); };
    try { new MutationObserver(paint).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] }); } catch (e) {}
    paint();
  };

  /* ── 6. footer — the same exits as aideazz.xyz/api ──────────────────────────────
     Resources + Company exactly as on /api (src/pages/LabApi.tsx footer); the /api link stays, named for what it is.
     The two decks open in the reader's language, like on /api. "Start a project" lands on the portfolio inquiry form
     with this page as the UTM source, so a lead from here is told apart in HubSpot. */
  Skin.footer = function (page) {
    var cols = document.getElementById('footCols');
    if (!cols) return;
    var SITE = 'https://aideazz.xyz';
    var T = {
      en: { res: 'Resources', co: 'Company', about: 'Human-Backed AI', api: 'GEO/AEO Visibility API', start: 'Start a project',
        pol: 'Service Policies', rights: 'All rights reserved', tools: 'Tools', portfolio: 'Portfolio ↗' },
      es: { res: 'Recursos', co: 'Empresa', about: 'IA con respaldo humano', api: 'API de visibilidad GEO/AEO', start: 'Empezar un proyecto',
        pol: 'Políticas de servicio', rights: 'Todos los derechos reservados', tools: 'Herramientas', portfolio: 'Portafolio ↗' }
    };
    var start = SITE + '/portfolio?utm_source=' + encodeURIComponent(page || 'atlas') +
      '&utm_medium=web&utm_campaign=atlas-shifted&utm_content=start-project#portfolio-inquiry-form';
    function a(href, text, cls) {
      var ext = href.indexOf('mailto:') !== 0;
      return '<a href="' + esc(href) + '"' + (ext ? ' target="_blank" rel="noopener"' : '') + (cls ? ' class="' + cls + '"' : '') + '>' + esc(text) + '</a>';
    }
    // the two tools themselves are relative links in the same tab (the pages are framed under aideazz.xyz/atlas)
    function own(href, text) { return '<a href="' + esc(href) + '">' + esc(text) + '</a>'; }
    function paint() {
      var es = (document.documentElement.lang || '').slice(0, 2) === 'es', L = T[es ? 'es' : 'en'], deck = es ? '_ES' : '';
      cols.innerHTML =
        '<div><span class="eyebrow">' + esc(L.tools) + '</span>' +
          own('./', 'WHITESPACE') +
          own('atlas.html', 'Atlas · ' + NAME[es ? 'es' : 'en']) +
          a(SITE + '/portfolio', L.portfolio) + '</div>' +
        '<div><span class="eyebrow">' + esc(L.res) + '</span>' +
          a(SITE + '/Elena_Revicheva_Professional_Outlook_2026' + deck + '.pdf?v=20261011c', L.about) +
          a('https://www.youtube.com/@AIdeazz', 'YouTube') +
          a(SITE + '/ai-ops-wiki.html', 'AI Ops Wiki') +
          a(SITE + '/blog', 'Blog') + '</div>' +
        '<div><span class="eyebrow">' + esc(L.co) + '</span>' +
          a(SITE + '/AIdeazz_AI_Growth_Operator_2026' + deck + '.pdf', 'AI Growth Operator') +
          a(SITE + '/api', L.api) +
          a('mailto:aipa@aideazz.xyz', 'aipa@aideazz.xyz') +
          a(start, L.start, 'hi') +
          a(SITE + '/policies.html', L.pol) + '</div>';
      var r = document.getElementById('fRights');
      if (r) r.textContent = L.rights;
    }
    var y = document.getElementById('fYear');
    if (y) y.textContent = String(new Date().getFullYear());
    paint();
    try { new MutationObserver(paint).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] }); } catch (e) {}
  };

  /* ── 7. count-up — the stats run up from 0, like the counters on aideazz.xyz/api ──────────────
     Same curve as /api's useCountUp (easeOutQuart over 2 s), started when the stats scroll into view. A value
     already on screen is not re-run when the page refreshes its data (only a changed number moves, from where it
     was); reduced-motion visitors get the final number at once. Numbers use the reader's grouping (3,519). */
  var counted = {}, seen = false, pendingRun = null;
  function numFmt(lang) {
    try { return new Intl.NumberFormat(lang === 'es' ? 'es-PA' : 'en-US'); } catch (e) { return { format: String }; }
  }
  function runCount(root, lang) {
    var fmt = numFmt(lang);
    var calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    Array.prototype.forEach.call(root.querySelectorAll('[data-count]'), function (el) {
      var end = +el.getAttribute('data-count') || 0, key = el.getAttribute('data-key') || '';
      var from = counted[key] != null ? counted[key] : 0;
      counted[key] = end;
      if (calm || from === end || !window.requestAnimationFrame) { el.textContent = fmt.format(end); return; }
      var t0 = null, D = 2000;
      el.textContent = fmt.format(from);
      (function step(ts) {
        if (t0 === null) t0 = ts;
        var p = Math.min((ts - t0) / D, 1), k = 1 - Math.pow(1 - p, 4);
        el.textContent = fmt.format(Math.floor(from + (end - from) * k));
        if (p < 1) requestAnimationFrame(step); else el.textContent = fmt.format(end);
      })(performance.now());
    });
  }
  Skin.countUp = function (root, lang) {
    if (!root) return;
    pendingRun = function () { runCount(root, lang); };
    if (seen || !('IntersectionObserver' in window)) { seen = true; pendingRun(); return; }
    // Until the stats are on screen they hold their REAL values (never a 0 for a screenshot or a reader that does
    // not scroll); the count-up from 0 starts the moment the first pixel of them is visible.
    var fmt = numFmt(lang);
    Array.prototype.forEach.call(root.querySelectorAll('[data-count]'), function (el) { el.textContent = fmt.format(+el.getAttribute('data-count') || 0); });
    if (root._cuObs) return;   // already waiting for it to come into view; the latest data runs then
    root._cuObs = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) if (entries[i].isIntersecting) {
        seen = true; root._cuObs.disconnect(); if (pendingRun) pendingRun(); return;
      }
    }, { threshold: 0 });
    root._cuObs.observe(root);
  };

  /* ── 8. light field — the aideazz.xyz/api torch (HeroBackdrop.tsx, read off hud.ai), ported ───────────
     A field of tiny square dots, each twinkling on its own phase (a shared phase reads as a screensaver), coloured
     gold -> white -> violet across the width. The pointer is a torch, not a cursor: the field sits low everywhere and
     lifts only where the visitor looks, easing after the mouse so it never snaps. The three CSS light rays drift with
     the pointer, each at its own depth. Touch screens have no hover, so there the field glows a little on its own,
     at ~30 fps. Reduced motion or no canvas: the static dot texture stays and nothing runs. */
  Skin.lightField = function () {
    if (window.__wsFwd) return;
    var bd = document.querySelector('.bd');
    if (!bd || !window.requestAnimationFrame) return;
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var c = document.createElement('canvas'), x = c.getContext && c.getContext('2d');
    if (!x) return;
    c.className = 'lf';
    var veil = bd.querySelector('.veil');
    bd.insertBefore(c, veil ? veil.nextSibling : null);
    bd.classList.add('bd--lit');
    var W = 0, H = 0, DPR = Math.min(window.devicePixelRatio || 1, 2);
    function size() { W = c.clientWidth; H = c.clientHeight; c.width = W * DPR; c.height = H * DPR; x.setTransform(DPR, 0, 0, DPR, 0, 0); }
    size();
    addEventListener('resize', size, { passive: true });
    var ptr = { x: -9999, y: -9999, tx: -9999, ty: -9999, lit: false };
    addEventListener('pointermove', function (e) {
      if (e.pointerType === 'touch') return;
      ptr.tx = e.clientX; ptr.ty = e.clientY;
      if (!ptr.lit) { ptr.x = e.clientX; ptr.y = e.clientY; ptr.lit = true; }
    }, { passive: true });
    document.addEventListener('mouseout', function (e) { if (!e.relatedTarget) ptr.lit = false; });
    var coarse = !!(window.matchMedia && matchMedia('(hover: none)').matches);
    var AMB = coarse ? 0.24 : 0.13, SPOT = coarse ? 0 : 0.75, R2 = 320 * 320, GAP = 12, DOT = 2, last = 0;
    function frame(t) {
      requestAnimationFrame(frame);
      if (coarse && t - last < 33) return;   // ~30 fps on phones
      last = t;
      x.clearRect(0, 0, W, H);
      var cx = W * 0.5, cy = H * 0.52, rad = Math.hypot(W, H) * 0.58;
      var breathe = Math.sin(t * 0.00035) * 0.14 + 0.86;
      ptr.x += (ptr.tx - ptr.x) * 0.12;
      ptr.y += (ptr.ty - ptr.y) * 0.12;
      for (var gy = 0; gy < H; gy += GAP) {
        for (var gx = 0; gx < W; gx += GAP) {
          var d = Math.hypot(gx - cx, gy - cy) / rad, blob = Math.max(0, 1 - d * d);
          var edge = Math.min(1, Math.min(gx, W - gx) / 90, Math.min(gy, H - gy) / 90), f = blob * edge;
          if (f <= 0.015) continue;
          var hash = (gx * 12.9898 + gy * 78.233) % 6.283;          // neighbours are never in step
          var flick = 0.42 + 0.58 * Math.abs(Math.sin(t * 0.0026 + hash));
          var hx = gx / W + Math.sin(t * 0.00016) * 0.09;
          var R = Math.round(255 - Math.max(0, hx - 0.42) * 168), G = Math.round(240 - Math.abs(hx - 0.5) * 150), B = Math.round(188 + hx * 67);
          var px = gx - ptr.x, py = gy - ptr.y, sd = (px * px + py * py) / R2;
          var spot = ptr.lit && sd < 1 ? (1 - sd) * (1 - sd) : 0;
          var a = f * flick * breathe * (AMB + SPOT * spot);
          if (a < 0.012) continue;
          x.fillStyle = 'rgba(' + R + ',' + G + ',' + B + ',' + a.toFixed(3) + ')';
          x.fillRect(gx, gy, DOT, DOT);
        }
      }
      // the rays slide with the pointer, each at its own depth (CSS reads --px/--py)
      bd.style.setProperty('--px', ptr.lit ? (ptr.x - W / 2).toFixed(1) : '0');
      bd.style.setProperty('--py', ptr.lit ? (ptr.y - H / 2).toFixed(1) : '0');
    }
    requestAnimationFrame(frame);
  };

  Skin.ticker = function (el, items) {
    if (!el) return;
    var row = items.map(function (s) { return '<span>' + s + '</span>'; }).join('');
    var twin = items.map(function (s) { return '<span aria-hidden="true">' + s + '</span>'; }).join('');
    el.innerHTML = '<div class="track">' + row + twin + '</div>';
  };

  /* ── 9. shared header: Tools dropdown (desktop) + one panel behind ☰ (phone/tablet) ───────────────
     The header markup is static in both pages; texts, hrefs and behaviour come from here. The Tools items are the same
     items, in the same words, as the WHITESPACE "Two tools" section and the footer Tools column. */
  var SVG0 = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  Skin.ICONS = {
    // dashed square + magnifier: the open space nobody is running
    scan: SVG0 + '<rect x="3" y="3" width="12" height="12" rx="2" stroke-dasharray="2.6 2.4"/><circle cx="15" cy="15" r="4.2"/><path d="m18.2 18.2 2.8 2.8"/></svg>',
    // globe + two wave lines: the weekly market reading
    globe: SVG0 + '<circle cx="12" cy="8.5" r="6"/><ellipse cx="12" cy="8.5" rx="2.5" ry="6"/><path d="M6 8.5h12"/><path d="M3 18c1.5-1.2 3-1.2 4.5 0s3 1.2 4.5 0 3-1.2 4.5 0 3 1.2 4.5 0"/><path d="M3 21.5c1.5-1.2 3-1.2 4.5 0s3 1.2 4.5 0 3-1.2 4.5 0 3 1.2 4.5 0"/></svg>',
    // </> brackets + dot: the API
    api: SVG0 + '<path d="m8 7-5 5 5 5"/><path d="m16 7 5 5-5 5"/><path d="m13.5 4.5-3 15"/><circle cx="20" cy="3.8" r="1.4" fill="currentColor" stroke="none"/></svg>',
    // chat bubble + check (the WhatsApp bubble's own path): the AI Growth Operator
    op: SVG0 + '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="m8.5 12 2.5 2.5 5-5"/></svg>',
  };
  var NAV_T = (Skin.NAV_T = {
    en: {
      tools: 'Tools', how: 'How it works', pricing: 'Pricing', faq: 'FAQ', free: 'Free scan', cta: '$100 diagnostic',
      menuCta: 'Book the $100 diagnostic →', menu: 'Menu', main: 'Main', g1: 'Ad intelligence', g2: 'For your business',
      ws: ['WHITESPACE · free scan', 'The ad or content angle nobody is running yet.'],
      atlas: ['Atlas · ' + NAME.en, 'Every Monday: which ad angles are opening, which are crowded.'],
      api: ['GEO/AEO Visibility API ↗', 'Free audit: can AI find, understand and cite your site?'],
      op: ['AI Growth Operator ↗', 'Set up with you inside WhatsApp Business, Google Maps and Instagram — website or not.'],
    },
    es: {
      tools: 'Herramientas', how: 'Cómo funciona', pricing: 'Precios', faq: 'FAQ', free: 'Escaneo gratis', cta: 'Diagnóstico de $100',
      menuCta: 'Reservar el diagnóstico de $100 →', menu: 'Menú', main: 'Principal', g1: 'Inteligencia publicitaria', g2: 'Para tu negocio',
      ws: ['WHITESPACE · escaneo gratis', 'El ángulo de anuncio o contenido que nadie usa todavía.'],
      atlas: ['Atlas · ' + NAME.es, 'Cada lunes: qué ángulos se abren y cuáles están saturados.'],
      api: ['API de visibilidad GEO/AEO ↗', 'Auditoría gratis: ¿puede la IA encontrar, entender y citar tu sitio?'],
      op: ['AI Growth Operator ↗', 'Configurado contigo dentro de WhatsApp Business, Google Maps e Instagram — con o sin sitio web.'],
    },
  });
  /** The 4 tool links (also used by the WHITESPACE "Two tools" section). */
  Skin.toolHref = function (key, page, lang) {
    if (key === 'ws') return page === 'whitespace' ? '#tool' : './';
    if (key === 'atlas') return 'atlas.html';
    if (key === 'api') return 'https://aideazz.xyz/api';
    return OP_PDF(lang);
  };
  var CHEV = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 4.5 3 3 3-3"/></svg>';
  var BURGER = SVG0 + '<path d="M4 7h16M4 12h16M4 17h16"/></svg>';
  var CLOSE = SVG0 + '<path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
  var navS = { bound: false, onLang: null };
  /** opts: { page: 'whitespace'|'atlas', lang, onLang(l) } — call it from every language paint; binds only once. */
  Skin.nav = function (opts) {
    opts = opts || {};
    var lang = opts.lang === 'es' ? 'es' : 'en', T = NAV_T[lang], page = opts.page === 'atlas' ? 'atlas' : 'whitespace';
    var top = document.getElementById('top'), menu = document.getElementById('menu');
    if (!top || !menu) return;
    var free = Skin.toolHref('ws', page, lang);
    function txt(id, s, href) {
      var el = document.getElementById(id);
      if (!el) return;
      el.textContent = s;
      if (href != null) el.setAttribute('href', href);
    }
    var tb = document.getElementById('navTools');
    if (tb) tb.innerHTML = '<span>' + esc(T.tools) + '</span>' + CHEV;
    txt('navHow', T.how, '#how'); txt('navPricing', T.pricing, '#pricing'); txt('navFaq', T.faq, '#faq');
    txt('navFree', T.free, free); txt('menuFree', T.free, free);
    txt('navCta', T.cta, PAY + lang); txt('menuCta', T.menuCta, PAY + lang);
    menu.setAttribute('aria-label', T.main);
    var dd = document.getElementById('ddTools');
    if (dd) {
      var item = function (key, icon) {
        var href = Skin.toolHref(key, page, lang), ext = /^https?:/.test(href);
        var cur = (key === 'ws' && page === 'whitespace') || (key === 'atlas' && page === 'atlas');
        return '<a class="dditem" href="' + esc(href) + '"' + (ext ? ' target="_blank" rel="noopener"' : '') + (cur ? ' aria-current="page"' : '') + '>' +
          '<span class="ddi">' + Skin.ICONS[icon] + '</span><span class="ddx"><span class="ddt">' + esc(T[key][0]) + '</span>' +
          '<span class="ddb">' + esc(T[key][1]) + '</span></span></a>';
      };
      dd.innerHTML = '<span class="ddg">' + esc(T.g1) + '</span>' + item('ws', 'scan') + item('atlas', 'globe') +
        '<div class="ddsep" role="separator"></div><span class="ddg">' + esc(T.g2) + '</span>' + item('api', 'api') + item('op', 'op');
    }
    navS.onLang = opts.onLang || null;
    Array.prototype.forEach.call(document.querySelectorAll('[data-lang]'), function (b) {
      var on = b.getAttribute('data-lang') === lang;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    var burger = document.getElementById('burger');
    if (burger) {
      var isOpen = top.classList.contains('open');
      burger.setAttribute('aria-label', T.menu);
      burger.innerHTML = isOpen ? CLOSE : BURGER;
    }
    if (navS.bound) return;
    navS.bound = true;

    var ddWrap = tb ? tb.closest('.dd') : null;
    var wide = window.matchMedia ? matchMedia('(min-width:1360px)') : { matches: true };
    var hover = window.matchMedia ? matchMedia('(hover:hover) and (min-width:1360px)') : { matches: false };
    var tOpen = 0, tClose = 0, byHover = false;
    function setDd(v) {
      if (!ddWrap) return;
      clearTimeout(tOpen); clearTimeout(tClose);
      ddWrap.classList.toggle('open', v);
      tb.setAttribute('aria-expanded', v ? 'true' : 'false');
      if (!v) byHover = false;
    }
    function ddOpen() { return !!(ddWrap && ddWrap.classList.contains('open')); }
    function setPanel(v) {
      top.classList.toggle('open', v);
      if (burger) {
        burger.setAttribute('aria-expanded', v ? 'true' : 'false');
        burger.innerHTML = v ? CLOSE : BURGER;
      }
    }
    function panelOpen() { return top.classList.contains('open'); }
    if (burger) burger.addEventListener('click', function () { setPanel(!panelOpen()); });
    if (tb) {
      tb.addEventListener('click', function () {
        if (!ddOpen()) { setDd(true); return; }
        if (byHover) { byHover = false; return; } // opened by hover a moment ago: the click keeps it open
        setDd(false);
      });
    }
    if (ddWrap) {
      ddWrap.addEventListener('mouseenter', function () {
        if (!hover.matches) return;
        clearTimeout(tClose);
        if (ddOpen()) return;
        tOpen = setTimeout(function () { setDd(true); byHover = true; }, 120);
      });
      ddWrap.addEventListener('mouseleave', function () {
        if (!hover.matches) return;
        clearTimeout(tOpen);
        tClose = setTimeout(function () { setDd(false); }, 180);
      });
    }
    // a tap on any link in the menu (anchor or page) closes the panel and the dropdown
    menu.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a');
      if (!a) return;
      setDd(false); setPanel(false);
    });
    // every EN/ES button on the page (header row and panel) switches the language
    document.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-lang]');
      if (b && navS.onLang) { e.preventDefault(); navS.onLang(b.getAttribute('data-lang') === 'es' ? 'es' : 'en'); return; }
      // "inside" is read from the path the event took, not from e.target: tapping the ☰ swaps its icon for an ✕, so the
      // tapped <svg> is already detached here and contains() would call it "outside" and close the menu it just opened.
      var path = e.composedPath ? e.composedPath() : [];
      var inside = function (el) { return !!el && (path.indexOf(el) >= 0 || el.contains(e.target)); };
      if (ddOpen() && ddWrap && !inside(ddWrap)) setDd(false);
      if (panelOpen() && !inside(top)) setPanel(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' && e.key !== 'Esc') return;
      if (ddOpen()) { setDd(false); if (tb) tb.focus(); return; }
      if (panelOpen()) { setPanel(false); if (burger) burger.focus(); }
    });
    var onWide = function () { if (wide.matches) setPanel(false); else setDd(false); };
    if (wide.addEventListener) wide.addEventListener('change', onWide); else if (wide.addListener) wide.addListener(onWide);
  };

  /* ── 10. FAQ: plain text only, so what a visitor reads is word for word what the FAQPage JSON-LD says ── */
  Skin.faq = function (el, items) {
    if (!el) return;
    el.innerHTML = (items || []).map(function (x) {
      return '<details class="qa"><summary><h3>' + esc(x.q) + '</h3></summary><p>' + esc(x.a) + '</p></details>';
    }).join('');
  };

  /* ── 11. plain names for lane ids (the board, the select, the drawer, the campaign cards) ── */
  Skin.LANES = {
    ai_automation: { en: 'AI automation', es: 'Automatización con IA' },
    whatsapp_ai_agents: { en: 'WhatsApp AI agents', es: 'Agentes de WhatsApp con IA' },
    fractional_cto: { en: 'Fractional CTO', es: 'CTO fraccional' },
    ai_film_making_studios: { en: 'AI film-making studios', es: 'Estudios de cine con IA' },
    ai_reliability_and_rescue: { en: 'AI reliability & rescue', es: 'Confiabilidad y rescate de IA' },
    ai_video_generation: { en: 'AI video generation', es: 'Generación de video con IA' },
    personal_ai_companions_on_the_go: { en: 'Personal AI companions on the go', es: 'Compañeros personales de IA siempre contigo' },
    health_supplements: { en: 'Health supplements', es: 'Suplementos de salud' },
    solar: { en: 'Solar', es: 'Energía solar' },
  };
  /** EXAMPLES, then LANES, then the tracked lane's own label (Atlas data), else the id with spaces. */
  Skin.lane = function (id, lang, tracked) {
    var k = String(id == null ? '' : id), l = lang === 'es' ? 'es' : 'en';
    for (var i = 0; i < Skin.EXAMPLES.length; i++) if (Skin.EXAMPLES[i].id === k) return Skin.EXAMPLES[i][l] || Skin.EXAMPLES[i].en;
    if (Skin.LANES[k]) return Skin.LANES[k][l] || Skin.LANES[k].en;
    var tv = tracked;
    if (!tv) { try { tv = (typeof ATLAS_DATA !== 'undefined' && ATLAS_DATA && ATLAS_DATA.tracked_verticals) || null; } catch (e) { tv = null; } }
    if (tv && tv.length) for (var j = 0; j < tv.length; j++) if (tv[j] && tv[j].id === k && tv[j].label) return String(tv[j].label);
    return k.replace(/_/g, ' ');
  };
})();
