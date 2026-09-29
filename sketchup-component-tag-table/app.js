// Component Table — model walk (talks to the JSA API) + DOM wiring.
//
// No model *mutation* anywhere in this file — there is no `operation.*`/
// `op.*` call, so tags, materials, attributes and the active scene are
// never edited. `model.updateSelection` (US-204's click-to-select) IS a
// live JSA call, but it's a Selection API call, not an operation/mutation
// one: it changes what's highlighted in the model, not the model's content,
// so it doesn't break the "no editing" guarantee the PRD's "read-only in
// v1" scope decision was actually about.
//
// Pure aggregation/filtering/grouping logic lives in ./logic.js and is
// imported here rather than duplicated, so `verify/verify.mjs` tests
// exactly what ships.

import {
  BUILTIN_FIELDS,
  attributesToPlainObject,
  mergeAttributeObjects,
  recordDiscoveredFields,
  filterComponents,
  groupComponentsByField,
  blankBucketLabel,
  getSelectionEntities,
  isFieldNumeric,
  aggregateColumn,
  formatColumnCell,
  sortSavedConfigs,
  pruneMissingFields,
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

// US-206 field audit: confirmed against the live JSA API reference plus
// sketchup-tag-color-viewer's own source-verified corrections (that
// reference doc's prose already claims two properties that don't match the
// real SDK — `ObserverHandle.end()` and `ComponentInstance.transformation`
// — both wrong; the real properties are `.stop()`/`.endStream()` and
// `.transform`). Transform (as X/Y/Z translation) and Size (as Width/
// Height/Depth) are both real, already-computed built-ins — `.transform`
// and `.bounds` — so reading them here costs nothing extra beyond what
// this walk already does per instance; no live-update performance concern.
// Area is NOT a real per-component/per-definition property (only
// `Face.area` exists) — computing it would mean walking every instance's
// own faces on every read, a real and currently unvalidated live-update
// cost with no real SketchUp session available to test it against a large
// model. Deferred rather than guessed; see README.md and todo.md.
// `locked`/`hidden` (both booleans) are also real built-ins this audit
// found but isn't adding here, since a boolean field doesn't fit this
// extension's numeric-sum/text-list column model without its own design
// question this story didn't ask to resolve.

// Extracts a Transformation's translation (X/Y/Z) as plain numbers, or null
// if the shape can't be confidently read — deliberately NOT falling back
// to identity/zero the way sketchup-tag-color-viewer's own matrixOf() does,
// because that file only ever used the fallback for a best-effort 3D
// position (a wrong-but-plausible position just looks slightly off), while
// here a wrong 0 would silently corrupt a SUMMED numeric column instead of
// just being visibly missing — a materially worse failure mode for a table
// whose whole point is trustworthy aggregation. `_m` is a plain (not
// truly private) property on Transformation, confirmed by
// sketchup-tag-color-viewer directly from the SDK source; translation
// occupies indices 12–14 of the row-major 16-number matrix either way.
function transformTranslation(transform) {
  const matrix = Array.isArray(transform) && transform.length === 16 ? transform
    : Array.isArray(transform?._m) && transform._m.length === 16 ? transform._m
    : null;
  if (!matrix) return { x: null, y: null, z: null };
  return { x: matrix[12], y: matrix[13], z: matrix[14] };
}

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
    const translation = transformTranslation(instance.transform);
    const bounds = instance.bounds;
    return {
      tag: instance.tagId != null ? (tagById.get(instance.tagId)?.name ?? null) : null,
      name: instance.name || null,
      definitionName: definition?.name || null,
      material: instance.materialId != null ? (materials.findMaterialById(instance.materialId)?.name ?? null) : null,
      guid: instance.guid || null,
      description: instance.description || null,
      transformX: translation.x,
      transformY: translation.y,
      transformZ: translation.z,
      sizeWidth: bounds?.width ?? null,
      sizeHeight: bounds?.height ?? null,
      sizeDepth: bounds?.depth ?? null,
      attributes,
      // Kept for US-204's click-to-select: a persistent Entity (not an
      // ephemeral operation Ref), so it's still valid to pass to
      // model.updateSelection long after this walk finishes. Never
      // serialized/persisted — components live only in the in-memory
      // allComponents array for the current session.
      instanceRef: instance,
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
const STORAGE_KEY = 'component-table:v1';

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
  // just the group-by field + Count on first open, without presuming which
  // Advanced Attributes (if any) a given model actually has. `groupByField`
  // defaults to 'tag' — same v1 behavior as before US-210/US-211, just no
  // longer the only option. `selectedConfigId` is just which saved table
  // (if any) is currently highlighted in the US-208 dropdown — a cosmetic
  // pointer, not the source of truth for what's loaded (see the "Relates
  // to existing auto-save" decision below).
  return { columns: ['definitionName'], filters: [], groupByDefinition: false, groupByField: 'tag', selectedConfigId: null };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.columns) || !Array.isArray(parsed.filters)) return defaultState();
    return {
      columns: parsed.columns,
      filters: parsed.filters,
      groupByDefinition: !!parsed.groupByDefinition,
      groupByField: typeof parsed.groupByField === 'string' && parsed.groupByField ? parsed.groupByField : 'tag',
      selectedConfigId: typeof parsed.selectedConfigId === 'string' ? parsed.selectedConfigId : null,
    };
  } catch (e) {
    console.warn('[Component Table] could not read saved state, using defaults', e);
    return defaultState();
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ columns, filters, groupByDefinition, groupByField, selectedConfigId }));
  } catch (e) {
    console.warn('[Component Table] could not save state', e);
  }
}

