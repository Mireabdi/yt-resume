// YT Resume content script: saves playback position per video and resumes it.
(() => {
  'use strict';

  const KEY_PREFIX = 'v:';
  const SAVE_INTERVAL_MS = 5000;
  const MIN_RESUME_S = 10; // saved positions at or below this are not worth resuming
  const USER_MOVED_S = 5; // playhead beyond this at resume time means someone already moved it
  const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

  let session = null; // state for the video currently being tracked
  let lastKnown = null; // {id, list, time, title, channel, duration}; used when the URL has already changed
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
    if (!capture(s)) return;
    const now = Date.now();
    if (now - s.lastSaveAt < SAVE_INTERVAL_MS) return;
    s.lastSaveAt = now;
    save();
  }

  // ---- resuming ----
  function stopResume(s) {
    s.resumed = true;
    if (s.observer) {
      s.observer.disconnect();
      s.observer = null;
    }
  }

  // Resume only once the real video is loaded, and never over a position the user already moved.
  function maybeResume(s) {
    if (!settings || !settings.enabled || s.closed || s.resumed || !s.ready || !s.saved || !s.video) return;
    const v = s.video;
    if (v.readyState < 1) return;
    if (isAd()) {
      watchForAdEnd(s);
      return;
    }
    if (getVideoId() !== s.id || v.currentTime >= USER_MOVED_S || !isTrackable(v)) {
      stopResume(s);
      return;
    }
    v.currentTime = s.saved.time;
    stopResume(s);
  }

  // A pre-roll ad can be playing when metadata loads; retry once the ad class clears.
  function watchForAdEnd(s) {
    if (s.observer) return;
    const player = document.getElementById('movie_player');
    if (!player) return;
    s.observer = new MutationObserver(() => {
      if (!isAd()) maybeResume(s);
    });
    s.observer.observe(player, { attributes: true, attributeFilter: ['class'] });
  }

  // ---- session lifecycle ----
  function teardown(s) {
    s.closed = true;
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
    settings = ytResumeNormalizeSettings(raw);
    if (session) maybeResume(session); // may have been waiting for settings or for "enabled"
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
