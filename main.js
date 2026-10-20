/* ==========================================================================
   Corn Hill hero: scroll-driven layered parallax
   --------------------------------------------------------------------------
   How it works
   - The hero is pinned for `scroll.<breakpoint>` viewport-heights of scrolling.
   - One scrubbed GSAP timeline (length 1) moves/scales each layer toward the camera.
   - Only transform and opacity are animated.
   - At the end a flat "paper" veil fades in, so the unpinned hero is exactly the page colour.
   ========================================================================== */

/* ---------- TUNE HERE ----------------------------------------------------- */
const CONFIG = {
  // How long the hero stays pinned, in viewport heights of scrolling.
  scroll: { desktop: 2.4, mobile: 1.7 },

  // Per-layer motion over the whole sequence. Back to front.
  //   y        total travel in % of viewport height (negative = up). Bigger = faster.
  //   scale    final scale (1 = no zoom).
  //   origin   transform-origin: the point the layer zooms toward.
  //   ease     'none' = linear with scroll; 'power2.in' = starts gentle, ends fast.
  //   dur      (optional) fraction of the sequence this layer's motion takes. Default 1.
  layers: {
    sky:        { y: -6,  scale: 1.1,  origin: '50% 100%', ease: 'none'        },
    houses:     { y: -60, scale: 1.25, origin: '70% 100%', ease: 'power1.in'   },
    hill:       { y: -30, scale: 1.8,  origin: '65% 100%', ease: 'power1.inOut'},
    // Foreground zooms about its own top edge (~78% down) so its bottom never lifts off the screen.
    foreground: { y: -110, scale: 6,   origin: '50% 78%',  ease: 'power1.in', dur: 0.86 },
  },

  // Narrow screens: partial overrides merged over `layers`.
  mobileLayers: {
    houses:     { y: -50 },
    hill:       { scale: 1.6 },
    foreground: { y: -110, scale: 6 },
  },

  // Business card: fades over the first `end` fraction of the sequence.
  card: { end: 0.16, lift: -28 },

  // Flat field colour fades in from this point (0-1) to the end of the sequence.
  veil: { start: 0.78 },

  // Used until the foreground has been sampled (or if sampling is blocked, e.g. file://).
  paperFallback: '#ebebeb',

  // Foreground region sampled for the field colour (fractions of image width/height).
  sample: { x0: 0.1, x1: 0.85, y0: 0.7, y1: 0.95 },

  // Give up waiting for images after this long and use the full painting instead.
  loadTimeoutMs: 8000,
};

const LAYER_FILES = {
  sky: 'assets/hero/sky.png',
  houses: 'assets/hero/houses.png',
  hill: 'assets/hero/hill.png',
  foreground: 'assets/hero/foreground.png',
};
/* -------------------------------------------------------------------------- */

const root = document.documentElement;
const hero = document.getElementById('hero');
const card = hero.querySelector('.hero__card');
const veil = hero.querySelector('.hero__veil');
const layerEl = (name) => hero.querySelector(`[data-layer="${name}"]`);

/** Load + decode an image. Resolves to the Image, or null on failure. */
function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    // decode() can stall in hidden tabs, so never wait on it for more than a moment.
    const decoded = () => (img.decode ? Promise.race([img.decode().catch(() => {}), new Promise((r) => setTimeout(r, 1500))]) : Promise.resolve());
    img.onload = () => decoded().then(() => resolve(img));
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Median colour of a region of the foreground -> CSS variable --paper. */
function sampleFieldColour(img) {
  try {
    const w = 200, h = Math.round(200 * img.naturalHeight / img.naturalWidth);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const s = CONFIG.sample;
    const x0 = Math.floor(s.x0 * w), x1 = Math.floor(s.x1 * w);
    const y0 = Math.floor(s.y0 * h), y1 = Math.floor(s.y1 * h);
    const data = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    const ch = [[], [], []];
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 250) continue;           // ignore transparent pixels
      ch[0].push(data[i]); ch[1].push(data[i + 1]); ch[2].push(data[i + 2]);
    }
    if (!ch[0].length) return;
    const med = (a) => a.sort((p, q) => p - q)[a.length >> 1];
    const [r, g, b] = ch.map(med);
    root.style.setProperty('--paper', `rgb(${r}, ${g}, ${b})`);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = `rgb(${r}, ${g}, ${b})`;
  } catch (e) {
    /* Canvas tainted (file://): keep the CSS default. */
  }
}

