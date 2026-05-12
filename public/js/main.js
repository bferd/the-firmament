'use strict';

// ── Immediate scroll lock (runs synchronously on script parse) ────────────
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
document.body.style.overflow = 'hidden';
window.scrollTo(0, 0);

// ── Constants ─────────────────────────────────────────────────────────────
const SCROLL_THRESHOLD = 360;
let PANEL_W            = 300;  // updated from theme on load
const TRANS_DURATION   = 3500; // ms — covers transition video length
const PANEL_FADE_MS    = 400;  // R4: panel fades in before overlay starts
const isMobile         = window.innerWidth <= 768;

// ── State ─────────────────────────────────────────────────────────────────
let state             = 'hero';
let mobilePanelSetting = 'hidden';
let authenticated     = false;
let scrollAccum       = 0;
let heroInView        = false;
let transitionReady   = false;
let pendingTransition = false;
let offlineHosts      = new Set();

// ── DOM refs ──────────────────────────────────────────────────────────────
const hero        = document.getElementById('hero');
const heroBgVideo = document.getElementById('hero-bg-video');
const videoA      = document.getElementById('engel-video-a');
const videoB      = document.getElementById('engel-video-b');
const heroSlot    = document.getElementById('hero-video-slot');
const engelPanel  = document.getElementById('engel-panel');
const panelVideo  = document.getElementById('engel-panel-video');
const mainContent = document.getElementById('main-content');
const servicesEl  = document.getElementById('services');
const siteHeader  = document.getElementById('site-header');
const authBadge = document.getElementById('auth-badge');
const authName  = document.getElementById('auth-name');

// ── Transition video — dynamic element for fresh decode context ───────────
const transitionVideo = document.createElement('video');
transitionVideo.preload     = 'auto';
transitionVideo.playsInline = true;
transitionVideo.muted       = true;
transitionVideo.src         = '/videos/engel-transition.webm';
transitionVideo.style.cssText = 'position:absolute;opacity:0;pointer-events:none;width:1px;height:1px;';
document.body.appendChild(transitionVideo);
transitionVideo.load();

transitionVideo.addEventListener('canplaythrough', () => {
  transitionReady = true;
  if (pendingTransition) {
    pendingTransition = false;
    runTransition();
  }
}, { once: true });

// ── Welcome video preloader ───────────────────────────────────────────────
const welcomePreloader = document.createElement('video');
welcomePreloader.preload     = 'auto';
welcomePreloader.playsInline = true;
welcomePreloader.muted       = true;
welcomePreloader.src         = '/videos/engel-welcome.webm';
welcomePreloader.style.cssText = 'position:absolute;opacity:0;pointer-events:none;width:1px;height:1px;';
document.body.appendChild(welcomePreloader);
welcomePreloader.load();

let welcomeReady     = false;
let welcomePosterUrl = '';

welcomePreloader.addEventListener('loadeddata', () => {
  try {
    const c = document.createElement('canvas');
    c.width  = welcomePreloader.videoWidth  || 1;
    c.height = welcomePreloader.videoHeight || 1;
    c.getContext('2d').drawImage(welcomePreloader, 0, 0);
    welcomePosterUrl = c.toDataURL('image/jpeg', 0.8);
  } catch (_) {}
}, { once: true });

welcomePreloader.addEventListener('canplaythrough', () => {
  welcomeReady = true;
  setTimeout(() => {
    if (welcomePreloader.parentNode) welcomePreloader.parentNode.removeChild(welcomePreloader);
  }, 5000);
}, { once: true });

// ── Hero double-buffer ────────────────────────────────────────────────────
let activeVideo   = videoA;
let inactiveVideo = videoB;

function resetBuffers() {
  videoA.style.opacity = '1';
  videoB.style.opacity = '0';
  activeVideo   = videoA;
  inactiveVideo = videoB;
}

function crossfadeHeroTo(src, loop = false) {
  inactiveVideo.src  = src;
  inactiveVideo.loop = loop;
  inactiveVideo.load();

  const doSwap = () => {
    inactiveVideo.play().catch(() => {});
    inactiveVideo.style.opacity = '1';
    activeVideo.style.opacity   = '0';
    const prev = activeVideo;
    [activeVideo, inactiveVideo] = [inactiveVideo, activeVideo];
    setTimeout(() => { prev.pause(); prev.removeAttribute('src'); prev.load(); }, 350);
  };

  if (inactiveVideo.readyState >= 3) {
    doSwap();
  } else {
    inactiveVideo.addEventListener('canplay', doSwap, { once: true });
  }
}

// ── R2: Proportional opacity driven by scroll ratio ───────────────────────
// ENGEL video stays at full opacity during scroll — only bg fades
function applyScrollRatio(ratio) {
  const v = Math.max(0, Math.min(1, 1 - ratio));
  heroBgVideo.style.opacity = String(v);
}

// ── Scroll lock ───────────────────────────────────────────────────────────
let touchStartY = 0;

function onWheel(e) {
  e.preventDefault();
  if (state !== 'hero') return;
  // R1+R2: bidirectional accumulation clamped 0–threshold
  scrollAccum = Math.max(0, Math.min(SCROLL_THRESHOLD, scrollAccum + e.deltaY));
  applyScrollRatio(scrollAccum / SCROLL_THRESHOLD);
  if (scrollAccum >= SCROLL_THRESHOLD) triggerTransition();
}

function onTouchStart(e) {
  touchStartY = e.touches[0].clientY;
}

function onTouchMove(e) {
  e.preventDefault();
  if (state !== 'hero') return;
  const dy = touchStartY - e.touches[0].clientY;
  touchStartY = e.touches[0].clientY;
  scrollAccum = Math.max(0, Math.min(SCROLL_THRESHOLD, scrollAccum + dy));
  applyScrollRatio(scrollAccum / SCROLL_THRESHOLD);
  if (scrollAccum >= SCROLL_THRESHOLD) triggerTransition();
}

