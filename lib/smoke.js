'use strict';
// Runtime smoke test: loads the generated app in jsdom, clicks its buttons, and reports uncaught errors.

function stubBrowserApis(w) {
  const noop = () => {};
  const ctx = new Proxy({}, {
    get: (t, p) => {
      if (p === 'measureText') return () => ({ width: 0 });
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop: noop });
      if (p === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      return p in t ? t[p] : noop;
    },
    set: (t, p, v) => { t[p] = v; return true; },
  });
  w.HTMLCanvasElement.prototype.getContext = () => ctx;
  w.HTMLElement.prototype.scrollIntoView = noop;
  w.scrollTo = noop;
  w.alert = noop;
  w.confirm = () => true;
  w.prompt = () => 'test';
  if (!w.matchMedia) w.matchMedia = () => ({ matches: false, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop });
  if (!w.ResizeObserver) w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  if (!w.IntersectionObserver) w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
}

async function smokeTest(html) {
  let JSDOM, VirtualConsole;
  try { ({ JSDOM, VirtualConsole } = require('jsdom')); } catch { return { ok: true, skipped: true, errors: [] }; }

  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => errors.push(String((e && e.message) || e)));

  let dom;
  try {
    dom = new JSDOM(html, {
      runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://app.test/', virtualConsole,
      beforeParse(w) {
        stubBrowserApis(w);
        w.addEventListener('error', (ev) => errors.push(String(ev.message || ev.error)));
        w.addEventListener('unhandledrejection', (ev) => errors.push('unhandled rejection: ' + String(ev.reason)));
      },
    });
  } catch (e) {
    return { ok: false, skipped: false, errors: ['failed to load: ' + e.message] };
  }

  try {
    const run = async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      await wait(400);
      const doc = dom.window.document;
      for (const inp of Array.from(doc.querySelectorAll('input[type=text], input:not([type]), textarea')).slice(0, 8)) {
        inp.value = 'test item';
        inp.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        inp.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      }
      for (const btn of Array.from(doc.querySelectorAll('button, [role=button]')).slice(0, 15)) {
        try { btn.click(); } catch (e) { errors.push('click failed: ' + e.message); }
      }
      await wait(200);
    };
    await Promise.race([run(), new Promise((r) => setTimeout(r, 8000))]);
  } finally {
    try { dom.window.close(); } catch { }
  }

  const clean = Array.from(new Set(errors.filter((m) => m && !/Not implemented/i.test(m)))).slice(0, 8);
  return { ok: clean.length === 0, skipped: false, errors: clean };
}

module.exports = { smokeTest };