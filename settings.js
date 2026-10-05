// Shared by the content script and the options page (plain script, no modules).
const YT_RESUME_SETTINGS_KEY = 'settings';

const YT_RESUME_DEFAULTS = Object.freeze({
  enabled: true,
  minDuration: 60, // seconds; shorter videos are not tracked
  finishedThreshold: 15, // seconds from the end that counts as finished
  maxEntries: 500,
});

// Upper bounds keep a typo from disabling tracking or filling storage.
const YT_RESUME_LIMITS = Object.freeze({
  minDuration: { min: 0, max: 86400 },
  finishedThreshold: { min: 0, max: 86400 },
  maxEntries: { min: 1, max: 5000 },
});

// Turns whatever is in storage (or a form) into a complete, valid settings object.
function ytResumeNormalizeSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const num = (name) => {
    const v = src[name];
    if (v === '' || v === null || v === undefined) return YT_RESUME_DEFAULTS[name];
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n)) return YT_RESUME_DEFAULTS[name];
    const { min, max } = YT_RESUME_LIMITS[name];
    return Math.min(max, Math.max(min, n));
  };
  return {
    enabled: typeof src.enabled === 'boolean' ? src.enabled : YT_RESUME_DEFAULTS.enabled,
    minDuration: num('minDuration'),
    finishedThreshold: num('finishedThreshold'),
    maxEntries: num('maxEntries'),
  };
}