function reveal() {
  root.classList.add('is-revealing');
  root.classList.remove('is-loading');
  setTimeout(() => root.classList.remove('is-revealing'), 900);
}

/** Simple non-parallax behaviour: static scene that fades into the field as you scroll past. */
function staticFade() {
  gsap.timeline({
    defaults: { ease: 'none' },
    scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true },
  })
    .to(card, { opacity: 0, duration: 0.5 }, 0)
    .fromTo(veil, { opacity: 0 }, { opacity: 1, duration: 0.7 }, 0.3);
}

function setupParallax(isMobile) {
  const layers = {};
  for (const name of Object.keys(CONFIG.layers)) {
    layers[name] = { ...CONFIG.layers[name], ...(isMobile ? CONFIG.mobileLayers[name] : null) };
  }

  const tl = gsap.timeline({
    defaults: { ease: 'none' },
    scrollTrigger: {
      trigger: hero,
      start: 'top top',
      end: () => '+=' + Math.round(window.innerHeight * (isMobile ? CONFIG.scroll.mobile : CONFIG.scroll.desktop)),
      pin: true,           // hero stays put; it un-pins when the timeline completes
      scrub: true,
      anticipatePin: 1,
      invalidateOnRefresh: true,
    },
  });

  // Layers: yPercent + scale are both transforms.
  for (const [name, L] of Object.entries(layers)) {
    tl.fromTo(
      layerEl(name),
      { yPercent: 0, scale: 1, transformOrigin: L.origin },
      { yPercent: L.y, scale: L.scale, transformOrigin: L.origin, ease: L.ease, duration: L.dur ?? 1 },
      0
    );
  }

  // Card fades out early.
  tl.to(card, { opacity: 0, y: CONFIG.card.lift, ease: 'power1.out', duration: CONFIG.card.end }, 0);

  // Flat field colour takes over for a seamless hand-off to the content.
  tl.fromTo(veil, { opacity: 0 }, { opacity: 1, ease: 'power1.inOut', duration: 1 - CONFIG.veil.start }, CONFIG.veil.start);
}

async function init() {
  const names = Object.keys(LAYER_FILES);
  const timeout = new Promise((r) => setTimeout(() => r('timeout'), CONFIG.loadTimeoutMs));
  const loaded = await Promise.race([Promise.all(names.map((n) => loadImage(LAYER_FILES[n]))), timeout]);

  const allLoaded = Array.isArray(loaded) && loaded.every(Boolean);
  const canAnimate = typeof gsap !== 'undefined' && typeof ScrollTrigger !== 'undefined';

  if (allLoaded) {
    sampleFieldColour(loaded[names.indexOf('foreground')]);
  } else {
    hero.classList.add('hero--fallback'); // use /assets/hero/corn-hill-full.jpg instead
  }

  if (!canAnimate) { reveal(); return; }

  gsap.registerPlugin(ScrollTrigger);
  ScrollTrigger.config({ ignoreMobileResize: true }); // no jumps when the mobile URL bar collapses

  const mm = gsap.matchMedia();
  mm.add(
    {
      // matchMedia only runs the callback when at least one of these matches, so cover every case.
      isMobile: '(max-width: 767px)',
      isDesktop: '(min-width: 768px)',
      reduce: '(prefers-reduced-motion: reduce)',
    },
    (ctx) => {
      const { isMobile, reduce } = ctx.conditions;
      if (reduce || !allLoaded) staticFade();
      else setupParallax(isMobile);
    }
  );

  reveal();
  window.addEventListener('load', () => ScrollTrigger.refresh());
}

// Safety net: never leave the page blank.
setTimeout(reveal, CONFIG.loadTimeoutMs + 1500);
init();
