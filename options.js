const fields = {
  enabled: document.getElementById('enabled'),
  minDuration: document.getElementById('minDuration'),
  finishedThreshold: document.getElementById('finishedThreshold'),
  maxEntries: document.getElementById('maxEntries'),
};
const statusEl = document.getElementById('status');
let statusTimer = null;

function fill(s) {
  fields.enabled.checked = s.enabled;
  for (const name of ['minDuration', 'finishedThreshold', 'maxEntries']) {
    fields[name].value = s[name];
    fields[name].min = YT_RESUME_LIMITS[name].min;
    fields[name].max = YT_RESUME_LIMITS[name].max;
  }
}

function showStatus(text) {
  statusEl.textContent = text;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { statusEl.textContent = ''; }, 2000);
}

// Saves on every change; the content script picks it up through storage.onChanged.
async function save() {
  const s = ytResumeNormalizeSettings({
    enabled: fields.enabled.checked,
    minDuration: fields.minDuration.value,
    finishedThreshold: fields.finishedThreshold.value,
    maxEntries: fields.maxEntries.value,
  });
  fill(s); // shows the value that was actually stored (clamped, or the default if blank)
  await chrome.storage.local.set({ [YT_RESUME_SETTINGS_KEY]: s });
  showStatus('Saved');
}

Object.values(fields).forEach((input) => input.addEventListener('change', save));

document.getElementById('reset').addEventListener('click', async () => {
  fill(YT_RESUME_DEFAULTS);
  await chrome.storage.local.set({ [YT_RESUME_SETTINGS_KEY]: { ...YT_RESUME_DEFAULTS } });
  showStatus('Reset to defaults');
});

chrome.storage.local.get(YT_RESUME_SETTINGS_KEY).then((res) => {
  fill(ytResumeNormalizeSettings(res[YT_RESUME_SETTINGS_KEY]));
});