function lockScroll() {
  document.body.style.overflow = 'hidden';
  window.addEventListener('wheel',      onWheel,      { passive: false });
  window.addEventListener('touchstart', onTouchStart, { passive: true  });
  window.addEventListener('touchmove',  onTouchMove,  { passive: false });
}

// Allows window.scrollTo() while keeping wheel/touch listeners active (user input blocked)
function semiUnlockScroll() {
  document.body.style.overflow = '';
}

function unlockScroll() {
  document.body.style.overflow = '';
  window.removeEventListener('wheel',      onWheel);
  window.removeEventListener('touchstart', onTouchStart);
  window.removeEventListener('touchmove',  onTouchMove);
}

// ── Transition ────────────────────────────────────────────────────────────
// R3: only fires when scrollAccum === SCROLL_THRESHOLD (both videos at opacity 0)
// R4: panel fades in first, then overlay animates, then browse-idle revealed
function triggerTransition() {
  if (state !== 'hero') return;
  state = 'transitioning';

  if (isMobile) { runMobileTransition(); return; }

  if (!transitionReady) {
    pendingTransition = true;
    return;
  }
  runTransition();
}

function runMobileTransition() {
  unlockScroll();
  engelPanel.classList.add('visible');
  mainContent.classList.add('panel-open');
  siteHeader.classList.add('visible');

  panelVideo.src           = '/videos/engel-browse-idle.webm';
  panelVideo.loop          = true;
  panelVideo.style.opacity = '1';
  panelVideo.load();
  panelVideo.play().catch(() => {});

  setTimeout(enterBrowse, 300);
}

function runTransition() {
  const transDuration = transitionVideo.duration
    ? Math.round(transitionVideo.duration * 1000)
    : TRANS_DURATION;

  // ── R4 Step 1: Panel fades in (400ms) before overlay starts ──────────
  engelPanel.style.opacity    = '0';
  engelPanel.style.transition = 'transform 0.6s cubic-bezier(0.22,1,0.36,1), opacity 0.4s ease';
  engelPanel.classList.add('visible');
  mainContent.classList.add('panel-open');
  siteHeader.classList.add('visible');

  requestAnimationFrame(() => {
    engelPanel.style.opacity = '1';
  });

  // Pre-load browse-idle hidden — will crossfade in when transition video fades out
  panelVideo.src          = '/videos/engel-browse-idle.webm';
  panelVideo.loop         = true;
  panelVideo.style.opacity = '0';
  panelVideo.load();

  // ── R4 Step 2: Overlay starts after panel has landed ─────────────────
  setTimeout(() => {
    const rect = heroSlot.getBoundingClientRect();

    // Container drives the CSS animation — video element itself is never animated
    const overlayEl = document.createElement('div');
    overlayEl.style.cssText = [
      'position:fixed',
      `left:${rect.left}px`,
      `top:${rect.top}px`,
      `width:${rect.width}px`,
      `height:${rect.height}px`,
      'overflow:hidden',
      'pointer-events:none',
      'z-index:1000',
      'background:transparent',
    ].join(';');

    // Reuse the already-buffered preloaded element — prevents cold-decode stall on desktop
    transitionVideo.style.cssText    = 'width:100%;height:100%;object-fit:contain;display:block;';
    transitionVideo.style.willChange = 'transform'; // own compositing layer, isolated from container animation
    transitionVideo.playbackRate     = 1.0;
    transitionVideo.currentTime      = 0;

    overlayEl.appendChild(transitionVideo);
    document.body.appendChild(overlayEl);

    // ENGEL disappears exactly when transition video takes over
    activeVideo.style.opacity   = '0';
    inactiveVideo.style.opacity = '0';

    transitionVideo.play().catch(() => {});

    // Release scroll lock immediately when transition starts — user can scroll naturally
    // while ENGEL flies to the panel without waiting for the animation to finish.
    unlockScroll();
    window.scrollTo({ top: hero.offsetHeight, behavior: 'smooth' });
    loadServices(false);

    // Wait for panel CSS transition to fully settle, then read browse-idle's exact rect
    setTimeout(() => {
      const idleRect = panelVideo.getBoundingClientRect();
      const targetLeft   = idleRect.left;
      const targetTop    = idleRect.top;
      const targetWidth  = idleRect.width  || PANEL_W;
      const targetHeight = idleRect.height || window.innerHeight;

      const easing = 'cubic-bezier(0.4,0,0.2,1)';
      const t      = `${transDuration}ms ${easing}`;

      requestAnimationFrame(() => requestAnimationFrame(() => {
        overlayEl.style.transition = `left ${t},top ${t},width ${t},height ${t}`;
        overlayEl.style.left   = targetLeft   + 'px';
        overlayEl.style.top    = targetTop    + 'px';
        overlayEl.style.width  = targetWidth  + 'px';
        overlayEl.style.height = targetHeight + 'px';
      }));
    }, 250); // panel CSS transition is 0.6s; we enter at 0.4s, so 0.25s buffer clears it

    // ── R4 Steps 3+4: When animation done, reveal browse-idle, fade overlay ──
    let entered = false;
    const doEnter = () => {
      if (entered) return;
      entered = true;

      transitionVideo.style.willChange = '';

      // Crossfade: browse-idle fades in as overlay fades out simultaneously
      panelVideo.play().catch(() => {});
      panelVideo.style.transition = 'opacity 0.4s ease';
      panelVideo.style.opacity    = '1';

      overlayEl.style.transition = 'opacity 0.4s ease';
      overlayEl.style.opacity    = '0';
      setTimeout(() => {
        overlayEl.remove();
        panelVideo.style.transition = '';
        enterBrowse();
      }, 400);
    };

    transitionVideo.addEventListener('ended', doEnter, { once: true });
    setTimeout(doEnter, transDuration + 650); // hard fallback (accounts for extra 250ms delay)
  }, PANEL_FADE_MS);
}

// ── Browse mode ───────────────────────────────────────────────────────────
function enterBrowse() {
  state = 'browse';

  engelPanel.style.opacity    = '';
  engelPanel.style.transition = '';

  unlockScroll(); // no-op if already released at transition start
  loadServices(false); // no-op if already loaded by runTransition
  heroObserver.observe(hero);
  startMetricsPoll();
}

