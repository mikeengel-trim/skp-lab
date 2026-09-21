// Extracts the PURE-LOGIC region straight out of the shipped index.html
// (no hand-copied fixture to drift) and exercises it in plain Node with
// `earcut` injected as a global, matching how it's loaded via CDN script
// tag in the real page.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import earcut from 'earcut';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.resolve(__dirname, '../index.html');
const html = fs.readFileSync(indexPath, 'utf8');

const beginMarker = 'PURE-LOGIC-BEGIN';
const endMarker = 'PURE-LOGIC-END';
const beginIdx = html.indexOf(beginMarker);
const endIdx = html.indexOf(endMarker);
if (beginIdx === -1 || endIdx === -1) throw new Error('PURE-LOGIC markers not found in index.html');
const pureLogicSrc = html.slice(html.indexOf('\n', beginIdx) + 1, html.lastIndexOf('\n', endIdx));

const context = { earcut, console };
vm.createContext(context);
// Both pieces run as ONE script so the export line shares the pure-logic
// region's top-level lexical scope — const/let from one vm.runInContext
// call are NOT visible to a later, separate call the way `var` would be.
const combinedSrc = pureLogicSrc + `\nglobalThis.__x = { ruleMatches, resolveColorForChain, prependLevel, ` +
  `resolveRenderBuckets, applyToPoint, matrixOf, worldPoint, triangulateFaceLocal, toThreeAxes, buildBasis, ` +
  `crossVec, dotVec, normalizeVec, IDENTITY_MATRIX, BUILTIN_FIELDS, encodeAttributeFieldId, ` +
  `decodeAttributeFieldId, attributeFieldLabel, getFieldValue, attributesToPlainObject, ` +
  `mergeAttributeObjects, recordDiscoveredFields };`;
vm.runInContext(combinedSrc, context, { filename: 'index.html (pure-logic region)' });
const {
  ruleMatches, resolveColorForChain, prependLevel, resolveRenderBuckets,
  applyToPoint, matrixOf, worldPoint, triangulateFaceLocal, toThreeAxes, buildBasis, crossVec, dotVec, IDENTITY_MATRIX,
  BUILTIN_FIELDS, encodeAttributeFieldId, decodeAttributeFieldId, attributeFieldLabel, getFieldValue,
  attributesToPlainObject, mergeAttributeObjects, recordDiscoveredFields,
} = context.__x;

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; console.error(`FAIL ${name}\n  expected ${e}\n  actual   ${a}`); }
}
function approx(name, actual, expected, tol = 1e-6) {
  const ok = Math.abs(actual - expected) < tol;
  if (ok) pass++;
  else { fail++; console.error(`FAIL ${name}: expected ${expected}, got ${actual}`); }
}

// ── ruleMatches (generalized to any value, not just a bare name string) ──
check('contains, case-insensitive', ruleMatches('Fixture - Installed', { matchType: 'contains', text: 'installed' }), true);
check('contains, no match', ruleMatches('Fixture - Pending', { matchType: 'contains', text: 'Installed' }), false);
check('equals exact', ruleMatches('Installed', { matchType: 'equals', text: 'installed' }), true);
check('equals rejects partial', ruleMatches('Fixture - Installed', { matchType: 'equals', text: 'Installed' }), false);
check('startsWith', ruleMatches('Installed Fixture', { matchType: 'startsWith', text: 'installed' }), true);
check('startsWith rejects mid-string', ruleMatches('Fixture Installed', { matchType: 'startsWith', text: 'Installed' }), false);
check('endsWith', ruleMatches('Fixture Installed', { matchType: 'endsWith', text: 'installed' }), true);
check('empty rule text never matches', ruleMatches('Anything', { matchType: 'contains', text: '' }), false);
check('null value never matches', ruleMatches(null, { matchType: 'contains', text: 'x' }), false);
check('undefined value never matches', ruleMatches(undefined, { matchType: 'contains', text: 'x' }), false);
check('non-string value (number) is coerced and matched', ruleMatches(42, { matchType: 'equals', text: '42' }), true);
check('non-string value (boolean) is coerced and matched', ruleMatches(true, { matchType: 'contains', text: 'ru' }), true);
check('zero is a real value, not treated as null/falsy-skip', ruleMatches(0, { matchType: 'equals', text: '0' }), true);

