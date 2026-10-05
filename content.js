// YT Resume content script: saves playback position per video and resumes it.
(() => {
  'use strict';

  const KEY_PREFIX = 'v:';
  const SAVE_INTERVAL_MS = 5000;
  const MIN_RESUME_S = 10; // saved positions at or below this are not worth resuming
  const USER_MOVED_S = 5; // after an ad, a playhead beyond this means someone already moved it
  const RESUME_TOLERANCE_S = 5; // playhead this close to our target already counts as resumed
  const RESUME_RECHECK_MS = 2500; // fallback check this long after playback starts
  const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
  const TOAST_MS = 6000;

  let session = null; // state for the video currently being tracked
  let lastKnown = null; // {id, list, time, title, channel, duration}; used when the URL has already changed
  let toast = null; // {el, timer} for the "Resumed at" overlay, at most one at a time
  let isFirstInit = true;
  let settings = null; // null until loaded from storage, so nothing happens under stale defaults

  const getVideoId = () => new URLSearchParams(location.search).get('v');
  const isAd = () => !!document.querySelector('#movie_player.ad-showing');
  // Live streams: infinite duration, or a finite DVR window with YouTube's live marker.
  const isLive = (v) => !Number.isFinite(v.duration) || !!document.querySelector('#movie_player .ytp-live');
  const isTrackable = (v) => !isLive(v) && v.duration >= settings.minDuration;

  // ---- storage helpers (all calls fail quietly, e.g. after the extension is reloaded) ----
  const hasStorage = () => {
    try { return !!chrome.runtime?.id; } catch { return false; }
  };
  async function storageGet(keys) {
    if (!hasStorage()) return {};
    try { return await chrome.storage.local.get(keys); } catch { return {}; }
  }
  async function storageSet(items) {
    if (!hasStorage()) return;
    try { await chrome.storage.local.set(items); } catch { /* ignore */ }
  }
  async function storageRemove(keys) {
    if (!hasStorage()) return;
    try { await chrome.storage.local.remove(keys); } catch { /* ignore */ }
  }

  function formatTime(total) {
    const s = Math.max(0, Math.floor(total));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  }

  // ---- saving ----
  function currentTitle(id) {
    const t = document.title.replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube$/, '').trim();
    return t || id;
  }

  // Channel name from the watch page; the markup changes now and then, so fail quietly.
  function currentChannel() {
    try {
      const a = document.querySelector('#owner ytd-channel-name a');
      return (a && a.textContent ? a.textContent : '').trim();
    } catch {
      return '';
    }
  }

  // Snapshot the player into lastKnown. Returns false when there is nothing trustworthy to record.
  function capture(s) {
    const v = s.video;
    if (!settings || !settings.enabled || !v || !s.ready || isAd() || !isTrackable(v)) return false;
    // The channel element can lag behind a navigation, so keep the last good value for this video.
    const channel = currentChannel() || (lastKnown && lastKnown.id === s.id ? lastKnown.channel : '');
    lastKnown = {
      id: s.id,
      list: s.list,
      time: v.currentTime,
      title: currentTitle(s.id),
      channel,
      duration: v.duration,
    };
    return true;
  }

  // Persist lastKnown (not the live player, which may already show the next video).
  function save() {
    const k = lastKnown;
    if (!k || !settings || !settings.enabled || isAd()) return;
    const key = KEY_PREFIX + k.id;
    if (k.duration - k.time <= settings.finishedThreshold) {
      storageRemove(key);
      return;
    }
    if (k.time <= MIN_RESUME_S) return; // would never be resumed, and would only clutter the list
    const entry = {
      time: Math.floor(k.time),
      duration: Math.floor(k.duration),
      title: k.title,
      updatedAt: Date.now(),
    };
    if (k.channel) entry.channel = k.channel;
    if (k.list) entry.list = k.list;
    storageSet({ [key]: entry });
  }

  // Unthrottled save from the live player (pause / hidden / pagehide).
  function flush() {
    if (session && !session.closed && capture(session)) save();
  }

  function onTimeUpdate(s) {
    if (toast && isAd()) hideToast(); // e.g. a mid-roll starting while the toast is still up
    if (!capture(s)) return;
    const now = Date.now();
    if (now - s.lastSaveAt < SAVE_INTERVAL_MS) return;
    s.lastSaveAt = now;
    save();
  }

  // ---- resume toast ----
  function hideToast() {
    if (!toast) return;
    clearTimeout(toast.timer);
    toast.el.remove();
    toast = null;
  }

  function startOver(s) {
    hideToast();
    if (s.closed || !s.video) return;
    s.video.currentTime = 0;
    // lastKnown still holds the resumed position; drop it so a quick navigation can't write it back.
    if (lastKnown && lastKnown.id === s.id) lastKnown = null;
    storageRemove(KEY_PREFIX + s.id);
  }

  // Classes are prefixed "ytr-" and styled in toast.css so they can't clash with YouTube's CSS.
  function showToast(s, resumedAt) {
    hideToast();
    try {
      const player = document.getElementById('movie_player');
      if (!player || isAd()) return;
      const el = document.createElement('div');
      el.className = 'ytr-toast';
      el.setAttribute('role', 'status');
      const text = document.createElement('span');
      text.className = 'ytr-toast__text';
      text.textContent = `Resumed at ${formatTime(resumedAt)}`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ytr-toast__btn';
      btn.textContent = 'Start over';
      btn.addEventListener('click', () => startOver(s));
      // Keep clicks from reaching the player, which would pause or unpause the video.
      for (const type of ['click', 'dblclick', 'mousedown', 'pointerdown']) {
        el.addEventListener(type, (e) => e.stopPropagation());
      }
      el.append(text, btn);
      player.append(el);
      toast = { el, timer: setTimeout(hideToast, TOAST_MS) };
    } catch { /* the toast is a nicety; never break resuming over it */ }
  }

  // ---- resuming ----
  function stopResume(s) {
    s.resumed = true;
    clearTimeout(s.timer);
    s.timer = null;
    if (s.observer) {
      s.observer.disconnect();
      s.observer = null;
    }
  }

  // One check per video load. At load time YouTube may already have resumed from its own history,
  // so we compare the playhead with our target instead of assuming it starts at 0:00 and only
  // seek when they disagree. `guarded` (used after an ad, or when settings change mid-playback)
  // also leaves the video alone if the playhead has moved on, since someone may have scrubbed.
  function maybeResume(s, guarded = false) {
    if (!settings || !settings.enabled || s.closed || s.resumed || !s.ready || !s.saved || !s.video) return;
    const v = s.video;
    if (v.readyState < 1) return;
    if (isAd()) {
      watchForAdEnd(s);
      return;
    }
    if (getVideoId() !== s.id || !isTrackable(v) || (guarded && v.currentTime >= USER_MOVED_S)) {
      stopResume(s);
      return;
    }
    const target = Math.max(0, s.saved.time - settings.rewind);
    const differs = Math.abs(v.currentTime - target) > RESUME_TOLERANCE_S;
    stopResume(s);
    if (!differs) return;
    v.currentTime = target;
    if (target > 0) showToast(s, target);
  }

  // A pre-roll ad can be playing when metadata loads; retry once the ad class clears.
  function watchForAdEnd(s) {
    if (s.observer) return;
    const player = document.getElementById('movie_player');
    if (!player) return;
    s.observer = new MutationObserver(() => {
      if (!isAd()) maybeResume(s, true);
    });
    s.observer.observe(player, { attributes: true, attributeFilter: ['class'] });
  }

  // ---- session lifecycle ----
  function teardown(s) {
    hideToast();
    s.closed = true;
    clearTimeout(s.timer);
    s.timer = null;
    s.abort.abort();
    if (s.observer) s.observer.disconnect();
    s.observer = null;
  }

  function attachVideo(s, v, initial) {
    s.video = v;
    const opts = { signal: s.abort.signal };
    v.addEventListener('timeupdate', () => onTimeUpdate(s), opts);
    v.addEventListener('pause', flush, opts);
    v.addEventListener('loadedmetadata', () => {
      s.ready = true;
      maybeResume(s);
    }, opts);
    // Fallback in case metadata fired before we attached, or YouTube positions the video late.
    // Scheduled once, from the first non-ad 'playing'; the element holds the right video by then.
    v.addEventListener('playing', () => {
      if (s.recheckScheduled || s.resumed || isAd()) return;
      s.recheckScheduled = true;
      s.timer = setTimeout(() => {
        s.timer = null;
        s.ready = true;
        maybeResume(s);
      }, RESUME_RECHECK_MS);
    }, opts);
    // The <video> element is reused across SPA navigations, so on a navigation it may still hold
    // the previous video. Only trust it now if it looks freshly loaded; otherwise wait for loadedmetadata.
    if (initial || (v.readyState >= 1 && v.currentTime < USER_MOVED_S)) s.ready = true;
    maybeResume(s);
  }

  function findVideo(s, initial) {
    let tries = 0;
    const tick = () => {
      if (s.closed) return;
      const v = document.querySelector('video.html5-main-video');
      if (v) return attachVideo(s, v, initial);
      if (++tries < 40) setTimeout(tick, 250);
    };
    tick();
  }

  function init() {
    // YouTube fires yt-navigate-finish on a page's first load, possibly after our own startup init().
    // Same video, still-live session: keep it, or the toast would vanish and the check would rerun.
    // (A real navigation always goes through yt-navigate-start first, which clears the session.)
    const current = getVideoId();
    if (session && !session.closed && current && session.id === current) return;
    if (session) teardown(session);
    session = null;
    lastKnown = null;
    const initial = isFirstInit;
    isFirstInit = false;

    const params = new URLSearchParams(location.search);
    const id = params.get('v');
    if (!id) return;

    const s = {
      id,
      list: params.get('list') || '',
      video: null,
      abort: new AbortController(),
      closed: false,
      ready: false,
      resumed: false,
      saved: null,
      observer: null,
      timer: null,
      recheckScheduled: false,
      lastSaveAt: 0,
    };
    session = s;

    const hasTParam = params.has('t');
    const key = KEY_PREFIX + id;
    storageGet(key).then((res) => {
      const saved = res[key];
      if (!s.closed && !hasTParam && saved && saved.time > MIN_RESUME_S) {
        s.saved = saved;
        maybeResume(s);
      }
    });

    findVideo(s, initial);
  }

  async function prune() {
    if (!settings || !settings.enabled) return;
    const all = await storageGet(null);
    const cutoff = Date.now() - MAX_AGE_MS;
    const entries = Object.entries(all).filter(([k]) => k.startsWith(KEY_PREFIX));
    const isFresh = (e) => e && e.updatedAt > cutoff;
    const stale = entries.filter(([, e]) => !isFresh(e)).map(([k]) => k);
    const excess = entries
      .filter(([, e]) => isFresh(e))
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
      .slice(settings.maxEntries)
      .map(([k]) => k);
    const doomed = stale.concat(excess);
    if (doomed.length) await storageRemove(doomed);
  }

  // ---- settings ----
  function applySettings(raw) {
    const firstLoad = settings === null;
    settings = ytResumeNormalizeSettings(raw);
    // Guarded after the first load: turning the extension on mid-playback must not yank the playhead.
    if (session) maybeResume(session, !firstLoad);
    prune(); // runs on load and again after any change, e.g. a lower entry limit
  }

  async function loadSettings() {
    const res = await storageGet(YT_RESUME_SETTINGS_KEY);
    applySettings(res[YT_RESUME_SETTINGS_KEY]);
  }

  // ---- wiring ----
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[YT_RESUME_SETTINGS_KEY]) {
        applySettings(changes[YT_RESUME_SETTINGS_KEY].newValue);
      }
    });
  } catch { /* extension context gone */ }
  document.addEventListener('yt-navigate-finish', init);
  document.addEventListener('yt-navigate-start', () => {
    save(); // lastKnown holds the video we are leaving
    if (session) teardown(session);
    session = null;
    lastKnown = null;
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', flush);

  loadSettings();
  init(); // the first yt-navigate-finish may already have fired before this script ran
})();
