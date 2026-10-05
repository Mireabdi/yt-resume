const KEY_PREFIX = 'v:';

const listEl = document.getElementById('list');
const emptyEl = document.getElementById('empty');
const clearBtn = document.getElementById('clear-all');

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

function renderRow([key, entry]) {
  const id = key.slice(KEY_PREFIX.length);
  const pct = entry.duration > 0 ? Math.min(100, (entry.time / entry.duration) * 100) : 0;

  const open = el('button', 'open');
  open.type = 'button';
  open.title = entry.title;
  open.append(
    el('span', 'title', entry.title),
    el('span', 'meta', `${formatTime(entry.time)} / ${formatTime(entry.duration)}`)
  );
  const bar = el('div', 'bar');
  const fill = el('div', 'fill');
  fill.style.width = `${pct}%`;
  bar.append(fill);
  open.append(bar);
  open.addEventListener('click', () => {
    chrome.tabs.create({ url: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}&t=${Math.floor(entry.time)}s` });
  });

  const del = el('button', 'delete', '×');
  del.type = 'button';
  del.title = 'Remove';
  del.setAttribute('aria-label', `Remove ${entry.title}`);
  del.addEventListener('click', async () => {
    await chrome.storage.local.remove(key);
    render();
  });

  const li = el('li');
  li.append(open, del);
  return li;
}

async function render() {
  const all = await chrome.storage.local.get(null);
  const entries = Object.entries(all)
    .filter(([k, e]) => k.startsWith(KEY_PREFIX) && e && typeof e.time === 'number')
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt);

  listEl.replaceChildren(...entries.map(renderRow));
  emptyEl.hidden = entries.length > 0;
  clearBtn.hidden = entries.length === 0;
}

clearBtn.addEventListener('click', async () => {
  const all = await chrome.storage.local.get(null);
  await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith(KEY_PREFIX)));
  render();
});

render();
