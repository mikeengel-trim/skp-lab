// Loads the ACTUAL shipped index.html into jsdom and confirms every id
// app.js looks up via el('...')/document.getElementById('...') really
// exists in the static markup — cheap insurance against an id typo between
// HTML and JS. Table rows/chips/filter rows are built dynamically so their
// ids/classes aren't in the static markup and aren't checked here; this
// only covers the fixed shell around them. Does not execute app.js itself
// (it needs a live `SketchUpApi` global this harness doesn't provide).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
const appJs = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');

const dom = new JSDOM(html);
const { document } = dom.window;

const ids = new Set();
for (const m of appJs.matchAll(/el\('([^']+)'\)/g)) ids.add(m[1]);
for (const m of appJs.matchAll(/document\.getElementById\('([^']+)'\)/g)) ids.add(m[1]);

let pass = 0, fail = 0;
for (const id of ids) {
  if (document.getElementById(id)) pass++;
  else { fail++; console.error(`FAIL missing element id in markup: #${id}`); }
}
console.log(`${pass} element ids resolved, ${fail} missing (checked ${ids.size} referenced ids)`);

const assertions = [
  ['error-banner starts hidden', document.getElementById('error-banner').hasAttribute('hidden'), true],
  ['truncated-banner starts hidden', document.getElementById('truncated-banner').hasAttribute('hidden'), true],
  ['refresh-btn starts disabled', document.getElementById('refresh-btn').hasAttribute('disabled'), true],
  ['live-indicator starts hidden', document.getElementById('live-indicator').hasAttribute('hidden'), true],
  ['live-indicator names "Live"', document.getElementById('live-indicator').textContent.includes('Live'), true],
  ['columns-list container exists and starts empty', document.getElementById('columns-list').innerHTML.trim(), ''],
  ['filters-list container exists and starts empty', document.getElementById('filters-list').innerHTML.trim(), ''],
  ['clear-filters-btn starts disabled', document.getElementById('clear-filters-btn').hasAttribute('disabled'), true],
  ['table starts visible (not hidden) in static markup', document.getElementById('component-table').hasAttribute('hidden'), false],
  ['empty-state starts hidden', document.getElementById('empty-state').hasAttribute('hidden'), true],
  ['add-column-select exists with placeholder option', document.getElementById('add-column-select').options.length >= 1, true],
  ['group-by-definition-toggle exists and starts unchecked in static markup', document.getElementById('group-by-definition-toggle').checked, false],
  ['group-by-field-select exists (populated at runtime, starts empty in static markup)', document.getElementById('group-by-field-select').options.length, 0],
];
for (const [name, actual, expected] of assertions) {
  if (actual === expected) pass++;
  else { fail++; console.error(`FAIL ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}

// Structural strings renderColumnsBar/renderFilters/renderTable rely on
// (class names/dataset keys used for dynamically-built rows) — a typo here
// wouldn't show up any other way in a harness that can't execute the script.
const structuralStrings = ['chip-remove', 'filter-row', 'mixed-cell', 'blank-row', 'count-cell'];
for (const s of structuralStrings) {
  if (appJs.includes(s) || html.includes(s)) pass++;
  else { fail++; console.error(`FAIL expected string not found in app.js/index.html: ${s}`); }
}

// Regression guard: this extension is read-only by design (PRD "Out of
// Scope" — no editing tags/components from the table in v1). Fails if any
// operation-mutating call ever creeps in.
if (/\boperation\.[a-zA-Z]/.test(appJs) || /\bperformOperation\(/.test(appJs)) {
  fail++;
  console.error('FAIL regression: app.js appears to call an operation/mutation API — this extension must stay read-only');
} else {
  pass++;
}

// Regression guard for the same ObserverHandle method-name mistake caught
// once already in sketchup-tag-color-viewer (JSA_API_COMPLETE.md's prose
// claims `.end()`; the real handle exposes `.stop()`/`.endStream()`).
if (/liveModelHandle\s*\?\.\s*end\s*\?\.\s*\(/.test(appJs) || /liveModelHandle\.end\(/.test(appJs)) {
  fail++;
  console.error('FAIL regression: app.js calls liveModelHandle.end() — the real ObserverHandle exposes .stop()/.endStream(), not .end()');
} else {
  pass++;
}
if (appJs.includes('liveModelHandle?.stop?.()')) pass++;
else { fail++; console.error('FAIL expected liveModelHandle to be stopped via .stop() somewhere in app.js'); }

// ─── Execution test: click-to-select (US-204) ────────────────────────────
//
// Unlike everything above (which never executes app.js — sibling
// extensions in this repo can't, since WebGL/Three.js genuinely don't run
// in jsdom), the Selection API is trivially mockable, so it's worth
// actually running app.js here and simulating a real row click rather than
// only checking for the right strings. Sets up the handful of bare globals
// app.js touches (document/window/localStorage/SketchUpApi/Option) before
// dynamically importing the real shipped module, then waits for its
// (unawaited) init() to finish its mocked model walk and initial render.

// Named exactly `ComponentInstance` (not e.g. MockComponentInstance) since
// app.js's model walk dispatches on `child?.constructor?.name`, matching
// the real JSA SDK's class name.
class ComponentInstance {
  constructor({ id, tagId = null, materialId = null }) {
    this.id = id;
    this.tagId = tagId;
    this.materialId = materialId;
    this.name = null;
    this.guid = id;
    this.description = null;
    this.definition = null;
    this.attributes = { allDictionaries: [] };
  }
}

// materialId 1 -> Oak on both doors, 2 -> Glass on the window, so grouping
// by Material (US-210/US-211) has a real non-trivial bucket to check.
const doorA = new ComponentInstance({ id: 'door-a', tagId: 1, materialId: 1 });
const doorB = new ComponentInstance({ id: 'door-b', tagId: 1, materialId: 1 });
const windowA = new ComponentInstance({ id: 'window-a', tagId: 2, materialId: 2 });

const materialsById = new Map([[1, { name: 'Oak' }], [2, { name: 'Glass' }]]);

const selectionCalls = [];
let mockModel;
mockModel = {
  getTagManager: async () => ({ tags: [{ id: 1, name: 'Doors' }, { id: 2, name: 'Windows' }] }),
  getMaterials: async () => ({ findMaterialById: (id) => materialsById.get(id) ?? null }),
  findEntity: async () => null,
  refresh: async () => mockModel,
  entities: { get: async () => [doorA, doorB, windowA] },
  updateSelection: async (entities, mode) => { selectionCalls.push({ entities: [...entities], mode }); },
};

const execDom = new JSDOM(html, { url: 'http://localhost/' });
globalThis.document = execDom.window.document;
globalThis.window = execDom.window;
globalThis.Option = execDom.window.Option;
const localStorageData = {};
globalThis.localStorage = {
  getItem: (k) => (k in localStorageData ? localStorageData[k] : null),
  setItem: (k, v) => { localStorageData[k] = v; },
};
globalThis.SketchUpApi = {
  connect: async () => {},
  disconnect: () => {},
  getActiveModel: async () => mockModel,
  observeActiveModel: () => ({ stop: () => {} }),
};

async function waitFor(predicate, { timeout = 2000, interval = 5 } = {}) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error('waitFor: timed out');
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

try {
  await import(path.resolve(__dirname, '../app.js'));
  await waitFor(() => execDom.window.document.getElementById('component-table-body').children.length > 0);

  const rows = [...execDom.window.document.querySelectorAll('#component-table-body tr.component-row')];
  const doorsRow = rows.find((r) => r.firstChild.textContent === 'Doors');
  const windowsRow = rows.find((r) => r.firstChild.textContent === 'Windows');

  if (doorsRow && windowsRow) {
    pass++;

    doorsRow.dispatchEvent(new execDom.window.MouseEvent('click', { bubbles: true }));
    const firstCall = selectionCalls[selectionCalls.length - 1];
    if (firstCall && firstCall.mode === 'set' && firstCall.entities.length === 2 &&
        firstCall.entities.includes(doorA) && firstCall.entities.includes(doorB)) {
      pass++;
    } else {
      fail++;
      console.error('FAIL clicking the "Doors" row did not call model.updateSelection([doorA, doorB], \'set\')', firstCall);
    }

    windowsRow.dispatchEvent(new execDom.window.MouseEvent('click', { bubbles: true }));
    const secondCall = selectionCalls[selectionCalls.length - 1];
    if (secondCall && secondCall.mode === 'set' && secondCall.entities.length === 1 && secondCall.entities[0] === windowA) {
      pass++;
    } else {
      fail++;
      console.error('FAIL clicking the "Windows" row did not call model.updateSelection([windowA], \'set\')', secondCall);
    }
  } else {
    fail += 3;
    console.error('FAIL expected rendered "Doors" and "Windows" rows with class .component-row, found none');
  }

  // ─── Generic grouping execution tests (US-210/US-211) ───────────────────
  const doc = execDom.window.document;

  // Tag is a normal column choice now — not excluded from the column picker.
  const addColumnSelect = doc.getElementById('add-column-select');
  const hasTagOption = [...addColumnSelect.querySelectorAll('option')].some((o) => o.value === 'tag');
  if (hasTagOption) pass++;
  else { fail++; console.error('FAIL expected "tag" to be a selectable column option (US-210 removes its column-picker exclusion)'); }

  // The table header's first column and the footer's group-count text
  // follow the group-by field's label — initially "Tag" (the default).
  const firstHeaderCell = () => doc.querySelector('#component-table-head th');
  if (firstHeaderCell()?.textContent === 'Tag') pass++;
  else { fail++; console.error(`FAIL expected the first header cell to read "Tag" initially, got "${firstHeaderCell()?.textContent}"`); }

  // Switching the group-by field to Material re-groups the table and
  // relabels the header/footer accordingly — nothing here is Tag-specific
  // anymore.
  const groupByFieldSelect = doc.getElementById('group-by-field-select');
  groupByFieldSelect.value = 'material';
  groupByFieldSelect.dispatchEvent(new execDom.window.Event('change', { bubbles: true }));

  if (firstHeaderCell()?.textContent === 'Material') pass++;
  else { fail++; console.error(`FAIL expected the first header cell to read "Material" after switching group-by, got "${firstHeaderCell()?.textContent}"`); }

  const materialRows = [...doc.querySelectorAll('#component-table-body tr.component-row')];
  const oakRow = materialRows.find((r) => r.firstChild.textContent === 'Oak');
  const glassRow = materialRows.find((r) => r.firstChild.textContent === 'Glass');
  if (oakRow && glassRow) pass++;
  else { fail++; console.error('FAIL expected "Oak" and "Glass" rows after grouping by Material', materialRows.map((r) => r.firstChild.textContent)); }

  const footerText = doc.getElementById('footer-summary').textContent;
  if (footerText.includes('Material group')) pass++;
  else { fail++; console.error(`FAIL expected footer summary to name "Material group(s)", got "${footerText}"`); }

  // Clicking the Oak row still selects both doors, proving grouping and
  // row-to-model selection (US-204) compose correctly for a non-Tag field.
  selectionCalls.length = 0;
  oakRow.dispatchEvent(new execDom.window.MouseEvent('click', { bubbles: true }));
  const oakCall = selectionCalls[selectionCalls.length - 1];
  if (oakCall && oakCall.mode === 'set' && oakCall.entities.length === 2 &&
      oakCall.entities.includes(doorA) && oakCall.entities.includes(doorB)) {
    pass++;
  } else {
    fail++;
    console.error('FAIL clicking the "Oak" row (grouped by Material) did not select both doors', oakCall);
  }

  // Restore Tag grouping so this stays a faithful "default session" for any
  // future assertions appended after this block.
  groupByFieldSelect.value = 'tag';
  groupByFieldSelect.dispatchEvent(new execDom.window.Event('change', { bubbles: true }));
} catch (e) {
  fail += 3;
  console.error('FAIL click-to-select execution test threw', e);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