// ── Scroll-back detection ─────────────────────────────────────────────────
const heroObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (state !== 'browse') continue;
    const fullyVisible = entry.intersectionRatio >= 0.98;

    if (fullyVisible && !heroInView) {
      heroInView = true;
      // Hide panel, restore hero
      engelPanel.classList.remove('visible');
      mainContent.classList.remove('panel-open');
      // Restore hero bg video opacity
      heroBgVideo.style.opacity = '1';
      // Restart idle loop in hero
      crossfadeHeroTo('/videos/engel-idle-loop.webm', true);
    } else if (!fullyVisible && heroInView) {
      heroInView = false;
      // Restore panel with browse-idle
      engelPanel.classList.add('visible');
      mainContent.classList.add('panel-open');
      panelVideo.src           = '/videos/engel-browse-idle.webm';
      panelVideo.loop          = true;
      panelVideo.style.opacity = '1';
      panelVideo.load();
      panelVideo.play().catch(() => {});
    }
  }
}, { threshold: [0, 0.98] });

// ── Video buffer readiness ────────────────────────────────────────────────
// Resolves when the video's buffered range covers ≥95% of its duration.
// For looping/unknown-duration videos (bg), canplaythrough is sufficient.
function waitForVideoReady(video) {
  return new Promise(resolve => {
    const check = () => {
      const dur = video.duration;
      if (!dur || dur === Infinity) { resolve(); return; }
      if (video.buffered.length > 0 &&
          video.buffered.end(video.buffered.length - 1) >= dur * 0.95) {
        resolve(); return;
      }
      video.addEventListener('progress', check, { once: true });
    };
    if (video.readyState >= 4) { check(); } else {
      video.addEventListener('canplaythrough', check, { once: true });
    }
  });
}

// ── Video error fallback UI ───────────────────────────────────────────────
function showVideoErrorMessage(mask, onContinue) {
  if (!mask) { onContinue(); return; }

  const throbber = mask.querySelector('.mask-throbber');
  if (throbber) throbber.style.display = 'none';

  const box = document.createElement('div');
  box.style.cssText = [
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'gap:1.2rem',
    'padding:2rem 2.5rem',
    'background:var(--card)',
    'backdrop-filter:blur(12px)',
    '-webkit-backdrop-filter:blur(12px)',
    'border:1px solid var(--border)',
    'border-radius:4px',
    'font-family:var(--font-mono)',
    'color:var(--cyan)',
    'max-width:380px',
    'text-align:center',
  ].join(';');

  const heading = document.createElement('div');
  heading.style.cssText = 'font-size:0.9rem;letter-spacing:0.08em;';
  heading.textContent = '● NO CHARACTER VIDEOS FOUND';

  const msg = document.createElement('div');
  msg.style.cssText = 'font-size:0.75rem;opacity:0.7;line-height:1.7;';
  msg.textContent = 'Add video files to the /videos/ directory to enable the full experience. See README for setup instructions.';

  const btn = document.createElement('button');
  btn.style.cssText = [
    'margin-top:0.25rem',
    'padding:0.6rem 1.5rem',
    'background:var(--cyan)',
    'color:var(--bg)',
    'border:none',
    'border-radius:2px',
    'font-family:var(--font-mono)',
    'font-size:0.78rem',
    'letter-spacing:0.1em',
    'cursor:pointer',
  ].join(';');
  btn.textContent = 'CONTINUE TO DASHBOARD';
  btn.addEventListener('click', onContinue, { once: true });

  box.appendChild(heading);
  box.appendChild(msg);
  box.appendChild(btn);
  mask.appendChild(box);
}

