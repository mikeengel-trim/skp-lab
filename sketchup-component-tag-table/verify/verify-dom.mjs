// Loads the ACTUAL shipped index.html into jsdom and confirms every id
// app.js looks up via el('...')/document.getElementById('...') really
// exists in the static markup — cheap insurance against an id typo between
// HTML and JS. This part only covers the fixed shell (table rows/chips/
// filter rows are built dynamically, so their ids/classes aren't in the
// static markup and aren't checked here) and never executes app.js.
//
// The second half of this file (from "Execution test: click-to-select"
// onward, US-204/US-205/US-210/US-211) does execute the real shipped app.js
// — mocking the handful of JSA calls it makes (SketchUpApi, model.*) and
// driving it with real simulated DOM events (clicks, select/input changes)
// — covering the column picker, filter rows, Mixed (N) expand/collapse, the
// empty "no components match" state, and generic (non-Tag) grouping, none
// of which the static-markup checks above can see since they're all built
// at runtime.
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
// 4 distinct guids in one tag group so a `guid` column lands in aggregateColumn's
// 'mixed' bucket (MIXED_VALUE_THRESHOLD = 3) — used by the Mixed (N)
// expand/collapse test below (US-205).
const fixtureA = new ComponentInstance({ id: 'fixture-a', tagId: 3 });
const fixtureB = new ComponentInstance({ id: 'fixture-b', tagId: 3 });
const fixtureC = new ComponentInstance({ id: 'fixture-c', tagId: 3 });
const fixtureD = new ComponentInstance({ id: 'fixture-d', tagId: 3 });

const materialsById = new Map([[1, { name: 'Oak' }], [2, { name: 'Glass' }]]);

