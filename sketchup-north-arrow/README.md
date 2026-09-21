# North Arrow

A JSA extension with **no user-facing options at all**. It opens itself at
startup as a borderless overlay in the lower-right corner of the viewport
(manifest `loadAtLaunch: true` + `window.type: "transparent"`) and rotates
a compass arrow in real time to keep pointing at the model's true north as
the camera orbits, pans, or zooms — nothing to click, nothing to configure.

## The swappable icon

`north-arrow.png` is the only thing that determines what's drawn. `index.html`
references it by that one filename and nothing else in the extension knows
or cares what it looks like — **replace the file and the new icon is what
shows**, at whatever size, as long as it has a transparent background (so
only the icon itself shows over the model, not a colored square) and a
roughly-centered subject (rotation pivots on the image's own center, so an
off-center icon will visibly wobble around a point that isn't its middle).

The shipped icon is the reference compass graphic supplied with this
extension's request — an "N" over a triangle-in-a-circle — background-keyed
to transparent and cropped to a square canvas.

## How the rotation is computed

`app.js`'s `computeArrowRotationDegrees(camera, northAngleRadians)` (in the
`PURE-LOGIC` region, tested standalone in `verify/`) does the actual work,
independent of whether the view is a flat top-down plan or an oblique
perspective:

1. Build the current view's own screen axes (`right`, `screenUp`) from the
   live `Camera`'s `eye`/`target`/`up` — re-derived on every camera tick, so
   this works correctly at any tilt, not just looking straight down.
2. Build the model's true-north direction as a ground-plane unit vector from
   `ShadowInfo.northAngle` (see below).
3. Project north onto those screen axes and take `atan2` of the result —
   the same "degrees clockwise from up" bearing a paper compass rose uses,
   which is why the shipped icon (arrow pointing straight up = 0°) needs no
   extra offset.
4. Apply that as a CSS `rotate()` on the `<img>`. A short CSS `transition`
   smooths consecutive camera-stream ticks into a continuous spin instead of
   visible jumps.

Live tracking comes from `model.view.observeCamera(callback)` — a real push
notification on every orbit/pan/zoom tick, not polling. `ShadowInfo.northAngle`
itself is only re-read on model changes (via `SketchUpApi.observeActiveModel`,
debounced 500ms, same pattern the Instance Color Rules extension in this repo
uses for its own live updates) — it rarely changes mid-session, so it isn't on
the hot path the camera stream is.

## North angle: what's confirmed and what's assumed

Everything about *which properties exist* below was confirmed by fetching
the actual JSA SDK
(`https://cdn.habitat.sketchup.com/dist/sketchup-js-api/v2/sketchup-js-api.min.js`,
the same URL `_template-extension/index.html` uses) and reading the
minified source directly, not by trusting the prose API reference alone —
this repo has already been burned once by a reference doc's prose being
wrong (see the Instance Color Rules README's `.transformation`/`.transform`
story). Confirmed this way:

- `model.getShadowInfo()` returns a `ShadowInfo` with a public `northAngle`
  number field (`this.northAngle = t.NorthAngle` in the real class body).
- `model.view.observeCamera(callback)` is the current, non-deprecated live
  camera API (`streamCamera` still works but logs a deprecation warning
  internally as of SDK 2.30.0) and hands the callback a real `Camera`
  instance with public `eye`, `target`, `up` — each a `Point3d`/`Vector3d`
  with plain public `x`/`y`/`z`, no getter indirection.
- `Camera.default()` — SketchUp's own default camera — uses `up: (0, 1, 0)`,
  i.e. the model's +Y (green) axis is screen-up in the default framing. This
  is what "north deviates from the Y axis" is relative to.

**Not confirmed against a live SketchUp session — assumed, and each is a
single named constant if it turns out wrong:**

