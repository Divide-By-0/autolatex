const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { compileScript } = require('./helpers/compile-script');

function runtime() {
  const context = { console: { log() {}, warn() {}, error() {} } };
  vm.createContext(context);
  for (const file of ['Common/Unicode.ts', 'Common/Code.ts', 'SidebarMathJaxShared.ts']) {
    vm.runInContext(compileScript(path.join(__dirname, '..', file)), context);
  }
  return context;
}

test('CodeCogs de-render preserves explicit cases row breaks for MathJax re-render', () => {
  const context = runtime();
  context.equation = String.raw`F_K(x)=\begin{cases}0 &: x\leq0 \\ (1-p)^3 &: 0<x\le1 \\ (1-p)^3+3p(1-p)^2 &: 1<x\le2 \\ (1-p)^3+3p(1-p)^2+3p^2(1-p) &: 2<x\le3 \\ 1 &: x>3\end{cases}`;
  for (const newlineCharacter of ['%0D', '%0B', '%0A']) {
    context.app = { newlineCharacter };
    const restored = vm.runInContext('deEncode(reEncode(equation, app), app)', context);
    assert.equal(restored, context.equation);
    context.restored = restored;
    const mathjax = vm.runInContext('prepareEquationForMathJax(getClientEquation(reEncode(restored, app), app))', context);
    assert.equal(mathjax, context.equation);
    assert.equal((mathjax.match(/\\\\/g) || []).length, 4);
  }
});

test('legacy encoded four-backslash newline markers still restore app line breaks', () => {
  const context = runtime();
  context.app = { newlineCharacter: '%0D' };
  assert.equal(vm.runInContext("deEncode('a%5C%5C%5C%5C%20b', app)", context), 'a\rb');
});