// ─── Named saved table configurations (US-207/US-208) ───────────────────
//
// Deliberately a SEPARATE localStorage key/structure from STORAGE_KEY above,
// per US-207's own "Relationship to existing auto-save" question: the
// existing auto-save (columns/filters/grouping under STORAGE_KEY) is the
// raw, unnamed "current" working state, and it keeps being what's restored
// whenever the extension reopens — unchanged from before this story.
// Named configurations are a separate, explicit, opt-in list you save to
// and load from at any time via the US-208 dropdown; `selectedConfigId`
// above only tracks which one is currently highlighted there, purely for
// UI continuity (e.g. so Rename/Delete know what they're acting on) — it's
// never what decides what loads when the extension starts.
const SAVED_CONFIGS_KEY = 'component-table:saved-configs:v1';

function loadSavedConfigs() {
  try {
    const raw = localStorage.getItem(SAVED_CONFIGS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn('[Component Table] could not read saved table configurations', e);
    return [];
  }
}

function saveSavedConfigs() {
  try {
    localStorage.setItem(SAVED_CONFIGS_KEY, JSON.stringify(savedConfigs));
  } catch (e) {
    console.warn('[Component Table] could not save table configurations', e);
  }
}

let { columns, filters, groupByDefinition, groupByField, selectedConfigId } = loadState();
let savedConfigs = loadSavedConfigs();
// Grows over the session as collectComponents discovers Advanced
// Attributes actually present in the model. Seeded with the always-
// available built-ins so every picker has options even before the first
// successful read.
let knownFields = [...BUILTIN_FIELDS];
let allComponents = [];
let lastTruncated = false;

// Cells the user has clicked to expand a "Mixed (N)" summary into its full
// value list (user story 23). Keyed `${groupLabel}::${fieldId}`, session-only
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
  renderGroupByFieldSelect();
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

  // Tag is a normal column choice as of US-210 — no field is excluded here
  // just for being the group-by key.
  const availableFields = knownFields.filter((f) => !columns.includes(f.id));
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
  // No field is privileged as of US-210 — default to the first available
  // field, same as any other picker would.
  const defaultField = knownFields[0]?.id ?? '';
  filters.push({ id: makeId('filter'), field: defaultField, matchType: 'contains', text: '' });
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
      ['contains', 'Contains'], ['notContains', 'Does not contain'],
      ['equals', 'Equals'], ['notEquals', 'Does not equal'],
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
    case 'notEquals': return '≠';
    case 'startsWith': return 'starts with';
    case 'endsWith': return 'ends with';
    case 'notContains': return 'does not contain';
    case 'contains':
    default: return 'contains';
  }
}

el('add-filter-btn').addEventListener('click', addFilter);
el('clear-filters-btn').addEventListener('click', clearFilters);

// ─── Grouping mode (US-203/US-210/US-211) ────────────────────────────────

// Updates the second-level toggle's label to name the CURRENT primary
// group-by field (e.g. "Material → Definition Name") rather than a
// hardcoded "Tag →..." — the second level itself stays fixed to Definition
// Name (see logic.js's groupComponentsByField), only the label text follows
// the primary field selection.
function updateGroupByDefinitionLabel() {
  el('group-by-definition-label').textContent = `${fieldLabel(groupByField)} → Definition Name`;
}

function renderGroupByFieldSelect() {
  const select = el('group-by-field-select');
  populateFieldSelect(select, knownFields, groupByField);
}

