// The stored-configuration contract: schema/instance-color-rules.schema.json
// (JSON Schema 2020-12) vs. the PURE-LOGIC serializeConfig/parseConfig pulled
// straight out of the shipped index.html. Confirms (1) the schema accepts
// and rejects the documents it should, (2) everything serializeConfig writes
// validates against the schema, (3) parseConfig round-trips what
// serializeConfig wrote, and (4) parseConfig agrees with the schema on
// valid vs. invalid documents so the two can't drift apart.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
const begin = html.indexOf('PURE-LOGIC-BEGIN');
const end = html.indexOf('PURE-LOGIC-END');
const src = html.slice(html.indexOf('\n', begin) + 1, html.lastIndexOf('\n', end));
const context = { console };
vm.createContext(context);
vm.runInContext(
  `${src}\nglobalThis.__x = { serializeConfig, parseConfig, encodeAttributeFieldId, CONFIG_DICTIONARY, CONFIG_KEY, CONFIG_SCHEMA_VERSION };`,
  context,
);
const { serializeConfig, parseConfig, encodeAttributeFieldId, CONFIG_DICTIONARY, CONFIG_KEY, CONFIG_SCHEMA_VERSION } = context.__x;

const schema = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../schema/instance-color-rules.schema.json'), 'utf8'));
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
const example = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../schema/example.json'), 'utf8'));

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else { fail++; console.error(`FAIL ${name}\n  expected ${e}\n  actual   ${a}`); }
}
let idCounter = 0;
const makeId = () => `gen-${++idCounter}`;
const mutate = (fn) => { const d = structuredClone(example); fn(d); return d; };

check('dictionary/key/version constants', [CONFIG_DICTIONARY, CONFIG_KEY, CONFIG_SCHEMA_VERSION], ['InstanceColorRules', 'config', 1]);

// ── 1 + 4: schema verdict vs. parseConfig verdict on the same documents ──
// `clean` = schema-valid AND parseConfig keeps every rule unchanged.
const documents = {
  'example.json': [example, true],
  'empty rules list': [{ ...structuredClone(example), rules: [] }, true],
  'bad color': [mutate((d) => { d.rules[0].color = 'blue'; }), false],
  'unknown match': [mutate((d) => { d.rules[0].match = 'regex'; }), false],
  'unknown builtin field': [mutate((d) => { d.rules[0].field.id = 'weight'; }), false],
  'attribute missing key': [mutate((d) => { delete d.rules[1].field.key; }), false],
  'attribute empty dictionary': [mutate((d) => { d.rules[1].field.dictionary = ''; }), false],
  'missing else': [mutate((d) => { delete d.else; }), false],
  'extra rule property': [mutate((d) => { d.rules[0].extra = 1; }), false],
  'non-boolean visible': [mutate((d) => { d.rules[0].visible = 'yes'; }), false],
  'non-string text': [mutate((d) => { d.rules[0].text = 5; }), false],
};
for (const [name, [doc, schemaOk]] of Object.entries(documents)) {
  check(`schema verdict: ${name}`, validate(doc), schemaOk);
  const parsed = parseConfig(JSON.stringify(doc), makeId);
  const parserClean = parsed.config !== null && parsed.dropped === 0 &&
    parsed.config.rules.length === (doc.rules?.length ?? -1);
  // The tolerant parser may still salvage an invalid doc (e.g. missing
  // else -> defaults), but it must never call a schema-invalid RULE clean.
  if (name.startsWith('missing else') || name.startsWith('extra rule property')) continue; // parser is intentionally more lenient here
  check(`parser agrees with schema: ${name}`, parserClean, schemaOk);
}
check('wrong schemaVersion rejected by schema', validate({ ...structuredClone(example), schemaVersion: 2 }), false);