// ── field id encode/decode ───────────────────────────────────────────────
check('builtin fields have the expected ids', BUILTIN_FIELDS.map((f) => f.id),
  ['name', 'tag', 'material', 'definitionName', 'guid', 'description']);
{
  const id = encodeAttributeFieldId('IFC', 'Status');
  check('encoded attribute field round-trips', decodeAttributeFieldId(id), { dict: 'IFC', key: 'Status' });
  check('attribute field label format', attributeFieldLabel('IFC', 'Status'), 'IFC → Status');
  check('a builtin id is not decodable as an attribute field', decodeAttributeFieldId('name'), null);
}
{
  // Dict/key names containing "::" themselves must not collide with the
  // separator or with each other once encoded.
  const idA = encodeAttributeFieldId('Weird::Dict', 'Key');
  const idB = encodeAttributeFieldId('Weird', 'Dict::Key');
  check('colliding-looking raw names still encode distinctly', idA === idB, false);
  check('idA decodes back to its own dict/key', decodeAttributeFieldId(idA), { dict: 'Weird::Dict', key: 'Key' });
  check('idB decodes back to its own dict/key', decodeAttributeFieldId(idB), { dict: 'Weird', key: 'Dict::Key' });
}

// ── getFieldValue ─────────────────────────────────────────────────────────
{
  const level = {
    name: 'Fixture - Installed',
    tagName: 'Electrical',
    materialName: 'Brushed Steel',
    definitionName: 'Light Fixture 6in',
    guid: '{ABC-123}',
    description: 'Ceiling-mounted',
    attributes: { IFC: { Status: 'Installed', Phase: 2 } },
  };
  check('getFieldValue name', getFieldValue(level, 'name'), 'Fixture - Installed');
  check('getFieldValue tag', getFieldValue(level, 'tag'), 'Electrical');
  check('getFieldValue material', getFieldValue(level, 'material'), 'Brushed Steel');
  check('getFieldValue definitionName', getFieldValue(level, 'definitionName'), 'Light Fixture 6in');
  check('getFieldValue guid', getFieldValue(level, 'guid'), '{ABC-123}');
  check('getFieldValue description', getFieldValue(level, 'description'), 'Ceiling-mounted');
  check('getFieldValue attribute (string)', getFieldValue(level, encodeAttributeFieldId('IFC', 'Status')), 'Installed');
  check('getFieldValue attribute (non-string, e.g. number)', getFieldValue(level, encodeAttributeFieldId('IFC', 'Phase')), 2);
  check('getFieldValue missing attribute key -> null', getFieldValue(level, encodeAttributeFieldId('IFC', 'Nonexistent')), null);
  check('getFieldValue missing dictionary -> null', getFieldValue(level, encodeAttributeFieldId('Nonexistent', 'Key')), null);
  check('getFieldValue on null level -> null', getFieldValue(null, 'name'), null);
  check('getFieldValue unrecognized field id -> null', getFieldValue(level, 'not-a-real-field'), null);
}

