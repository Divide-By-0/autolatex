const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const filename = process.env.ALE_SLIDES_SIDEBAR_TS || path.join(__dirname, '../Slides/Sidebar.ts');
const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText;

for (const action of ['editText', 'undoAll']) {
  test(`Slides ${action} displays the actual RPC failure and re-enables its button`, () => {
    const elements = new Map();
    let displayedError;
    let failure;
    let button;
    let stopped = false;
    const escapeHtml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const $ = selector => {
      if (!elements.has(selector)) {
        let content = '';
        const element = {
          ready() {}, click() {}, keydown() {}, remove() {},
          text(value) { content = escapeHtml(value); return this; },
          html(value) { if (value === undefined) return content; content = value; return this; },
          after(value) { displayedError = value; },
        };
        elements.set(selector, element);
      }
      // showError passes its error div HTML to jQuery.
      return typeof selector === 'string' && selector.startsWith('<div id="error"') ? selector : elements.get(selector);
    };
    const run = {
      withSuccessHandler() { return this; },
      withFailureHandler(callback) { failure = callback; return this; },
      withUserObject(value) { button = value; return this; },
      editEquations() { failure({ message: 'Service unavailable <retry>' }, button); },
      removeAll() { failure({ message: 'Service unavailable <retry>' }, button); },
    };
    const runtime = vm.createContext({
      $, window: {}, google: { script: { run } }, console: { error() {} },
      document: { createElement: () => ({ getContext: () => null }) },
      setInterval: () => 1, clearInterval: () => { stopped = true; },
    });
    vm.runInContext(source, runtime, { filename });
    runtime.getCurrentSettings = () => ({ sizeRaw: '14', delimiter: '$$', renderer: 'auto' });
    const clicked = { disabled: false };
    runtime[action].call(clicked);
    assert.match(displayedError, /Service unavailable &lt;retry&gt;/);
    assert.doesNotMatch(displayedError, /Please select/);
    assert.equal($('#loading').html(), 'Status: Error, de-render failed.');
    assert.equal(clicked.disabled, false);
    assert.equal(stopped, true);
  });
}