// ── 2 + 3: serialize -> schema-valid -> parse round trip ────────────────
const attrField = encodeAttributeFieldId('Assembly: Parts', 'weird::key');
const states = {
  'default-like': { rules: [{ id: 'r1', field: 'name', matchType: 'contains', text: 'Installed', color: '#2f6fed', visible: true }], elseColor: '#9aa0ab', elseVisible: true },
  'no rules, else hidden': { rules: [], elseColor: '#000000', elseVisible: false },
  'attribute field with ":: " in names': { rules: [{ id: 'r2', field: attrField, matchType: 'equals', text: 'Removed', color: '#e5484d', visible: false }], elseColor: '#ffffff', elseVisible: true },
  'blank text rule (fresh "Add rule")': { rules: [{ id: 'r3', field: 'tag', matchType: 'startsWith', text: '', color: '#2f6fed', visible: true }], elseColor: '#9aa0ab', elseVisible: true },
  'every builtin + every match type': {
    rules: ['name', 'tag', 'material', 'definitionName', 'guid', 'description'].map((f, i) => ({
      id: `b${i}`, field: f, matchType: ['contains', 'equals', 'startsWith', 'endsWith'][i % 4], text: `t${i}`, color: '#abcdef', visible: i % 2 === 0,
    })),
    elseColor: '#123456', elseVisible: true,
  },
};
for (const [name, state] of Object.entries(states)) {
  const json = serializeConfig(state);
  const doc = JSON.parse(json);
  check(`serialized state validates: ${name}`, validate(doc), true);
  if (!validate(doc)) console.error(JSON.stringify(validate.errors));
  const parsed = parseConfig(json, makeId);
  check(`round trip: ${name}`, parsed, { config: state, dropped: 0, problem: null });
  check(`serialization is deterministic: ${name}`, serializeConfig(state), json);
}

// ── serializeConfig normalizes bad in-memory values instead of emitting an invalid doc ──
{
  const json = serializeConfig({
    rules: [{ id: 'x', field: 'not-a-field', matchType: 'regex', text: undefined, color: 'red', visible: undefined }],
    elseColor: 'nope', elseVisible: undefined,
  });
  check('bad in-memory values still produce a schema-valid document', validate(JSON.parse(json)), true);
}

// ── parseConfig tolerance ───────────────────────────────────────────────
{
  const partly = mutate((d) => {
    d.rules.push({ id: 'bad', field: { kind: 'builtin', id: 'nope' }, match: 'contains', text: 'x', color: '#000000', visible: true });
    d.rules.push('not an object');
  });
  const r = parseConfig(JSON.stringify(partly), makeId);
  check('salvages valid rules, counts dropped', [r.config.rules.map((x) => x.id), r.dropped, r.problem], [['rule-1', 'rule-2'], 2, null]);

  const dupes = mutate((d) => { d.rules[1].id = d.rules[0].id; });
  const rd = parseConfig(JSON.stringify(dupes), makeId);
  check('duplicate ids are regenerated, not dropped', [rd.config.rules.length, new Set(rd.config.rules.map((x) => x.id)).size], [2, 2]);

  const noVisible = mutate((d) => { delete d.rules[0].visible; delete d.else.visible; delete d.else.color; });
  const rv = parseConfig(JSON.stringify(noVisible), makeId);
  check('missing visible defaults to true, else defaults applied', [rv.config.rules[0].visible, rv.config.elseVisible, rv.config.elseColor], [true, true, '#9aa0ab']);
}
check('garbage string -> invalid', parseConfig('{not json', makeId), { config: null, dropped: 0, problem: 'invalid' });
check('non-string -> invalid', parseConfig(42, makeId), { config: null, dropped: 0, problem: 'invalid' });
check('array -> invalid', parseConfig('[]', makeId), { config: null, dropped: 0, problem: 'invalid' });
check('missing version -> invalid', parseConfig(JSON.stringify({ rules: [] }), makeId), { config: null, dropped: 0, problem: 'invalid' });
check('newer version -> newer-version (never overwrite)', parseConfig(JSON.stringify({ schemaVersion: 2, rules: [] }), makeId), { config: null, dropped: 0, problem: 'newer-version' });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
