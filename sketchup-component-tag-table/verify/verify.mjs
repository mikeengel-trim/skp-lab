// Pure-logic tests — imports the REAL shipped ../logic.js directly (an ES
// module with no DOM/JSA dependency), so there's no hand-copied fixture
// that can drift from what ships.
import assert from 'node:assert/strict';
import {
  BUILTIN_FIELDS,
  UNTAGGED_LABEL,
  encodeAttributeFieldId,
  decodeAttributeFieldId,
  attributeFieldLabel,
  getFieldValue,
  attributesToPlainObject,
  mergeAttributeObjects,
  recordDiscoveredFields,
  filterMatches,
  groupFiltersByField,
  componentMatchesFilters,
  filterComponents,
  groupComponentsByTag,
  isNumericValue,
  isFieldNumeric,
  aggregateColumn,
  formatColumnCell,
  MIXED_VALUE_THRESHOLD,
} from '../logic.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try {
    fn();
    pass++;
  } catch (e) {
    fail++;
    console.error(`FAIL ${name}: ${e.message}`);
  }
}

// ─── Field ids ──────────────────────────────────────────────────────────

test('BUILTIN_FIELDS includes tag as the group-by field', () => {
  assert.ok(BUILTIN_FIELDS.some((f) => f.id === 'tag'));
});

test('encodeAttributeFieldId/decodeAttributeFieldId round-trip', () => {
  const id = encodeAttributeFieldId('IFC', 'Status');
  const decoded = decodeAttributeFieldId(id);
  assert.deepEqual(decoded, { dict: 'IFC', key: 'Status' });
});

test('encodeAttributeFieldId handles "::" inside the dict/key name without colliding', () => {
  const idA = encodeAttributeFieldId('A::B', 'C');
  const idB = encodeAttributeFieldId('A', 'B::C');
  assert.notEqual(idA, idB);
  assert.deepEqual(decodeAttributeFieldId(idA), { dict: 'A::B', key: 'C' });
  assert.deepEqual(decodeAttributeFieldId(idB), { dict: 'A', key: 'B::C' });
});

test('decodeAttributeFieldId returns null for a built-in id', () => {
  assert.equal(decodeAttributeFieldId('tag'), null);
});

test('attributeFieldLabel formats as "dict → key"', () => {
  assert.equal(attributeFieldLabel('IFC', 'Status'), 'IFC → Status');
});

// ─── getFieldValue ──────────────────────────────────────────────────────

const sampleComponent = {
  tag: 'Doors',
  name: 'Door 1',
  definitionName: 'Single Door 36in',
  material: 'Oak',
  guid: 'abc-123',
  description: 'Front entry',
  attributes: { IFC: { Status: 'Installed', Cost: '450' } },
};

test('getFieldValue reads every built-in field', () => {
  assert.equal(getFieldValue(sampleComponent, 'tag'), 'Doors');
  assert.equal(getFieldValue(sampleComponent, 'name'), 'Door 1');
  assert.equal(getFieldValue(sampleComponent, 'definitionName'), 'Single Door 36in');
  assert.equal(getFieldValue(sampleComponent, 'material'), 'Oak');
  assert.equal(getFieldValue(sampleComponent, 'guid'), 'abc-123');
  assert.equal(getFieldValue(sampleComponent, 'description'), 'Front entry');
});

test('getFieldValue reads an Advanced Attribute field', () => {
  const id = encodeAttributeFieldId('IFC', 'Status');
  assert.equal(getFieldValue(sampleComponent, id), 'Installed');
});

test('getFieldValue returns null for a missing dictionary/key', () => {
  assert.equal(getFieldValue(sampleComponent, encodeAttributeFieldId('Other', 'Missing')), null);
});

test('getFieldValue returns null for null component', () => {
  assert.equal(getFieldValue(null, 'tag'), null);
});

// ─── Attribute flattening/merging ───────────────────────────────────────

test('attributesToPlainObject flattens allDictionaries/Map shape', () => {
  const attrs = { allDictionaries: [{ name: 'IFC', values: new Map([['Status', 'Installed']]) }] };
  assert.deepEqual(attributesToPlainObject(attrs), { IFC: { Status: 'Installed' } });
});

test('attributesToPlainObject handles undefined input', () => {
  assert.deepEqual(attributesToPlainObject(undefined), {});
});

