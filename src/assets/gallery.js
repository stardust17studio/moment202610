(() => {
  'use strict';

  const root = document.documentElement;
  const backdrop = document.querySelector('.backdrop');
  const masthead = document.querySelector('.masthead');
  const pad = (n) => String(n).padStart(2, '0');

  /* Backdrop veil: the snow photograph blurs and pales as the gallery scrolls over it. */
  let ticking = false;
  const onScroll = () => {
    ticking = false;
    const vh = window.innerHeight;
    const veil = Math.min(1, Math.max(0, (window.scrollY - vh * 0.1) / (vh * 0.6)));
    backdrop.style.setProperty('--veil', veil.toFixed(3));
    masthead.classList.toggle('is-visible', window.scrollY > vh * 0.85);
  };
  const requestUpdate = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(onScroll);
    }
  };
  window.addEventListener('scroll', requestUpdate, { passive: true });
  window.addEventListener('resize', requestUpdate);
  onScroll();

  /* Fade images in once decoded (the blurred placeholder sits underneath). */
  for (const img of document.querySelectorAll('.work__frame img')) {
    const done = () => img.parentElement.classList.add('is-loaded');
    if (img.complete && img.naturalWidth) done();
    else {
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
    }
  }

  /* Reveal on scroll + current chapter in the masthead. */
  const revealables = document.querySelectorAll('.reveal, .work');
  const navLinks = new Map(
    [...document.querySelectorAll('.masthead__nav a')].map((a) => [a.hash.slice(1), a]),
  );
  if ('IntersectionObserver' in window) {
    const revealer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            revealer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    revealables.forEach((el) => revealer.observe(el));

    const spy = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const link = navLinks.get(entry.target.id);
          if (link) link.classList.toggle('is-active', entry.isIntersecting);
        }
      },
      { rootMargin: '-45% 0px -50% 0px' },
    );
    document.querySelectorAll('.chapter').forEach((el) => spy.observe(el));
  } else {
    revealables.forEach((el) => el.classList.add('is-visible'));
  }

  /* Viewer. Without <dialog> support the frames stay plain links to the large files. */
  const viewer = document.querySelector('.viewer');
  const frames = [...document.querySelectorAll('.work__frame')];
  if (!viewer || typeof viewer.showModal !== 'function' || !frames.length) return;

  const stageImg = viewer.querySelector('.viewer__img');
  const field = (name) => viewer.querySelector(`.viewer__${name}`);
  const fields = {
    no: field('no'),
    title: field('title'),
    meta: field('meta'),
    gear: field('gear'),
    count: field('count'),
  };
  const stage = field('stage');
  const idOf = (frame) => frame.closest('.work').id;
  const preloaded = new Set();
  let index = -1;
  let token = 0;

  const preload = (src) => {
    if (preloaded.has(src)) return;
    preloaded.add(src);
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
  };

  const show = (i) => {
    index = (i + frames.length) % frames.length;
    const frame = frames[index];
    const thumb = frame.querySelector('img');
    const large = frame.getAttribute('href');
    const { dataset } = frame;

    fields.no.textContent = dataset.no;
    fields.title.textContent = dataset.title;
    fields.meta.textContent = dataset.meta;
    fields.gear.textContent = dataset.gear;
    fields.count.textContent = `${dataset.no} / ${pad(frames.length)}`;
    stageImg.alt = thumb.alt;

    stageImg.classList.remove('is-entering');
    void stageImg.offsetWidth;
    stageImg.classList.add('is-entering');

    // Show the already-decoded grid image instantly, then swap in the large file.
    const placeholder = thumb.complete && thumb.naturalWidth ? thumb.currentSrc : '';
    const current = ++token;
    if (placeholder && placeholder !== large) {
      stageImg.src = placeholder;
      const loader = new Image();
      loader.decoding = 'async';
      loader.onload = () => {
        if (current === token) stageImg.src = large;
      };
      loader.src = large;
    } else {
      stageImg.src = large;
    }
    preloaded.add(large);

    for (const step of [1, -1]) preload(frames[(index + step + frames.length) % frames.length].getAttribute('href'));
    history.replaceState(null, '', `#${idOf(frame)}`);
  };

  const open = (i) => {
    root.classList.add('is-viewing');
    if (!viewer.open) {
      viewer.showModal();
      stage.focus({ preventScroll: true });
    }
    show(i);
  };

  const close = () => viewer.close();

  viewer.addEventListener('close', () => {
    root.classList.remove('is-viewing');
    history.replaceState(null, '', window.location.pathname + window.location.search);
    frames[index]?.focus();
    token++;
  });

  frames.forEach((frame, i) => {
    frame.addEventListener('click', (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      open(i);
    });
  });

  for (const trigger of document.querySelectorAll('[data-open]')) {
    trigger.addEventListener('click', (event) => {
      const i = frames.findIndex((frame) => idOf(frame) === trigger.dataset.open);
      if (i < 0) return;
      event.preventDefault();
      open(i);
    });
  }

  viewer.querySelector('.viewer__close').addEventListener('click', close);
  viewer.querySelector('.viewer__prev').addEventListener('click', () => show(index - 1));
  viewer.querySelector('.viewer__next').addEventListener('click', () => show(index + 1));
  stageImg.addEventListener('click', () => show(index + 1));

  // Clicking the empty frosted margin closes the viewer.
  viewer.addEventListener('click', (event) => {
    if (event.target === viewer || event.target.classList.contains('viewer__figure')) close();
  });

  viewer.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      show(index + 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      show(index - 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });

  let touchX = 0;
  let touchY = 0;
  viewer.addEventListener(
    'touchstart',
    (event) => {
      const t = event.changedTouches[0];
      touchX = t.clientX;
      touchY = t.clientY;
    },
    { passive: true },
  );
  viewer.addEventListener(
    'touchend',
    (event) => {
      const t = event.changedTouches[0];
      const dx = t.clientX - touchX;
      const dy = t.clientY - touchY;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) show(index + (dx < 0 ? 1 : -1));
      else if (dy > 90 && dy > Math.abs(dx) * 1.4) close();
    },
    { passive: true },
  );

  // Deep links: index.html#red-in-the-snow opens that photograph.
  const fromHash = () => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    const i = id ? frames.findIndex((frame) => idOf(frame) === id) : -1;
    if (i >= 0) open(i);
  };
  window.addEventListener('hashchange', fromHash);
  fromHash();
})();
