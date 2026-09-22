// Component Tag Table — pure logic.
//
// No DOM, no JSA calls anywhere in this file. `verify/verify.mjs` imports
// these functions directly (an ES module, unlike the older single-file JSA
// extensions in this repo that had to regex-extract a "pure logic" region
// out of an inlined <script> — splitting files is fine now, see
// docs/CONVENTIONS.md, so the test just imports the real shipped file).
//
// `app.js` (DOM + JSA wiring) imports from here too, so there is exactly one
// copy of this logic — what ships is what's tested.

// ─── Fields ─────────────────────────────────────────────────────────────
//
// Same shape as Instance Color Rules' field picker (sketchup-tag-color-
// viewer): a handful of always-available built-ins, plus every distinct
// Advanced Attribute dictionary/key pair discovered while walking the
// model. `tag` doubles as the fixed group-by key (every row is a tag
// group) AND an ordinary filterable/columnable field like any other.

export const BUILTIN_FIELDS = [
  { id: 'tag', label: 'Tag' },
  { id: 'name', label: 'Name' },
  { id: 'definitionName', label: 'Definition Name' },
  { id: 'material', label: 'Material' },
  { id: 'guid', label: 'GUID' },
  { id: 'description', label: 'Description' },
];

export const UNTAGGED_LABEL = 'Untagged';

// Advanced Attribute field ids are encoded as a single string (so they can
// be a plain <select> option value and a plain JSON-serializable column/
// filter field) rather than kept as a {dict,key} pair everywhere — each
// part is URI-encoded before joining on "::" so a dictionary or key name
// that happens to contain "::" itself can never be confused with the
// separator. Identical scheme to Instance Color Rules, reused verbatim.
export function encodeAttributeFieldId(dict, key) {
  return `attribute::${encodeURIComponent(dict)}::${encodeURIComponent(key)}`;
}
export function decodeAttributeFieldId(fieldId) {
  if (typeof fieldId !== 'string' || !fieldId.startsWith('attribute::')) return null;
  const parts = fieldId.split('::');
  if (parts.length !== 3) return null;
  return { dict: decodeURIComponent(parts[1]), key: decodeURIComponent(parts[2]) };
}
export function attributeFieldLabel(dict, key) {
  return `${dict} → ${key}`;
}

// Pulls one field's value out of a component record. Returns null for a
// field the component simply doesn't have — every function downstream
// already treats null as "no value", so a column/filter targeting a field
// most components don't carry just quietly finds nothing for them rather
// than erroring.
export function getFieldValue(component, fieldId) {
  if (!component) return null;
  switch (fieldId) {
    case 'tag': return component.tag;
    case 'name': return component.name;
    case 'definitionName': return component.definitionName;
    case 'material': return component.material;
    case 'guid': return component.guid;
    case 'description': return component.description;
    default: {
      const attr = decodeAttributeFieldId(fieldId);
      if (!attr) return null;
      return component.attributes?.[attr.dict]?.[attr.key] ?? null;
    }
  }
}

// Flattens an SDK Attributes object (`.allDictionaries` is an array of
// `{name, values: Map}`, confirmed from source by Instance Color Rules)
// into a plain nested object: { [dictionaryName]: { [key]: value } }.
// Also accepts a plain mock shaped the same way, which is what makes this
// testable without a live JSA connection.
export function attributesToPlainObject(attributes) {
  const result = {};
  const dictionaries = attributes?.allDictionaries || [];
  for (const dict of dictionaries) {
    const values = {};
    (dict.values || new Map()).forEach((v, k) => { values[k] = v; });
    result[dict.name] = values;
  }
  return result;
}

// Merges a ComponentInstance's own flattened Advanced Attributes with its
// ComponentDefinition's — the definition's attributes act as the
// component's "template" defaults, and the instance's own attributes (rarer,
// but real) override them on a key collision.
export function mergeAttributeObjects(base, override) {
  const merged = { ...base };
  for (const [dictName, values] of Object.entries(override || {})) {
    merged[dictName] = { ...(merged[dictName] || {}), ...values };
  }
  return merged;
}

// Accumulates every distinct Advanced Attribute dictionary/key pair seen
// anywhere in the model into `discovered` (a Map keyed by the encoded field
// id) so the column/filter field pickers can offer it, in addition to the
// always-available BUILTIN_FIELDS. Mutates `discovered` in place since it's
// threaded through the whole model walk, accumulating as it goes.
export function recordDiscoveredFields(discovered, attributesObj) {
  for (const [dictName, values] of Object.entries(attributesObj || {})) {
    for (const key of Object.keys(values)) {
      const id = encodeAttributeFieldId(dictName, key);
      if (!discovered.has(id)) discovered.set(id, { id, label: attributeFieldLabel(dictName, key) });
    }
  }
}

// ─── Filtering ──────────────────────────────────────────────────────────
//
// A filter: { id, field, matchType: 'contains'|'equals'|'startsWith'|'endsWith', text }
// matched case-insensitively, same four match types as Instance Color
// Rules' rules. `value` is whatever getFieldValue returned — not
// necessarily a string (an Advanced Attribute can hold a number, boolean,
// etc.) — so it's coerced to a string before matching.
export function filterMatches(value, filter) {
  if (value === null || value === undefined || !filter || !filter.text) return false;
  const haystack = String(value).toLowerCase();
  const needle = filter.text.toLowerCase();
  switch (filter.matchType) {
    case 'equals': return haystack === needle;
    case 'startsWith': return haystack.startsWith(needle);
    case 'endsWith': return haystack.endsWith(needle);
    case 'contains':
    default: return haystack.includes(needle);
  }
}