test('mergeAttributeObjects: instance overrides definition on collision', () => {
  const base = { IFC: { Status: 'Planned', Cost: '100' } };
  const override = { IFC: { Status: 'Installed' } };
  assert.deepEqual(mergeAttributeObjects(base, override), { IFC: { Status: 'Installed', Cost: '100' } });
});

test('mergeAttributeObjects does not mutate its base argument', () => {
  const base = { IFC: { Status: 'Planned' } };
  mergeAttributeObjects(base, { IFC: { Status: 'Installed' } });
  assert.equal(base.IFC.Status, 'Planned');
});

test('recordDiscoveredFields records each dict/key pair once', () => {
  const discovered = new Map();
  recordDiscoveredFields(discovered, { IFC: { Status: 'A' } });
  recordDiscoveredFields(discovered, { IFC: { Status: 'B' } });
  assert.equal(discovered.size, 1);
});

// ─── Filtering ──────────────────────────────────────────────────────────

test('filterMatches: all four match types, case-insensitive', () => {
  assert.equal(filterMatches('Doors', { matchType: 'contains', text: 'oor' }), true);
  assert.equal(filterMatches('Doors', { matchType: 'equals', text: 'doors' }), true);
  assert.equal(filterMatches('Doors', { matchType: 'startsWith', text: 'DO' }), true);
  assert.equal(filterMatches('Doors', { matchType: 'endsWith', text: 'RS' }), true);
  assert.equal(filterMatches('Doors', { matchType: 'equals', text: 'Windows' }), false);
});

test('filterMatches coerces a non-string value before comparing', () => {
  assert.equal(filterMatches(450, { matchType: 'equals', text: '450' }), true);
  assert.equal(filterMatches(0, { matchType: 'equals', text: '0' }), true);
});

test('filterMatches never matches a null value or an empty filter', () => {
  assert.equal(filterMatches(null, { matchType: 'contains', text: 'x' }), false);
  assert.equal(filterMatches('Doors', { matchType: 'contains', text: '' }), false);
});

test('groupFiltersByField groups by field and skips incomplete rows', () => {
  const filters = [
    { field: 'tag', matchType: 'equals', text: 'Doors' },
    { field: 'tag', matchType: 'equals', text: 'Windows' },
    { field: 'material', matchType: 'contains', text: 'Oak' },
    { field: 'guid', matchType: 'contains', text: '' }, // incomplete — no text
  ];
  const byField = groupFiltersByField(filters);
  assert.equal(byField.size, 2);
  assert.equal(byField.get('tag').length, 2);
  assert.equal(byField.get('material').length, 1);
});

test('componentMatchesFilters: OR within a field, AND across fields', () => {
  const doorComponent = { ...sampleComponent, tag: 'Doors', material: 'Oak' };
  const windowComponent = { ...sampleComponent, tag: 'Windows', material: 'Oak' };
  const fixtureComponent = { ...sampleComponent, tag: 'Fixtures', material: 'Oak' };
  const metalDoor = { ...sampleComponent, tag: 'Doors', material: 'Steel' };

  const filters = [
    { field: 'tag', matchType: 'equals', text: 'Doors' },
    { field: 'tag', matchType: 'equals', text: 'Windows' }, // ORs with the Doors filter above
    { field: 'material', matchType: 'equals', text: 'Oak' }, // ANDs against the tag group
  ];
  const byField = groupFiltersByField(filters);

  assert.equal(componentMatchesFilters(doorComponent, byField), true);
  assert.equal(componentMatchesFilters(windowComponent, byField), true);
  assert.equal(componentMatchesFilters(fixtureComponent, byField), false); // wrong tag
  assert.equal(componentMatchesFilters(metalDoor, byField), false); // right tag, wrong material
});

test('filterComponents returns everything unchanged when there are no active filters', () => {
  const components = [sampleComponent, { ...sampleComponent, tag: 'Windows' }];
  assert.equal(filterComponents(components, []).length, 2);
});

// ─── Grouping by tag ─────────────────────────────────────────────────────

test('groupComponentsByTag buckets missing/empty tags as Untagged', () => {
  const components = [
    { ...sampleComponent, tag: 'Doors' },
    { ...sampleComponent, tag: null },
    { ...sampleComponent, tag: '' },
  ];
  const groups = groupComponentsByTag(components);
  const untagged = groups.find((g) => g.tagLabel === UNTAGGED_LABEL);
  assert.equal(untagged.components.length, 2);
});

