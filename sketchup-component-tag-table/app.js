// Component Tag Table — model walk (talks to the JSA API) + DOM wiring.
//
// Read-only: every call below is a getter or a container's `.entities.get()`
// accessor. There is no `operation.*`/`op.*` call anywhere in this file, so
// tags, materials, attributes and the active scene are never touched — this
// extension only ever reads the model, per the PRD's "read-only in v1"
// scope decision.
//
// Pure aggregation/filtering/grouping logic lives in ./logic.js and is
// imported here rather than duplicated, so `verify/verify.mjs` tests
// exactly what ships.

import {
  BUILTIN_FIELDS,
  UNTAGGED_LABEL,
  attributesToPlainObject,
  mergeAttributeObjects,
  recordDiscoveredFields,
  filterComponents,
  groupComponentsByTag,
  isFieldNumeric,
  aggregateColumn,
  formatColumnCell,
} from './logic.js';

// ─── Model walk ─────────────────────────────────────────────────────────
//
// Counts every ComponentInstance found anywhere in the tree — including
// ones nested inside other components — as its own row contributor, keyed
// by its OWN tag (not an ancestor's). A Group is a transparent container:
// it is never itself counted, but its children are still walked. This
// answers the PRD's open question 3 (nested components counted
// individually, not rolled into their parent) the same direction Instance
// Color Rules already took for per-level fields, for the same reason: a
// sub-component can legitimately carry a different tag than its parent
// assembly, and collapsing that away would hide exactly the kind of
// tagging-gap case this tool exists to surface (user story 4).

const MAX_COMPONENTS = 200_000;
const MAX_TREE_DEPTH = 64; // guards a pathological/cyclic nesting chain, not a real modeling limit
const MAX_DEFINITION_VISITS = 5000; // same guard, for a shared definition entered many times

async function collectComponents(model) {
  const tagManager = await model.getTagManager();
  const tagById = new Map((tagManager.tags || []).map((t) => [t.id, t]));
  const materials = await model.getMaterials();

  const components = [];
  const discoveredFields = new Map();
  const definitionVisitCounts = new Map();
  let truncated = false;
  // Diagnostic only (surfaced in the UI when the walk turns up zero
  // components, since iPad has no accessible devtools) — a tally of every
  // entity type the walk actually saw, root and nested, regardless of
  // whether it was countable. Tells us whether entities.get() returned
  // nothing at all vs. returned things this walk doesn't recognize.
  const typeTally = new Map();

  function buildComponentRecord(instance, definition) {
    const definitionAttrs = attributesToPlainObject(definition?.attributes);
    const instanceAttrs = attributesToPlainObject(instance.attributes);
    const attributes = mergeAttributeObjects(definitionAttrs, instanceAttrs);
    recordDiscoveredFields(discoveredFields, attributes);
    return {
      tag: instance.tagId != null ? (tagById.get(instance.tagId)?.name ?? null) : null,
      name: instance.name || null,
      definitionName: definition?.name || null,
      material: instance.materialId != null ? (materials.findMaterialById(instance.materialId)?.name ?? null) : null,
      guid: instance.guid || null,
      description: instance.description || null,
      attributes,
    };
  }

  async function walk(container, depth) {
    if (truncated || depth > MAX_TREE_DEPTH) return;
    const children = await container.entities.get();
    for (const child of children) {
      if (truncated) return;
      const typeName = child?.constructor?.name || '';
      typeTally.set(typeName, (typeTally.get(typeName) || 0) + 1);

      if (typeName === 'Group') {
        await walk(child, depth + 1);
        continue;
      }

      if (typeName === 'ComponentInstance') {
        if (components.length >= MAX_COMPONENTS) { truncated = true; return; }

        const definition = await model.findEntity(child.definition);
        components.push(buildComponentRecord(child, definition));

        if (definition) {
          // A shared definition legitimately gets walked once per placement
          // — this guard only stops a genuinely pathological/cyclic
          // reference chain, not normal component reuse.
          const visits = definitionVisitCounts.get(definition.id) || 0;
          if (visits <= MAX_DEFINITION_VISITS) {
            definitionVisitCounts.set(definition.id, visits + 1);
            await walk(definition, depth + 1);
          }
        }
        continue;
      }

      // Faces, edges, curves, construction geometry, text, images: not
      // components, no contribution.
    }
  }

  await walk(model, 0);
  return {
    components,
    availableFields: [...discoveredFields.values()],
    truncated,
    typeTally: [...typeTally.entries()].map(([type, count]) => `${type || '(blank)'}: ${count}`).join(', ') || '(no entities seen at all)',
  };
}