// ── attributesToPlainObject / mergeAttributeObjects ─────────────────────
{
  // Mock shaped exactly like the real SDK's Attributes/AttributeDictionary
  // (confirmed from source: `.allDictionaries` is an array of
  // `{name, values: Map}`) — this is what makes the function testable
  // without a live JSA connection.
  const mockAttributes = {
    allDictionaries: [
      { name: 'IFC', values: new Map([['Status', 'Installed'], ['Phase', 2]]) },
      { name: 'DynamicAttributes', values: new Map([['Cost', 199.99]]) },
    ],
  };
  const plain = attributesToPlainObject(mockAttributes);
  check('flattens to nested plain object', plain, {
    IFC: { Status: 'Installed', Phase: 2 },
    DynamicAttributes: { Cost: 199.99 },
  });
  check('null/undefined attributes -> empty object', attributesToPlainObject(undefined), {});
  check('empty allDictionaries -> empty object', attributesToPlainObject({ allDictionaries: [] }), {});
}
{
  const base = { IFC: { Status: 'Designed', Phase: 1 } };
  const override = { IFC: { Status: 'Installed' }, DynamicAttributes: { Cost: 50 } };
  const merged = mergeAttributeObjects(base, override);
  check('override wins on key collision within a shared dictionary', merged.IFC.Status, 'Installed');
  check('a key only in base survives the merge', merged.IFC.Phase, 1);
  check('a dictionary only in override is added', merged.DynamicAttributes.Cost, 50);
  check('base object itself is not mutated', base.IFC.Status, 'Designed');
}

// ── recordDiscoveredFields ───────────────────────────────────────────────
{
  const discovered = new Map();
  recordDiscoveredFields(discovered, { IFC: { Status: 'Installed', Phase: 2 } });
  recordDiscoveredFields(discovered, { IFC: { Status: 'Removed' }, DynamicAttributes: { Cost: 10 } });
  const ids = [...discovered.keys()].sort();
  check('discovers every distinct dict/key pair exactly once, even seen twice', ids, [
    encodeAttributeFieldId('DynamicAttributes', 'Cost'),
    encodeAttributeFieldId('IFC', 'Phase'),
    encodeAttributeFieldId('IFC', 'Status'),
  ].sort());
  check('label is human-readable', discovered.get(encodeAttributeFieldId('IFC', 'Status')).label, 'IFC → Status');
}

// ── prependLevel ─────────────────────────────────────────────────────────
{
  const outer = { name: 'Outer' };
  const inner = { name: 'Inner' };
  check('level prepends to the front (nearest-first)', prependLevel([outer], inner), [inner, outer]);
  check('prepending to an empty chain', prependLevel([], inner), [inner]);
  // Unlike the old name-only nextNameChain, a level is NEVER skipped even
  // if its .name is blank -- other fields (tag, material, attributes)
  // might still be meaningful to match on.
  const blankNameLevel = { name: null, tagName: 'Electrical' };
  check('a level with no name is still recorded, not skipped', prependLevel([], blankNameLevel), [blankNameLevel]);
}

// ── resolveColorForChain (now field-aware per rule) ──────────────────────
{
  const installedRule = { id: 'r-installed', field: 'name', matchType: 'contains', text: 'Installed', color: '#2f6fed' };
  const removedRule = { id: 'r-removed', field: 'name', matchType: 'contains', text: 'Removed', color: '#e3494f' };
  const rules = [installedRule, removedRule];
  const levelA = { name: 'Bracket - Removed' };
  const levelB = { name: 'Fixture - Installed' };
  check('matches the nearest (innermost) chain entry', resolveColorForChain([levelA, levelB], rules), { color: '#e3494f', ruleId: 'r-removed' });
  const levelC = { name: 'Bolt' };
  check('falls through to an outer ancestor match when the inner level matches nothing', resolveColorForChain([levelC, levelB], rules), { color: '#2f6fed', ruleId: 'r-installed' });
  check('no match anywhere in the chain', resolveColorForChain([levelC, { name: 'Widget' }], rules), { color: null, ruleId: null });
  check('empty chain never matches', resolveColorForChain([], rules), { color: null, ruleId: null });

  // First rule in list order wins when the SAME level matches multiple rules.
  const overlapping = [
    { id: 'first', field: 'name', matchType: 'contains', text: 'Fixture', color: '#111111' },
    { id: 'second', field: 'name', matchType: 'contains', text: 'Installed', color: '#222222' },
  ];
  check('first matching rule in list order wins for one level', resolveColorForChain([levelB], overlapping), { color: '#111111', ruleId: 'first' });

  // Different rules can target different fields on the SAME level.
  const statusRule = { id: 'r-status', field: encodeAttributeFieldId('IFC', 'Status'), matchType: 'equals', text: 'Installed', color: '#00ff00' };
  const tagRule = { id: 'r-tag', field: 'tag', matchType: 'equals', text: 'Electrical', color: '#ff00ff' };
  const richLevel = { name: 'Anything', tagName: 'Electrical', attributes: { IFC: { Status: 'Installed' } } };
  check('a rule matches on its own configured field, not just name', resolveColorForChain([richLevel], [statusRule]), { color: '#00ff00', ruleId: 'r-status' });
  check('two different rules can each match the same level on different fields (first in list wins)', resolveColorForChain([richLevel], [tagRule, statusRule]), { color: '#ff00ff', ruleId: 'r-tag' });
}

