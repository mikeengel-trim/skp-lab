// Loads the ACTUAL shipped index.html (unmodified markup) into jsdom and
// confirms every id the script looks up via el('...') or
// document.getElementById('...') really exists in the markup — cheap
// insurance against the classic id-typo-between-HTML-and-JS class of bug.
// Rule rows themselves are built dynamically (renderRulesList) so their
// ids/data-attributes aren't present in the static markup and aren't
// checked here — this only covers the fixed shell around them. Does not
// attempt to execute the script: real WebGL/ResizeObserver aren't
// available in jsdom, and Three.js genuinely can't be verified here (see
// README "Not yet verified").
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.resolve(__dirname, '../index.html');
const html = fs.readFileSync(indexPath, 'utf8');

const dom = new JSDOM(html);
const { document } = dom.window;

const scriptMatch = html.match(/<script type="module">([\s\S]*?)<\/script>/);
const script = scriptMatch[1];

const ids = new Set();
for (const m of script.matchAll(/el\('([^']+)'\)/g)) ids.add(m[1]);
for (const m of script.matchAll(/document\.getElementById\('([^']+)'\)/g)) ids.add(m[1]);
for (const m of script.matchAll(/getObjectByName\('([^']+)'\)/g)) ids.add(m[1]); // Three.js object name, not a DOM id

let pass = 0, fail = 0;
for (const id of ids) {
  if (id === 'floor-grid') continue; // Three.js object name, not a DOM id
  const found = document.getElementById(id);
  if (found) { pass++; }
  else { fail++; console.error(`FAIL missing element id in markup: #${id}`); }
}
console.log(`${pass} element ids resolved, ${fail} missing (checked ${ids.size} referenced ids)`);

const assertions = [
  ['error-banner starts hidden', document.getElementById('error-banner').hasAttribute('hidden'), true],
  ['truncated-banner starts hidden', document.getElementById('truncated-banner').hasAttribute('hidden'), true],
  ['refresh-btn starts disabled', document.getElementById('refresh-btn').hasAttribute('disabled'), true],
  ['rules-list container exists and starts empty', document.getElementById('rules-list').innerHTML.trim(), ''],
  ['add-rule-btn exists', Boolean(document.getElementById('add-rule-btn')), true],
  ['else-color input exists', document.getElementById('else-color').type, 'color'],
  ['else-visible checkbox starts checked', document.getElementById('else-visible').hasAttribute('checked'), true],
  ['rules-panel does not start collapsed in static markup', document.getElementById('rules-panel').classList.contains('collapsed'), false],
  ['panel-collapse-btn exists', Boolean(document.getElementById('panel-collapse-btn')), true],
  ['powered-by badge names Three.js', document.querySelector('.powered-by')?.textContent.includes('Three.js'), true],
  ['live-indicator starts hidden', document.getElementById('live-indicator').hasAttribute('hidden'), true],
  ['live-indicator names "Live"', document.getElementById('live-indicator').textContent.includes('Live'), true],
];
for (const [name, actual, expected] of assertions) {
  if (actual === expected) pass++;
  else { fail++; console.error(`FAIL ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}

// Rule rows are built dynamically, but the class names/selectors
// renderRulesList() relies on (e.g. `[data-count-for="..."]` lookups in
// updateCounts) are still worth confirming exist as *string literals* in
// the script, since a typo there wouldn't show up any other way in a
// harness that can't execute the script.
const structuralStrings = ['dataset.ruleId', 'dataset.countFor', 'data-count-for', 'rule-field'];
for (const s of structuralStrings) {
  if (script.includes(s)) pass++;
  else { fail++; console.error(`FAIL expected string not found in script: ${s}`); }
}

// Regression guard for a real, shipped bug: the walk once read
// `child.transformation`, which is `undefined` on the real SDK's Group/
// ComponentInstance (the actual property is `.transform`) — matrixOf()
// silently treated that as identity, so every instance rendered stacked
// at the local origin instead of its real placement, with zero error
// anywhere. Confirms the fix is still in place: exactly two call sites
// (Group, ComponentInstance) read `.transform`, and the wrong property
// name hasn't crept back in anywhere in the script.
if (script.includes('child.transformation')) {
  fail++;
  console.error('FAIL regression: script reads child.transformation (always undefined on the real SDK) — should be child.transform');
} else {
  pass++;
}
const transformCallSites = script.match(/matrixOf\(child\.transform\)/g) || [];
if (transformCallSites.length === 2) pass++;
else {
  fail++;
  console.error(`FAIL expected exactly 2 call sites reading matrixOf(child.transform) (Group + ComponentInstance), found ${transformCallSites.length}`);
}

// Regression guard for the same class of bug, on a different API: an
// ObserverHandle (the return value of SketchUpApi.observeActiveModel, used
// for live updates) is confirmed from SDK source to expose `.stop()`/
// `.endStream()`, NOT `.end()` — JSA_API_COMPLETE.md's prose claims `.end()`
// for observer handles generally, which is the same doc file that was
// already wrong about the Group/ComponentInstance transform property name.
// Calling `.end()` on the real object would throw silently inside a
// beforeunload handler (no visible error, since the page is unloading).
if (/liveModelHandle\s*\?\.\s*end\s*\(/.test(script) || /liveModelHandle\.end\(/.test(script)) {
  fail++;
  console.error('FAIL regression: script calls liveModelHandle.end() — the real ObserverHandle exposes .stop()/.endStream(), not .end()');
} else {
  pass++;
}
if (/liveModelHandle\s*\?\.\s*stop\s*\?\.\s*\(\)/.test(script) || /liveModelHandle\.stop\(\)/.test(script)) {
  pass++;
} else {
  fail++;
  console.error('FAIL expected liveModelHandle to be stopped via .stop() somewhere in the script');
}
if (script.includes('SketchUpApi.observeActiveModel(')) pass++;
else { fail++; console.error('FAIL expected a call to SketchUpApi.observeActiveModel(...) for live updates'); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
