const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('browser telemetry replaces relay identifiers and denies storage before configuration', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'telemetry.js'), 'utf8');
  const appended = [];
  class Element {}
  const window = { dataLayer: [] };
  window.window = window;
  const context = {
    window,
    location: {
      origin: 'https://youbot.live',
      pathname: '/private-relay-slug/k/private-owner-key',
      search: '?session=private-session',
    },
    document: {
      currentScript: {
        src: 'https://youbot.live/telemetry.js',
        dataset: { youbotTelemetry: 'relay_ui' },
      },
      addEventListener() {},
      createElement() { return {}; },
      head: { appendChild(node) { appended.push(node); } },
    },
    fetch: async () => ({ ok: true, json: async () => ({ measurementId: 'G-TEST123' }) }),
    URL,
    Element,
    HTMLAnchorElement: class extends Element {},
    HTMLButtonElement: class extends Element {},
    HTMLSelectElement: class extends Element {},
    HTMLTextAreaElement: class extends Element {},
    HTMLInputElement: class extends Element {},
    HTMLFormElement: class extends Element {},
    console,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(source, context);
  await new Promise(resolve => setImmediate(resolve));

  const serialized = JSON.stringify(window.dataLayer);
  assert.match(serialized, /analytics_storage/);
  assert.match(serialized, /denied/);
  assert.match(serialized, /send_page_view/);
  assert.match(serialized, /:relay\/k\/:owner/);
  for (const secret of ['private-relay-slug', 'private-owner-key', 'private-session']) {
    assert.doesNotMatch(serialized, new RegExp(secret));
  }
  assert.equal(appended.length, 1);
  assert.equal(appended[0].src, 'https://www.googletagmanager.com/gtag/js?id=G-TEST123');
});