// ─── State, persistence ─────────────────────────────────────────────────

const el = (id) => document.getElementById(id);
const STORAGE_KEY = 'component-tag-table:v1';

// Not crypto.randomUUID(): confirmed elsewhere in this workspace
// (sketchup-tag-color-viewer README, "crypto.randomUUID() threw in a
// sandboxed opaque-origin context") that it can throw in some embedding
// contexts with no visible error. A filter row id only needs to be unique
// within one session's in-memory list, so a counter is simpler and has no
// availability risk.
let idCounter = 0;
function makeId(prefix) {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

function defaultState() {
  // Seeded with one column (Definition Name) so the table shows more than
  // just Tag + Count on first open, without presuming which Advanced
  // Attributes (if any) a given model actually has.
  return { columns: ['definitionName'], filters: [] };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.columns) || !Array.isArray(parsed.filters)) return defaultState();
    return parsed;
  } catch (e) {
    console.warn('[Component Tag Table] could not read saved state, using defaults', e);
    return defaultState();
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ columns, filters }));
  } catch (e) {
    console.warn('[Component Tag Table] could not save state', e);
  }
}

let { columns, filters } = loadState();
// Grows over the session as collectComponents discovers Advanced
// Attributes actually present in the model. Seeded with the always-
// available built-ins so every picker has options even before the first
// successful read.
let knownFields = [...BUILTIN_FIELDS];
let allComponents = [];
let lastTruncated = false;

// Cells the user has clicked to expand a "Mixed (N)" summary into its full
// value list (user story 23). Keyed `${tagLabel}::${fieldId}`, session-only
// — not persisted, since it's a transient reading aid, not a preference.
const expandedCells = new Set();

// ─── Banners / status ───────────────────────────────────────────────────

function showError(message) {
  el('error-banner-text').textContent = message;
  el('error-banner').hidden = false;
}
function clearError() { el('error-banner').hidden = true; }

function showTruncated(message) {
  el('truncated-banner-text').textContent = message;
  el('truncated-banner').hidden = false;
}
function clearTruncated() { el('truncated-banner').hidden = true; }

function setStatus(text, kind) {
  const pill = el('status-pill');
  pill.textContent = text;
  pill.className = 'status-pill' + (kind ? ' ' + kind : '');
}

// ─── Field pickers ──────────────────────────────────────────────────────

// Rebuilds one <select>'s options from `fields`, grouped Built-in vs.
// Advanced Attributes — same grouping Instance Color Rules uses for its
// rule field picker.
function populateFieldSelect(select, fields, selectedValue) {
  select.innerHTML = '';
  if (select.dataset.placeholder) {
    select.appendChild(new Option(select.dataset.placeholder, ''));
  }

  const builtins = fields.filter((f) => !f.id.startsWith('attribute::'));
  if (builtins.length > 0) {
    const group = document.createElement('optgroup');
    group.label = 'Built-in';
    for (const f of builtins) group.appendChild(new Option(f.label, f.id));
    select.appendChild(group);
  }

  const attrFields = fields.filter((f) => f.id.startsWith('attribute::'));
  if (attrFields.length > 0) {
    const group = document.createElement('optgroup');
    group.label = 'Advanced Attributes';
    for (const f of attrFields) group.appendChild(new Option(f.label, f.id));
    select.appendChild(group);
  }

  if (selectedValue) select.value = selectedValue;
}

function fieldLabel(fieldId) {
  return knownFields.find((f) => f.id === fieldId)?.label ?? fieldId;
}

// Merges newly-discovered Advanced Attribute fields into knownFields and,
// only if anything new actually showed up, refreshes every open field
// picker in place. Called after every successful model read (including
// live-update ticks), so it has to be cheap and non-disruptive when
// nothing new was found (the common case, hence the early return).
function updateFieldOptions(discoveredFields) {
  let added = false;
  for (const f of discoveredFields) {
    if (!knownFields.some((k) => k.id === f.id)) {
      knownFields.push(f);
      added = true;
    }
  }
  if (!added) return;
  knownFields.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
  renderColumnsBar();
  renderFilters();
}

