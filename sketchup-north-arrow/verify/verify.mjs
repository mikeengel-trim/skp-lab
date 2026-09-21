// Extracts app.js's PURE-LOGIC-BEGIN…PURE-LOGIC-END region straight out of
// the shipped file (no hand-copied fixture to drift) and runs it in a plain
// Node vm context. Covers the vector math and the screen-projection/bearing
// logic that decides how far to rotate the arrow — not the SketchUpApi
// wiring, which needs a live session (see README's "Not covered" note).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(here, '..', 'app.js'), 'utf8');

const beginMarker = source.indexOf('PURE-LOGIC-BEGIN');
const endMarker = source.indexOf('PURE-LOGIC-END');
if (beginMarker === -1 || endMarker === -1) throw new Error('Could not find PURE-LOGIC-BEGIN/END markers in app.js');
// Skip past the rest of the BEGIN marker's own comment line, and stop at
// the start of the line the END marker's comment lives on — so only the
// executable code between the two banners is extracted, not the banner
// text itself (which isn't valid as a bare statement).
const afterBegin = source.indexOf('\n', beginMarker) + 1;
const startOfEndLine = source.lastIndexOf('\n', endMarker) + 1;
const pureLogicSource = source.slice(afterBegin, startOfEndLine);

const context = {};
vm.createContext(context);
vm.runInContext(pureLogicSource, context);

const {
  subtract, cross, dot, length, normalize,
  northVectorFromAngle, computeArrowRotationDegrees,
} = context;

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const EPS = 1e-6;
function approxEqual(a, b, msg) {
  assert.ok(Math.abs(a - b) < EPS, `${msg}: expected ${b}, got ${a}`);
}

// ─── Vector math ─────────────────────────────────────────────────────────

check('subtract', () => {
  const r = subtract({ x: 3, y: 5, z: 7 }, { x: 1, y: 1, z: 1 });
  approxEqual(r.x, 2, 'x'); approxEqual(r.y, 4, 'y'); approxEqual(r.z, 6, 'z');
});

check('cross: X × Y = Z (right-handed)', () => {
  const r = cross({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
  approxEqual(r.x, 0, 'x'); approxEqual(r.y, 0, 'y'); approxEqual(r.z, 1, 'z');
});

check('dot', () => {
  assert.equal(dot({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 }), 32);
});

check('length', () => {
  approxEqual(length({ x: 3, y: 4, z: 0 }), 5, 'length');
});

check('normalize: unit length, preserves direction', () => {
  const r = normalize({ x: 0, y: 0, z: 10 });
  approxEqual(r.x, 0, 'x'); approxEqual(r.y, 0, 'y'); approxEqual(r.z, 1, 'z');
});

check('normalize: zero vector does not throw / divide by zero', () => {
  const r = normalize({ x: 0, y: 0, z: 0 });
  approxEqual(r.x, 0, 'x'); approxEqual(r.y, 0, 'y'); approxEqual(r.z, 0, 'z');
});

// ─── North vector from angle ────────────────────────────────────────────

check('northVectorFromAngle(0) points along +Y', () => {
  const n = northVectorFromAngle(0);
  approxEqual(n.x, 0, 'x'); approxEqual(n.y, 1, 'y'); approxEqual(n.z, 0, 'z');
});

check('northVectorFromAngle(PI/2) is a unit vector in the XY plane', () => {
  const n = northVectorFromAngle(Math.PI / 2);
  approxEqual(n.z, 0, 'z stays 0 — north is always a ground-plane direction');
  approxEqual(Math.hypot(n.x, n.y), 1, 'stays unit length');
});

// ─── Screen-space bearing (computeArrowRotationDegrees) ─────────────────

// A straight-down top view: eye above target, up = +Y (SketchUp's default
// camera per Camera.default()). Screen-up is world +Y, screen-right is
// world +X. North at angle 0 (== world +Y) should read as 0° — "up".
const TOP_VIEW = { eye: { x: 0, y: 0, z: 100 }, target: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } };

check('top view, north == +Y: arrow bearing is 0°', () => {
  approxEqual(computeArrowRotationDegrees(TOP_VIEW, 0), 0, 'bearing');
});

check('top view, north rotated 90° (== +X by NORTH_ANGLE_SIGN convention): arrow bearing is 90°', () => {
  const deg = computeArrowRotationDegrees(TOP_VIEW, Math.PI / 2);
  approxEqual(deg, 90, 'bearing');
});

check('top view, north pointing -Y: arrow bearing is 180°', () => {
  const deg = computeArrowRotationDegrees(TOP_VIEW, Math.PI);
  approxEqual(Math.abs(deg), 180, 'bearing magnitude');
});

check('rotating the camera around the view axis rotates the bearing by the same amount, opposite sign', () => {
  // Orbiting the camera 30° clockwise (as seen from above) around its
  // target, with north fixed, should swing the on-screen bearing by -30°
  // (north appears to swing counter-clockwise relative to the view that
  // just turned clockwise toward it) — a basic sanity check that the
  // projection actually responds to camera orientation, not just north.
  const angle = (30 * Math.PI) / 180;
  const rotatedUp = { x: Math.sin(angle), y: Math.cos(angle), z: 0 };
  const camera = { eye: { x: 0, y: 0, z: 100 }, target: { x: 0, y: 0, z: 0 }, up: rotatedUp };
  const deg = computeArrowRotationDegrees(camera, 0);
  approxEqual(deg, -30, 'bearing after orbiting camera up vector by +30°');
});

check('camera looking exactly along north/south (degenerate projection): returns null, does not throw', () => {
  // forward = -Z is fine (top view); make forward *parallel to north*
  // instead — camera eye/target both offset only along the north axis.
  const camera = { eye: { x: 0, y: -10, z: 0 }, target: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } };
  const deg = computeArrowRotationDegrees(camera, 0); // north == +Y == forward direction
  assert.equal(deg, null);
});

check('degenerate camera (eye == target): returns null, does not throw', () => {
  const camera = { eye: { x: 5, y: 5, z: 5 }, target: { x: 5, y: 5, z: 5 }, up: { x: 0, y: 0, z: 1 } };
  assert.equal(computeArrowRotationDegrees(camera, 0), null);
});

check('perspective view (forward not aligned with any world axis) never throws and returns a finite bearing', () => {
  const camera = {
    eye: { x: 40, y: -40, z: 40 },
    target: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 0, z: 1 },
  };
  const deg = computeArrowRotationDegrees(camera, 0.35);
  assert.ok(Number.isFinite(deg), `expected a finite bearing, got ${deg}`);
});

console.log(`\n${passed} assertions passed`);