el('group-by-field-select').addEventListener('change', (e) => {
  groupByField = e.target.value;
  saveState();
  updateGroupByDefinitionLabel();
  renderTable();
});

el('group-by-definition-toggle').checked = groupByDefinition;
el('group-by-definition-toggle').addEventListener('change', (e) => {
  groupByDefinition = e.target.checked;
  saveState();
  renderTable();
});

// ─── Saved table configurations (US-207/US-208) ─────────────────────────

// Shared inline UI for both the "Save table as…"/Rename name-input and the
// Overwrite/Delete confirmations — one small reused row instead of a
// separate widget per action, appended into the fixed #saved-config-inline
// container already in index.html.
function showInlineNameInput({ initialValue, submitLabel, onSubmit }) {
  const container = el('saved-config-inline');
  container.innerHTML = '';
  container.hidden = false;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'saved-config-name-input';
  input.placeholder = 'Table name…';
  input.value = initialValue || '';

  const errorText = document.createElement('span');
  errorText.className = 'saved-config-error';

  const submitBtn = document.createElement('button');
  submitBtn.className = 'btn-add';
  submitBtn.textContent = submitLabel;
  submitBtn.addEventListener('click', () => {
    const name = input.value.trim();
    errorText.textContent = '';
    if (!name) { errorText.textContent = 'Enter a name.'; return; }
    onSubmit(name, errorText);
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn-link';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', hideSavedConfigInline);

  container.append(input, submitBtn, cancelBtn, errorText);
  input.focus();
}

function showInlineConfirm({ message, confirmLabel, onConfirm }) {
  const container = el('saved-config-inline');
  container.innerHTML = '';
  container.hidden = false;

  const text = document.createElement('span');
  text.className = 'saved-config-confirm-text';
  text.textContent = message;

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'btn-add';
  confirmBtn.textContent = confirmLabel;
  confirmBtn.addEventListener('click', () => { onConfirm(); hideSavedConfigInline(); });

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn-link';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', hideSavedConfigInline);

  container.append(text, confirmBtn, cancelBtn);
}

function hideSavedConfigInline() {
  const container = el('saved-config-inline');
  container.hidden = true;
  container.innerHTML = '';
}

// Rebuilds the US-208 dropdown from `savedConfigs` (US-208's "Stays in
// Sync" criterion — called after every save/rename/delete) and the
// Rename/Delete buttons' enabled state. Empty-state: disabled with
// placeholder text rather than a blank/broken list (US-208).
function renderSavedConfigsSelect() {
  const select = el('saved-configs-select');
  select.innerHTML = '';
  if (savedConfigs.length === 0) {
    select.disabled = true;
    select.appendChild(new Option('No saved tables yet', ''));
  } else {
    select.disabled = false;
    select.appendChild(new Option('— Select a saved table —', ''));
    for (const config of sortSavedConfigs(savedConfigs)) {
      select.appendChild(new Option(config.name, config.id));
    }
  }
  const hasSelection = Boolean(selectedConfigId) && savedConfigs.some((c) => c.id === selectedConfigId);
  select.value = hasSelection ? selectedConfigId : '';
  el('rename-config-btn').disabled = !hasSelection;
  el('delete-config-btn').disabled = !hasSelection;
}

function currentConfigValues() {
  return {
    columns: [...columns],
    filters: filters.map((f) => ({ ...f })),
    groupByField,
    groupByDefinition,
  };
}

function createSavedConfig(name) {
  const config = { id: makeId('config'), name, ...currentConfigValues(), savedAt: new Date().toISOString() };
  savedConfigs.push(config);
  saveSavedConfigs();
  selectedConfigId = config.id;
  saveState();
  renderSavedConfigsSelect();
}

function overwriteSavedConfig(id, name) {
  const config = savedConfigs.find((c) => c.id === id);
  if (!config) return;
  Object.assign(config, { name, ...currentConfigValues(), savedAt: new Date().toISOString() });
  saveSavedConfigs();
  selectedConfigId = id;
  saveState();
  renderSavedConfigsSelect();
}

// Loading a saved configuration silently replaces the current working
// state (US-208's "Unsaved-Changes Handling" decision: silently discard,
// no confirmation prompt) — this extension has never had an "unsaved
// changes" concept anywhere else in its UI (columns/filters already
// auto-save on every edit), so introducing a dirty-tracking/confirm flow
// only for this one dropdown would be an inconsistent, disproportionate
// addition; "Save table as…" is always one click away first if a user
// wants to keep their current setup under a name before switching.
function loadSavedConfig(id) {
  const config = savedConfigs.find((c) => c.id === id);
  if (!config) return;
  const pruned = pruneMissingFields(config, knownFields.map((f) => f.id));
  columns = pruned.columns;
  filters = pruned.filters;
  groupByField = pruned.groupByField;
  groupByDefinition = !!pruned.groupByDefinition;
  saveState();
  renderColumnsBar();
  renderFilters();
  renderGroupByFieldSelect();
  updateGroupByDefinitionLabel();
  el('group-by-definition-toggle').checked = groupByDefinition;
  renderTable();
}

