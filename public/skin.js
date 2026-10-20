/* skin.js — shared behaviour for WHITESPACE + Atlas (19 Oct 2026).
   1. backdrop(): two <video> elements cross-fade through AIdeazz AI Lab promo shots (already rendered,
      zero new spend). Phones get 640x360 encodes; reduced-motion / Data Saver / 2g get the still only.
   2. examples(): the 7 creatives Atlas shipped in June–July, as a permanent gallery. A static list on
      purpose, so no lane filter or data change can hide them; the server refuses to re-render them.
   3. leadForm(): the public's way in (weekly tracking, quota ran out, diagnostic) → POST api/atlas/lead. */
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
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var c = navigator.connection;
    if (c && (c.saveData === true || /^(slow-)?2g$/.test(c.effectiveType || ''))) return;
    var ext = window.innerWidth < 860 ? '-m.mp4' : '.mp4';
    var R = names.map(function (n) { return 'media/' + n + ext; });
    var cur = A, nxt = B, i = 0, hand = false, X = 1.2;
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
    function tick() {
      if (hand || !cur.duration || cur.duration - cur.currentTime > X) return;
      var nj = nextGood(i);
      if (nj < 0 || nj === i) { cur.loop = true; return; } // one good clip left: it simply loops
      if (nxt.dataset.src !== R[nj]) { pre(); return; }
      hand = true;
      nxt.currentTime = 0;
      nxt.play().then(function () {
        nxt.style.opacity = 1; cur.style.opacity = 0;
        setTimeout(function () {
          var f = cur; cur = nxt; nxt = f; i = +cur.dataset.idx; f.pause(); hand = false; pre();
        }, X * 1000);
      }).catch(function () { hand = false; });
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
    // Never freeze on a last frame. `hand` stays as it is: only the handoff's own promise clears it.
    function ended() { if (this === cur && !dead) { cur.currentTime = 0; cur.play().catch(function () {}); } }
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

  Skin.ticker = function (el, items) {
    if (!el) return;
    var row = items.map(function (s) { return '<span>' + s + '</span>'; }).join('');
    var twin = items.map(function (s) { return '<span aria-hidden="true">' + s + '</span>'; }).join('');
    el.innerHTML = '<div class="track">' + row + twin + '</div>';
  };
})();