// ── Boot ─────────────────────────────────────────────────────────────────
async function boot() {
  window.scrollTo(0, 0);

  state       = 'hero';
  scrollAccum = 0;
  heroInView  = false;
  heroObserver.disconnect();

  [videoA, videoB, panelVideo].forEach(v => {
    v.pause();
    v.removeAttribute('src');
    v.load();
  });

  resetBuffers();
  applyScrollRatio(0); // reset ENGEL + bg opacity/volume to 1

  engelPanel.style.opacity    = '';
  engelPanel.style.transition = '';
  engelPanel.classList.remove('visible');
  mainContent.classList.remove('panel-open');
  siteHeader.classList.remove('visible');

  lockScroll();

  // ── Mask: show while videos buffer ──────────────────────────────────────
  const mask = document.getElementById('hero-mask');
  if (mask) {
    mask.classList.remove('fade-out');
    mask.style.display = '';
  }

  let safetyTimer;
  let revealDone = false;
  let bgError = false, welcomeError = false, idleError = false;

  function startVideoSequence() {
    heroBgVideo.play().catch(() => {});
    activeVideo.poster = '';
    activeVideo.play().catch(() => {
      crossfadeHeroTo('/videos/engel-idle-loop.webm', true);
    });
  }

  function revealHero() {
    if (revealDone) return;
    revealDone = true;
    clearTimeout(safetyTimer);
    if (mask) {
      mask.classList.add('fade-out');
      setTimeout(() => { mask.style.display = 'none'; }, 400);
    }
    startVideoSequence();
  }

  function skipToDashboard() {
    if (revealDone) return;
    revealDone = true;
    clearTimeout(safetyTimer);

    if (mask) {
      mask.style.transition = 'opacity 0.4s ease';
      mask.style.opacity    = '0';
      setTimeout(() => { mask.style.display = 'none'; }, 400);
    }

    engelPanel.classList.add('visible');
    mainContent.classList.add('panel-open');
    siteHeader.classList.add('visible');

    panelVideo.src           = '/videos/engel-browse-idle.webm';
    panelVideo.loop          = true;
    panelVideo.style.opacity = '1';
    panelVideo.load();
    panelVideo.play().catch(() => {});

    state = 'browse';
    unlockScroll();
    applyMobilePanelVisibility(mobilePanelSetting);
    loadServices(false);
    heroObserver.observe(hero);
    startMetricsPoll();

    setTimeout(() => {
      document.getElementById('services')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 400);
  }

  function checkVideoErrors() {
    const anyError   = bgError || welcomeError || idleError;
    const allErrored = bgError && welcomeError && idleError;

    if (allErrored) {
      if (revealDone) return;
      clearTimeout(safetyTimer);
      showVideoErrorMessage(mask, skipToDashboard);
      return;
    }

    if (anyError && !revealDone) {
      clearTimeout(safetyTimer);
      safetyTimer = setTimeout(revealHero, 3000);
    }
  }

  // Load background video
  heroBgVideo.muted = true;
  heroBgVideo.src   = '/videos/hero-background.mp4';
  heroBgVideo.load();

  // Load idle loop (inactive buffer)
  inactiveVideo.src  = '/videos/engel-idle-loop.webm';
  inactiveVideo.loop = true;
  inactiveVideo.load();

  // Load welcome video
  if (welcomePosterUrl) activeVideo.poster = welcomePosterUrl;
  activeVideo.src = '/videos/engel-welcome.webm';
  activeVideo.load();

  activeVideo.addEventListener('ended', () => {
    crossfadeHeroTo('/videos/engel-idle-loop.webm', true);
  }, { once: true });

  heroBgVideo.addEventListener('error',   () => { bgError      = true; checkVideoErrors(); }, { once: true });
  activeVideo.addEventListener('error',   () => { welcomeError = true; checkVideoErrors(); }, { once: true });
  inactiveVideo.addEventListener('error', () => { idleError    = true; checkVideoErrors(); }, { once: true });

  // Gate mask on all three videos being fully buffered; safety fallback at 8s
  safetyTimer = setTimeout(revealHero, 8000);
  Promise.all([
    waitForVideoReady(heroBgVideo),
    waitForVideoReady(activeVideo),
    waitForVideoReady(inactiveVideo),
  ]).then(revealHero);

  // Auth
  await checkAuthStatus();

}

// ── Services ──────────────────────────────────────────────────────────────
// fast=true (admin-back): stagger halved for quick reveal
// fast=false (normal transition): full stagger spans TRANS_DURATION
async function loadServices(fast = false) {
  if (servicesEl.dataset.loaded) return;
  servicesEl.dataset.loaded = '1';

  let services;
  try {
    const res = await fetch('/api/services');
    services = await res.json();
  } catch (_) {
    return;
  }

  const catMap = new Map();
  for (const svc of services) {
    const key = svc.category_id ?? 'uncategorised';
    if (!catMap.has(key)) {
      catMap.set(key, {
        name:   svc.category_name   || 'OTHER',
        colour: svc.category_colour || '#00e5ff',
        items:  [],
      });
    }
    catMap.get(key).items.push(svc);
  }

  servicesEl.innerHTML = '';

  const baseStagger = catMap.size > 1 ? Math.floor(TRANS_DURATION / catMap.size) : 0;
  const stagger      = fast ? Math.floor(baseStagger / 2) : baseStagger;

  let delay = 0;
  for (const [, cat] of catMap) {
    const section = buildCategorySection(cat);
    section.style.transitionDelay = `${delay}ms`;
    servicesEl.appendChild(section);
    delay += stagger;
  }

  requestAnimationFrame(() => {
    servicesEl.classList.add('visible');
    servicesEl.querySelectorAll('.category-section').forEach((s, i) => {
      setTimeout(() => s.classList.add('visible'), i * stagger);
    });
    updateAuthGatedCards(authenticated);
  });
}

function buildCategorySection(cat) {
  const section = document.createElement('section');
  section.className = 'category-section';

  const header = document.createElement('div');
  header.className = 'category-header';

  const name = document.createElement('span');
  name.className   = 'category-name';
  name.style.color = cat.colour;
  name.textContent = cat.name;

  const line = document.createElement('div');
  line.className        = 'category-line';
  line.style.background = cat.colour;

  header.appendChild(name);
  header.appendChild(line);

  const grid = document.createElement('div');
  grid.className = 'services-grid';

  for (const svc of cat.items) grid.appendChild(buildCard(svc));

  section.appendChild(header);
  section.appendChild(grid);
  return section;
}

function buildCard(svc) {
  const a = document.createElement('a');
  a.className = 'service-card';
  a.href      = svc.url;
  a.target    = '_blank';
  a.rel       = 'noopener noreferrer';
  if (svc.requires_auth)        a.dataset.requiresAuth  = 'true';
  if (svc.host_name)            a.dataset.hostName      = svc.host_name;
  if (svc.disable_when_offline) a.dataset.disableOffline = '1';
  a.addEventListener('click', (e) => { if (a.classList.contains('card-offline')) e.preventDefault(); });

  const rgb = hexToRgb(svc.accent_colour);
  a.style.setProperty('--accent', svc.accent_colour);
  if (rgb) a.style.setProperty('--accent-rgb', `${rgb.r},${rgb.g},${rgb.b}`);

  const icon = document.createElement('span');
  icon.className   = 'service-icon';
  icon.textContent = svc.icon;

  const info = document.createElement('div');
  info.className = 'service-info';

  const svcName = document.createElement('div');
  svcName.className   = 'service-name';
  svcName.textContent = svc.name;

  const svcUrl = document.createElement('div');
  svcUrl.className   = 'service-url';
  svcUrl.textContent = svc.url.replace(/^https?:\/\//, '');

  info.appendChild(svcName);
  info.appendChild(svcUrl);

  if (svc.description) {
    const svcDesc = document.createElement('div');
    svcDesc.className   = 'service-description';
    svcDesc.textContent = svc.description;
    info.appendChild(svcDesc);
  }

  a.appendChild(icon);
  a.appendChild(info);

  if (svc.requires_auth) {
    const tag = document.createElement('span');
    tag.className   = 'service-auth-tag';
    tag.textContent = 'AUTH';
    a.appendChild(tag);
  }

  return a;
}

// ── Panel metrics ─────────────────────────────────────────────────────────
let metricsTimer = null;

function startMetricsPoll() {
  if (metricsTimer) return;
  fetchAndDisplayPanelMetrics();
  metricsTimer = setInterval(fetchAndDisplayPanelMetrics, 30000);
}

async function fetchAndDisplayPanelMetrics() {
  try {
    const [metricsRes, borgRes] = await Promise.all([
      fetch('/api/metrics'),
      fetch('/api/borg-status').catch(() => null),
    ]);
    const data     = await metricsRes.json();
    const borgData = borgRes ? await borgRes.json().catch(() => null) : null;
    updatePanelMetrics(data);
    updatePanelBackup(borgData, data.panel_config);

    // Rebuild offline host set and update card states
    offlineHosts = new Set();
    for (const c of (data.containers || [])) { if (c.offline) offlineHosts.add(c.host); }
    for (const n of (data.nodes      || [])) { if (n.offline) offlineHosts.add(n.host); }
    applyOfflineStates();
  } catch (_) {}
}

function applyOfflineStates() {
  document.querySelectorAll('.service-card[data-host-name]').forEach(card => {
    if (card.dataset.disableOffline !== '1') return;
    const isOffline = offlineHosts.has(card.dataset.hostName);
    card.classList.toggle('card-offline', isOffline);
    // Update or remove the OFFLINE badge
    let badge = card.querySelector('.card-offline-badge');
    if (isOffline) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'card-offline-badge';
        badge.textContent = 'OFFLINE';
        card.appendChild(badge);
      }
    } else {
      if (badge) badge.remove();
    }
  });
}

