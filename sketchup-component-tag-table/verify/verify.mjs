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
  isNegatedMatchType,
  groupFiltersByField,
  componentMatchesFilters,
  filterComponents,
  groupComponentsByField,
  blankBucketLabel,
  BLANK_LABEL,
  getSelectionEntities,
  MISSING_DEFINITION_LABEL,
  isNumericValue,
  isFieldNumeric,
  aggregateColumn,
  formatColumnCell,
  MIXED_VALUE_THRESHOLD,
  sortSavedConfigs,
  pruneMissingFields,
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

test('filterMatches: notEquals and notContains, case-insensitive', () => {
  assert.equal(filterMatches('Doors', { matchType: 'notEquals', text: 'Windows' }), true);
  assert.equal(filterMatches('Doors', { matchType: 'notEquals', text: 'doors' }), false);
  assert.equal(filterMatches('Doors', { matchType: 'notContains', text: 'win' }), true);
  assert.equal(filterMatches('Doors', { matchType: 'notContains', text: 'oor' }), false);
});

test('filterMatches: notEquals/notContains match a missing value (a component without the field passes "does not equal/contain")', () => {
  assert.equal(filterMatches(null, { matchType: 'notEquals', text: 'Doors' }), true);
  assert.equal(filterMatches(undefined, { matchType: 'notContains', text: 'Doors' }), true);
  // still requires filter text — an incomplete row matches nothing, negated or not
  assert.equal(filterMatches(null, { matchType: 'notEquals', text: '' }), false);
});