el('saved-configs-select').addEventListener('change', (e) => {
  const id = e.target.value;
  selectedConfigId = id || null;
  saveState();
  if (id) loadSavedConfig(id);
  renderSavedConfigsSelect();
});

el('save-config-btn').addEventListener('click', () => {
  showInlineNameInput({
    initialValue: '',
    submitLabel: 'Save',
    onSubmit: (name) => {
      const existing = savedConfigs.find((c) => c.name === name);
      if (existing) {
        showInlineConfirm({
          message: `A table named "${name}" already exists. Overwrite it?`,
          confirmLabel: 'Overwrite',
          onConfirm: () => overwriteSavedConfig(existing.id, name),
        });
        return;
      }
      createSavedConfig(name);
      hideSavedConfigInline();
    },
  });
});

el('rename-config-btn').addEventListener('click', () => {
  if (!selectedConfigId) return;
  const current = savedConfigs.find((c) => c.id === selectedConfigId);
  if (!current) return;
  showInlineNameInput({
    initialValue: current.name,
    submitLabel: 'Rename',
    onSubmit: (name, errorText) => {
      const collision = savedConfigs.find((c) => c.name === name && c.id !== current.id);
      if (collision) { errorText.textContent = `A table named "${name}" already exists.`; return; }
      current.name = name;
      saveSavedConfigs();
      renderSavedConfigsSelect();
      hideSavedConfigInline();
    },
  });
});

el('delete-config-btn').addEventListener('click', () => {
  if (!selectedConfigId) return;
  const current = savedConfigs.find((c) => c.id === selectedConfigId);
  if (!current) return;
  showInlineConfirm({
    message: `Delete "${current.name}"?`,
    confirmLabel: 'Delete',
    onConfirm: () => {
      savedConfigs = savedConfigs.filter((c) => c.id !== current.id);
      saveSavedConfigs();
      selectedConfigId = null;
      saveState();
      renderSavedConfigsSelect();
    },
  });
});

// ─── Table rendering ────────────────────────────────────────────────────

// Renders one aggregated-column cell into `row`, wiring up the Mixed (N)
// expand-on-click behavior keyed by `cellKey`. Shared between the flat
// (single-field) and two-level (<field> → Definition Name) render paths
// below so the expand behavior works identically at either grouping depth.
function appendAggregatedCells(row, groupComponents, numericByColumn, cellKeyPrefix) {
  for (const fieldId of columns) {
    const summary = aggregateColumn(groupComponents, fieldId, numericByColumn.get(fieldId));
    const cellKey = `${cellKeyPrefix}::${fieldId}`;
    const expanded = expandedCells.has(cellKey);
    const cell = td(formatColumnCell(summary, expanded));
    if (summary.type === 'mixed') {
      cell.classList.add('mixed-cell');
      cell.title = summary.values.join(', ');
      cell.addEventListener('click', (e) => {
        e.stopPropagation(); // expand/collapse only — don't also trigger the row's select-in-model click
        if (expandedCells.has(cellKey)) expandedCells.delete(cellKey);
        else expandedCells.add(cellKey);
        renderTable();
      });
    }
    row.appendChild(cell);
  }
}