1. **Unit of `shadowInfo.northAngle`.** The SDK source hands back the raw
   number with no visible conversion, so its unit isn't confirmed from code.
   Assumed **radians**, per JSA's own top-level "angles are radians" rule
   and the setter recipe's own inline comment (`// North angle (radians
   from Y axis)`) — the terser one-line API table elsewhere in this repo's
   reference docs says "degrees" for the *setter*, which is the kind of
   discrepancy between reference docs that's already turned out to be wrong
   once before in this repo. If the arrow ends up rotating by a wildly wrong
   amount (e.g. barely moving, or spinning many multiples of a full circle
   for a small orbit), that mismatch is almost certainly why — the fix is a
   `* Math.PI / 180` on the value read out of `refreshNorthAngle()` in
   `app.js`.
2. **Rotation sign.** Assumed clockwise-positive when viewed from above
   (SketchUp's standard geo-location convention), encoded as the single
   `NORTH_ANGLE_SIGN = 1` constant at the top of the `PURE-LOGIC` region in
   `app.js`. Flip it to `-1` if the arrow turns out to spin the wrong way
   relative to a model with a known, deliberately-set north angle.

**How to actually verify both, in a real SketchUp session:** open a model,
set Model Info → Geo-location's north angle to something unambiguous (e.g.
90°), and confirm the arrow points where "90° off the green axis" should
put it before and after orbiting. This extension has not yet been tested
that way — see "Verification" below for exactly what has and hasn't been
checked.

## Install

Point SketchUp at this folder (`sketchup-north-arrow/`) in the GitHub repo —
no zip, no packaging step, per [../docs/CONVENTIONS.md](../docs/CONVENTIONS.md).
It should appear in the viewport automatically the next time SketchUp
launches with this extension enabled; the `commands`/`menuItems` entry in
the manifest exists only as a manual fallback to reopen it if it's ever
closed, since `loadAtLaunch` opening a `transparent`-type window
automatically (rather than just preloading its iframe hidden) is itself one
of the assumptions above that a real session hasn't confirmed yet.

## Layout

```
sketchup-north-arrow/
├── manifest.json     # loadAtLaunch + transparent window, lower-right corner
├── index.html        # markup + styles; loads app.js
├── app.js            # rotation math (PURE-LOGIC, tested) + SketchUpApi wiring
├── north-arrow.png   # the icon — swap this file to change what's shown
├── verify/           # pure-logic tests for the rotation math
└── README.md
```

## Limitations / not yet confirmed

- **The two north-angle assumptions above** (unit, sign) — see that section
  for exactly what to check and how to fix it if either is wrong.
- **`loadAtLaunch` + `window.type: "transparent"` auto-opening with no user
  action** has not been confirmed in a real SketchUp session — only that
  both are documented, valid manifest values. If the overlay doesn't appear
  on its own, use the "North Arrow" menu command as a fallback and mention
  it so this note can be corrected.
- No `op.*` calls anywhere — this extension only ever reads (`getShadowInfo`,
  `observeCamera`, `observeActiveModel`); it cannot and does not change the
  model.
- The arrow freezes (rather than jumping to an arbitrary angle) for the one
  camera orientation where north points directly into or out of the screen
  (looking exactly due north or south) — see `computeArrowRotationDegrees`'s
  `null`-return case in `app.js`.

## Verification

`verify/verify.mjs` extracts `app.js`'s `PURE-LOGIC-BEGIN`…`PURE-LOGIC-END`
region straight out of the shipped file (no hand-copied fixture to drift)
and runs it in a plain Node `vm` context — 15 assertions covering the vector
math primitives, `northVectorFromAngle`, and `computeArrowRotationDegrees`
across a top-down view, an orbited camera, a perspective (non-axis-aligned)
view, and the degenerate cases (camera looking exactly along the north axis,
`eye === target`).

```bash
cd sketchup-north-arrow/verify
npm test
```

**Not covered, and why:** the live `SketchUpApi.connect()`/`getShadowInfo()`/
`observeCamera()` calls against a real model, and both north-angle
assumptions above — none of that is exercisable outside a real SketchUp
session. This extension has not yet been opened inside SketchUp at all.
