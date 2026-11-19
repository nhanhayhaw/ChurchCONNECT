/**
 * Building blocks shared by the five reels: scene fades, the persistent brand
 * corner, the closing end card, the screenshot frame and the cursor.
 */
(function () {
  const { p, ease, reveal, kf, lerp } = E;

  /** Opacity of a scene root: fade in over `i`, fade out over `o` at the end. */
  E.sfade = function (el, lt, dur, i = 0.45, o = 0.45) {
    const v = Math.min(p(lt, 0, i, ease.out), 1 - p(lt, dur - o, o, ease.in));
    el.style.opacity = v.toFixed(3);
    return v;
  };

  const CURSOR_SVG = `<svg viewBox="0 0 44 54" xmlns="http://www.w3.org/2000/svg"><path d="M8 4 L8 40 L17 31 L24 48 L31 45 L24 29 L37 29 Z" fill="#fff" stroke="#0F172A" stroke-width="3" stroke-linejoin="round"/></svg>`;

  /** Inserts a screenshot frame. Returns {frame, img, ring}. */
  E.screenFrame = function (parent, { src, x, y, w, h, url = 'ekklesia.redemptiontemple.org', bare = false }) {
    const frame = document.createElement('div');
    frame.className = 'screen' + (bare ? ' bare' : '');
    frame.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;`;
    frame.innerHTML = `<div class="chrome"><i></i><i></i><i></i><div class="url">${url}</div></div><div class="img-wrap"><img src="${src}" alt=""><div class="ring"></div></div>`;
    parent.appendChild(frame);
    const wrap = frame.querySelector('.img-wrap');
    wrap.dataset.maxH = String(h - (bare ? 0 : 44));
    wrap.dataset.chrome = bare ? '0' : '44';
    return { frame, wrap, img: frame.querySelector('img'), ring: frame.querySelector('.ring') };
  };

  E.cursorEl = function (parent) {
    const c = document.createElement('div');
    c.className = 'cursor';
    c.innerHTML = CURSOR_SVG;
    parent.appendChild(c);
    return c;
  };

  /** The brand corner that sits on every scene except the end card. */
  E.brandCorner = function (parent) {
    const d = document.createElement('div');
    d.className = 'corner-brand';
    d.innerHTML = `<img src="assets/logo.png" alt=""><div><b>EKKLESIA</b><span>Redemption Temple AG</span></div>`;
    parent.appendChild(d);
    const n = document.createElement('div');
    n.className = 'sample-note';
    n.textContent = 'Sample data';
    parent.appendChild(n);
    return { corner: d, note: n };
  };

  /**
   * The closing end card every reel shares: logo, wordmark, tagline, the
   * organisation, and the sample-data notice.
   */
  E.endCard = function (root, { lines = [] } = {}) {
    root.innerHTML = `
      <div class="glow" style="position:absolute;left:290px;top:520px;width:500px;height:500px;border-radius:50%;background:radial-gradient(circle, rgba(219,184,119,0.28) 0%, rgba(219,184,119,0) 70%);"></div>
      <img class="logo ec-logo" src="assets/logo.png" alt="" style="left:440px;top:600px;">
      <div class="wordmark ec-word" style="top:850px;">EKKLESIA</div>
      <div class="tagline ec-tag" style="top:968px;">Connecting People. Strengthening the Church.</div>
      <div class="small ec-sys" style="top:1050px;">Church Membership, Attendance &amp; Follow-Up<br>Management System</div>
      <div class="small ec-org" style="top:1180px;color:#fff;font-weight:600;">Redemption Temple Assemblies of God</div>
      ${lines.map((l, i) => `<div class="small ec-line" style="top:${1290 + i * 48}px;">${l}</div>`).join('')}
      <div class="small ec-note" style="top:1470px;font-size:20px;color:rgba(155,178,205,0.6);">Screens show demonstration data. Names and figures are samples.</div>
    `;
    return function render(lt, dur) {
      const q = p(lt, 0.1, 1.1, ease.outQuint);
      const logo = root.querySelector('.ec-logo');
      logo.style.opacity = q;
      logo.style.transform = `scale(${lerp(0.6, 1, q)}) translateY(${lerp(30, 0, q)}px)`;
      root.querySelector('.glow').style.opacity = (p(lt, 0.3, 1.5) * (0.85 + 0.15 * Math.sin(lt * 1.3))).toFixed(3);
      reveal(root.querySelector('.ec-word'), lt, { at: 0.55, dur: 0.9, y: 30 });
      reveal(root.querySelector('.ec-tag'), lt, { at: 0.95, dur: 0.8, y: 24 });
      reveal(root.querySelector('.ec-sys'), lt, { at: 1.3, dur: 0.8, y: 20 });
      reveal(root.querySelector('.ec-org'), lt, { at: 1.55, dur: 0.8, y: 20 });
      root.querySelectorAll('.ec-line').forEach((el, i) => reveal(el, lt, { at: 1.9 + i * 0.25, dur: 0.8, y: 20 }));
      reveal(root.querySelector('.ec-note'), lt, { at: 2.2, dur: 0.8, y: 0 });
      // Hold, then fade everything to black for the last second.
      root.style.opacity = (1 - p(lt, dur - 0.9, 0.9, ease.in)).toFixed(3);
    };
  };

  /** Sanctuary photograph with slow push and brand tint. */
  E.photoLayer = function (parent, { blur = 0 } = {}) {
    const ph = document.createElement('div');
    ph.className = 'photo';
    ph.style.backgroundImage = 'url(assets/sanctuary.jpg)';
    ph.style.filter = `blur(${blur}px) saturate(0.85)`;
    const tint = document.createElement('div');
    tint.className = 'photo-tint';
    parent.appendChild(ph); parent.appendChild(tint);
    return function (lt, dur, { from = 1.12, to = 1.0, opacity = 1 } = {}) {
      const s = lerp(from, to, p(lt, 0, dur, ease.linear));
      ph.style.transform = `scale(${s.toFixed(4)})`;
      ph.style.opacity = opacity;
    };
  };

  /** Build an app-style avatar (pastel disc, dark initials). */
  const AV = [
    ['#E0F2FE', '#075985'], ['#FEE2E2', '#991B1B'], ['#FEF3C7', '#92400E'], ['#D1FAE5', '#065F46'],
    ['#EDE9FE', '#5B21B6'], ['#E2E8F0', '#1E293B'], ['#FCE7F3', '#9D174D'],
  ];
  E.avatar = function (initials, size = 96, idx = 0) {
    const [bg, fg] = AV[idx % AV.length];
    const a = document.createElement('div');
    a.className = 'avatar';
    a.style.cssText = `width:${size}px;height:${size}px;background:${bg};color:${fg};font-size:${Math.round(size * 0.36)}px;`;
    a.textContent = initials;
    return a;
  };

  /** Gold light sweep crossing the stage between `at` and `at+dur`. */
  E.sweep = function (el, lt, at, dur = 1.2) {
    const q = p(lt, at, dur, ease.inOutSine);
    el.style.transform = `translateX(${(q * 1900).toFixed(0)}px) rotate(12deg)`;
    el.style.opacity = q > 0 && q < 1 ? '1' : '0';
  };
})();
