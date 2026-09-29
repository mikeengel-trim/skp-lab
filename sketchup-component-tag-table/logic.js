// Component Table — pure logic.
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
// model. As of US-210, `tag` is an ordinary filterable/columnable/
// groupable field like any other — no field is privileged as a fixed
// group-by key; `app.js`'s group-by picker just defaults to it.

export const BUILTIN_FIELDS = [
  { id: 'tag', label: 'Tag' },
  { id: 'name', label: 'Name' },
  { id: 'definitionName', label: 'Definition Name' },
  { id: 'material', label: 'Material' },
  { id: 'guid', label: 'GUID' },
  { id: 'description', label: 'Description' },
  // US-206: Transform (translation) and Size, decomposed into scalar
  // sub-fields the same way every other field here is a single value — see
  // app.js's buildComponentRecord for where these are actually read off
  // the JSA ComponentInstance. Units are SketchUp's raw internal inches,
  // hence the "(in)" in each label, per the "format sensibly re: units"
  // requirement — no unit conversion happens anywhere in this extension.
  { id: 'transformX', label: 'Transform → X (in)' },
  { id: 'transformY', label: 'Transform → Y (in)' },
  { id: 'transformZ', label: 'Transform → Z (in)' },
  { id: 'sizeWidth', label: 'Size → Width (in)' },
  { id: 'sizeHeight', label: 'Size → Height (in)' },
  { id: 'sizeDepth', label: 'Size → Depth (in)' },
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
//
// `context` (US-209) is how a calculated column plugs into this same seam:
// `context.calculatedColumns` is a Map of fieldId -> { name, ast }, and a
// fieldId found there is evaluated on demand rather than read off the
// component directly. Every caller elsewhere in this file threads its own
// `context` parameter through to here, defaulting to `{}` — a fieldId that
// isn't a calculated column ignores it entirely, so nothing about the
// existing built-in/Advanced-Attribute path changes when it's omitted.
export function getFieldValue(component, fieldId, context = {}) {
  if (!component) return null;
  switch (fieldId) {
    case 'tag': return component.tag;
    case 'name': return component.name;
    case 'definitionName': return component.definitionName;
    case 'material': return component.material;
    case 'guid': return component.guid;
    case 'description': return component.description;
    case 'transformX': return component.transformX ?? null;
    case 'transformY': return component.transformY ?? null;
    case 'transformZ': return component.transformZ ?? null;
    case 'sizeWidth': return component.sizeWidth ?? null;
    case 'sizeHeight': return component.sizeHeight ?? null;
    case 'sizeDepth': return component.sizeDepth ?? null;
    default: {
      if (context.calculatedColumns?.has(fieldId)) {
        return evaluateCalculatedField(component, fieldId, context);
      }
      const attr = decodeAttributeFieldId(fieldId);
      if (!attr) return null;
      return component.attributes?.[attr.dict]?.[attr.key] ?? null;
    }
  }
}

// Evaluates one calculated column's formula for one component, resolving
// each `{Label}` reference back through getFieldValue (recursively, so a
// formula can reference another calculated column, a built-in, or an
// Advanced Attribute all the same way) and converging every failure mode
// — an unknown field label, a runtime circular reference that slipped past
// wouldCreateCircularReference (e.g. from a saved config edited outside
// this UI), division by zero, a non-numeric operand — into a single
// `#ERROR: ...` string rather than letting it throw and break the whole
// table's render. `context.visiting` is a defense-in-depth guard against
// that runtime cycle case specifically: add/edit-time validation is the
// primary defense, this is the fallback that keeps a corrupted config from
// ever infinite-looping instead of just showing an error.
function evaluateCalculatedField(component, fieldId, context) {
  const calc = context.calculatedColumns.get(fieldId);
  const visiting = context.visiting || new Set();
  if (visiting.has(fieldId)) return '#ERROR: circular reference';
  const nextContext = { ...context, visiting: new Set(visiting).add(fieldId) };
  try {
    return evaluateFormula(calc.ast, (label) => {
      const refFieldId = context.fieldIdByLabel?.get(label);
      if (!refFieldId) throw new FormulaError(`Unknown field {${label}}`);
      return getFieldValue(component, refFieldId, nextContext);
    });
  } catch (e) {
    return `#ERROR: ${e instanceof FormulaError ? e.message : 'evaluation failed'}`;
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
// A filter: { id, field, matchType: 'contains'|'notContains'|'equals'|
// 'notEquals'|'startsWith'|'endsWith', text } matched case-insensitively,
// same four positive match types as Instance Color Rules' rules plus two
// negated ones (US-202). `value` is whatever getFieldValue returned — not
// necessarily a string (an Advanced Attribute can hold a number, boolean,
// etc.) — so it's coerced to a string before matching.
//
// A negated match type (notEquals/notContains) matches a missing value
// (null/undefined) — a component that doesn't even have the field trivially
// doesn't equal/contain the filter's text, and a user asking for "Tag does
// not equal Doors" expects an untagged component to show up, not be
// silently excluded the way a positive filter excludes it.
export function isNegatedMatchType(matchType) {
  return matchType === 'notEquals' || matchType === 'notContains';
}

export function filterMatches(value, filter) {
  if (!filter || !filter.text) return false;
  const negated = isNegatedMatchType(filter.matchType);
  if (value === null || value === undefined) return negated;
  const haystack = String(value).toLowerCase();
  const needle = filter.text.toLowerCase();
  switch (filter.matchType) {
    case 'equals': return haystack === needle;
    case 'notEquals': return haystack !== needle;
    case 'startsWith': return haystack.startsWith(needle);
    case 'endsWith': return haystack.endsWith(needle);
    case 'notContains': return !haystack.includes(needle);
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
//
// Negated filters (notEquals/notContains) are the one exception, resolved
// for US-202: OR-ing a positive and a negated match type on the SAME field
// would trivially match everything (e.g. "Tag equals Doors" OR "Tag does
// not equal Doors"), so within a field, positive filters still OR together,
// negated filters AND together, and the two groups AND against each other —
// see componentMatchesFilters below.
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
// filter: it matches at least one of that field's positive filters (if any
// are present), AND it matches every one of that field's negated filters
// (if any are present) — see groupFiltersByField above for why negated
// filters AND instead of OR within a field.
export function componentMatchesFilters(component, filtersByField, context = {}) {
  for (const fieldFilters of filtersByField.values()) {
    const positive = fieldFilters.filter((f) => !isNegatedMatchType(f.matchType));
    const negated = fieldFilters.filter((f) => isNegatedMatchType(f.matchType));
    if (positive.length > 0) {
      const matchesAny = positive.some((f) => filterMatches(getFieldValue(component, f.field, context), f));
      if (!matchesAny) return false;
    }
    const matchesAllNegated = negated.every((f) => filterMatches(getFieldValue(component, f.field, context), f));
    if (!matchesAllNegated) return false;
  }
  return true;
}

export function filterComponents(components, filters, context = {}) {
  const filtersByField = groupFiltersByField(filters);
  if (filtersByField.size === 0) return components;
  return components.filter((c) => componentMatchesFilters(c, filtersByField, context));
}

// ─── Grouping by field ──────────────────────────────────────────────────
//
// US-210/US-211: grouping is no longer fixed to Tag — the caller picks
// which field to group by, the same way filters already pick a field via
// `getFieldValue`. A component whose group-by field is missing/blank
// groups under a synthetic fallback bucket — same collision-handling as
// Space Creator's tag dropdown originally established for Tag specifically
// (SketchUp's own built-in default tag is literally named "Untagged", so a
// component tagged with that real tag lands in the same bucket as one with
// no tag at all — user story 4). `blankBucketLabel` preserves that exact
// "Untagged" wording when the group-by field IS Tag (no behavior change for
// existing Tag-grouped tables), and falls back to a generic `BLANK_LABEL`
// for every other field, so the same fallback-bucket behavior works no
// matter what's being grouped on.

export const BLANK_LABEL = '(blank)';

export function blankBucketLabel(fieldId) {
  return fieldId === 'tag' ? UNTAGGED_LABEL : BLANK_LABEL;
}

// `byDefinition` (US-203) adds an optional second grouping level: each
// top-level entry also gets a `subgroups` array breaking its components
// down further by Definition Name, using the same empty-value/sort rules as
// the top level but keyed on `definitionName` instead. This second level
// stays fixed to Definition Name regardless of `fieldId` — US-211's own
// notes flag "any field -> any field" two-level grouping as a considered
// alternative, but that's a bigger, separate generalization; keeping the
// second level fixed here means US-203's toggle keeps working unchanged on
// top of whatever field the user now picks as the primary one.
export function groupComponentsByField(components, fieldId, { byDefinition = false, context = {} } = {}) {
  const blankLabel = blankBucketLabel(fieldId);
  const groups = new Map(); // groupLabel -> component[]
  for (const component of components) {
    const raw = getFieldValue(component, fieldId, context);
    const label = raw !== null && raw !== undefined && String(raw).trim() !== '' ? String(raw) : blankLabel;
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(component);
  }

  const entries = [...groups.entries()].map(([groupLabel, comps]) => ({
    groupLabel,
    components: comps,
    ...(byDefinition ? { subgroups: groupComponentsByDefinitionName(comps) } : {}),
  }));
  // Alphabetical, but the blank bucket always sorts last regardless of
  // where it'd otherwise land — it's a fallback bucket, not a real value,
  // and reads better parked at the bottom of a reviewer's QA pass.
  entries.sort((a, b) => {
    if (a.groupLabel === blankLabel) return 1;
    if (b.groupLabel === blankLabel) return -1;
    return a.groupLabel.localeCompare(b.groupLabel, undefined, { sensitivity: 'base' });
  });
  return entries;
}

export const MISSING_DEFINITION_LABEL = '(No Definition Name)';

// The second grouping level for US-203: buckets one tag group's components
// by Definition Name. Not exported on its own — always reached through
// groupComponentsByField's `byDefinition` option, so the two levels can't
// drift apart (e.g. a duplicated empty-value bucket with a different
// fallback label). A missing/blank definition name gets its own fallback
// bucket, distinct from UNTAGGED_LABEL since it's a different field —
// this is what makes the "Untagged" tag group break down correctly by
// Definition Name too, rather than needing special-case handling.
function groupComponentsByDefinitionName(components) {
  const groups = new Map(); // definitionLabel -> component[]
  for (const component of components) {
    const label = component.definitionName && component.definitionName.trim() !== ''
      ? component.definitionName
      : MISSING_DEFINITION_LABEL;
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(component);
  }

  const entries = [...groups.entries()].map(([definitionLabel, comps]) => ({ definitionLabel, components: comps }));
  entries.sort((a, b) => {
    if (a.definitionLabel === MISSING_DEFINITION_LABEL) return 1;
    if (b.definitionLabel === MISSING_DEFINITION_LABEL) return -1;
    return a.definitionLabel.localeCompare(b.definitionLabel, undefined, { sensitivity: 'base' });
  });
  return entries;
}

// ─── Row-to-model selection (US-204) ─────────────────────────────────────

// Extracts the underlying JSA entity references for a table row's
// components, so a click handler can hand them straight to
// `model.updateSelection(entities, 'set')`. A component record only carries
// an `instanceRef` when it was built from a live model walk (app.js's
// `buildComponentRecord`); records built purely for tests or column/filter
// preview purposes may not have one, so a missing ref is silently dropped
// rather than passed to the Selection API as `undefined`.
export function getSelectionEntities(components) {
  return components.map((c) => c.instanceRef).filter((ref) => ref != null);
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
export function isFieldNumeric(components, fieldId, context = {}) {
  let sawValue = false;
  for (const component of components) {
    const value = getFieldValue(component, fieldId, context);
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
export function aggregateColumn(components, fieldId, isNumeric, context = {}) {
  const values = [];
  for (const component of components) {
    const value = getFieldValue(component, fieldId, context);
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

// Rounds a summed numeric value to 4 decimal places before display — enough
// to collapse the floating-point noise a geometry-derived sum can pick up
// (e.g. Transform/Size values from US-206 summing to 47.999999999997)
// without truncating a genuine attribute-provided decimal like 3.5.
function formatNumber(value) {
  return String(Math.round(value * 10000) / 10000);
}

// Renders one aggregated cell as display text. `expanded` only affects a
// 'mixed' cell — the caller (app.js) tracks which cells the user has
// clicked to expand, per user story 23.
export function formatColumnCell(summary, expanded) {
  switch (summary.type) {
    case 'empty': return '—';
    case 'sum': return formatNumber(summary.value);
    case 'single': return summary.value;
    case 'list': return summary.values.join(', ');
    case 'mixed':
      return expanded ? summary.values.join(', ') : `Mixed (${summary.count})`;
    default: return '—';
  }
}

// ─── Saved table configurations (US-207/US-208) ──────────────────────────

// Alphabetical by name, case-insensitive — the documented sort order for
// the US-208 dropdown (an explicit choice over "most-recently-saved",
// since a reviewer picking between named views like "Untagged Audit" and
// "Door Schedule" is scanning for a name, not a save time).
export function sortSavedConfigs(configs) {
  return [...configs].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

// Degrades a saved configuration gracefully when it references a column,
// filter, or group-by field that the currently-open model hasn't
// discovered (Advanced Attribute fields are only known once the model walk
// has actually seen them — see README.md). Drops any column/filter
// referencing an unknown field rather than crashing the table, and falls
// back the group-by field to 'tag' (always known — a built-in) if it's
// unknown too. Returns a new object; never mutates `config`.
export function pruneMissingFields(config, knownFieldIds) {
  const known = new Set(knownFieldIds);
  return {
    ...config,
    columns: config.columns.filter((fieldId) => known.has(fieldId)),
    filters: config.filters.filter((filter) => known.has(filter.field)),
    groupByField: known.has(config.groupByField) ? config.groupByField : 'tag',
  };
}

// ─── Calculated columns (US-209) ───────────────────────────────────────────
//
// A small, hand-rolled recursive-descent parser/evaluator for a minimal
// arithmetic-and-comparison grammar — deliberately NOT `eval()`/
// `new Function()` against the raw formula string, since a formula can
// arrive via a saved/shared table configuration (US-207/US-208) and get
// evaluated automatically the moment that configuration loads, with no
// review step in between. That makes a raw formula string untrusted-ish
// input, and eval()/new Function() on untrusted input is a real
// code-injection surface — this grammar can only ever produce arithmetic,
// so there's nothing in it capable of reaching outside this evaluator.
//
//   expression  := comparison
//   comparison  := additive (('==' | '!=' | '<=' | '>=' | '<' | '>') additive)?
//   additive    := multiplicative (('+' | '-') multiplicative)*
//   multiplicative := unary (('*' | '/') unary)*
//   unary       := '-' unary | primary
//   primary     := NUMBER | STRING | FIELD_REF | '(' expression ')'
//
// A field reference is written `{Field Label}` — the exact label shown in
// the column/filter/group-by pickers (e.g. `{Tag}`, `{IFC → Cost}`,
// `{Transform → X (in)}`), not this extension's internal field id, so a
// formula reads naturally without knowing how Advanced Attribute ids are
// encoded. A double-quoted string literal has no escape handling (a label
// or comparison value containing a literal `"` isn't supported) — a
// deliberately minimal grammar, not a general-purpose language.
export class FormulaError extends Error {}

function tokenizeFormula(source) {
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '{') {
      const end = source.indexOf('}', i);
      if (end === -1) throw new FormulaError(`Unterminated field reference starting at position ${i}`);
      tokens.push({ type: 'fieldRef', value: source.slice(i + 1, end).trim(), pos: i });
      i = end + 1;
      continue;
    }
    if (c === '"') {
      const end = source.indexOf('"', i + 1);
      if (end === -1) throw new FormulaError(`Unterminated string literal starting at position ${i}`);
      tokens.push({ type: 'string', value: source.slice(i + 1, end), pos: i });
      i = end + 1;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < source.length && /[0-9.]/.test(source[j])) j++;
      const numStr = source.slice(i, j);
      if (!/^\d+(\.\d+)?$/.test(numStr)) throw new FormulaError(`Invalid number "${numStr}" at position ${i}`);
      tokens.push({ type: 'number', value: Number(numStr), pos: i });
      i = j;
      continue;
    }
    const twoChar = source.slice(i, i + 2);
    const TWO_CHAR_OPS = { '==': 'eq', '!=': 'neq', '<=': 'lte', '>=': 'gte' };
    if (TWO_CHAR_OPS[twoChar]) { tokens.push({ type: TWO_CHAR_OPS[twoChar], pos: i }); i += 2; continue; }
    const ONE_CHAR_OPS = { '(': 'lparen', ')': 'rparen', '+': 'plus', '-': 'minus', '*': 'star', '/': 'slash', '<': 'lt', '>': 'gt' };
    if (ONE_CHAR_OPS[c]) { tokens.push({ type: ONE_CHAR_OPS[c], pos: i }); i++; continue; }
    throw new FormulaError(`Unexpected character "${c}" at position ${i}`);
  }
  return tokens;
}

// Parses a formula string into an AST, throwing FormulaError for any
// syntax problem — the caller (app.js's "Add Calculated Column" UI) parses
// eagerly when a formula is entered, so an invalid formula is flagged in
// the column-definition UI itself, before it's ever added as a column.
export function parseFormula(source) {
  const tokens = tokenizeFormula(source);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parsePrimary() {
    const t = peek();
    if (!t) throw new FormulaError('Unexpected end of formula');
    if (t.type === 'number') { next(); return { type: 'number', value: t.value }; }
    if (t.type === 'string') { next(); return { type: 'string', value: t.value }; }
    if (t.type === 'fieldRef') { next(); return { type: 'fieldRef', label: t.value }; }
    if (t.type === 'lparen') {
      next();
      const expr = parseComparison();
      if (!peek() || peek().type !== 'rparen') throw new FormulaError(`Expected ")" at position ${peek()?.pos ?? source.length}`);
      next();
      return expr;
    }
    throw new FormulaError(`Unexpected token at position ${t.pos}`);
  }

  function parseUnary() {
    if (peek()?.type === 'minus') { next(); return { type: 'negate', operand: parseUnary() }; }
    return parsePrimary();
  }

  function parseMultiplicative() {
    let node = parseUnary();
    while (peek() && (peek().type === 'star' || peek().type === 'slash')) {
      const op = next().type === 'star' ? '*' : '/';
      node = { type: 'binary', op, left: node, right: parseUnary() };
    }
    return node;
  }

  function parseAdditive() {
    let node = parseMultiplicative();
    while (peek() && (peek().type === 'plus' || peek().type === 'minus')) {
      const op = next().type === 'plus' ? '+' : '-';
      node = { type: 'binary', op, left: node, right: parseMultiplicative() };
    }
    return node;
  }

  const COMPARISON_OPS = { eq: '==', neq: '!=', lte: '<=', gte: '>=', lt: '<', gt: '>' };
  function parseComparison() {
    let node = parseAdditive();
    if (peek() && COMPARISON_OPS[peek().type]) {
      const op = COMPARISON_OPS[next().type];
      node = { type: 'compare', op, left: node, right: parseAdditive() };
    }
    return node;
  }

  if (tokens.length === 0) throw new FormulaError('Formula is empty');
  const ast = parseComparison();
  if (pos < tokens.length) throw new FormulaError(`Unexpected token at position ${tokens[pos].pos}`);
  return ast;
}

// Every `{Label}` a formula's AST references, in encounter order with
// duplicates removed — used both to resolve field values during evaluation
// and to build the calculated-column dependency graph for circular-
// reference detection below.
export function extractFormulaFieldRefs(ast) {
  const labels = [];
  const seen = new Set();
  function walk(node) {
    if (!node) return;
    if (node.type === 'fieldRef') {
      if (!seen.has(node.label)) { seen.add(node.label); labels.push(node.label); }
      return;
    }
    if (node.type === 'negate') { walk(node.operand); return; }
    if (node.type === 'binary' || node.type === 'compare') { walk(node.left); walk(node.right); }
  }
  walk(ast);
  return labels;
}

// Evaluates a parsed formula AST against one component. `resolveFieldRef`
// maps a `{Label}` reference to that field's raw value — injected rather
// than this module reaching into getFieldValue/knownFields itself, so this
// evaluator has zero dependency on the field-registry shape and stays
// trivially unit-testable with a plain lookup function. Throws FormulaError
// for any per-component evaluation failure (missing/unknown field,
// non-numeric operand in an arithmetic op, division by zero) — the caller
// (getFieldValue) catches this and returns an error marker rather than
// letting it propagate and break the whole table's render.
export function evaluateFormula(ast, resolveFieldRef) {
  function toNumber(value, label) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
    throw new FormulaError(`${label ? `{${label}}` : 'value'} is not numeric`);
  }
  function evalNode(node) {
    switch (node.type) {
      case 'number': return node.value;
      case 'string': return node.value;
      case 'fieldRef': {
        const value = resolveFieldRef(node.label);
        if (value === null || value === undefined) throw new FormulaError(`{${node.label}} has no value for this component`);
        return value;
      }
      case 'negate': return -toNumber(evalNode(node.operand));
      case 'binary': {
        const left = toNumber(evalNode(node.left));
        const right = toNumber(evalNode(node.right));
        if (node.op === '+') return left + right;
        if (node.op === '-') return left - right;
        if (node.op === '*') return left * right;
        if (node.op === '/') {
          if (right === 0) throw new FormulaError('Division by zero');
          return left / right;
        }
        break;
      }
      case 'compare': {
        const left = evalNode(node.left);
        const right = evalNode(node.right);
        if (node.op === '==') return String(left) === String(right);
        if (node.op === '!=') return String(left) !== String(right);
        const leftNum = toNumber(left);
        const rightNum = toNumber(right);
        if (node.op === '<') return leftNum < rightNum;
        if (node.op === '>') return leftNum > rightNum;
        if (node.op === '<=') return leftNum <= rightNum;
        if (node.op === '>=') return leftNum >= rightNum;
        break;
      }
    }
    throw new FormulaError('Unrecognized formula node');
  }
  return evalNode(ast);
}

// Detects whether a calculated column named `columnName`, whose formula
// references the field labels in `formulaFieldRefs`, would create a
// circular dependency among calculated columns — i.e. whether some
// referenced calculated column transitively references `columnName` back.
// `existingColumns` is every OTHER current calculated column (excluding
// the one being added/edited): `{ name, formula }` objects. Re-parses each
// existing column's own formula on demand rather than requiring its field
// refs to be precomputed/stored — this only ever runs once, at
// add/edit-time, never per render, so the extra parsing is negligible.
// A column with its own unparseable formula can't propagate a cycle
// through itself, so it's skipped rather than treated as an error here.
export function wouldCreateCircularReference(columnName, formulaFieldRefs, existingColumns) {
  const byName = new Map(existingColumns.map((c) => [c.name, c]));
  const visited = new Set();
  function reaches(refs) {
    for (const label of refs) {
      if (label === columnName) return true;
      if (visited.has(label)) continue;
      visited.add(label);
      const referenced = byName.get(label);
      if (!referenced) continue;
      let refAst;
      try { refAst = parseFormula(referenced.formula); } catch { continue; }
      if (reaches(extractFormulaFieldRefs(refAst))) return true;
    }
    return false;
  }
  return reaches(formulaFieldRefs);
}