// ── resolveRenderBuckets ─────────────────────────────────────────────────
{
  const rules = [
    { id: 'blue', field: 'name', matchType: 'contains', text: 'Installed', color: '#2f6fed' },
  ];
  const elseColor = '#9aa0ab';
  const chainEntries = [
    { chain: [{ name: 'Fixture - Installed' }], bucket: { faceCount: 2, positions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18] } }, // 2 triangles
    { chain: [{ name: 'Fixture - Installed 2' }], bucket: { faceCount: 1, positions: [0, 0, 0, 1, 0, 0, 0, 1, 0] } }, // 1 triangle, different chain, same rule
    { chain: [{ name: 'Random Widget' }], bucket: { faceCount: 3, positions: [] } }, // matches nothing, no geometry (e.g. all degenerate faces)
  ];
  const groups = resolveRenderBuckets(chainEntries, rules, elseColor);
  check('two different chains matching the same rule merge into one group', groups.get('blue').faceCount, 3);
  check('merged group keeps both position parts unflattened', groups.get('blue').parts.length, 2);
  check('unmatched chain groups under "else"', groups.get('else').faceCount, 3);
  check('else group color is the else color', groups.get('else').color, elseColor);
  check('a zero-geometry bucket contributes no parts', groups.get('else').parts.length, 0);
}

// ── Transformation math, against values confirmed from the real SDK ────
check('identity applyToPoint is a no-op', applyToPoint(IDENTITY_MATRIX, [3, -4, 5]), [3, -4, 5]);

{
  const t = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1]; // Transformation.translation([10,20,30])
  check('pure translation', applyToPoint(t, [1, 2, 3]), [11, 22, 33]);
  check('matrixOf passes through a raw 16-array', matrixOf(t), t);
  check('matrixOf reads ._m off an instance-shaped object', matrixOf({ _m: t }), t);
  check('matrixOf falls back to identity for garbage', matrixOf({ nonsense: true }), IDENTITY_MATRIX);
}

{
  const angle = Math.PI / 2;
  const c = Math.cos(angle), s = Math.sin(angle);
  const rotZ90 = [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const [x, y, z] = applyToPoint(rotZ90, [1, 0, 0]);
  approx('rotateZ90 x', x, 0);
  approx('rotateZ90 y', y, 1);
  approx('rotateZ90 z', z, 0);
}

{
  const instanceT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1];
  const groupT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 100, 0, 1];
  const stack = [groupT, instanceT]; // pushed root-to-leaf order, as the walk does
  check('nested transform stack composes correctly', worldPoint([0, 0, 0], stack), [5, 100, 0]);
}

check('axis swap Z-up -> Y-up', toThreeAxes([1, 2, 3]), [1, 3, -2]);