function renderTable() {
  const filtered = filterComponents(allComponents, filters.filter((f) => f.text.trim() !== ''));
  const groups = groupComponentsByField(filtered, groupByField, { byDefinition: groupByDefinition });
  const blankLabel = blankBucketLabel(groupByField);

  const wrapper = el('table-wrapper');
  const table = el('component-table');
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
  // set (not per group, and not per definition sub-group either), so a
  // column can't flip type row to row — see logic.js isFieldNumeric.
  const numericByColumn = new Map(columns.map((fieldId) => [fieldId, isFieldNumeric(filtered, fieldId)]));

  const groupFieldHeaderLabel = fieldLabel(groupByField);
  const thead = el('component-table-head');
  thead.innerHTML = '';
  const headRow = document.createElement('tr');
  headRow.appendChild(th(groupFieldHeaderLabel));
  if (groupByDefinition) headRow.appendChild(th('Definition Name'));
  headRow.appendChild(th('Count'));
  for (const fieldId of columns) headRow.appendChild(th(fieldLabel(fieldId)));
  thead.appendChild(headRow);

  const tbody = el('component-table-body');
  tbody.innerHTML = '';
  let subgroupCount = 0;
  for (const group of groups) {
    if (!groupByDefinition) {
      const row = document.createElement('tr');
      if (group.groupLabel === blankLabel) row.classList.add('blank-row');
      row.classList.add('component-row');
      row.title = 'Click to select these components in the model';
      row.addEventListener('click', () => selectRowInModel(group.components));

      row.appendChild(td(group.groupLabel));
      row.appendChild(td(String(group.components.length), 'count-cell'));
      appendAggregatedCells(row, group.components, numericByColumn, group.groupLabel);
      tbody.appendChild(row);
      continue;
    }

    // <group field> → Definition Name: one row per definition sub-group,
    // with the primary group label shown once (on the first sub-row)
    // rather than repeated — the sub-rows are still visually grouped under
    // it via the shared .blank-row styling and row order.
    group.subgroups.forEach((sub, subIndex) => {
      subgroupCount += 1;
      const row = document.createElement('tr');
      row.classList.add('definition-subrow', 'component-row');
      if (group.groupLabel === blankLabel) row.classList.add('blank-row');
      row.title = 'Click to select these components in the model';
      row.addEventListener('click', () => selectRowInModel(sub.components));

      row.appendChild(td(subIndex === 0 ? group.groupLabel : ''));
      row.appendChild(td(sub.definitionLabel));
      row.appendChild(td(String(sub.components.length), 'count-cell'));
      appendAggregatedCells(row, sub.components, numericByColumn, `${group.groupLabel}::${sub.definitionLabel}`);
      tbody.appendChild(row);
    });
  }

  const truncatedNote = lastTruncated ? ` (stopped at ${MAX_COMPONENTS.toLocaleString()} components — partial)` : '';
  const groupingNote = groupByDefinition
    ? ` across ${subgroupCount} definition group${subgroupCount === 1 ? '' : 's'}`
    : '';
  el('footer-summary').textContent =
    `${filtered.length} of ${allComponents.length} component${allComponents.length === 1 ? '' : 's'} · ` +
    `${groups.length} ${groupFieldHeaderLabel} group${groups.length === 1 ? '' : 's'}${groupingNote}${truncatedNote}`;
}

// Click-to-select (US-204): selects the JSA entities behind a clicked row's
// components, replacing whatever is currently selected in the model — same
// "replace" semantics as clicking an entity directly in the SketchUp
// viewport, not an additive multi-row selection. A group summary row
// selects every component instance in that group (and, when the second
// "→ Definition Name" grouping level is on, a definition sub-row selects
// just that sub-group's instances) since `group.components`/
// `sub.components` already holds exactly the right instance set either way.
function selectRowInModel(rowComponents) {
  if (!model) return;
  const entities = getSelectionEntities(rowComponents);
  if (entities.length === 0) return;
  model.updateSelection(entities, 'set').catch((e) => {
    console.error('[Component Table] failed to select components in the model', e);
    showError(`Could not select components in the model: ${e.message}`);
  });
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

    console.log('[Component Table] entity types seen while walking the model:', result.typeTally);

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
    console.error('[Component Table] failed to read the model', e);
    showError(`Component Table could not read the model: ${e.message}`);
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
    console.warn('[Component Table] model.refresh() failed, retrying with the existing reference', e);
  }
  await readAndRenderModel();
}

async function handleLiveModelChange(streamModel) {
  try {
    model = await streamModel.getModel();
    await readAndRenderModel();
  } catch (e) {
    console.error('[Component Table] live update failed', e);
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
    console.warn('[Component Table] live updates unavailable, falling back to manual Refresh', e);
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
renderGroupByFieldSelect();
updateGroupByDefinitionLabel();
renderSavedConfigsSelect();

async function init() {
  try {
    await SketchUpApi.connect();
    model = await SketchUpApi.getActiveModel();
    el('refresh-btn').disabled = false;
    await loadAndRender();
    startLiveUpdates();
  } catch (e) {
    console.error('[Component Table] connection failed', e);
    setStatus('Not connected', 'error');
    showError(`Not connected to SketchUp (${e.message}) — this panel only works when run inside SketchUp.`);
  }
}

window.addEventListener('beforeunload', () => {
  stopLiveUpdates();
  SketchUpApi.disconnect();
});

init();
