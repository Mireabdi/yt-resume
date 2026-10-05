const KEY_PREFIX = 'v:';

const listEl = document.getElementById('list');
const emptyEl = document.getElementById('empty');
const noMatchEl = document.getElementById('no-match');
const clearBtn = document.getElementById('clear-all');
const searchWrap = document.getElementById('search-wrap');
const searchEl = document.getElementById('search');

let entries = []; // all saved videos, newest first

function formatTime(total) {
  const s = Math.max(0, Math.floor(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text; // titles are untrusted: never innerHTML
  return node;
}

function watchUrl(id, entry) {
  let url = `https://www.youtube.com/watch?v=${encodeURIComponent(id)}&t=${Math.floor(entry.time)}s`;
  if (entry.list) url += `&list=${encodeURIComponent(entry.list)}`;
  return url;
}

// Small fixed-size thumbnail; if it can't load, the grey placeholder box stays and nothing shifts.
function renderThumb(id) {
  const wrap = el('span', 'thumb');
  const img = document.createElement('img');
  img.width = 80;
  img.height = 45;
  img.alt = '';
  img.loading = 'lazy';
  img.referrerPolicy = 'no-referrer';
  img.addEventListener('error', () => { img.hidden = true; });
  img.src = `https://i.ytimg.com/vi/${encodeURIComponent(id)}/default.jpg`;
  wrap.append(img);
  return wrap;
}

function renderRow([key, entry]) {
  const id = key.slice(KEY_PREFIX.length);
  const pct = entry.duration > 0 ? Math.min(100, (entry.time / entry.duration) * 100) : 0;
  const title = String(entry.title ?? id);

  const open = el('button', 'open');
  open.type = 'button';
  open.title = title;
  const text = el('span', 'text');
  text.append(el('span', 'title', title));
  if (entry.channel) text.append(el('span', 'channel', String(entry.channel)));
  text.append(el('span', 'meta', `${formatTime(entry.time)} / ${formatTime(entry.duration)}`));
  const bar = el('div', 'bar');
  const fill = el('div', 'fill');
  fill.style.width = `${pct}%`;
  bar.append(fill);
  text.append(bar);
  open.append(renderThumb(id), text);
  open.addEventListener('click', () => {
    chrome.tabs.create({ url: watchUrl(id, entry) });
  });

  const del = el('button', 'delete', '×');
  del.type = 'button';
  del.title = 'Remove';
  del.setAttribute('aria-label', `Remove ${title}`);
  del.addEventListener('click', async () => {
    await chrome.storage.local.remove(key);
    load();
  });

  const li = el('li');
  li.append(open, del);
  return li;
}

// Re-draws the list from memory, applying the search box.
function render() {
  const q = searchEl.value.trim().toLowerCase();
  const shown = q
    ? entries.filter(([, e]) => String(e.title ?? '').toLowerCase().includes(q))
    : entries;

  listEl.replaceChildren(...shown.map(renderRow));
  emptyEl.hidden = entries.length > 0;
  noMatchEl.hidden = entries.length === 0 || shown.length > 0;
  searchWrap.hidden = entries.length === 0;
  clearBtn.hidden = entries.length === 0;
}

async function load() {
  const all = await chrome.storage.local.get(null);
  entries = Object.entries(all)
    .filter(([k, e]) => k.startsWith(KEY_PREFIX) && e && typeof e.time === 'number')
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt);
  render();
}

searchEl.addEventListener('input', render);

clearBtn.addEventListener('click', async () => {
  const all = await chrome.storage.local.get(null);
  await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith(KEY_PREFIX)));
  searchEl.value = '';
  load();
});

load();