test('groupComponentsByTag sorts alphabetically with Untagged always last', () => {
  const components = [
    { ...sampleComponent, tag: 'Windows' },
    { ...sampleComponent, tag: null },
    { ...sampleComponent, tag: 'Doors' },
  ];
  const groups = groupComponentsByTag(components);
  assert.deepEqual(groups.map((g) => g.tagLabel), ['Doors', 'Windows', UNTAGGED_LABEL]);
});

// ─── Numeric detection ───────────────────────────────────────────────────

test('isNumericValue: numbers, numeric strings, non-numeric strings, booleans, empty', () => {
  assert.equal(isNumericValue(450), true);
  assert.equal(isNumericValue('450'), true);
  assert.equal(isNumericValue('450.5'), true);
  assert.equal(isNumericValue('  450  '), true);
  assert.equal(isNumericValue('Oak'), false);
  assert.equal(isNumericValue(''), false);
  assert.equal(isNumericValue('   '), false);
  assert.equal(isNumericValue(true), false);
  assert.equal(isNumericValue(NaN), false);
});

test('isFieldNumeric: true only when every present value is numeric', () => {
  const allNumeric = [{ attributes: { IFC: { Cost: '100' } } }, { attributes: { IFC: { Cost: 200 } } }];
  const mixed = [{ attributes: { IFC: { Cost: '100' } } }, { attributes: { IFC: { Cost: 'n/a' } } }];
  const id = encodeAttributeFieldId('IFC', 'Cost');
  assert.equal(isFieldNumeric(allNumeric, id), true);
  assert.equal(isFieldNumeric(mixed, id), false);
});

test('isFieldNumeric: false when a field has no values anywhere', () => {
  const id = encodeAttributeFieldId('IFC', 'Nothing');
  assert.equal(isFieldNumeric([{ attributes: {} }], id), false);
});

// ─── Column aggregation ──────────────────────────────────────────────────

function withCost(cost) {
  return { attributes: { IFC: { Cost: cost, Material: cost === undefined ? undefined : 'Oak' } } };
}

test('aggregateColumn: empty when no component has a value', () => {
  const id = encodeAttributeFieldId('IFC', 'Missing');
  assert.deepEqual(aggregateColumn([sampleComponent], id, false), { type: 'empty' });
});

test('aggregateColumn: sum for a numeric column', () => {
  const id = encodeAttributeFieldId('IFC', 'Cost');
  const components = [withCost('100'), withCost('200.5'), withCost(50)];
  assert.deepEqual(aggregateColumn(components, id, true), { type: 'sum', value: 350.5 });
});

test('aggregateColumn: single value when every component agrees', () => {
  const components = [{ material: 'Oak' }, { material: 'Oak' }];
  assert.deepEqual(aggregateColumn(components, 'material', false), { type: 'single', value: 'Oak' });
});

test(`aggregateColumn: list when unique values are <= ${MIXED_VALUE_THRESHOLD}`, () => {
  const components = [{ material: 'Oak' }, { material: 'Maple' }];
  const result = aggregateColumn(components, 'material', false);
  assert.equal(result.type, 'list');
  assert.deepEqual(result.values.sort(), ['Maple', 'Oak']);
});

test(`aggregateColumn: mixed when unique values exceed ${MIXED_VALUE_THRESHOLD}`, () => {
  const components = ['Oak', 'Maple', 'Pine', 'Birch'].map((material) => ({ material }));
  const result = aggregateColumn(components, 'material', false);
  assert.equal(result.type, 'mixed');
  assert.equal(result.count, 4);
  assert.equal(result.values.length, 4);
});

test('formatColumnCell renders each summary type, mixed collapsed vs expanded', () => {
  assert.equal(formatColumnCell({ type: 'empty' }), '—');
  assert.equal(formatColumnCell({ type: 'sum', value: 350.5 }), '350.5');
  assert.equal(formatColumnCell({ type: 'single', value: 'Oak' }), 'Oak');
  assert.equal(formatColumnCell({ type: 'list', values: ['Oak', 'Maple'] }), 'Oak, Maple');
  assert.equal(formatColumnCell({ type: 'mixed', values: ['A', 'B', 'C', 'D'], count: 4 }, false), 'Mixed (4)');
  assert.equal(formatColumnCell({ type: 'mixed', values: ['A', 'B', 'C', 'D'], count: 4 }, true), 'A, B, C, D');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