function updatePanelMetrics(data) {
  // Sync mobile status bar regardless of panel visibility
  const mobileStatusDot  = document.getElementById('mobile-status-dot');
  const mobileStatusText = document.getElementById('mobile-status-text');
  if (mobileStatusDot && mobileStatusText) {
    if (!data || data.status === 'unconfigured') {
      mobileStatusDot.className   = '';
      mobileStatusText.textContent = 'AWAITING DATA';
    } else {
      const isMobileDegraded = data.status === 'degraded';
      mobileStatusDot.className   = isMobileDegraded ? 'degraded' : '';
      mobileStatusText.textContent = isMobileDegraded ? 'SYSTEMS DEGRADED' : 'SYSTEMS NOMINAL';
    }
  }

  const statusDot  = document.getElementById('panel-status-dot');
  const statusText = document.getElementById('panel-status-text');
  const nodesEl    = document.getElementById('panel-metrics-nodes');
  if (!statusDot || !statusText || !nodesEl) return;

  if (!data || data.status === 'unconfigured') {
    statusDot.className    = 'status-dot dim';
    statusText.textContent = 'AWAITING DATA';
    nodesEl.innerHTML      = '';
    return;
  }

  const degraded = data.status === 'degraded';
  statusDot.className    = 'status-dot' + (degraded ? ' degraded' : '');
  statusText.textContent = degraded ? 'SYSTEMS DEGRADED' : 'SYSTEMS NOMINAL';

  const cfg         = data.panel_config || {};
  // null = not configured (show all); Set = explicit list (may be empty = show none)
  const showNodes   = Array.isArray(cfg.show_nodes) ? new Set(cfg.show_nodes) : null;
  const showMetrics = new Set(cfg.show_metrics  || ['cpu', 'ram', 'disk', 'uptime']);
  const thr         = data.thresholds || {};
  const defaultThr  = { cpu: 85, ram: 90, disk: 90 };

  nodesEl.innerHTML = '';
  for (const node of (data.nodes || [])) {
    if (showNodes !== null && !showNodes.has(node.host)) continue;

    const nodeThr = { ...defaultThr, ...(thr[node.host] || {}) };
    const entry   = document.createElement('div');
    entry.className = 'panel-node-entry';

    const stats = [];
    if (showMetrics.has('cpu') && node.cpu !== null) {
      const over = node.cpu > nodeThr.cpu;
      stats.push(`<span class="panel-stat">CPU <b${over ? ' class="over"' : ''}>${node.cpu.toFixed(1)}%</b></span>`);
    }
    if (showMetrics.has('ram') && node.ram !== null) {
      const over = node.ram > nodeThr.ram;
      stats.push(`<span class="panel-stat">RAM <b${over ? ' class="over"' : ''}>${node.ram.toFixed(1)}%</b></span>`);
    }
    if (showMetrics.has('disk')) {
      const diskStr = node.disk === null
        ? '<b style="color:var(--text-dim)">N/A</b>'
        : node.disk < 0
          ? '<b>Internal</b>'
          : `<b${node.disk > nodeThr.disk ? ' class="over"' : ''}>${node.disk.toFixed(1)}%</b>`;
      stats.push(`<span class="panel-stat">DSK ${diskStr}</span>`);
    }
    if (showMetrics.has('uptime')) {
      stats.push(`<span class="panel-stat">UP  <b>${escHtml(node.uptime)}</b></span>`);
    }
    if (showMetrics.has('loadavg') && node.loadavg !== null && node.loadavg !== undefined) {
      stats.push(`<span class="panel-stat">LA  <b>${node.loadavg.toFixed(2)}</b></span>`);
    }

    entry.innerHTML = `
      <div class="panel-node-name">${escHtml(node.display_name)}</div>
      <div class="panel-node-stats">${stats.join('')}</div>
    `;
    nodesEl.appendChild(entry);
  }
}

