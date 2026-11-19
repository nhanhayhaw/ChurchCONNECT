/**
 * Frame-accurate motion engine for the Ekklesia reels.
 *
 * Nothing here runs on a clock. Every visual is a pure function of time `t`
 * (seconds); the renderer calls window.__seek(t) for each frame and takes a
 * screenshot, so the output is identical on every run and never drops a frame.
 *
 * A reel declares scenes: { id, el, render(lt, dur, t) }. The scene's start and
 * end come from the timeline JSON produced by voiceover.mjs (the voice-over
 * duration decides how long each scene is held), so timing lives in one place.
 */
(function () {
  const W = 1080, H = 1920;

  const ease = {
    linear: (x) => x,
    out: (x) => 1 - Math.pow(1 - x, 3),
    in: (x) => x * x * x,
    inOut: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
    outExpo: (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
    outBack: (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
    outQuint: (x) => 1 - Math.pow(1 - x, 5),
    inOutSine: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
  };

  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, p) => a + (b - a) * p;

  /** Progress 0..1 of time `t` across [t0, t0+dur], eased. */
  function p(t, t0, dur, e = ease.out) {
    if (dur <= 0) return t >= t0 ? 1 : 0;
    return e(clamp((t - t0) / dur));
  }

  /**
   * Piecewise keyframe interpolation. keys: [[time, value], ...] where value is
   * a number or an array of numbers. Holds first/last values outside the range.
   */
  function kf(t, keys, e = ease.inOut) {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      if (t <= keys[i][0]) {
        const [ta, va] = keys[i - 1], [tb, vb] = keys[i];
        const q = e(clamp((t - ta) / (tb - ta)));
        return Array.isArray(va) ? va.map((v, k) => lerp(v, vb[k], q)) : lerp(va, vb, q);
      }
    }
    return keys[keys.length - 1][1];
  }

  /** Fade/slide an element in at `at` (seconds into the scene), out at `until`. */
  function reveal(el, lt, { at = 0, dur = 0.7, until = Infinity, outDur = 0.5, y = 36, x = 0, scale = 1, e = ease.outQuint } = {}) {
    const q = p(lt, at, dur, e);
    const qo = until === Infinity ? 0 : p(lt, until, outDur, ease.in);
    const o = q * (1 - qo);
    el.style.opacity = o.toFixed(3);
    const ty = y * (1 - q) - 20 * qo;
    const tx = x * (1 - q);
    const s = lerp(scale, 1, q);
    el.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${s.toFixed(4)})`;
    el.style.visibility = o <= 0.001 ? 'hidden' : 'visible';
    return q;
  }

  /** Reveal a list of elements one after another. */
  function stagger(els, lt, { at = 0, gap = 0.12, ...rest } = {}) {
    els.forEach((el, i) => reveal(el, lt, { at: at + i * gap, ...rest }));
  }

  /** Counts a number up with tabular digits. */
  function countUp(el, lt, { at = 0, dur = 1.2, to = 0, from = 0, suffix = '', e = ease.outExpo } = {}) {
    const v = Math.round(lerp(from, to, p(lt, at, dur, e)));
    el.textContent = v.toLocaleString('en-GB') + suffix;
  }

  /** Typewriter. */
  function typeText(el, text, lt, { at = 0, cps = 28 } = {}) {
    const n = clamp(Math.floor((lt - at) * cps), 0, text.length);
    el.textContent = text.slice(0, n);
    const caret = el.nextElementSibling && el.nextElementSibling.classList.contains('caret') ? el.nextElementSibling : null;
    if (caret) caret.style.opacity = n < text.length || Math.floor(lt * 2) % 2 === 0 ? '1' : '0';
    return n >= text.length;
  }

  /**
   * Screenshot camera. The frame (`.screen`) clips an <img> of a 2x capture.
   * (cx, cy) is the point in the image (natural pixels) placed at the frame's
   * centre; `zoom` is the image scale. A 2x capture at zoom 0.5 is the native
   * desktop size; 1.0 is a crisp 2x push-in.
   */
  function camera(frameEl, imgEl, cx, cy, zoom) {
    const fw = frameEl.clientWidth;
    const iw = imgEl.naturalWidth * zoom, ih = imgEl.naturalHeight * zoom;
    // The frame is never taller than the capture: it shrinks to the image for
    // the overview and grows back as the camera pushes in, so no backing shows.
    const maxH = frameEl.dataset.maxH ? +frameEl.dataset.maxH : frameEl.clientHeight;
    const fh = Math.min(maxH, Math.floor(ih));
    if (frameEl.dataset.maxH) {
      const chrome = +(frameEl.dataset.chrome || 0);
      frameEl.style.height = fh + 'px';
      frameEl.parentElement.style.height = (fh + chrome) + 'px';
    }
    let tx = fw / 2 - cx * zoom, ty = fh / 2 - cy * zoom;
    if (iw >= fw) tx = Math.min(0, Math.max(fw - iw, tx)); else tx = (fw - iw) / 2;
    ty = Math.min(0, Math.max(fh - ih, ty));
    imgEl.style.transformOrigin = '0 0';
    imgEl.style.transform = `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${zoom.toFixed(4)})`;
  }

  /** Camera driven by keyframes of [cx, cy, zoom]. */
  function cameraKf(frameEl, imgEl, lt, keys, e = ease.inOutSine) {
    const [cx, cy, z] = kf(lt, keys, e);
    camera(frameEl, imgEl, cx, cy, z);
  }

  /** A soft highlight ring positioned over a region of the camera image. */
  function highlight(ringEl, frameEl, imgEl, lt, { at = 0, dur = 0.5, until = Infinity, x, y, w, h, pad = 10 } = {}) {
    const m = imgEl.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/);
    if (!m) return;
    const tx = +m[1], ty = +m[2], z = +m[3];
    ringEl.style.left = (tx + (x - pad) * z) + 'px';
    ringEl.style.top = (ty + (y - pad) * z) + 'px';
    ringEl.style.width = ((w + 2 * pad) * z) + 'px';
    ringEl.style.height = ((h + 2 * pad) * z) + 'px';
    const o = p(lt, at, dur) * (1 - (until === Infinity ? 0 : p(lt, until, 0.35)));
    ringEl.style.opacity = o.toFixed(3);
  }

  /** Stage coordinates of a point (natural px) in a camera image. */
  function toStage(frameEl, imgEl, x, y) {
    const m = imgEl.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/);
    if (!m) return [0, 0];
    const screen = frameEl.parentElement;
    const r = { left: screen.offsetLeft + frameEl.offsetLeft, top: screen.offsetTop + frameEl.offsetTop };
    return [r.left + +m[1] + x * +m[3], r.top + +m[2] + y * +m[3]];
  }

  /** A layer that follows the camera image, for covers/annotations in natural px. */
  function overlayLayer(frameEl, imgEl) {
    const d = document.createElement('div');
    d.style.cssText = 'position:absolute;left:0;top:0;transform-origin:0 0;z-index:2;pointer-events:none;';
    frameEl.appendChild(d);
    return { el: d, sync() { d.style.transform = imgEl.style.transform; } };
  }

  /** Cursor: moves between keyframed points [x, y] (stage px); click scales it. */
  function cursor(el, lt, keys, clicks = []) {
    const [x, y] = kf(lt, keys, ease.inOutSine);
    let s = 1;
    for (const c of clicks) {
      const d = lt - c;
      if (d >= 0 && d < 0.3) s = 1 - 0.25 * Math.sin((d / 0.3) * Math.PI);
    }
    el.style.transform = `translate(${x}px, ${y}px) scale(${s.toFixed(3)})`;
    el.style.opacity = lt < keys[0][0] - 0.3 ? '0' : '1';
  }

  // -------------------------------------------------------------------------
  // Particles: gold dust drifting upward. Deterministic from t.
  // -------------------------------------------------------------------------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let r = Math.imul(a ^ (a >>> 15), 1 | a);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rnd = mulberry32(7);
  const PARTICLES = Array.from({ length: 90 }, () => ({
    x: rnd() * W, y: rnd() * H, r: 1 + rnd() * 2.6, sp: 12 + rnd() * 30,
    ph: rnd() * Math.PI * 2, amp: 10 + rnd() * 30, w: 0.3 + rnd() * 0.6, a: 0.25 + rnd() * 0.6,
    gold: rnd() < 0.7,
  }));

  function drawParticles(ctx, t, intensity = 1) {
    ctx.clearRect(0, 0, W, H);
    if (intensity <= 0) return;
    for (const q of PARTICLES) {
      const y = ((q.y - t * q.sp) % (H + 40) + (H + 40)) % (H + 40) - 20;
      const x = q.x + Math.sin(t * q.w + q.ph) * q.amp;
      const tw = 0.6 + 0.4 * Math.sin(t * 1.7 + q.ph * 3);
      ctx.beginPath();
      ctx.arc(x, y, q.r, 0, Math.PI * 2);
      ctx.fillStyle = q.gold ? `rgba(219,184,119,${(q.a * tw * intensity).toFixed(3)})` : `rgba(255,255,255,${(q.a * 0.6 * tw * intensity).toFixed(3)})`;
      ctx.shadowColor = q.gold ? 'rgba(219,184,119,0.9)' : 'rgba(255,255,255,0.8)';
      ctx.shadowBlur = 8;
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  // -------------------------------------------------------------------------
  // Subtitles (burned in from the timeline the voice-over generator wrote).
  // -------------------------------------------------------------------------
  function renderSubs(el, t) {
    const subs = (window.TIMELINE && window.TIMELINE.subs) || [];
    const cur = subs.find((s) => t >= s.start && t < s.end);
    if (!cur) { el.style.opacity = '0'; return; }
    el.textContent = cur.text;
    const fi = p(t, cur.start, 0.18, ease.out);
    const fo = 1 - p(t, cur.end - 0.15, 0.15, ease.in);
    el.style.opacity = Math.min(fi, fo).toFixed(3);
  }

  // -------------------------------------------------------------------------
  // Reel runtime
  // -------------------------------------------------------------------------
  const reel = {
    scenes: [],
    bgIntensity: () => 1,
    define(scenes) { this.scenes = scenes; },
  };

  function sceneTimes(id) {
    const s = window.TIMELINE.byId[id];
    if (!s) throw new Error('Scene not in timeline: ' + id);
    return s;
  }

  function render(t) {
    const canvas = document.getElementById('bg');
    if (canvas) drawParticles(canvas.getContext('2d'), t, reel.bgIntensity(t));

    for (const sc of reel.scenes) {
      const { start } = sceneTimes(sc.id);
      const end = sceneTimes(sc.until || sc.id).end;
      const el = typeof sc.el === 'string' ? document.querySelector(sc.el) : sc.el;
      const lead = sc.lead || 0, tail = sc.tail || 0;
      if (t >= start - lead && t < end + tail) {
        el.style.display = '';
        sc.render(t - start, end - start, t);
      } else {
        el.style.display = 'none';
      }
    }
    const subs = document.getElementById('subs');
    if (subs) renderSubs(subs, t);
  }

  async function ready() {
    await document.fonts.ready;
    const imgs = Array.from(document.images);
    await Promise.all(imgs.map((im) => (im.complete ? Promise.resolve() : new Promise((r) => { im.onload = r; im.onerror = r; }))));
    await Promise.all(imgs.map((im) => im.decode().catch(() => {})));
  }

  window.__ready = ready;
  window.__seek = async function (t) {
    render(t);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  };

  window.E = { W, H, ease, clamp, lerp, p, kf, reveal, stagger, countUp, typeText, camera, cameraKf, highlight, cursor, toStage, overlayLayer, reel, sceneTimes, render };
})();
