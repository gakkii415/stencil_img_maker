// Run with: node --test tests/size-layout.test.cjs
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

// Exercise the shipped HTML's functions without copying the layout implementation.
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(script); // Also catch syntax errors outside the layout functions.
const context = vm.createContext({});
vm.runInContext(
  script.slice(script.indexOf('    const DPI'), script.indexOf('    // price-simulator/artist.html'))
    + script.slice(script.indexOf('    function imgPx('), script.indexOf('    function buildCanvas('))
    + '\nthis.layout = { buildPageList, buildPageListDown, buildPageListUp, resolveRows, MIN_CM };',
  context
);
const { buildPageList, buildPageListDown, buildPageListUp, resolveRows, MIN_CM } = context.layout;
const toMm = list => Array.from(list, cm => Math.round(cm * 1000) / 100);
function main(mm, stepMm, width = 1000, height = 960) {
  return buildPageList(mm / 10, stepMm / 10, width, height, Math.max(width, height));
}

test('photo example keeps a variable number of nearby sizes', () => {
  assert.deepEqual(toMm(main(25, 5)), [10, 15, 20, 25, 30, 35, 40]);
  assert.deepEqual(toMm(main(30, 5)), [15, 20, 25, 30, 35, 40]);
});

test('one millimetre change does not trigger extra downward filling', () => {
  assert.deepEqual(toMm(main(31, 5, 1000, 500)), [6, 11, 16, 21, 26, 31, 36, 41, 46, 51]);
  assert.deepEqual(toMm(main(32, 5, 1000, 500)), [7, 12, 17, 22, 27, 32, 37, 42, 47, 52]);
  assert.deepEqual(toMm(main(52, 10, 1000, 1000)), [32, 42, 52, 62]);
  assert.deepEqual(toMm(main(53, 10, 1000, 1000)), [33, 43, 53, 63]);
});

test('near the paper width limit, the range shifts to keep many candidates', () => {
  assert.deepEqual(toMm(main(175, 5, 1000, 100)), [140, 145, 150, 155, 160, 165, 170, 175, 180]);
  assert.deepEqual(toMm(main(176, 5, 1000, 100)), [136, 141, 146, 151, 156, 161, 166, 171, 176]);
});

test('small and large pages continue next to the main range without duplicates', () => {
  for (const mm of [25, 30, 31, 32, 52, 53, 175, 176]) {
    const width = 1000, height = 960, edge = 1000, step = 0.5;
    const list = main(mm, 5, width, height);
    const below = Math.round((list[0] - step) * 100) / 100;
    const above = Math.round((list.at(-1) + step) * 100) / 100;
    const small = below >= MIN_CM ? buildPageListDown(below, step, width, height, edge) : [];
    const large = buildPageListUp(above, step, width, height, edge);
    if (small.length) assert.equal(small.at(-1), below);
    if (large.length) assert.equal(large[0], above);
    const combined = toMm([...small, ...list, ...large]);
    assert.equal(new Set(combined).size, combined.length);
    for (const page of [small, list, large]) {
      assert.equal(resolveRows(page, width, height, edge).length, page.length);
    }
  }
});

test('valid sizes retain the anchor, fit on paper, and stay continuous at fixed steps', () => {
  for (const ratio of [0.01, 0.1, 0.25, 0.32, 0.5, 0.75, 0.96, 1, 2, 10]) {
    for (const stepMm of [1, 2, 5, 10, 25, 50]) {
      let previous = null;
      const width = 1000, height = width * ratio, edge = Math.max(width, height);
      for (let mm = 1; mm <= 250; mm++) {
        const anchor = mm / 10;
        if (!resolveRows([anchor], width, height, edge).length) continue;
        const list = main(mm, stepMm, width, height);
        const label = JSON.stringify({ ratio, stepMm, mm, list: toMm(list) });
        assert.ok(list.includes(anchor), `missing anchor: ${label}`);
        assert.ok(list.every(cm => Number.isFinite(cm) && cm >= MIN_CM), label);
        assert.equal(resolveRows(list, width, height, edge).length, list.length, label);
        for (let i = 1; i < list.length; i++) {
          assert.ok(Math.abs((list[i] - list[i - 1]) * 10 - stepMm) < 1e-6, label);
        }
        if (previous) {
          // A single 1 mm increment must not jump downward by multiple size steps.
          assert.ok((previous[0] - list[0]) * 10 <= stepMm + 1e-6, label);
        }
        previous = list;
      }
    }
  }
});