function updatePanelBackup(data, panelConfig) {
  const el = document.getElementById('panel-backup-summary');
  if (!el) return;

  if (!data || data.error === 'disabled') { el.innerHTML = ''; return; }

  const showBorg = panelConfig?.show_borg;
  const repos = (data.repositories || []).filter(r =>
    !Array.isArray(showBorg) || showBorg.includes(r.name)
  );

  if (!data.connected || repos.length === 0) {
    if (!data.connected) {
      el.innerHTML = '<div class="panel-backup-divider"></div>' +
        '<div class="panel-backup-status"><span class="panel-backup-dot unavailable">&#9679;</span> UNAVAILABLE</div>';
    } else {
      el.innerHTML = '';
    }
    return;
  }

  const parts = ['<div class="panel-backup-divider"></div>'];
  for (const repo of repos) {
    const displayName = (repo.display_name || repo.name).toUpperCase();
    const lb          = repo.last_backup;
    parts.push(`<div class="panel-backup-label">${escHtml(displayName)}</div>`);
    if (data.status === 'degraded') {
      parts.push(`<div class="panel-backup-status"><span class="panel-backup-dot failed">&#9679;</span> BACKUP FAILED</div>`);
      if (lb) parts.push(`<div class="panel-backup-stat">Last: ${escHtml(lb.time_ago || '—')}</div>`);
    } else {
      const dotClass = data.status === 'warning' ? 'warning' : 'healthy';
      const timeStr  = lb ? `${escHtml(lb.time_ago || '—')} &middot; ${escHtml(lb.duration_display || '—')}` : '—';
      parts.push(`<div class="panel-backup-status"><span class="panel-backup-dot ${dotClass}">&#9679;</span> ${timeStr}</div>`);
      if (lb) parts.push(`<div class="panel-backup-stat">${escHtml(lb.deduplicated_size_display || '—')} deduplicated</div>`);
    }
  }
  el.innerHTML = parts.join('');
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function hexToRgb(hex) {
  if (!hex) return null;
  const m = hex.replace('#', '').match(/.{2}/g);
  if (!m || m.length < 3) return null;
  return { r: parseInt(m[0], 16), g: parseInt(m[1], 16), b: parseInt(m[2], 16) };
}

// ── Auth helpers ──────────────────────────────────────────────────────────
async function checkAuthStatus() {
  try {
    const res  = await fetch('/api/auth-status');
    const data = await res.json();
    authenticated = data.authenticated;
    if (authenticated && data.username) {
      authName.textContent = data.username;
      authBadge.classList.add('visible');
    } else {
      authBadge.classList.remove('visible');
    }
    updateAuthGatedCards(authenticated);
    updateAdminDot(authenticated);
  } catch (_) {
    updateAuthGatedCards(false);
    updateAdminDot(false);
  }
}

function updateAuthGatedCards(isAuth) {
  document.querySelectorAll('.service-card[data-requires-auth="true"]').forEach(card => {
    card.style.display = isAuth ? 'flex' : 'none';
  });
  document.querySelectorAll('.category-section').forEach(section => {
    const hasVisible = [...section.querySelectorAll('.service-card')].some(c => c.style.display !== 'none');
    section.style.display = hasVisible ? '' : 'none';
  });
}

function updateAdminDot(isAuth) {
  const dot = document.getElementById('admin-auth-dot');
  if (dot) dot.classList.toggle('active', isAuth);
}

// Re-check when user returns to the tab
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkAuthStatus();
});

// Re-check every 5 minutes while the tab is open
setInterval(checkAuthStatus, 5 * 60 * 1000);

// ── Fast boot — skip hero when returning from /admin ─────────────────────
async function bootFast() {
  state       = 'browse';
  scrollAccum = 0;
  heroInView  = false;
  heroObserver.disconnect();

  [videoA, videoB, panelVideo].forEach(v => {
    v.pause();
    v.removeAttribute('src');
    v.load();
  });

  resetBuffers();
  applyScrollRatio(0);
  engelPanel.style.opacity    = '';
  engelPanel.style.transition = '';

  // Immediately enter browse layout
  engelPanel.classList.add('visible');
  mainContent.classList.add('panel-open');
  siteHeader.classList.add('visible');

  // Browse-idle panel video
  panelVideo.src           = '/videos/engel-browse-idle.webm';
  panelVideo.loop          = true;
  panelVideo.style.opacity = '1';
  panelVideo.load();
  panelVideo.play().catch(() => {});

  // Background video so hero works if user scrolls back up
  heroBgVideo.muted = true;
  heroBgVideo.src   = '/videos/hero-background.mp4';
  heroBgVideo.load();
  heroBgVideo.play().catch(() => {});

  // Hide the mask immediately — videos are already cached from prior boot
  const mask = document.getElementById('hero-mask');
  if (mask) mask.style.display = 'none';

  unlockScroll();
  window.scrollTo(0, hero.offsetHeight);

  loadServices(true); // fast stagger for admin-back path
  heroObserver.observe(hero);
  startMetricsPoll();

  await checkAuthStatus();
}

// ── Mobile panel visibility ───────────────────────────────────────────────
function applyMobilePanelVisibility(setting) {
  const nowMobile    = Math.min(window.screen.width, window.screen.height) <= 768;
  const panel        = document.getElementById('engel-panel');
  const services     = document.getElementById('services');
  const mobileStatus = document.getElementById('mobile-status');
  const panelOnLeft  = document.body.classList.contains('panel-left');

  if (nowMobile) {
    const mobilePanel = setting || 'hidden';
    if (mobilePanel === 'hidden') {
      if (panel) panel.style.display = 'none';
      if (services) {
        services.style.marginRight  = '0';
        services.style.marginLeft   = '0';
        services.style.paddingRight = panelOnLeft ? '' : '1rem';
        services.style.paddingLeft  = panelOnLeft ? '1rem' : '';
      }
      if (mobileStatus) mobileStatus.style.display = 'block';
    } else {
      if (panel) panel.style.display = '';
      if (services) {
        services.style.marginRight  = '';
        services.style.marginLeft   = '';
        services.style.paddingRight = '';
        services.style.paddingLeft  = '';
      }
      if (mobileStatus) mobileStatus.style.display = 'none';
    }
  } else {
    if (panel)        panel.style.display        = '';
    if (mobileStatus) mobileStatus.style.display = 'none';
  }
}

window.addEventListener('resize', () => {
  applyMobilePanelVisibility(mobilePanelSetting);
});

