/* ==========================================================================
   Document reader
   --------------------------------------------------------------------------
   Clicking a deliverable pill (.docs a) opens the PDF inside the site, in the
   #reader <dialog>, instead of a new browser tab.
   - pdf.js is loaded from cdnjs the first time it is needed.
   - Landscape PDFs (decks) page like slides; portrait PDFs scroll like paper.
   - Falls back to the normal link (new tab) if anything fails.
   To tune: PDFJS_VERSION below, MAX_DPR for sharpness vs. speed.
   ========================================================================== */

(() => {
  const dlg = document.getElementById('reader');
  if (!dlg || typeof dlg.showModal !== 'function') return;   // old browser: links just open the PDF

  const PDFJS_VERSION = '3.11.174';
  const CDN = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/`;
  const MAX_DPR = 2;

  const $ = (k) => dlg.querySelector(`[data-r="${k}"]`);
  const el = {
    title: $('title'), meta: $('meta'), project: $('project'), blurb: $('blurb'), tabs: $('tabs'),
    stage: $('stage'), view: $('view'), status: $('status'), count: $('count'), bar: $('bar'),
    prev: $('prev'), next: $('next'), download: $('download'), open: $('open'), close: $('close'),
  };
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const pad = (n) => String(n).padStart(2, '0');

  /* ---------- pdf.js loader ---------- */
  let libPromise;
  const loadLib = () => (libPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = CDN + 'pdf.min.js';
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN + 'pdf.worker.min.js';
      resolve(window.pdfjsLib);
    };
    s.onerror = () => { libPromise = null; reject(new Error('pdf.js failed to load')); };
    document.head.append(s);
  }));

  /* ---------- state ---------- */
  let pdf = null, mode = 'slides', page = 1, total = 0, token = 0, group = [], groupIdx = 0, io = null;

  const setProgress = (p) => el.bar.style.setProperty('--p', clamp(p, 0, 1).toFixed(3));
  const setStatus = (state, text) => { el.stage.dataset.state = state; if (text) el.status.textContent = text; };

  const reset = () => {
    token++;
    if (io) { io.disconnect(); io = null; }
    el.view.replaceChildren();
    el.count.textContent = '';
    setProgress(0);
    el.prev.disabled = el.next.disabled = true;
  };

  /* ---------- slides (landscape decks) ---------- */
  let frame, canvas;
  const renderSlide = async (n) => {
    const my = ++token;
    page = clamp(n, 1, total);
    const pg = await pdf.getPage(page);
    if (my !== token) return;
    const base = pg.getViewport({ scale: 1 });
    const box = el.view.getBoundingClientRect();
    const scale = Math.min(box.width / base.width, box.height / base.height);
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const vp = pg.getViewport({ scale: scale * dpr });

    const next = document.createElement('canvas');
    next.width = Math.floor(vp.width);
    next.height = Math.floor(vp.height);
    await pg.render({ canvasContext: next.getContext('2d'), viewport: vp }).promise;
    if (my !== token) return;

    if (!frame) {
      frame = document.createElement('div');
      frame.className = 'reader__frame';
      el.view.replaceChildren(frame);
    }
    frame.style.width = Math.floor(base.width * scale) + 'px';
    frame.style.height = Math.floor(base.height * scale) + 'px';
    frame.replaceChildren(next);
    canvas = next;
    frame.style.animation = 'none'; void frame.offsetWidth; frame.style.animation = ''; // replay fade
    el.count.textContent = `${pad(page)} / ${pad(total)}`;
    setProgress(total > 1 ? (page - 1) / (total - 1) : 1);
    el.prev.disabled = page <= 1;
    el.next.disabled = page >= total;
    setStatus('ready');
  };

  /* ---------- scroll (portrait documents) ---------- */
  let scroller, pages = [];
  const setupScroll = async () => {
    const first = await pdf.getPage(1);
    const base = first.getViewport({ scale: 1 });
    scroller = document.createElement('div');
    scroller.className = 'reader__scroll';
    pages = [];
    for (let i = 1; i <= total; i++) {
      const d = document.createElement('div');
      d.className = 'reader__page';
      d.style.aspectRatio = `${base.width} / ${base.height}`;
      d.dataset.n = i;
      scroller.append(d);
      pages.push(d);
    }
    el.view.replaceChildren(scroller);

    const rendering = new Set();
    io = new IntersectionObserver((entries) => {
      entries.forEach(async (e) => {
        const d = e.target, n = +d.dataset.n;
        if (!e.isIntersecting || d.firstChild || rendering.has(n)) return;
        rendering.add(n);
        const pg = await pdf.getPage(n);
        const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
        const w = d.clientWidth;
        const vp = pg.getViewport({ scale: (w / pg.getViewport({ scale: 1 }).width) * dpr });
        const c = document.createElement('canvas');
        c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
        await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        d.replaceChildren(c);
      });
    }, { root: scroller, rootMargin: '120% 0px' });
    pages.forEach((d) => io.observe(d));

    const onScroll = () => {
      const max = scroller.scrollHeight - scroller.clientHeight;
      const step = pages[0].offsetHeight + 20;
      page = clamp(Math.round(scroller.scrollTop / step) + 1, 1, total);
      el.count.textContent = `${pad(page)} / ${pad(total)}`;
      setProgress(max > 0 ? scroller.scrollTop / max : 1);
      el.prev.disabled = scroller.scrollTop <= 2;
      el.next.disabled = scroller.scrollTop >= max - 2;
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    setStatus('ready');
  };

  /* ---------- load a document ---------- */
  const loadDoc = async (href, label) => {
    reset();
    frame = canvas = scroller = null;
    setStatus('loading', 'Loading…');
    el.download.href = el.open.href = href;
    el.download.setAttribute('download', href.split('/').pop());
    try {
      const lib = await loadLib();
      const my = token;
      if (pdf) { pdf.destroy(); pdf = null; }
      pdf = await lib.getDocument({ url: href }).promise;
      if (my !== token) return;
      total = pdf.numPages;
      const p1 = await pdf.getPage(1);
      const vp = p1.getViewport({ scale: 1 });
      mode = vp.width > vp.height ? 'slides' : 'scroll';
      dlg.dataset.mode = mode;
      el.prev.disabled = el.next.disabled = false;
      if (mode === 'slides') await renderSlide(1); else await setupScroll();
    } catch (err) {
      console.error(err);
      setStatus('error', 'Could not load this document. Use Open to view it in a new tab.');
    }
  };

  /* ---------- open / close ---------- */
  const buildTabs = () => {
    el.tabs.replaceChildren();
    if (group.length < 2) return;
    group.forEach((a, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'reader__tab';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', i === groupIdx);
      const label = a.childNodes[0].textContent.trim();
      const small = a.querySelector('small');
      b.innerHTML = `<span></span><small></small>`;
      b.firstChild.textContent = label;
      b.lastChild.textContent = small ? small.textContent : '';
      b.addEventListener('click', () => { groupIdx = i; buildTabs(); loadDoc(a.getAttribute('href')); });
      el.tabs.append(b);
    });
  };

  const openFrom = (a) => {
    const project = a.closest('.project');
    const name = project.querySelector('.project__title').textContent.trim();
    const tag = project.querySelector('.project__tag')?.textContent.trim() || '';
    const date = project.querySelector('.project__date')?.textContent.trim() || '';
    group = [...a.closest('.docs').querySelectorAll('a')];
    groupIdx = group.indexOf(a);
    el.title.textContent = name;
    el.project.textContent = name;
    el.meta.textContent = [tag, date].filter(Boolean).join(' · ');
    el.blurb.textContent = project.querySelector('.project__inner p')?.textContent.trim() || '';
    buildTabs();
    document.documentElement.classList.add('reader-open');
    dlg.showModal();
    loadDoc(a.getAttribute('href'));
  };

  dlg.addEventListener('close', () => {
    document.documentElement.classList.remove('reader-open');
    reset();
    if (pdf) { pdf.destroy(); pdf = null; }
  });
  el.close.addEventListener('click', () => dlg.close());

  document.querySelectorAll('.docs a').forEach((a) => {
    a.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;   // let power-user clicks open a new tab
      e.preventDefault();
      openFrom(a);
    });
  });

  /* ---------- navigation ---------- */
  const go = (dir) => {
    if (!pdf) return;
    if (mode === 'slides') renderSlide(page + dir);
    else scroller.scrollBy({ top: dir * (scroller.clientHeight * 0.85), behavior: 'smooth' });
  };
  el.prev.addEventListener('click', () => go(-1));
  el.next.addEventListener('click', () => go(1));

  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || (e.key === ' ' && mode === 'slides')) { e.preventDefault(); go(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(-1); }
  });

  // Click the left / right edge of a slide to turn the page; swipe on touch screens.
  el.view.addEventListener('click', (e) => {
    if (mode !== 'slides' || !frame) return;
    const r = frame.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right) return;
    go(e.clientX < r.left + r.width / 2 ? -1 : 1);
  });
  let sx = null;
  el.view.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') sx = e.clientX; });
  el.view.addEventListener('pointerup', (e) => {
    if (sx === null || mode !== 'slides') return;
    const dx = e.clientX - sx; sx = null;
    if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
  });

  // Re-fit the current slide when the window changes size.
  let rt;
  addEventListener('resize', () => {
    if (!dlg.open || !pdf || mode !== 'slides') return;
    clearTimeout(rt);
    rt = setTimeout(() => renderSlide(page), 150);
  });
})();