// ── buildBasis / triangulateFaceLocal ───────────────────────────────
{
  const { u, v } = buildBasis([0, 0, 1]);
  approx('basis u is unit length', Math.hypot(...u), 1);
  approx('basis u perpendicular to normal', dotVec(u, [0, 0, 1]), 0);
  approx('basis v perpendicular to normal', dotVec(v, [0, 0, 1]), 0);
  approx('basis u perpendicular to v', dotVec(u, v), 0);
}

function triangleArea3d(a, b, c) {
  const ab = [b.x - a.x, b.y - a.y, b.z - a.z];
  const ac = [c.x - a.x, c.y - a.y, c.z - a.z];
  const cr = crossVec(ab, ac);
  return Math.hypot(...cr) / 2;
}

{
  const square = [
    { x: 0, y: 0, z: 5 }, { x: 10, y: 0, z: 5 }, { x: 10, y: 10, z: 5 }, { x: 0, y: 10, z: 5 },
  ];
  const face = { normal: [0, 0, 1], outerLoop: square, holes: [] };
  const tris = triangulateFaceLocal(face);
  check('square triangulates to 2 triangles', tris.length / 3, 2);
  let totalArea = 0;
  for (let i = 0; i < tris.length; i += 3) totalArea += triangleArea3d(tris[i], tris[i + 1], tris[i + 2]);
  approx('square triangle area sums to 100', totalArea, 100);
  const knownKeys = new Set(square.map((p) => `${p.x},${p.y},${p.z}`));
  const allFromKnownPoints = tris.every((p) => knownKeys.has(`${p.x},${p.y},${p.z}`));
  check('every triangulated point is a real input vertex', allFromKnownPoints, true);
}

{
  const outer = [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 10, y: 10, z: 0 }, { x: 0, y: 10, z: 0 }];
  const hole = [{ x: 3, y: 3, z: 0 }, { x: 3, y: 7, z: 0 }, { x: 7, y: 7, z: 0 }, { x: 7, y: 3, z: 0 }];
  const face = { normal: [0, 0, 1], outerLoop: outer, holes: [hole] };
  const tris = triangulateFaceLocal(face);
  let totalArea = 0;
  for (let i = 0; i < tris.length; i += 3) totalArea += triangleArea3d(tris[i], tris[i + 1], tris[i + 2]);
  approx('square-with-hole area = 100 - 16', totalArea, 100 - 16, 1e-4);

  function centroidInsideHole(a, b, c) {
    const cx = (a.x + b.x + c.x) / 3, cy = (a.y + b.y + c.y) / 3;
    return cx > 3 && cx < 7 && cy > 3 && cy < 7;
  }
  let anyInsideHole = false;
  for (let i = 0; i < tris.length; i += 3) if (centroidInsideHole(tris[i], tris[i + 1], tris[i + 2])) anyInsideHole = true;
  check('no triangle centroid falls inside the hole', anyInsideHole, false);
}

{
  const n = [1, 1, 1].map((v) => v / Math.sqrt(3));
  const { u, v } = buildBasis(n);
  const origin = { x: 20, y: -5, z: 8 };
  function pt(u2, v2) {
    return {
      x: origin.x + u[0] * u2 + v[0] * v2,
      y: origin.y + u[1] * u2 + v[1] * v2,
      z: origin.z + u[2] * u2 + v[2] * v2,
    };
  }
  const tiltedSquare = [pt(0, 0), pt(6, 0), pt(6, 6), pt(0, 6)];
  const face = { normal: n, outerLoop: tiltedSquare, holes: [] };
  const tris = triangulateFaceLocal(face);
  check('tilted square triangulates to 2 triangles', tris.length / 3, 2);
  let totalArea = 0;
  for (let i = 0; i < tris.length; i += 3) totalArea += triangleArea3d(tris[i], tris[i + 1], tris[i + 2]);
  approx('tilted square area sums to 36', totalArea, 36, 1e-4);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
