/* ==========================================================================
   Site interactions (everything below the hero)
   --------------------------------------------------------------------------
   Plain JS, no dependencies. Hero motion lives in main.js.
   - nav appears after the hero and highlights the current section
   - .lede text lights up word by word as you scroll
   - experience timeline line draws with scroll
   - sections fade up as they enter; stat numbers count up once
   - project rows expand/collapse; chips filter them
   All scroll work shares one rAF-throttled listener and reads live positions,
   so it keeps working when the hero pin changes the page height.
   ========================================================================== */

(() => {
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (n, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));

  /* ---------- scroll reveal ---------- */
  const reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !reduceMotion) {
    // Stagger siblings that enter together.
    let batch = 0, batchTimer;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        // Anything already scrolled past (e.g. after a reload mid-page) shows immediately.
        if (e.isIntersecting || e.boundingClientRect.top < 0) {
          e.target.style.setProperty('--d', Math.min(batch++, 4) * 0.08 + 's');
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
      });
      clearTimeout(batchTimer);
      batchTimer = setTimeout(() => { batch = 0; }, 120);
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add('is-in'));
  }

  /* ---------- count-up numbers ---------- */
  const counters = document.querySelectorAll('[data-count]');
  const runCount = (el) => {
    const end = +el.dataset.count, pre = el.dataset.prefix || '', suf = el.dataset.suffix || '';
    if (reduceMotion) { el.textContent = pre + end + suf; return; }
    const dur = 1300, t0 = performance.now();
    const step = (t) => {
      const p = clamp((t - t0) / dur);
      el.textContent = pre + Math.round(end * (1 - Math.pow(1 - p, 3))) + suf;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  if ('IntersectionObserver' in window) {
    const cio = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { runCount(e.target); cio.unobserve(e.target); } });
    }, { threshold: 0.6 });
    counters.forEach((el) => cio.observe(el));
  }

  /* ---------- scroll-lit ledes ---------- */
  const ledes = [...document.querySelectorAll('[data-scrub]')].map((el) => {
    const words = el.textContent.trim().split(/\s+/);
    el.textContent = '';
    const spans = words.map((w, i) => {
      const s = document.createElement('span');
      s.className = 'w';
      s.textContent = w;
      el.append(s);
      if (i < words.length - 1) el.append(' ');
      return s;
    });
    el.setAttribute('aria-label', words.join(' '));
    return { el, spans };
  });

  /* ---------- nav ---------- */
  const nav = document.querySelector('.nav');
  const about = document.getElementById('about');
  const navLinks = [...document.querySelectorAll('.nav__links a')];
  const sections = navLinks.map((a) => document.querySelector(a.getAttribute('href')));

  /* ---------- timeline ---------- */
  // The line follows whichever is further down: how far you've scrolled, or the job under the mouse.
  // Dots fill in once the line has reached them, so the line and the filled dots never disagree.
  const timeline = document.querySelector('[data-timeline]');
  const jobs = timeline ? [...timeline.querySelectorAll('.job')] : [];
  let dotY = [], barTop = 8, barH = 1, hovered = -1;
  const measure = () => {
    if (!timeline) return;
    barTop = parseFloat(getComputedStyle(timeline.querySelector('.timeline__bar')).top) || 8;
    barH = Math.max(1, timeline.offsetHeight - barTop * 2);
    dotY = jobs.map((j) => j.offsetTop + (parseFloat(getComputedStyle(j, '::before').top) || 0) + 3.5);
  };
  if (timeline) {
    measure();
    addEventListener('load', () => { measure(); onScroll(); });
    addEventListener('resize', measure);
    jobs.forEach((j, i) => {
      j.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { measure(); hovered = i; onScroll(); } });
      j.addEventListener('pointerleave', () => { hovered = -1; onScroll(); });
    });
  }

  /* ---------- one scroll loop ---------- */
  let ticking = false;
  const update = () => {
    ticking = false;
    const vh = window.innerHeight;

    // Nav: show once the About section is coming into view.
    nav.classList.toggle('is-on', about.getBoundingClientRect().top < vh * 0.6);

    // Current section: the last one whose top has passed 40% of the viewport.
    let current = -1;
    sections.forEach((s, i) => { if (s.getBoundingClientRect().top < vh * 0.4) current = i; });
    navLinks.forEach((a, i) => a.classList.toggle('is-current', i === current));

    // Words light up between 85% and 45% of the viewport height.
    ledes.forEach(({ el, spans }) => {
      const top = el.getBoundingClientRect().top;
      const p = reduceMotion ? 1 : clamp((vh * 0.85 - top) / (vh * 0.4));
      const t = p * (spans.length + 1);
      spans.forEach((s, i) => { s.style.opacity = (0.2 + 0.8 * clamp(t - i)).toFixed(2); });
    });

    // Timeline: line length = max(scroll progress, hovered job's dot).
    if (timeline && !reduceMotion) {
      const r = timeline.getBoundingClientRect();
      let p = clamp((vh * 0.65 - r.top - barTop) / barH);
      if (hovered >= 0) p = Math.max(p, clamp((dotY[hovered] - barTop) / barH));
      timeline.style.setProperty('--p', p.toFixed(3));
      jobs.forEach((j, i) => j.classList.toggle('is-reached', (dotY[i] - barTop) / barH <= p + 0.002));
    } else if (timeline) {
      jobs.forEach((j) => j.classList.add('is-reached'));
    }
  };
  const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
  update();

  /* ---------- projects: expand + filter ---------- */
  document.querySelectorAll('.project__head').forEach((btn) => {
    btn.addEventListener('click', () => {
      btn.setAttribute('aria-expanded', btn.getAttribute('aria-expanded') !== 'true');
    });
  });

  const chips = document.querySelectorAll('.chip');
  const projects = document.querySelectorAll('.project');
  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const f = chip.dataset.filter;
      chips.forEach((c) => {
        const on = c === chip;
        c.classList.toggle('is-active', on);
        c.setAttribute('aria-pressed', on);
      });
      projects.forEach((p) => {
        const show = f === 'all' || p.dataset.cat === f;
        p.hidden = !show;
        if (show) p.classList.add('is-in'); // filtered-in rows must never stay faded out
      });
    });
  });
})();