const selectionCalls = [];
let mockModel;
mockModel = {
  getTagManager: async () => ({ tags: [{ id: 1, name: 'Doors' }, { id: 2, name: 'Windows' }, { id: 3, name: 'Fixtures' }] }),
  getMaterials: async () => ({ findMaterialById: (id) => materialsById.get(id) ?? null }),
  findEntity: async () => null,
  refresh: async () => mockModel,
  entities: { get: async () => [doorA, doorB, windowA, fixtureA, fixtureB, fixtureC, fixtureD] },
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

// Seeded ahead of the app.js import (US-207/US-208): a saved configuration
// referencing an Advanced Attribute field this mocked session never
// discovers, to prove loading it degrades gracefully (drops the missing
// field) instead of crashing — has to be seeded before import since
// app.js's savedConfigs array is only ever read from localStorage once, at
// module load.
localStorageData['component-table:saved-configs:v1'] = JSON.stringify([{
  id: 'config-ghost',
  name: 'Ghost Field View',
  columns: ['definitionName', 'attribute::IFC::Status'],
  filters: [],
  groupByField: 'attribute::IFC::Status',
  groupByDefinition: false,
  savedAt: '2024-01-01T00:00:00.000Z',
}]);
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

  // ─── Execution tests: broader DOM/integration coverage (US-205) ─────────
  //
  // Continues driving the SAME loaded app instance (app.js only runs its
  // module-level setup once per process) via real simulated UI events,
  // rather than re-importing — this is exactly how a single browser session
  // would exercise these interactions in sequence.
  const doc = execDom.window.document;

  // Column add / reorder / remove.
  try {
    const addColumnSelect = doc.getElementById('add-column-select');
    addColumnSelect.value = 'material';
    addColumnSelect.dispatchEvent(new execDom.window.Event('change', { bubbles: true }));

    const chipLabels = () => [...doc.querySelectorAll('#columns-list .chip')].map((c) => c.querySelector('.chip-label').textContent);
    if (JSON.stringify(chipLabels()) === JSON.stringify(['Definition Name', 'Material'])) pass++;
    else { fail++; console.error('FAIL adding "material" column did not append a "Material" chip', chipLabels()); }

    // Move the second chip (Material) left, swapping the two columns.
    const materialChip = [...doc.querySelectorAll('#columns-list .chip')].find((c) => c.querySelector('.chip-label').textContent === 'Material');
    materialChip.querySelector('.chip-btn').dispatchEvent(new execDom.window.MouseEvent('click', { bubbles: true })); // first .chip-btn is the "move left" (↑) button
    if (JSON.stringify(chipLabels()) === JSON.stringify(['Material', 'Definition Name'])) pass++;
    else { fail++; console.error('FAIL moving the "Material" chip left did not reorder the columns', chipLabels()); }

    // Remove the (now-first) Material chip.
    const chipToRemove = [...doc.querySelectorAll('#columns-list .chip')].find((c) => c.querySelector('.chip-label').textContent === 'Material');
    chipToRemove.querySelector('.chip-remove').dispatchEvent(new execDom.window.MouseEvent('click', { bubbles: true }));
    if (JSON.stringify(chipLabels()) === JSON.stringify(['Definition Name'])) pass++;
    else { fail++; console.error('FAIL removing the "Material" chip did not leave just "Definition Name"', chipLabels()); }
  } catch (e) {
    fail += 3;
    console.error('FAIL column add/reorder/remove execution test threw', e);
  }

  // Filter row add / remove.
  try {
    doc.getElementById('add-filter-btn').dispatchEvent(new execDom.window.MouseEvent('click', { bubbles: true }));
    const rows = doc.querySelectorAll('#filters-list .filter-row');
    if (rows.length === 1) pass++;
    else { fail++; console.error(`FAIL expected 1 filter row after "+ Add filter", found ${rows.length}`); }

    const row = rows[0];
    const fieldValue = row.querySelector('.filter-field')?.value;
    const matchTypeValue = row.querySelector('.filter-match-type')?.value;
    if (fieldValue === 'tag' && matchTypeValue === 'contains') pass++;
    else { fail++; console.error(`FAIL new filter row defaults: expected field 'tag'/matchType 'contains', got '${fieldValue}'/'${matchTypeValue}'`); }

    row.querySelector('.chip-remove').dispatchEvent(new execDom.window.MouseEvent('click', { bubbles: true }));
    const rowsAfterRemove = doc.querySelectorAll('#filters-list .filter-row');
    const clearBtnDisabled = doc.getElementById('clear-filters-btn').disabled;
    if (rowsAfterRemove.length === 0 && clearBtnDisabled) pass++;
    else { fail++; console.error(`FAIL removing the filter row: ${rowsAfterRemove.length} rows left, clear-filters-btn.disabled=${clearBtnDisabled}`); }
  } catch (e) {
    fail += 3;
    console.error('FAIL filter add/remove execution test threw', e);
  }

  // Mixed (N) cell expand/collapse: add the `guid` column, which is
  // distinct across all 4 Fixtures components, landing in aggregateColumn's
  // 'mixed' bucket for that tag group.
  try {
    const addColumnSelect = doc.getElementById('add-column-select');
    addColumnSelect.value = 'guid';
    addColumnSelect.dispatchEvent(new execDom.window.Event('change', { bubbles: true }));

    const fixturesRow = [...doc.querySelectorAll('#component-table-body tr.component-row')].find((r) => r.firstChild.textContent === 'Fixtures');
    const mixedCell = fixturesRow?.querySelector('.mixed-cell');
    if (mixedCell && mixedCell.textContent === 'Mixed (4)') pass++;
    else { fail++; console.error(`FAIL expected the Fixtures row's guid cell to read "Mixed (4)", got "${mixedCell?.textContent}"`); }

    mixedCell.dispatchEvent(new execDom.window.MouseEvent('click', { bubbles: true }));
    const expandedCell = [...doc.querySelectorAll('#component-table-body tr.component-row')]
      .find((r) => r.firstChild.textContent === 'Fixtures')?.querySelector('.mixed-cell');
    if (expandedCell && expandedCell.textContent === 'fixture-a, fixture-b, fixture-c, fixture-d') pass++;
    else { fail++; console.error(`FAIL expanding the Mixed (4) cell: got "${expandedCell?.textContent}"`); }

    // Clicking it again re-collapses it back to the summary form.
    expandedCell.dispatchEvent(new execDom.window.MouseEvent('click', { bubbles: true }));
    const collapsedCell = [...doc.querySelectorAll('#component-table-body tr.component-row')]
      .find((r) => r.firstChild.textContent === 'Fixtures')?.querySelector('.mixed-cell');
    if (collapsedCell && collapsedCell.textContent === 'Mixed (4)') pass++;
    else { fail++; console.error(`FAIL re-collapsing the Mixed (4) cell: got "${collapsedCell?.textContent}"`); }

    // A row click still fires from a normal cell in the same row — confirms
    // stopPropagation() on the mixed-cell only suppresses the OWN clicks,
    // not clicks elsewhere in the row (US-204 regression guard).
    selectionCalls.length = 0;
    fixturesRow.dispatchEvent(new execDom.window.MouseEvent('click', { bubbles: true }));
    const fixturesCall = selectionCalls[selectionCalls.length - 1];
    if (fixturesCall && fixturesCall.entities.length === 4) pass++;
    else { fail++; console.error('FAIL clicking the Fixtures row (outside the mixed cell) did not select all 4 fixtures', fixturesCall); }
  } catch (e) {
    fail += 4;
    console.error('FAIL Mixed (N) expand/collapse execution test threw', e);
  }

  // Empty "no components match" state, then restore to a clean filter set.
  try {
    doc.getElementById('add-filter-btn').dispatchEvent(new execDom.window.MouseEvent('click', { bubbles: true }));
    const row = doc.querySelector('#filters-list .filter-row');
    const textInput = row.querySelector('.filter-text');
    textInput.value = 'no-such-tag-value';
    textInput.dispatchEvent(new execDom.window.Event('input', { bubbles: true }));

    const table = doc.getElementById('component-table');
    const emptyState = doc.getElementById('empty-state');
    if (table.hidden === true && emptyState.hidden === false) pass++;
    else { fail++; console.error(`FAIL empty state: table.hidden=${table.hidden}, empty-state.hidden=${emptyState.hidden}`); }

    const footerText = doc.getElementById('footer-summary').textContent;
    if (footerText.includes('0 of 7 components match')) pass++;
    else { fail++; console.error(`FAIL empty-state footer summary: got "${footerText}"`); }

    doc.getElementById('clear-filters-btn').dispatchEvent(new execDom.window.MouseEvent('click', { bubbles: true }));
    if (table.hidden === false && emptyState.hidden === true) pass++;
    else { fail++; console.error(`FAIL table did not return after "Clear all": table.hidden=${table.hidden}, empty-state.hidden=${emptyState.hidden}`); }
  } catch (e) {
    fail += 3;
    console.error('FAIL empty-state execution test threw', e);
  }

  // ─── Generic grouping execution tests (US-210/US-211) ───────────────────

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

  // ─── Saved table configurations execution tests (US-207/US-208) ─────────

  const savedConfigsSelect = doc.getElementById('saved-configs-select');
  const optionLabels = () => [...savedConfigsSelect.options].map((o) => o.textContent);

  // Seeded "Ghost Field View" (a since-removed Advanced Attribute field)
  // populates the dropdown without crashing anything at load.
  try {
    if (optionLabels().includes('Ghost Field View')) pass++;
    else { fail++; console.error('FAIL expected the seeded "Ghost Field View" saved config in the dropdown', optionLabels()); }
  } catch (e) {
    fail++;
    console.error('FAIL checking the seeded saved config threw', e);
  }

  // Save current state ("Save table as…" inline flow).
  try {
    doc.getElementById('save-config-btn').dispatchEvent(new execDom.window.MouseEvent('click', { bubbles: true }));
    const inlineInput = doc.querySelector('.saved-config-name-input');
    inlineInput.value = 'Fixtures Audit';
    inlineInput.dispatchEvent(new execDom.window.Event('input', { bubbles: true }));
    const saveSubmitBtn = [...doc.querySelectorAll('#saved-config-inline button')].find((b) => b.textContent === 'Save');
    saveSubmitBtn.dispatchEvent(new execDom.window.MouseEvent('click', { bubbles: true }));

    if (optionLabels().includes('Fixtures Audit')) pass++;
    else { fail++; console.error('FAIL saving "Fixtures Audit" did not add it to the dropdown', optionLabels()); }

    if (doc.getElementById('saved-config-inline').hidden === true) pass++;
    else { fail++; console.error('FAIL the inline save UI did not close after a successful save'); }

    if (savedConfigsSelect.value !== '' && savedConfigsSelect.selectedOptions[0]?.textContent === 'Fixtures Audit') pass++;
    else { fail++; console.error('FAIL the dropdown did not select the just-saved "Fixtures Audit" entry'); }

    if (doc.getElementById('rename-config-btn').disabled === false && doc.getElementById('delete-config-btn').disabled === false) pass++;
    else { fail++; console.error('FAIL Rename/Delete should be enabled once a saved config is selected'); }
  } catch (e) {
    fail += 4;
    console.error('FAIL "Save table as…" execution test threw', e);
  }

  // Loading a saved config replaces the current columns/filters (US-208).
  try {
    const addColumnSelect = doc.getElementById('add-column-select');
    addColumnSelect.value = 'material';
    addColumnSelect.dispatchEvent(new execDom.window.Event('change', { bubbles: true }));
    const chipLabelsNow = () => [...doc.querySelectorAll('#columns-list .chip')].map((c) => c.querySelector('.chip-label').textContent);
    const beforeReload = chipLabelsNow();

    // Re-select "Fixtures Audit" (already selected, but simulate picking it
    // again the way a user would after making unsaved edits) to confirm it
    // discards the just-added "Material" column — US-208's decided
    // "silently discard unsaved changes" behavior.
    savedConfigsSelect.value = '';
    savedConfigsSelect.dispatchEvent(new execDom.window.Event('change', { bubbles: true }));
    const fixturesAuditOption = [...savedConfigsSelect.options].find((o) => o.textContent === 'Fixtures Audit');
    savedConfigsSelect.value = fixturesAuditOption.value;
    savedConfigsSelect.dispatchEvent(new execDom.window.Event('change', { bubbles: true }));

    if (beforeReload.includes('Material') && !chipLabelsNow().includes('Material')) pass++;
    else { fail++; console.error('FAIL loading "Fixtures Audit" did not discard the unsaved "Material" column', beforeReload, chipLabelsNow()); }
  } catch (e) {
    fail++;
    console.error('FAIL loading a saved config execution test threw', e);
  }

  // Overwrite confirmation: saving under the same name prompts before
  // replacing rather than silently duplicating.
  try {
    doc.getElementById('save-config-btn').dispatchEvent(new execDom.window.MouseEvent('click', { bubbles: true }));
    const inlineInput = doc.querySelector('.saved-config-name-input');
    inlineInput.value = 'Fixtures Audit';
    const saveSubmitBtn = [...doc.querySelectorAll('#saved-config-inline button')].find((b) => b.textContent === 'Save');
    saveSubmitBtn.dispatchEvent(new execDom.window.MouseEvent('click', { bubbles: true }));

    const confirmText = doc.querySelector('.saved-config-confirm-text')?.textContent;
    if (confirmText?.includes('already exists')) pass++;
    else { fail++; console.error(`FAIL expected an overwrite confirmation, got "${confirmText}"`); }

    const overwriteBtn = [...doc.querySelectorAll('#saved-config-inline button')].find((b) => b.textContent === 'Overwrite');
    overwriteBtn.dispatchEvent(new execDom.window.MouseEvent('click', { bubbles: true }));

    const fixturesAuditCount = optionLabels().filter((l) => l === 'Fixtures Audit').length;
    if (fixturesAuditCount === 1) pass++;
    else { fail++; console.error(`FAIL overwrite should not duplicate the entry, found ${fixturesAuditCount} "Fixtures Audit" options`); }
  } catch (e) {
    fail += 2;
    console.error('FAIL overwrite-confirmation execution test threw', e);
  }

  // Rename.
  try {
    doc.getElementById('rename-config-btn').dispatchEvent(new execDom.window.MouseEvent('click', { bubbles: true }));
    const inlineInput = doc.querySelector('.saved-config-name-input');
    if (inlineInput.value === 'Fixtures Audit') pass++;
    else { fail++; console.error(`FAIL rename input should be pre-filled with the current name, got "${inlineInput.value}"`); }

    inlineInput.value = 'Fixtures Review';
    const renameSubmitBtn = [...doc.querySelectorAll('#saved-config-inline button')].find((b) => b.textContent === 'Rename');
    renameSubmitBtn.dispatchEvent(new execDom.window.MouseEvent('click', { bubbles: true }));

    if (optionLabels().includes('Fixtures Review') && !optionLabels().includes('Fixtures Audit')) pass++;
    else { fail++; console.error('FAIL renaming did not update the dropdown option', optionLabels()); }
  } catch (e) {
    fail += 2;
    console.error('FAIL rename execution test threw', e);
  }

  // Delete.
  try {
    doc.getElementById('delete-config-btn').dispatchEvent(new execDom.window.MouseEvent('click', { bubbles: true }));
    const confirmText = doc.querySelector('.saved-config-confirm-text')?.textContent;
    if (confirmText?.includes('Fixtures Review')) pass++;
    else { fail++; console.error(`FAIL expected a delete confirmation naming "Fixtures Review", got "${confirmText}"`); }

    const deleteBtn = [...doc.querySelectorAll('#saved-config-inline button')].find((b) => b.textContent === 'Delete');
    deleteBtn.dispatchEvent(new execDom.window.MouseEvent('click', { bubbles: true }));

    if (!optionLabels().includes('Fixtures Review')) pass++;
    else { fail++; console.error('FAIL deleting "Fixtures Review" did not remove it from the dropdown', optionLabels()); }
  } catch (e) {
    fail += 2;
    console.error('FAIL delete execution test threw', e);
  }

  // Loading the seeded "Ghost Field View" (references a since-removed
  // field) degrades gracefully: drops the missing column/group-by field
  // rather than crashing the table (US-207).
  try {
    const ghostOption = [...savedConfigsSelect.options].find((o) => o.textContent === 'Ghost Field View');
    savedConfigsSelect.value = ghostOption.value;
    savedConfigsSelect.dispatchEvent(new execDom.window.Event('change', { bubbles: true }));

    const chipLabelsNow = [...doc.querySelectorAll('#columns-list .chip')].map((c) => c.querySelector('.chip-label').textContent);
    if (chipLabelsNow.includes('Definition Name') && !chipLabelsNow.some((l) => l.includes('IFC'))) pass++;
    else { fail++; console.error('FAIL loading "Ghost Field View" should keep the known Definition Name column and drop the missing IFC one', chipLabelsNow); }

    if (doc.getElementById('component-table').hidden === false) pass++;
    else { fail++; console.error('FAIL the table should still render (not crash) after loading a config with a missing field'); }

    // groupByField also degraded back to 'tag' rather than staying on the
    // missing attribute field — the header reflects that.
    if (firstHeaderCell()?.textContent === 'Tag') pass++;
    else { fail++; console.error(`FAIL expected group-by to fall back to "Tag" after the missing field, got "${firstHeaderCell()?.textContent}"`); }
  } catch (e) {
    fail += 3;
    console.error('FAIL loading a saved config with a missing field threw instead of degrading gracefully', e);
  }

  // Empty state: after removing every saved config, the dropdown reflects
  // that clearly rather than showing a blank/broken list (US-208).
  try {
    for (const opt of [...savedConfigsSelect.options]) {
      if (!opt.value) continue;
      savedConfigsSelect.value = opt.value;
      savedConfigsSelect.dispatchEvent(new execDom.window.Event('change', { bubbles: true }));
      doc.getElementById('delete-config-btn').dispatchEvent(new execDom.window.MouseEvent('click', { bubbles: true }));
      const deleteBtn = [...doc.querySelectorAll('#saved-config-inline button')].find((b) => b.textContent === 'Delete');
      deleteBtn?.dispatchEvent(new execDom.window.MouseEvent('click', { bubbles: true }));
    }

    if (savedConfigsSelect.disabled === true && optionLabels().includes('No saved tables yet')) pass++;
    else { fail++; console.error('FAIL expected the dropdown to show its empty state once every saved config is deleted', savedConfigsSelect.disabled, optionLabels()); }
  } catch (e) {
    fail++;
    console.error('FAIL empty-state (saved configs) execution test threw', e);
  }
} catch (e) {
  fail += 3;
  console.error('FAIL click-to-select execution test threw', e);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
