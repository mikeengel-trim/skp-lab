// North Arrow — a small always-on-top compass overlay, no user options.
//
// Opens itself at startup (manifest `loadAtLaunch: true`, `window.type:
// "transparent"` positioned in the lower-right corner) and just rotates the
// arrow image to keep pointing at the model's true north as the camera
// orbits — nothing to configure, nothing to click.
//
// The icon is swappable: replace north-arrow.png with any other image (same
// or different size) and it's picked up on next load — index.html just
// points an <img> at that filename, nothing else references it.

// ═════════════════════════════════════════════════════════════════════════
// PURE-LOGIC-BEGIN — no DOM, no SketchUpApi calls below this line and above
// the matching closing marker. Kept dependency-free so verify/verify.mjs
// can extract and exercise exactly this region in plain Node.
// ═════════════════════════════════════════════════════════════════════════

function subtract(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function length(a) { return Math.hypot(a.x, a.y, a.z); }
function normalize(a) {
  const len = length(a);
  return len > 1e-9 ? { x: a.x / len, y: a.y / len, z: a.z / len } : { x: 0, y: 0, z: 0 };
}

// The model's true-north direction, in model XY (ground-plane), as a unit
// vector. SketchUp expresses "how far off true north the model's own green
// (+Y) axis is" as ShadowInfo.northAngle — 0 means +Y is north.
//
// Two things about this angle are NOT independently confirmed against a
// live SketchUp session (only against the shipped JSA SDK source, which
// exposes the raw number with no documented unit conversion) — see
// README.md "North angle: what's confirmed and what's assumed":
//   1. Unit — degrees, per ShadowInfo.northAngle's documented behavior.
//   2. Rotation sign — assumed clockwise-positive when viewed from above
//      (SketchUp's standard geo-location convention), i.e. a positive angle
//      swings north from +Y toward +X.
// If the arrow turns out to spin backwards or by the wrong amount in a real
// model, flip NORTH_ANGLE_SIGN to -1 here — everything downstream is
// derived from this one vector.
const NORTH_ANGLE_SIGN = 1;

function northVectorFromAngle(northAngleDegrees) {
  const angle = NORTH_ANGLE_SIGN * (northAngleDegrees * Math.PI) / 180;
  return { x: Math.sin(angle), y: Math.cos(angle), z: 0 };
}

// Projects the model's north vector into the camera's own screen plane and
// returns the angle (degrees, clockwise from screen-up) the arrow image
// should be rotated to keep pointing at it — the same "bearing" convention
// a paper compass rose uses, so the shipped icon (which points up = 0°) is
// correct with no extra offset.
//
// Works for any camera orientation, not just a flat top-down view: `right`
// and `screenUp` are rebuilt from the camera's actual forward/up vectors
// every call, so orbiting, tilting or looking near-straight-down all still
// project north onto *this* view's screen plane rather than assuming a
// fixed world-up.
//
// Returns null when north points directly into/out of the screen (forward
// is parallel to the north vector — camera aimed exactly due north or
// south) — there's no meaningful 2D bearing at that exact orientation, so
// the caller should just leave the arrow at its last rotation rather than
// snapping to an arbitrary angle.
function computeArrowRotationDegrees(camera, northAngleDegrees) {
  const forward = normalize(subtract(camera.target, camera.eye));
  if (length(forward) < 1e-9) return null; // degenerate camera (eye == target)

  let right = normalize(cross(forward, camera.up));
  if (length(right) < 1e-6) {
    // forward is parallel to the camera's own up vector (looking straight
    // up/down along it) — fall back to world +X as an arbitrary reference
    // so screen axes are still well-defined.
    right = normalize(cross(forward, { x: 1, y: 0, z: 0 }));
    if (length(right) < 1e-6) return null;
  }
  const screenUp = normalize(cross(right, forward));

  const north = northVectorFromAngle(northAngleDegrees);
  const screenX = dot(north, right);
  const screenY = dot(north, screenUp);
  if (Math.hypot(screenX, screenY) < 1e-6) return null;

  return (Math.atan2(screenX, screenY) * 180) / Math.PI;
}

// ═════════════════════════════════════════════════════════════════════════
// PURE-LOGIC-END
// ═════════════════════════════════════════════════════════════════════════

const arrowEl = document.getElementById('arrow');

let northAngleDegrees = 0; // ShadowInfo.northAngle; refreshed on load and on model changes
let model = null;

function applyRotation(camera) {
  const degrees = computeArrowRotationDegrees(camera, northAngleDegrees);
  if (degrees === null) return; // keep last rotation — see computeArrowRotationDegrees
  arrowEl.style.transform = `rotate(${degrees}deg)`;
}

async function refreshNorthAngle() {
  if (!model) return;
  try {
    const shadowInfo = await model.getShadowInfo();
    if (shadowInfo && typeof shadowInfo.northAngle === 'number') {
      northAngleDegrees = shadowInfo.northAngle;
    }
  } catch (e) {
    console.warn('[North Arrow] could not read shadow info / north angle', e);
  }
}

// Live camera updates: fires on every orbit/pan/zoom tick with a fresh
// Camera (real push from SketchUp, not polling) — this is what makes the
// arrow track "in real time" as the user moves the view.
function startCameraStream() {
  try {
    model.view.observeCamera((camera) => applyRotation(camera));
  } catch (e) {
    console.error('[North Arrow] could not start camera stream', e);
  }
}

// North angle rarely changes mid-session (only via Model Info >
// Geo-location, or an explicit op.shadowSetNorth), so this isn't on the hot
// path the camera stream is — refreshed opportunistically whenever the
// model's revision changes, debounced the same way the color-viewer
// extension debounces its own live-update tick, so a burst of unrelated
// edits doesn't fire a re-read per edit.
let modelChangeTimer = null;
function startModelChangeWatch() {
  try {
    SketchUpApi.observeActiveModel(() => {
      if (modelChangeTimer) clearTimeout(modelChangeTimer);
      modelChangeTimer = setTimeout(refreshNorthAngle, 500);
    });
  } catch (e) {
    console.warn('[North Arrow] live model-change watch unavailable; north angle will only be read once at startup', e);
  }
}

async function init() {
  try {
    await SketchUpApi.connect();
    model = await SketchUpApi.getActiveModel();
    await refreshNorthAngle();
    const camera = await model.view.getCamera();
    applyRotation(camera);
    startCameraStream();
    startModelChangeWatch();
  } catch (e) {
    // No SketchUpApi.ui / status text here on purpose — this overlay has no
    // UI beyond the arrow itself. Errors are still logged so a failure is
    // debuggable via the DevTools console rather than silently invisible.
    console.error('[North Arrow] connection failed', e);
  }
}

init();