test('isNegatedMatchType identifies the two negated match types only', () => {
  assert.equal(isNegatedMatchType('notEquals'), true);
  assert.equal(isNegatedMatchType('notContains'), true);
  assert.equal(isNegatedMatchType('equals'), false);
  assert.equal(isNegatedMatchType('contains'), false);
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

test('componentMatchesFilters: negated filters on the same field AND together instead of OR-ing with positive ones', () => {
  // "Tag does not equal Doors" AND "Tag does not equal Windows" — excludes both,
  // rather than the nonsensical "match anything" a plain OR would produce if a
  // negated filter were combined the same way as two positive ones.
  const doorComponent = { ...sampleComponent, tag: 'Doors' };
  const windowComponent = { ...sampleComponent, tag: 'Windows' };
  const fixtureComponent = { ...sampleComponent, tag: 'Fixtures' };

  const filters = [
    { field: 'tag', matchType: 'notEquals', text: 'Doors' },
    { field: 'tag', matchType: 'notEquals', text: 'Windows' },
  ];
  const byField = groupFiltersByField(filters);

  assert.equal(componentMatchesFilters(doorComponent, byField), false);
  assert.equal(componentMatchesFilters(windowComponent, byField), false);
  assert.equal(componentMatchesFilters(fixtureComponent, byField), true);
});

test('componentMatchesFilters: a positive and a negated filter on the same field AND together (does not trivially match everything)', () => {
  // "Tag equals Doors" OR "Tag equals Windows" would normally OR, but mixing in
  // "Tag does not equal Doors" must still exclude Doors components rather than
  // matching every component regardless of tag.
  const doorComponent = { ...sampleComponent, tag: 'Doors' };
  const windowComponent = { ...sampleComponent, tag: 'Windows' };
  const fixtureComponent = { ...sampleComponent, tag: 'Fixtures' };

  const filters = [
    { field: 'tag', matchType: 'equals', text: 'Doors' },
    { field: 'tag', matchType: 'equals', text: 'Windows' },
    { field: 'tag', matchType: 'notEquals', text: 'Doors' },
  ];
  const byField = groupFiltersByField(filters);

  assert.equal(componentMatchesFilters(doorComponent, byField), false); // matches a positive, but fails the negated AND
  assert.equal(componentMatchesFilters(windowComponent, byField), true);
  assert.equal(componentMatchesFilters(fixtureComponent, byField), false); // doesn't match either positive filter
});

test('filterComponents returns everything unchanged when there are no active filters', () => {
  const components = [sampleComponent, { ...sampleComponent, tag: 'Windows' }];
  assert.equal(filterComponents(components, []).length, 2);
});

// ─── Row-to-model selection (US-204) ─────────────────────────────────────

test('getSelectionEntities extracts each component\'s instanceRef', () => {
  const components = [
    { ...sampleComponent, instanceRef: { id: 'a' } },
    { ...sampleComponent, instanceRef: { id: 'b' } },
  ];
  assert.deepEqual(getSelectionEntities(components), [{ id: 'a' }, { id: 'b' }]);
});

test('getSelectionEntities drops components with no instanceRef rather than passing null/undefined through', () => {
  const components = [
    { ...sampleComponent, instanceRef: { id: 'a' } },
    { ...sampleComponent, instanceRef: null },
    { ...sampleComponent }, // no instanceRef key at all
  ];
  assert.deepEqual(getSelectionEntities(components), [{ id: 'a' }]);
});

test('getSelectionEntities returns an empty array for an empty component list', () => {
  assert.deepEqual(getSelectionEntities([]), []);
});

// ─── Generic grouping by field (US-210/US-211) ───────────────────────────

test('blankBucketLabel: Tag keeps the "Untagged" wording, every other field gets the generic BLANK_LABEL', () => {
  assert.equal(blankBucketLabel('tag'), UNTAGGED_LABEL);
  assert.equal(blankBucketLabel('material'), BLANK_LABEL);
  assert.equal(blankBucketLabel(encodeAttributeFieldId('IFC', 'Status')), BLANK_LABEL);
});

test('groupComponentsByField(tag) buckets missing/empty tags as Untagged (no behavior change from the old Tag-only grouping)', () => {
  const components = [
    { ...sampleComponent, tag: 'Doors' },
    { ...sampleComponent, tag: null },
    { ...sampleComponent, tag: '' },
  ];
  const groups = groupComponentsByField(components, 'tag');
  const untagged = groups.find((g) => g.groupLabel === UNTAGGED_LABEL);
  assert.equal(untagged.components.length, 2);
});

test('groupComponentsByField(tag) sorts alphabetically with Untagged always last', () => {
  const components = [
    { ...sampleComponent, tag: 'Windows' },
    { ...sampleComponent, tag: null },
    { ...sampleComponent, tag: 'Doors' },
  ];
  const groups = groupComponentsByField(components, 'tag');
  assert.deepEqual(groups.map((g) => g.groupLabel), ['Doors', 'Windows', UNTAGGED_LABEL]);
});

test('groupComponentsByField groups by a non-Tag built-in field, with a generic "(blank)" bucket sorted last', () => {
  const components = [
    { ...sampleComponent, material: 'Oak' },
    { ...sampleComponent, material: 'Steel' },
    { ...sampleComponent, material: 'Oak' },
    { ...sampleComponent, material: null },
  ];
  const groups = groupComponentsByField(components, 'material');
  assert.deepEqual(groups.map((g) => g.groupLabel), ['Oak', 'Steel', BLANK_LABEL]);
  assert.equal(groups.find((g) => g.groupLabel === 'Oak').components.length, 2);
  assert.equal(groups.find((g) => g.groupLabel === BLANK_LABEL).components.length, 1);
});

test('groupComponentsByField groups by an Advanced Attribute field the same way', () => {
  const id = encodeAttributeFieldId('IFC', 'Status');
  const components = [
    { ...sampleComponent, attributes: { IFC: { Status: 'Installed' } } },
    { ...sampleComponent, attributes: { IFC: { Status: 'Planned' } } },
    { ...sampleComponent, attributes: {} }, // missing the attribute entirely -> blank bucket
  ];
  const groups = groupComponentsByField(components, id);
  assert.deepEqual(groups.map((g) => g.groupLabel), ['Installed', 'Planned', BLANK_LABEL]);
});

test('groupComponentsByField without byDefinition produces no subgroups key (existing single-level shape unchanged)', () => {
  const groups = groupComponentsByField([{ ...sampleComponent, tag: 'Doors' }], 'tag');
  assert.equal('subgroups' in groups[0], false);
});

// ─── Two-level grouping: <field> → Definition Name (US-203/US-211) ───────

test('groupComponentsByField({ byDefinition: true }) breaks each group down by Definition Name', () => {
  const components = [
    { ...sampleComponent, tag: 'Doors', definitionName: 'Single Door 36in' },
    { ...sampleComponent, tag: 'Doors', definitionName: 'Single Door 36in' },
    { ...sampleComponent, tag: 'Doors', definitionName: 'Double Door 60in' },
    { ...sampleComponent, tag: 'Windows', definitionName: 'Casement 24in' },
  ];
  const groups = groupComponentsByField(components, 'tag', { byDefinition: true });

  const doors = groups.find((g) => g.groupLabel === 'Doors');
  assert.deepEqual(
    doors.subgroups.map((s) => [s.definitionLabel, s.components.length]),
    [['Double Door 60in', 1], ['Single Door 36in', 2]],
  );

  const windows = groups.find((g) => g.groupLabel === 'Windows');
  assert.deepEqual(windows.subgroups.map((s) => s.definitionLabel), ['Casement 24in']);
});

test('groupComponentsByField({ byDefinition: true }): a missing Definition Name falls into its own last-sorted bucket', () => {
  const components = [
    { ...sampleComponent, tag: 'Doors', definitionName: 'Single Door 36in' },
    { ...sampleComponent, tag: 'Doors', definitionName: null },
    { ...sampleComponent, tag: 'Doors', definitionName: '' },
  ];
  const groups = groupComponentsByField(components, 'tag', { byDefinition: true });
  const doors = groups.find((g) => g.groupLabel === 'Doors');
  assert.deepEqual(
    doors.subgroups.map((s) => s.definitionLabel),
    ['Single Door 36in', MISSING_DEFINITION_LABEL],
  );
  assert.equal(doors.subgroups.find((s) => s.definitionLabel === MISSING_DEFINITION_LABEL).components.length, 2);
});

test('groupComponentsByField({ byDefinition: true }): the Untagged tag group also breaks down by Definition Name', () => {
  const components = [
    { ...sampleComponent, tag: null, definitionName: 'Single Door 36in' },
    { ...sampleComponent, tag: '', definitionName: 'Single Door 36in' },
    { ...sampleComponent, tag: null, definitionName: 'Double Door 60in' },
  ];
  const groups = groupComponentsByField(components, 'tag', { byDefinition: true });
  const untagged = groups.find((g) => g.groupLabel === UNTAGGED_LABEL);
  assert.deepEqual(
    untagged.subgroups.map((s) => [s.definitionLabel, s.components.length]),
    [['Double Door 60in', 1], ['Single Door 36in', 2]],
  );
});

test('groupComponentsByField({ byDefinition: true }) works with a non-Tag primary field\'s blank bucket too', () => {
  const components = [
    { ...sampleComponent, material: null, definitionName: 'Single Door 36in' },
    { ...sampleComponent, material: '', definitionName: 'Double Door 60in' },
  ];
  const groups = groupComponentsByField(components, 'material', { byDefinition: true });
  const blank = groups.find((g) => g.groupLabel === BLANK_LABEL);
  assert.deepEqual(
    blank.subgroups.map((s) => s.definitionLabel).sort(),
    ['Double Door 60in', 'Single Door 36in'],
  );
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

// ─── Saved table configurations (US-207/US-208) ───────────────────────────

test('sortSavedConfigs sorts alphabetically by name, case-insensitively', () => {
  const configs = [{ name: 'zebra' }, { name: 'Apple' }, { name: 'banana' }];
  assert.deepEqual(sortSavedConfigs(configs).map((c) => c.name), ['Apple', 'banana', 'zebra']);
});

test('sortSavedConfigs does not mutate its input array', () => {
  const configs = [{ name: 'b' }, { name: 'a' }];
  sortSavedConfigs(configs);
  assert.deepEqual(configs.map((c) => c.name), ['b', 'a']);
});

test('pruneMissingFields drops columns/filters referencing an unknown field', () => {
  const config = {
    columns: ['definitionName', 'attribute::IFC::Status'],
    filters: [
      { field: 'material', matchType: 'contains', text: 'Oak' },
      { field: 'attribute::IFC::Status', matchType: 'equals', text: 'Installed' },
    ],
    groupByField: 'tag',
    groupByDefinition: false,
  };
  const knownFieldIds = ['tag', 'name', 'definitionName', 'material', 'guid', 'description'];
  const pruned = pruneMissingFields(config, knownFieldIds);
  assert.deepEqual(pruned.columns, ['definitionName']);
  assert.deepEqual(pruned.filters, [{ field: 'material', matchType: 'contains', text: 'Oak' }]);
});

test('pruneMissingFields falls back an unknown groupByField to "tag" (always a known built-in)', () => {
  const config = { columns: [], filters: [], groupByField: 'attribute::IFC::Status', groupByDefinition: false };
  const pruned = pruneMissingFields(config, ['tag', 'name']);
  assert.equal(pruned.groupByField, 'tag');
});

test('pruneMissingFields keeps a known groupByField unchanged and does not mutate the input', () => {
  const config = { columns: ['material'], filters: [], groupByField: 'material', groupByDefinition: true };
  const pruned = pruneMissingFields(config, ['tag', 'material']);
  assert.equal(pruned.groupByField, 'material');
  assert.equal(pruned.groupByDefinition, true);
  assert.deepEqual(config.columns, ['material']); // original untouched
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