// Groups filters by field. Multiple filters on the SAME field combine with
// OR (e.g. two "Tag equals" filters lets you ask for "Doors" or "Windows"
// at once — user story 10). Filters on DIFFERENT fields combine with AND
// (e.g. "Tag equals Doors" AND "Phase equals 2" — user story 13). This is
// a standard facet-filter combination rule, and it's the only shape that
// satisfies both stories without a separate AND/OR toggle in the UI.
export function groupFiltersByField(filters) {
  const byField = new Map();
  for (const filter of filters) {
    if (!filter.field || !filter.text) continue; // an incomplete filter row matches nothing and constrains nothing
    if (!byField.has(filter.field)) byField.set(filter.field, []);
    byField.get(filter.field).push(filter);
  }
  return byField;
}

// A component passes if, for every field that has at least one active
// filter, the component matches at least one of that field's filters (OR
// within a field, AND across fields — see groupFiltersByField above).
export function componentMatchesFilters(component, filtersByField) {
  for (const fieldFilters of filtersByField.values()) {
    const matchesAny = fieldFilters.some((f) => filterMatches(getFieldValue(component, f.field), f));
    if (!matchesAny) return false;
  }
  return true;
}

export function filterComponents(components, filters) {
  const filtersByField = groupFiltersByField(filters);
  if (filtersByField.size === 0) return components;
  return components.filter((c) => componentMatchesFilters(c, filtersByField));
}

// ─── Grouping by tag ────────────────────────────────────────────────────

// A component with no tag (tag is null/empty) groups under the synthetic
// "Untagged" bucket — same collision-handling as Space Creator's tag
// dropdown: SketchUp's own built-in default tag is also literally named
// "Untagged", so a component tagged with that real tag lands in the same
// bucket as one with no tag at all, which is the behavior a user looking
// for tagging gaps actually wants (user story 4).
export function groupComponentsByTag(components) {
  const groups = new Map(); // tagLabel -> component[]
  for (const component of components) {
    const label = component.tag && component.tag.trim() !== '' ? component.tag : UNTAGGED_LABEL;
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(component);
  }

  const entries = [...groups.entries()].map(([tagLabel, comps]) => ({ tagLabel, components: comps }));
  // Alphabetical, but Untagged always sorts last regardless of where it'd
  // otherwise land — it's a fallback bucket, not a real tag, and reads
  // better parked at the bottom of a reviewer's QA pass.
  entries.sort((a, b) => {
    if (a.tagLabel === UNTAGGED_LABEL) return 1;
    if (b.tagLabel === UNTAGGED_LABEL) return -1;
    return a.tagLabel.localeCompare(b.tagLabel, undefined, { sensitivity: 'base' });
  });
  return entries;
}

// ─── Column aggregation ─────────────────────────────────────────────────

// A raw value counts as numeric if, trimmed, it parses as a finite number.
// Booleans and empty strings are deliberately excluded — `Number('')` is
// 0 and `Number(true)` is 1, both of which would otherwise misclassify
// plainly non-numeric data as numeric.
export function isNumericValue(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw);
  if (typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  if (trimmed === '') return false;
  return Number.isFinite(Number(trimmed));
}

// A field is treated as numeric for aggregation purposes only if it has at
// least one real value across the given components AND every one of those
// values is numeric — inferred from the data actually present, since
// Advanced Attributes carry no reliable declared type of their own (PRD
// open question 6). A field with zero values anywhere defaults to text
// (an empty numeric column would just show a row of "0"s, which is more
// misleading than a row of blanks).
export function isFieldNumeric(components, fieldId) {
  let sawValue = false;
  for (const component of components) {
    const value = getFieldValue(component, fieldId);
    if (value === null || value === undefined || value === '') continue;
    sawValue = true;
    if (!isNumericValue(value)) return false;
  }
  return sawValue;
}

export const MIXED_VALUE_THRESHOLD = 3;

// Aggregates one column's values across one tag group's components.
//   - numeric column -> { type: 'sum', value }
//   - no values at all -> { type: 'empty' }
//   - one distinct value -> { type: 'single', value }
//   - 2..MIXED_VALUE_THRESHOLD distinct values -> { type: 'list', values }
//   - more than that -> { type: 'mixed', values, count } — `values` is kept
//     (not discarded) so the UI can still show the full list on demand
//     (user story 23's "expand on demand"), it just doesn't show by default.
export function aggregateColumn(components, fieldId, isNumeric) {
  const values = [];
  for (const component of components) {
    const value = getFieldValue(component, fieldId);
    if (value === null || value === undefined || value === '') continue;
    values.push(value);
  }

  if (values.length === 0) return { type: 'empty' };

  if (isNumeric) {
    const sum = values.reduce((total, v) => total + Number(v), 0);
    return { type: 'sum', value: sum };
  }

  const unique = [...new Set(values.map((v) => String(v)))];
  if (unique.length === 1) return { type: 'single', value: unique[0] };
  if (unique.length <= MIXED_VALUE_THRESHOLD) return { type: 'list', values: unique };
  return { type: 'mixed', values: unique, count: unique.length };
}

// Renders one aggregated cell as display text. `expanded` only affects a
// 'mixed' cell — the caller (app.js) tracks which cells the user has
// clicked to expand, per user story 23.
export function formatColumnCell(summary, expanded) {
  switch (summary.type) {
    case 'empty': return '—';
    case 'sum': return String(summary.value);
    case 'single': return summary.value;
    case 'list': return summary.values.join(', ');
    case 'mixed':
      return expanded ? summary.values.join(', ') : `Mixed (${summary.count})`;
    default: return '—';
  }
}