// ─── Columns bar ────────────────────────────────────────────────────────

function addColumn(fieldId) {
  if (!fieldId || columns.includes(fieldId)) return;
  columns.push(fieldId);
  saveState();
  renderColumnsBar();
  renderTable();
}

function removeColumn(fieldId) {
  columns = columns.filter((c) => c !== fieldId);
  saveState();
  renderColumnsBar();
  renderTable();
}

function moveColumn(fieldId, delta) {
  const index = columns.indexOf(fieldId);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= columns.length) return;
  [columns[index], columns[target]] = [columns[target], columns[index]];
  saveState();
  renderColumnsBar();
  renderTable();
}

function renderColumnsBar() {
  const list = el('columns-list');
  list.innerHTML = '';
  columns.forEach((fieldId, index) => {
    const chip = document.createElement('span');
    chip.className = 'chip';

    const up = document.createElement('button');
    up.className = 'chip-btn';
    up.textContent = '↑';
    up.title = 'Move left';
    up.disabled = index === 0;
    up.addEventListener('click', () => moveColumn(fieldId, -1));

    const down = document.createElement('button');
    down.className = 'chip-btn';
    down.textContent = '↓';
    down.title = 'Move right';
    down.disabled = index === columns.length - 1;
    down.addEventListener('click', () => moveColumn(fieldId, 1));

    const label = document.createElement('span');
    label.className = 'chip-label';
    label.textContent = fieldLabel(fieldId);

    const remove = document.createElement('button');
    remove.className = 'chip-btn chip-remove';
    remove.textContent = '✕';
    remove.title = 'Remove column';
    remove.addEventListener('click', () => removeColumn(fieldId));

    chip.append(up, down, label, remove);
    list.appendChild(chip);
  });

  const availableFields = knownFields.filter((f) => f.id !== 'tag' && !columns.includes(f.id));
  const select = el('add-column-select');
  select.dataset.placeholder = '+ Add column…';
  populateFieldSelect(select, availableFields, '');
}

el('add-column-select').addEventListener('change', (e) => {
  addColumn(e.target.value);
  e.target.value = '';
});

// ─── Filters ────────────────────────────────────────────────────────────

function addFilter() {
  filters.push({ id: makeId('filter'), field: 'tag', matchType: 'contains', text: '' });
  saveState();
  renderFilters();
  renderTable();
}

function removeFilter(id) {
  filters = filters.filter((f) => f.id !== id);
  saveState();
  renderFilters();
  renderTable();
}

function clearFilters() {
  filters = [];
  saveState();
  renderFilters();
  renderTable();
}

function renderFilters() {
  const list = el('filters-list');
  list.innerHTML = '';

  for (const filter of filters) {
    const row = document.createElement('div');
    row.className = 'filter-row';

    const fieldSelect = document.createElement('select');
    fieldSelect.className = 'filter-field';
    populateFieldSelect(fieldSelect, knownFields, filter.field);
    fieldSelect.addEventListener('change', () => {
      filter.field = fieldSelect.value;
      saveState();
      renderTable();
    });

    const matchType = document.createElement('select');
    matchType.className = 'filter-match-type';
    for (const [value, text] of [
      ['contains', 'Contains'], ['equals', 'Equals'],
      ['startsWith', 'Starts with'], ['endsWith', 'Ends with'],
    ]) {
      const opt = new Option(text, value, false, filter.matchType === value);
      matchType.appendChild(opt);
    }
    matchType.addEventListener('change', () => {
      filter.matchType = matchType.value;
      saveState();
      renderTable();
    });

    const text = document.createElement('input');
    text.type = 'text';
    text.className = 'filter-text';
    text.placeholder = 'value…';
    text.value = filter.text;
    text.addEventListener('input', () => {
      filter.text = text.value;
      saveState();
      renderTable();
      updateFiltersSummary();
    });

    const remove = document.createElement('button');
    remove.className = 'chip-btn chip-remove';
    remove.textContent = '✕';
    remove.title = 'Remove filter';
    remove.addEventListener('click', () => removeFilter(filter.id));

    row.append(fieldSelect, matchType, text, remove);
    list.appendChild(row);
  }

  el('clear-filters-btn').disabled = filters.length === 0;
  updateFiltersSummary();
}