// ── Layout settings ───────────────────────────────────────────────────────
async function applyLayoutSettings() {
  try {
    const res  = await fetch('/api/layout');
    const data = await res.json();
    const minW = parseInt(data.card_width_desktop) || 200;
    const cols = parseInt(data.card_width_mobile)  || 1;
    document.documentElement.style.setProperty('--card-min-width', `${minW}px`);
    let styleEl = document.getElementById('layout-override-style');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'layout-override-style';
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = `@media (max-width: 600px) { .services-grid { grid-template-columns: repeat(${cols}, 1fr) !important; } }`;
  } catch (_) {}
}

// ── Theme application ─────────────────────────────────────────────────────
const GOOGLE_FONT_VARIANTS = {
  'Orbitron':        'Orbitron:wght@400;700;900',
  'Rajdhani':        'Rajdhani:wght@400;500;700',
  'Exo 2':           'Exo+2:wght@400;500;700',
  'Audiowide':       'Audiowide',
  'Michroma':        'Michroma',
  'Quantico':        'Quantico:wght@400;700',
  'Share Tech':      'Share+Tech',
  'Inter':           'Inter:wght@300;400;500',
  'Source Sans 3':   'Source+Sans+3:wght@400;500',
  'DM Sans':         'DM+Sans:wght@400;500',
  'Nunito':          'Nunito:wght@400;500',
  'Open Sans':       'Open+Sans:wght@400;500',
  'Share Tech Mono': 'Share+Tech+Mono',
  'JetBrains Mono':  'JetBrains+Mono:wght@300;400',
  'Fira Code':       'Fira+Code:wght@400;500',
  'Space Mono':      'Space+Mono',
  'Courier Prime':   'Courier+Prime',
};

// Fonts already in main.css @import — no dynamic load needed
const PRELOADED_FONTS = new Set(['Orbitron', 'JetBrains Mono', 'Inter', 'Share Tech Mono']);

