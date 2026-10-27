// Run with: node --test tests/popup-focus.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const popupSrc = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');

// Minimal DOM stand-in: just enough surface for popup.js to load and render.
function makeNode() {
  return {
    hidden: false,
    value: '',
    children: [],
    focused: false,
    focus() { this.focused = true; },
    addEventListener() {},
    replaceChildren(...kids) { this.children = kids; },
  };
}

async function openPopup(stored) {
  const nodes = {};
  const listeners = {};
  const rafQueue = [];
  const document = {
    getElementById(id) { return (nodes[id] ??= makeNode()); },
    createElement: () => ({ ...makeNode(), style: {}, append() {}, setAttribute() {} }),
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
  };
  const context = {
    document,
    chrome: {
      storage: { local: { get: async () => stored, remove: async () => {} } },
      tabs: { create() {} },
      runtime: { openOptionsPage() {} },
    },
    requestAnimationFrame: (fn) => rafQueue.push(fn),
  };
  vm.runInNewContext(popupSrc, context);

  // Before DOMContentLoaded nothing should have been focused.
  assert.equal(nodes.search.focused, false);
  for (const fn of listeners.DOMContentLoaded ?? []) fn();
  await new Promise((r) => setImmediate(r)); // let load() settle
  for (const fn of rafQueue.splice(0)) fn();
  return nodes;
}

test('focuses the search input when videos are saved', async () => {
  const nodes = await openPopup({
    'v:abc': { time: 10, duration: 100, title: 'A video', updatedAt: 1 },
  });
  assert.equal(nodes['search-wrap'].hidden, false);
  assert.equal(nodes.search.focused, true);
});

test('does not focus the search input when nothing is saved', async () => {
  const nodes = await openPopup({});
  assert.equal(nodes['search-wrap'].hidden, true);
  assert.equal(nodes.search.focused, false);
});

test('search input carries the autofocus attribute', () => {
  const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
  const input = html.match(/<input[^>]*id="search"[^>]*>/)[0];
  assert.match(input, /\bautofocus\b/);
});