// Active filters are always summarized here, even ones on a field that
// isn't currently shown as a column (user story 14).
function updateFiltersSummary() {
  const active = filters.filter((f) => f.text.trim() !== '');
  const summary = el('filters-summary');
  if (active.length === 0) {
    summary.textContent = filters.length === 0 ? 'No filters applied.' : 'No filters active yet — enter a value above.';
    return;
  }
  const parts = active.map((f) => `${fieldLabel(f.field)} ${matchTypeLabel(f.matchType)} "${f.text}"`);
  summary.textContent = `Showing components where ${parts.join(' AND ')}.`;
}

function matchTypeLabel(matchType) {
  switch (matchType) {
    case 'equals': return '=';
    case 'startsWith': return 'starts with';
    case 'endsWith': return 'ends with';
    case 'contains':
    default: return 'contains';
  }
}

el('add-filter-btn').addEventListener('click', addFilter);
el('clear-filters-btn').addEventListener('click', clearFilters);

// ─── Table rendering ────────────────────────────────────────────────────

function renderTable() {
  const filtered = filterComponents(allComponents, filters.filter((f) => f.text.trim() !== ''));
  const groups = groupComponentsByTag(filtered);

  const wrapper = el('table-wrapper');
  const table = el('tag-table');
  const emptyState = el('empty-state');

  if (allComponents.length > 0 && filtered.length === 0) {
    table.hidden = true;
    emptyState.hidden = false;
    el('footer-summary').textContent =
      `0 of ${allComponents.length} component${allComponents.length === 1 ? '' : 's'} match the current filters.`;
    return;
  }

  table.hidden = false;
  emptyState.hidden = true;

  // Numeric-vs-text is decided once per column across the whole filtered
  // set (not per tag group), so a column can't flip type row to row —
  // see logic.js isFieldNumeric.
  const numericByColumn = new Map(columns.map((fieldId) => [fieldId, isFieldNumeric(filtered, fieldId)]));

  const thead = el('tag-table-head');
  thead.innerHTML = '';
  const headRow = document.createElement('tr');
  headRow.appendChild(th('Tag'));
  headRow.appendChild(th('Count'));
  for (const fieldId of columns) headRow.appendChild(th(fieldLabel(fieldId)));
  thead.appendChild(headRow);

  const tbody = el('tag-table-body');
  tbody.innerHTML = '';
  for (const group of groups) {
    const row = document.createElement('tr');
    if (group.tagLabel === UNTAGGED_LABEL) row.classList.add('untagged-row');

    row.appendChild(td(group.tagLabel));
    row.appendChild(td(String(group.components.length), 'count-cell'));

    for (const fieldId of columns) {
      const summary = aggregateColumn(group.components, fieldId, numericByColumn.get(fieldId));
      const cellKey = `${group.tagLabel}::${fieldId}`;
      const expanded = expandedCells.has(cellKey);
      const cell = td(formatColumnCell(summary, expanded));
      if (summary.type === 'mixed') {
        cell.classList.add('mixed-cell');
        cell.title = summary.values.join(', ');
        cell.addEventListener('click', () => {
          if (expandedCells.has(cellKey)) expandedCells.delete(cellKey);
          else expandedCells.add(cellKey);
          renderTable();
        });
      }
      row.appendChild(cell);
    }
    tbody.appendChild(row);
  }

  const truncatedNote = lastTruncated ? ` (stopped at ${MAX_COMPONENTS.toLocaleString()} components — partial)` : '';
  el('footer-summary').textContent =
    `${filtered.length} of ${allComponents.length} component${allComponents.length === 1 ? '' : 's'} · ` +
    `${groups.length} tag group${groups.length === 1 ? '' : 's'}${truncatedNote}`;
}

function th(text) {
  const cell = document.createElement('th');
  cell.textContent = text;
  return cell;
}
function td(text, className) {
  const cell = document.createElement('td');
  cell.textContent = text;
  if (className) cell.className = className;
  return cell;
}

// ─── Load / refresh / live-update pipeline ──────────────────────────────
//
// Same shape as Instance Color Rules: a "read the model" half that's
// comparatively slow and only runs on Refresh/live-update ticks, and a
// "resolve + render" half (renderTable, above) that's pure/cheap and reruns
// on every column/filter edit without touching the JSA API again.