function loadGoogleFont(family) {
  if (!family || PRELOADED_FONTS.has(family)) return;
  const variant = GOOGLE_FONT_VARIANTS[family];
  if (!variant) return;
  const id = `gfont-${family.replace(/\s+/g, '-').toLowerCase()}`;
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id   = id;
  link.rel  = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${variant}&display=swap`;
  document.head.appendChild(link);
}

async function applyTheme() {
  try {
    const res   = await fetch('/api/theme');
    const theme = await res.json();
    const root  = document.documentElement;

    // Colour vars
    if (theme.theme_bg_primary)     root.style.setProperty('--bg',  theme.theme_bg_primary);
    if (theme.theme_bg_secondary)   root.style.setProperty('--bg2', theme.theme_bg_secondary);
    if (theme.theme_accent_primary) root.style.setProperty('--cyan', theme.theme_accent_primary);
    if (theme.theme_text_primary)   root.style.setProperty('--text', theme.theme_text_primary);
    if (theme.theme_text_dim)       root.style.setProperty('--text-dim', theme.theme_text_dim);

    // Derived vars
    const accentRgb = hexToRgb(theme.theme_accent_primary);
    if (accentRgb) {
      root.style.setProperty('--border', `rgba(${accentRgb.r},${accentRgb.g},${accentRgb.b},0.12)`);
    }
    const bg2Rgb     = hexToRgb(theme.theme_bg_secondary);
    const cardOpacity = parseFloat(theme.theme_card_opacity) || 0.85;
    if (bg2Rgb) {
      root.style.setProperty('--card', `rgba(${bg2Rgb.r},${bg2Rgb.g},${bg2Rgb.b},${cardOpacity})`);
    }

    // Effects
    const intensity = theme.theme_scanlines === 'false' ? '0' : (theme.theme_scanline_intensity || '0.012');
    root.style.setProperty('--scanline-intensity', intensity);
    root.style.setProperty('--corner-brackets-opacity',
      theme.theme_corner_brackets === 'false' ? '0' : '0.35');

    // Character settings
    const charEnabled = theme.character_enabled !== 'false';
    const panelSide   = theme.character_panel_side || 'right';
    const panelWidth  = parseInt(theme.character_panel_width) || 300;
    PANEL_W = panelWidth;

    document.body.classList.toggle('character-disabled', !charEnabled);
    document.body.classList.toggle('panel-left', panelSide === 'left');
    root.style.setProperty('--panel-w', `${panelWidth}px`);

    const charNameEl = document.querySelector('.panel-engel-name');
    if (charNameEl && theme.character_name) charNameEl.textContent = theme.character_name;

    const panelTitleEl = document.getElementById('panel-site-title');
    if (panelTitleEl && theme.character_tagline) panelTitleEl.textContent = theme.character_tagline;

    const blendMode = theme.character_blend_mode || 'screen';
    [document.getElementById('engel-panel-video'),
     document.getElementById('engel-video-a'),
     document.getElementById('engel-video-b')].forEach(v => {
      if (v) v.style.mixBlendMode = blendMode;
    });

    const metricsWrap = document.getElementById('panel-metrics-wrap');
    if (metricsWrap) metricsWrap.style.display = theme.character_show_metrics === 'false' ? 'none' : '';
    const statusLine = document.getElementById('panel-status-line');
    if (statusLine) statusLine.style.display = theme.character_show_status === 'false' ? 'none' : '';

    mobilePanelSetting = theme.character_mobile_panel || 'hidden';
    applyMobilePanelVisibility(mobilePanelSetting);

    // Hero text
    const heroTitleEl = document.querySelector('.hero-title');
    if (heroTitleEl && theme.hero_title) heroTitleEl.textContent = theme.hero_title;
    const heroSubtitleEl = document.querySelector('.hero-subtitle');
    if (heroSubtitleEl && theme.hero_subtitle) heroSubtitleEl.textContent = theme.hero_subtitle;

    // Page title / site logo
    if (theme.title) {
      document.title = theme.title;
      const logoEl = document.querySelector('.site-logo');
      if (logoEl) logoEl.textContent = theme.title;
    }

    // Layout helpers
    document.body.classList.toggle('hide-descriptions', theme.layout_show_descriptions === 'false');
    document.body.classList.toggle('hide-urls',         theme.layout_show_urls         === 'false');
    document.body.classList.toggle('hide-scroll-hint',  theme.hero_show_scroll_indicator === 'false');

    // Card style
    ['glass','solid','minimal','bordered'].forEach(s => document.body.classList.remove(`card-style-${s}`));
    if (theme.layout_card_style && theme.layout_card_style !== 'glass') {
      document.body.classList.add(`card-style-${theme.layout_card_style}`);
    }

    // Desktop columns override
    let styleEl = document.getElementById('layout-override-style');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'layout-override-style';
      document.head.appendChild(styleEl);
    }
    if (theme.layout_desktop_columns && theme.layout_desktop_columns !== 'auto') {
      const cols = parseInt(theme.layout_desktop_columns);
      if (cols >= 2 && cols <= 5) {
        styleEl.textContent = (styleEl.textContent || '') +
          `\n@media (min-width: 601px) { .services-grid { grid-template-columns: repeat(${cols}, 1fr) !important; } }`;
      }
    }

    // Footer
    const footerTextEl = document.getElementById('footer-text');
    if (footerTextEl && theme.footer_text) footerTextEl.textContent = theme.footer_text;
    const footerPersonal = document.getElementById('footer-personal-section');
    if (footerPersonal) footerPersonal.style.display = theme.footer_show_link === 'false' ? 'none' : '';
    const footerLink = document.getElementById('footer-personal-link');
    if (footerLink) {
      if (theme.footer_link_url)   footerLink.href        = theme.footer_link_url;
      if (theme.footer_link_label) footerLink.textContent = theme.footer_link_label;
    }

    // Fonts
    loadGoogleFont(theme.theme_font_heading);
    loadGoogleFont(theme.theme_font_body);
    loadGoogleFont(theme.theme_font_mono);

    let fontCss = '';
    if (theme.theme_font_heading_custom) {
      fontCss += `@font-face { font-family: 'CustomHeading'; src: url('/fonts/${theme.theme_font_heading_custom}'); }\n`;
    }
    if (theme.theme_font_body_custom) {
      fontCss += `@font-face { font-family: 'CustomBody'; src: url('/fonts/${theme.theme_font_body_custom}'); }\n`;
    }

    const headingFont = theme.theme_font_heading_custom
      ? `'CustomHeading', '${theme.theme_font_heading || 'Orbitron'}'`
      : `'${theme.theme_font_heading || 'Orbitron'}'`;
    const bodyFont = theme.theme_font_body_custom
      ? `'CustomBody', '${theme.theme_font_body || 'Inter'}'`
      : `'${theme.theme_font_body || 'Inter'}'`;
    const monoFont = `'${theme.theme_font_mono || 'Share Tech Mono'}'`;

    fontCss += `:root { --font-heading: ${headingFont}; --font-body: ${bodyFont}; --font-mono: ${monoFont}; }\n`;
    fontCss += `body { font-family: ${bodyFont}, sans-serif; }\n`;

    let fontStyleEl = document.getElementById('theme-font-style');
    if (!fontStyleEl) {
      fontStyleEl = document.createElement('style');
      fontStyleEl.id = 'theme-font-style';
      document.head.appendChild(fontStyleEl);
    }
    fontStyleEl.textContent = fontCss;

    // Custom CSS (sanitised server-side, injected here)
    if (theme.theme_custom_css) {
      let customEl = document.getElementById('theme-custom-style');
      if (!customEl) {
        customEl = document.createElement('style');
        customEl.id = 'theme-custom-style';
        document.head.appendChild(customEl);
      }
      customEl.textContent = theme.theme_custom_css;
    }

    // Announcement banner
    if (theme.announcement_enabled === 'true' && theme.announcement_text) {
      const banner  = document.getElementById('announcement-banner');
      const textEl  = document.getElementById('announcement-text');
      const dismiss = document.getElementById('announcement-dismiss');
      if (banner && textEl) {
        root.style.setProperty('--announcement-colour', theme.announcement_colour || '#fbbf24');
        textEl.textContent = theme.announcement_text;
        const dismissed = sessionStorage.getItem('firmament_announcement_dismissed');
        if (!dismissed) {
          banner.style.display = 'flex';
          document.body.classList.add('has-announcement');
        }
        if (dismiss && theme.announcement_dismissible !== 'false') {
          dismiss.style.display = '';
          dismiss.addEventListener('click', () => {
            banner.style.display = 'none';
            document.body.classList.remove('has-announcement');
            sessionStorage.setItem('firmament_announcement_dismissed', '1');
          }, { once: true });
        } else if (dismiss) {
          dismiss.style.display = 'none';
        }
      }
    }

    // Welcome modal
    showWelcomeModal(theme);

  } catch (_) {}
}

function showWelcomeModal(theme) {
  if (theme.welcome_modal_enabled !== 'true') return;
  if (theme.welcome_modal_once_per_session !== 'false') {
    if (sessionStorage.getItem('firmament_welcome_dismissed')) return;
  }
  const modal   = document.getElementById('welcome-modal');
  const titleEl = document.getElementById('welcome-modal-title');
  const bodyEl  = document.getElementById('welcome-modal-body');
  const btnEl   = document.getElementById('welcome-modal-btn');
  if (!modal || !titleEl || !bodyEl || !btnEl) return;

  titleEl.textContent = theme.welcome_modal_title  || 'WELCOME';
  bodyEl.textContent  = theme.welcome_modal_body   || '';
  btnEl.textContent   = theme.welcome_modal_button || 'ENTER';

  setTimeout(() => {
    modal.style.display = 'flex';
  }, 500);

  btnEl.addEventListener('click', () => {
    modal.style.display = 'none';
    if (theme.welcome_modal_once_per_session !== 'false') {
      sessionStorage.setItem('firmament_welcome_dismissed', '1');
    }
  }, { once: true });
}

applyLayoutSettings();
applyTheme();

// ── Start ─────────────────────────────────────────────────────────────────
const fromAdmin = (() => {
  try { return !!document.referrer && new URL(document.referrer).pathname === '/admin'; }
  catch (_) { return false; }
})();

fromAdmin ? bootFast() : boot();