let model = null;
let loading = false;
let liveModelHandle = null;
let liveUpdateTimer = null;
const LIVE_UPDATE_DEBOUNCE_MS = 500;

async function readAndRenderModel() {
  if (!model || loading) return;
  loading = true;
  el('refresh-btn').disabled = true;
  el('refresh-btn').classList.add('spinning');
  clearError();
  clearTruncated();

  try {
    const result = await collectComponents(model);
    allComponents = result.components;
    lastTruncated = result.truncated;
    updateFieldOptions(result.availableFields);
    renderTable();

    console.log('[Component Tag Table] entity types seen while walking the model:', result.typeTally);

    if (result.truncated) {
      showTruncated(
        `Stopped at ${MAX_COMPONENTS.toLocaleString()} components — this model has more than the table's ` +
        `limit, so what you see is partial.`
      );
    } else if (allComponents.length === 0) {
      // The walk completed without error but found no ComponentInstance —
      // surfaced in-app (not just console.log) because iPad has no
      // accessible devtools to check the console from.
      showTruncated(`No components found. Entity types seen while walking the model: ${result.typeTally}.`);
    }
    setStatus('Connected', 'connected');
  } catch (e) {
    console.error('[Component Tag Table] failed to read the model', e);
    showError(`Component Tag Table could not read the model: ${e.message}`);
    setStatus('Error', 'error');
  } finally {
    loading = false;
    el('refresh-btn').disabled = false;
    el('refresh-btn').classList.remove('spinning');
  }
}

async function loadAndRender() {
  if (!model) return;
  try {
    const freshModel = await model.refresh();
    model = freshModel || model;
  } catch (e) {
    console.warn('[Component Tag Table] model.refresh() failed, retrying with the existing reference', e);
  }
  await readAndRenderModel();
}

async function handleLiveModelChange(streamModel) {
  try {
    model = await streamModel.getModel();
    await readAndRenderModel();
  } catch (e) {
    console.error('[Component Tag Table] live update failed', e);
    showError(`Live update failed: ${e.message}`);
  }
}

// SketchUpApi.observeActiveModel is a real push notification (confirmed
// from SDK source by Instance Color Rules, not polling): it fires whenever
// the active model's revision changes or the active model itself switches
// to a different open document. Debounced so a burst of edits coalesces
// into one re-walk. Wrapped in try/catch and left non-fatal on failure —
// if it's ever unavailable on some host, the table should keep working via
// manual Refresh rather than fail to load entirely.
function startLiveUpdates() {
  try {
    liveModelHandle = SketchUpApi.observeActiveModel((streamModel) => {
      if (liveUpdateTimer) clearTimeout(liveUpdateTimer);
      liveUpdateTimer = setTimeout(() => handleLiveModelChange(streamModel), LIVE_UPDATE_DEBOUNCE_MS);
    });
    el('live-indicator').hidden = false;
  } catch (e) {
    console.warn('[Component Tag Table] live updates unavailable, falling back to manual Refresh', e);
  }
}

function stopLiveUpdates() {
  if (liveUpdateTimer) clearTimeout(liveUpdateTimer);
  // ObserverHandle exposes .stop()/.endStream(), not .end() — confirmed
  // from SDK source by Instance Color Rules (see its README). Calling a
  // nonexistent .end() would throw inside beforeunload specifically, the
  // one place an error is easiest to miss.
  liveModelHandle?.stop?.();
}

el('refresh-btn').addEventListener('click', loadAndRender);
el('error-banner-close').addEventListener('click', clearError);
el('truncated-banner-close').addEventListener('click', clearTruncated);

renderColumnsBar();
renderFilters();

async function init() {
  try {
    await SketchUpApi.connect();
    model = await SketchUpApi.getActiveModel();
    el('refresh-btn').disabled = false;
    await loadAndRender();
    startLiveUpdates();
  } catch (e) {
    console.error('[Component Tag Table] connection failed', e);
    setStatus('Not connected', 'error');
    showError(`Not connected to SketchUp (${e.message}) — this panel only works when run inside SketchUp.`);
  }
}

window.addEventListener('beforeunload', () => {
  stopLiveUpdates();
  SketchUpApi.disconnect();
});

init();
