# Instance Color Rules

_(project folder retains its original name, `sketchup-tag-color-viewer/`,
and manifest `id: "tag-color-viewer"`, for install-identity continuity —
the extension's display name and behavior are what changed. See
[`tag-color-viewer.zip`](./tag-color-viewer.zip) below.)_

A JSA (SketchUp JavaScript Adapter) extension that opens a movable window
rendering the active model with Three.js, colored by **user-defined rules
matched against a field you pick per rule** — Name, Tag, Material,
Definition Name, GUID, Description, or any Advanced Attribute set on a
component's definition or a specific instance — e.g. *"Status equals
'Installed' → Blue, else Gray"* — beside the modeling view, without
touching it. The view **updates live** as the model changes, via a real
push notification from SketchUp, not polling.

Confirmed working in a real SketchUp session as a tag-based colorer (see
"From tags to name rules" below); coloring has since moved from tags to
user rules, then from a fixed "Name" field to any field, with live updates
added alongside. All still the same JSA architecture underneath.

---

## From tags to name rules

The first version of this extension colored the model by SketchUp **tag**,
using a fixed, ΔE-validated 9-color palette (a port of the original Ruby
prototype's `tag_palette.rb`) — no user input, no way to change what
determined a color.

After confirming that version worked in a real SketchUp session, the
requirement changed: **coloring is no longer tag-based.** It's now driven
by a small list of rules the user edits live in the panel, each matched
against a component or group's **instance name** — SketchUp's `.name` on
a `Group`/`ComponentInstance`, not its tag. `"Name Contains 'Installed'" →
"Set Color as Blue"`, else a fallback color (Gray by default).

**What that removed:** the entire `TagPalette` object, its ΔE-validated
hex slots, `assignTagColors`'s alphabetical-position assignment, the "9
tags is the honest limit for color alone" capacity note, and the
`getTagManager()` call — none of that machinery makes sense once color is
user-chosen per rule rather than auto-assigned from a fixed palette. It
was deleted, not left in as dead code.

**What that added:** a rule editor (add/remove rule rows, each with a
match-type dropdown, a text field, a color picker, a visibility checkbox,
and a live face-count badge), a persistent "Else" color/visibility row,
`localStorage` persistence for the whole rule set, and — the actual
implementation challenge — a two-phase pipeline so editing a rule recolors
**instantly** instead of re-reading the model from SketchUp on every
keystroke:

1. **`collectGeometryByNameChain(model)`** — one JSA walk, run on load and
   on "Refresh". For every face, records its triangulated world-space
   geometry keyed by the ordered chain of ancestor instance names above it
   (nearest first). This function has never heard of a "rule" — it just
   answers "what geometry exists, and what's the name-lineage above it?"
2. **`resolveRenderBuckets(chainEntries, rules, elseColor)`** — pure,
   client-side, no JSA calls. Re-evaluates which rule (if any) matches
   each already-read chain and regroups the geometry by matched rule.
   Runs on every keystroke (200ms debounced) in a rule's text field, every
   color-picker drag, every add/remove — all without touching the JSA API.

**What did NOT change:** the JSA architecture, the confirmed
`Transformation`/`Vertex` SDK internals, the earcut-based face
triangulation, the Three.js rendering setup, the read-only contract (still
zero `op.*` calls anywhere in this file), and the 1.5M-triangle cap.

---

## Three follow-ups after real-model testing

1. **Fixed: every instance rendered at the local origin, ignoring its real
   placement.** Root cause was a wrong property name, not a math bug — see
   "Confirmed directly from `Sketchup.js` source" item 3 below for the
   full story. One-line fix (`.transformation` → `.transform`) at both
   call sites in `collectGeometryByNameChain`; the transform math itself
   (`applyToPoint`, `worldPoint`, the innermost-first composition) was
   already correct and unchanged.
2. **The rules panel is now collapsible.** A `»`/`«` toggle button in the
   panel header shrinks it to a 44px strip (Refresh stays reachable while
   collapsed) to free up the viewport for a closer look at the model, and
   expands it back. State persists to `localStorage`
   (`instance-color-rules:panel-collapsed`). Collapsing only changes the
   panel's CSS width — the viewport is `flex: 1`, so it grows into the
   freed space on its own, and the `ResizeObserver` already watching it
   (see `initScene`) picks up the layout change and resizes the Three.js
   renderer/camera with no extra plumbing.
3. **A small "Powered by Three.js" credit** in the viewport's bottom-left
   corner (`pointer-events: none` so it never steals an `OrbitControls`
   drag). This credits what's actually rendering the scene — plain
   Three.js, not "That Open Engine" from the original Ruby prototype,
   which this JSA rebuild deliberately doesn't use (see "From tags to name
   rules" above, and the original Ruby README's own bundle-size reasoning
   for dropping it). Confirmed with the user before adding any branding,
   specifically because crediting the wrong project would have
   misrepresented what's actually running.

---

## From one fixed field to any field, and from manual to live

Two more requests after the fixes above, both genuine architecture
changes rather than surface tweaks:

**1. Live updates.** The view now re-reads the model automatically as it
changes — no more "click Refresh to see what changed." This runs on
`SketchUpApi.observeActiveModel(callback)`, confirmed directly from the
shipped SDK source to be a real push notification: the native host tells
the page whenever the active model's `revision` counter changes
(essentially any edit) or the active model itself switches to a different
open document. This is genuinely different from polling — there's no
"check every N seconds and see if anything's different" loop anywhere in
this file. The callback is debounced 500ms (`LIVE_UPDATE_DEBOUNCE_MS`) so
a burst of edits — dragging a face, an undo/redo chain — coalesces into
one re-walk instead of re-triangulating the whole model on every
intermediate revision tick. A small pulsing "● Live" indicator in the
viewport header shows when this is active; "Refresh" remains as a manual
fallback and still works exactly as before.

The camera no longer re-frames itself on every live update, either — only
on the very first successful geometry load (`hasFramedCamera`). Without
that guard, every edit would yank the view back to a default framing
mid-orbit, which would have made "live" actively worse than manual
Refresh for anyone actually looking at the model while editing it.

**2. Any field, not just Name.** Coloring rules used to hardcode
"instance name" as the only thing a rule could match against. Each rule
now has its own `field` — picked from a dropdown offering the always-
available built-ins (Name, Tag, Material, Definition Name, GUID,
Description) plus every Advanced Attribute dictionary/key pair the model
walk actually finds, discovered live and appended to the picker as new
ones turn up. Two different rules can target two different fields on the
very same component (e.g. one rule watching `Tag`, another watching a
custom `IFC → Status` attribute) — resolution just asks each rule for
whichever value *it* cares about, per level in the ancestor chain, same
nearest-wins cascade as before.

Advanced Attributes are read from **both** a `ComponentInstance` and its
`ComponentDefinition` — the definition's attributes act as the
component's "template" defaults, and the instance's own attributes (rarer,
but real) override them on a key collision. A `Group` has no shared
definition, so only its own attributes apply.

**What changed under the hood to support both at once:** the per-level
data carried down the tree grew from a bare name string into a small
record (`{name, tagName, materialName, definitionName, guid, description,
attributes}`), and the model walk was split cleanly from rule evaluation
even further: `collectGeometryByAttributeChain` (the JSA-calling half) now
returns *every* field's value for every level, once, regardless of which
fields any current rule happens to target — and `resolveColorForChain`
(pure, no JSA) picks out only the one field each rule asks for via
`getFieldValue`. This is what makes live updates and field-picking compose
cleanly: a live-update tick re-reads all fields once, and changing which
field a rule targets is then just another instant client-side recolor,
the same debounced path rule-text edits already used.

---

## What it does for the customer

- **Color is defined by the user, against whatever field actually carries
  the meaning.** "Everything with an IFC Status of Installed" or
  "everything Tagged Electrical" or "everything named like a fixture" are
  all different modeling realities — a fixed palette keyed to one property
  couldn't express any of that.
- **Nested overrides work the way you'd expect.** A "Fixture - Installed"
  assembly colors Blue; if a sub-part nested inside it matches a different
  rule (on any field, not just the same one), the sub-part overrides to
  its own rule's color. The nearest matching ancestor always wins.
  Anything with no match anywhere in its ancestry gets the Else color.
- **Editing a rule recolors immediately** — no re-scan of the model, no
  waiting, because the (comparatively slow) model read and the (fast)
  color resolution are two separate steps.
- **The view stays current on its own.** Live updates mean a colleague's
  edit, or your own change in the modeling window, shows up here without
  clicking anything.
- **The model stays as it is.** Still read-only: no `op.*` call anywhere
  in `index.html`. Materials, tags, styles, attributes and the active
  scene are never touched.
- **Runs on Web, Desktop and iPad** — unchanged from the tag-based
  version's fix for the original Ruby prototype's Desktop-only limitation.

---

## Install

Drag `tag-color-viewer.zip` onto SketchUp's Extension Manager (any
platform).

To rebuild the zip after an edit:

```bash
cd sketchup-tag-color-viewer
zip -r tag-color-viewer.zip manifest.json index.html tag-color-viewer.svg
```

---

## Layout

```
sketchup-tag-color-viewer/
├── manifest.json              # JSA v2 manifest — one floating-window command
├── index.html                 # entire extension: markup, styles, script, inlined
├── tag-color-viewer.svg       # extension + command icon
├── verify/                    # pure-logic + DOM sanity tests (see "Verification")
│   ├── verify.mjs
│   ├── verify-dom.mjs
│   └── package.json
└── tag-color-viewer.zip       # built artifact — the actual install target
```

Everything ships in one `index.html`. **Do not** split the script into a
sibling `.js` file loaded via a relative `<script src>` — see
"Why one file" below.

---

## Why one file

The drag-and-drop "virtual extension" loader doesn't navigate the browser
to this page. It `fetch()`es the HTML as text, parses it, and clones each
node into its own already-loaded document. Any relative URL on a cloned
node resolves against the *loader's* location, not this extension's — so a
sibling `<script src="tag-color-viewer.js">` 403s, while an absolute CDN
URL (the JSA SDK, Three.js, earcut, the Google Font) loads fine. Confirmed
against the real loader source during a previous extension's build in this
workspace (see `feedback_jsa_virtual_extension_inline_scripts` memory) —
every real, working JSA extension here inlines its script for the same
reason.

The same mechanism means `init()` at the bottom of the script runs
**unconditionally, with no `DOMContentLoaded`/`load` listener**. Those
events fire against the loader's near-empty shell almost immediately, long
before this script is spliced in — a listener for either would simply
never fire.

---

## JSA APIs used

Read-only, confirmed either from `JSA_API_COMPLETE.md`
(`sketchup-speckle-connector/agent/`) or, where that table was silent or
this project needed more certainty, directly from the shipped SDK source
(`Sketchup.js`, fetched from the CDN it's loaded from):

| API | Used for |
|---|---|
| `SketchUpApi.connect()` / `.getActiveModel()` / `.disconnect()` | session lifecycle |
| `SketchUpApi.observeActiveModel(callback)` | **live updates** — real push notification on model revision change, see below |
| `model.entities.get()` (on `Model`, `Group`, `ComponentDefinition`) | recursive tree walk |
| `model.findEntity(ref)` | resolve a `ComponentInstance.definition` to its real `ComponentDefinition` |
| `model.refresh()` | re-snapshot before a manual Refresh (live updates instead use the fresh model a push already hands over) |
| `model.getTagManager()` | resolve a level's `tagId` to a display name for the **Tag** field |
| `model.getMaterials()` → `Materials.findMaterialById(id)` | resolve a level's `materialId` to a display name for the **Material** field |
| `Face.outerLoop` / `.holes` / `.normal` | per-face geometry |
| `EdgeUse.start` (on each loop entry) | resolves to a `Vertex {x,y,z}`, already oriented for the loop direction |
| `Group.name` / `ComponentInstance.name` | the **Name** field |
| `Group`/`ComponentInstance` `.guid` / `.description` | the **GUID** / **Description** fields |
| `ComponentDefinition.name` | the **Definition Name** field (`Group` has none — no shared definition) |
| `entity.attributes.allDictionaries` | every **Advanced Attribute** on an instance or definition |
| `Group.transform` / `ComponentInstance.transform` | local→parent transform, composed down the tree — **not** `.transformation`, see below |

Tag and Material are back as *filterable fields* — they're read again
after the earlier tags-to-rules pivot removed `getTagManager()` entirely —
but they no longer determine coloring by themselves; a rule has to
explicitly target the Tag or Material field the same way it would target
any Advanced Attribute.

### Confirmed directly from `Sketchup.js` source, not from the docs table

Two details the terse API reference doesn't spell out, and getting either
wrong would have silently produced garbled geometry:

1. **`Transformation`'s internal shape.** It stores state as a flat
   16-number array on a plain (not `#`-private) `_m` field, row-major
   4-tuples, translation at indices 12–14 —
   `Transformation.translation([x,y,z])` literally builds
   `[1,0,0,0, 0,1,0,0, 0,0,1,0, x,y,z,1]`. The SDK's own point-transform
   method, `Transformation.applyToPoint(m, p)`, is:
   ```
   [ p0*m0 + p1*m4 + p2*m8  + m12,
     p0*m1 + p1*m5 + p2*m9  + m13,
     p0*m2 + p1*m6 + p2*m10 + m14 ]
   ```
   `index.html` reimplements this exact formula (`applyToPoint`) rather
   than calling the SDK's instance method, because that method
   type-checks for a real `Point3d`/`Vector3d` instance internally and
   this extension only ever has plain `{x,y,z}` data from `Vertex`.
2. **`Vertex` and `Point3d` both expose plain public `x,y,z`** (no getter
   indirection), and `EdgeUse.start`/`.end` are computed getters that
   already account for the edge-use's `reverse` flag — so
   `face.outerLoop.map(eu => eu.start)` alone gives a correctly-wound
   vertex loop, no manual reversal needed.
3. **The property is `Group`/`ComponentInstance.transform`, not
   `.transformation`.** `JSA_API_COMPLETE.md` documents `.transformation`;
   the real constructors (`Group`, `ComponentInstance`) both read
   `e.transform` off the wire payload and assign `this.transform = ...`.
   **This was a real, shipped bug**, not just a documentation nitpick:
   `index.html` originally read `child.transformation`, which is always
   `undefined` on the real class, so `matrixOf()` silently fell back to
   identity for *every* instance — every component rendered stacked at
   the local origin instead of its real placement in the model, with no
   error anywhere (`matrixOf`'s whole point is to degrade gracefully
   instead of throwing, which meant it degraded gracefully all the way to
   wrong). Caught by the user testing a real model, not by any harness —
   confirmed against source at that point, fixed to `.transform`. Also
   confirms `.transform` is *never* `undefined` on a real instance (the
   constructor defaults it to `Transformation.identity`, not `void 0`), so
   `matrixOf()`'s own `!transformation` fallback branch is now dead in
   practice for this call site — left in place as a harmless defensive
   fallback, not removed.

If a future JSA SDK release changes `Transformation`'s internal
representation, `matrixOf()` falls back to identity rather than throwing —
documented in code as the one piece of this file with no *public* accessor
to lean on instead. (Same caveat now applies, one level up, to the
property name itself: if a future SDK renames `.transform`, this file
would need updating — there's no way to defend against a property that
simply isn't there without falling back to the same wrong-looking
"silently renders at the origin" failure mode this bug just was.)

4. **`ObserverHandle` exposes `.stop()`/`.endStream()`, not `.end()`.**
   `JSA_API_COMPLETE.md`'s prose claims observer handles ("`ObserverHandle`
   with `.end()` to stop") for the whole family of `observe*` methods —
   the same doc file already found wrong once in this project (item 3
   above). Confirmed from source before shipping this time, rather than
   after: `createObserverHandle(fn)` in the SDK literally returns
   `{ endStream: fn, stop: fn }` — the same function under both names, and
   neither is called `end`. `stopLiveUpdates()` calls `.stop()`. Calling a
   nonexistent `.end()` here would have thrown inside a `beforeunload`
   handler specifically — the one place an error is easiest to miss,
   since the page is already unloading when it happens.

---

## Geometry: level inheritance, transform composition, triangulation

**Level inheritance** — same cascading shape the earlier tag-based version
used for tags, generalized from "name" to "whichever field a rule cares
about": a face's color comes from the **nearest ancestor whose *chosen
field* matches a rule**, walking up from its immediate container to the
model root; an ancestor further up never overrides one closer to the face.
Concretely, `collectGeometryByAttributeChain` builds, for every face, an
ordered chain of ancestor **level records** — nearest first, each one a
`{name, tagName, materialName, definitionName, guid, description,
attributes}` snapshot — and `resolveColorForChain` scans that chain in
order; for each level, each rule pulls out its own configured field via
`getFieldValue(level, rule.field)` before testing it. Not every level of
the tree needs a match on the field a given rule cares about: if the
nearest ancestor doesn't match, resolution keeps walking outward until it
finds one that does, or falls back to Else if none of them do. Unlike the
old name-only version, a level is **never skipped** even if its Name is
blank — its Tag, Material, or an Advanced Attribute might still be exactly
what a rule is looking for.

**Transform composition** — unchanged from the tag-based version: each
`Group`/`ComponentInstance` pushes its own `Transformation` matrix onto a
stack while the walk descends, and pops it on the way back out. A face's
local vertex is mapped to world space by applying that stack
**innermost-first**: `Transformation` exposes no `multiply()`, so rather
than composing one matrix, `worldPoint()` just applies each ancestor's
transform to the point in turn, walking out to the model root.

**Triangulation** — unchanged from the tag-based version:

1. Build a 2D basis (`u, v`) perpendicular to the face's own **local**
   normal (before any ancestor transform is applied — a non-uniform-scale
   ancestor could otherwise distort the projection).
2. Project the outer loop and every hole loop into that 2D basis.
3. Triangulate with [earcut](https://github.com/mapbox/earcut) (concave
   polygons and holes both need real ear-clipping — a fan triangulation
   silently produces wrong geometry for either).
4. Map the resulting triangle indices back to the original **local** 3D
   points, then through `worldPoint()` to get final world-space positions.

Non-indexed geometry: each triangle gets 3 unique vertices (no shared
indices across faces), so Three.js's `computeVertexNormals()` produces
correct flat per-face normals with no extra work.

**Axes** — SketchUp is inches, Z-up; Three.js is Y-up. `toThreeAxes` does
`(x, y, z) → (x, z, −y)`. No inches→meters conversion: Three.js has no
notion of a physical unit, only relative scale, and the camera/grid are
sized from the model's own bounding radius.

---

## Rules

A rule is `{ id, field, matchType, text, color, visible }`. `field` is
either a built-in id (`name`, `tag`, `material`, `definitionName`, `guid`,
`description`) or an encoded Advanced Attribute id
(`` `attribute::${encodeURIComponent(dict)}::${encodeURIComponent(key)}` ``
— each part URI-encoded before joining so a dictionary or key name that
happens to contain `::` itself can never collide with the separator).
`matchType` is one of `contains` / `equals` / `startsWith` / `endsWith`,
matched case-insensitively against whatever `getFieldValue` pulls out for
that field (coerced to a string first — an Advanced Attribute can hold a
number or boolean). Rules are evaluated **in list order** — for a single
level, the first rule that matches wins; see "Level inheritance" above for
how a *chain* of ancestor levels is walked, and how different rules in the
same list can target completely different fields.

The field picker always offers the six built-ins immediately, even before
any geometry has been read, and grows to include every distinct Advanced
Attribute dictionary/key pair the model walk actually finds (`knownFields`,
appended to — never reset — as new ones are discovered across reads,
including live-update ticks).

Anything that matches no rule anywhere in its ancestry falls back to the
**Else** color (Gray by default) — same role the old tag-based version's
fixed "Untagged" gray played, just user-editable now instead of hardcoded.

Both rules and the Else color/visibility persist to `localStorage`
(`instance-color-rules:v1`) so they survive closing and reopening the
panel. They do **not** sync across devices or SketchUp sessions — this is
per-browser-profile state, same category of persistence the Speckle
Connector and Model GraphQL Inspector extensions in this workspace already
use for their own settings.

**Visibility toggles are per-rule, not per-color.** Two rules that happen
to share the same color still get independent checkboxes and independent
face counts — `resolveRenderBuckets` groups geometry by *matched rule
identity* (or the literal `'else'`), never by the resolved color itself,
specifically so this stays true even when colors collide.

---

## Verification

**`verify/verify.mjs`** extracts the file's `PURE-LOGIC-BEGIN`…
`PURE-LOGIC-END` region straight out of the shipped `index.html` (regex on
the real file — no hand-copied fixture to drift) and runs it in a plain
Node `vm` context with `earcut` injected as a global. 77 assertions:

- `ruleMatches`, generalized: all four match types, case-insensitivity,
  empty-text/null/undefined non-matching, and non-string values (a number,
  a boolean, `0` specifically — must match, not be treated as falsy) are
  coerced to a string before comparing rather than silently failing.
- Field id encode/decode: `BUILTIN_FIELDS`' exact ids, an Advanced
  Attribute id round-trips through `encodeAttributeFieldId`/
  `decodeAttributeFieldId`, and two dict/key pairs whose raw names contain
  `::` still encode to distinct, individually-decodable ids (the
  separator-collision case the URI-encoding step exists to prevent).
- `getFieldValue`: every built-in field, a string and a non-string
  Advanced Attribute value, a missing key/dictionary returning `null`
  (not throwing), and an unrecognized field id.
- `attributesToPlainObject`/`mergeAttributeObjects`: flattening a mock
  shaped exactly like the real SDK's `Attributes`/`AttributeDictionary`
  (`.allDictionaries` → `{name, values: Map}`, confirmed from source),
  override-wins-on-collision merging, and that merging never mutates the
  base object.
- `recordDiscoveredFields`: the same dict/key pair seen twice is recorded
  once.
- `prependLevel`: nearest-first ordering, and — unlike the old name-only
  `nextNameChain` it replaced — a level with a blank Name is still
  recorded, never skipped.
- `resolveColorForChain`, field-aware: nearest-ancestor-wins, falling
  through to an outer ancestor, no match anywhere, first-rule-in-list-order
  winning on a same-field tie, and two different rules independently
  matching the *same* level on two *different* fields (Tag vs. a custom
  Advanced Attribute).
- `resolveRenderBuckets`: unchanged logic, re-verified against level-record
  chains instead of bare name strings.
- The `Transformation` math (unchanged): `applyToPoint` against by-hand
  values (translation, 90° rotation, a two-level nested transform stack
  confirming innermost-first composition), the axis swap, and
  triangulation of a flat square, a square with a hole, and a square on an
  arbitrary tilted plane.

**`verify/verify-dom.mjs`** loads the real shipped `index.html` into jsdom
and confirms every element id the script looks up via
`el('...')`/`document.getElementById('...')` exists, the banners/refresh
button/live-indicator's starting state, the rules-list container starts
empty (rows are built at runtime), the collapse toggle/panel elements
exist and the panel doesn't start collapsed, the "Powered by" badge names
Three.js, and that the `dataset.ruleId`/`dataset.countFor`/
`data-count-for`/`rule-field` strings the dynamic row-building code
depends on are actually present in the script. Three **regression
guards**, each for a real bug already caught once by trusting
`JSA_API_COMPLETE.md`'s prose instead of the SDK source: fails if
`child.transformation` (always `undefined`) ever reappears, confirms
exactly two call sites read `child.transform`, and fails if
`liveModelHandle.end(` ever appears while confirming `.stop()` and a real
`SketchUpApi.observeActiveModel(` call are both present. None of these are
things a pure-logic test could catch — every one was a property/method
*name* mistake, not a logic mistake.

Run both:

```bash
cd sketchup-tag-color-viewer/verify
npm install
npm test
```

**Browser-tested outside SketchUp**, twice:

- Rule editor interactivity — add/edit/delete a rule, typing into a rule's
  text field without losing focus mid-edit (a real risk given
  `recolorAndRender()` must never rebuild `rules-list`'s DOM on every
  keystroke). Caught and fixed a real crash this way:
  `crypto.randomUUID()` threw (`SecurityError`/`TypeError` depending on
  context) in this sandboxed preview's opaque-origin `data:` URL, at the
  very first statement of `defaultState()`, before `wireUi()` ever ran —
  the entire rule list silently failed to render with no on-screen
  indication why. Replaced with a dependency-free counter-based
  `makeRuleId()`. Same "console first, don't assume" discipline as
  `feedback_browser_console_first_for_fetch_failures`.
- The collapsible panel and "Powered by Three.js" badge — toggled collapse
  and expand, confirmed the viewport visibly grows into the freed space
  (flex layout + the existing `ResizeObserver`, no new plumbing needed)
  and the toggle icon/title swap correctly, confirmed the badge renders
  and doesn't block clicks in that corner.
- The field picker — confirmed the dropdown lists all six built-ins with
  `name` selected by default, changing it to `tag` persists and survives
  adding a second rule, and "+ Add rule" produces a correctly-defaulted
  new row. No new console errors from any of this beyond the expected
  "Not in SketchUp" connection error.

**Not covered, and why:** the Three.js rendering itself, the live
`SketchUpApi.connect()` handshake against a real model, and — new this
round — the entire `observeActiveModel` live-update path and Advanced
Attribute discovery. This preview sandbox has no WebGL and reports "Not in
SketchUp" the same way any non-SketchUp browser tab would, so
`startLiveUpdates()` never even runs here, and `collectGeometryByAttributeChain`
never gets a real `Attributes`/`Tag`/`Material` object to resolve. This is
exactly why the origin-placement bug (see "Three follow-ups after
real-model testing" above) slipped past every harness and every browser
check available here: reproducing that one needed a real
`Group`/`ComponentInstance` object built by the real SDK's real
deserialization code, and this round's `observeActiveModel`/`.stop()`
details were verified the same way — from source — precisely because nothing
short of a live session can exercise them directly. **Live updates and
attribute-based field matching have not yet been tested inside a real
SketchUp session** — only the earlier tag-based coloring and the
origin-placement fix got that far.

---

## Limitations

- **Faces only.** Edges, text, dimensions and section planes are not
  rendered, and have no fields to match on either.
- Materials and textures are intentionally discarded visually — a
  material's *name* is matchable as a field, but its actual appearance
  (color/texture) is not read or shown.
- Stops at 1,500,000 triangles and says so (`MAX_TRIANGLES`).
- Read-only: no selection linkage back to SketchUp.
- Live updates are debounced 500ms and re-walk the *entire* model on every
  tick — fine for typical editing, but a very large model edited
  continuously (e.g. a live drag) will feel like it catches up every half
  second rather than tracking smoothly frame-by-frame. There's no
  incremental "only re-walk what actually changed" path.
- Only `Group`/`ComponentInstance`-level fields are matchable — a rule
  can't target a `Face`-level property (e.g. a face's own material,
  distinct from its container's) or a Model-level Advanced Attribute.
- Advanced Attribute discovery only offers fields the model walk has
  *already found by the time you open the field picker* — a brand-new
  attribute dictionary/key that exists only on geometry not yet
  encountered in this session's most recent read won't appear until the
  next read (Refresh, or the next live-update tick) surfaces it.
- No rule reordering UI (drag-to-reorder or up/down buttons) — rules apply
  in the order they were added.

## Sources

- SketchUp JSA reference docs — `sketchup-speckle-connector/agent/JSA_API_COMPLETE.md`,
  `JSA_RECIPES.md`, `JSA_MANIFEST.md` (shared across this workspace's JSA
  extensions).
- `Sketchup.js` — fetched directly from
  `https://d38s2ymumupq87.cloudfront.net/sketchup/jsa/latest/js/Sketchup.js`
  for the `Transformation`/`Vertex`/`EdgeUse` details above.
- [earcut](https://github.com/mapbox/earcut) — polygon triangulation with
  holes.
- The original Ruby prototype —
  [`SketchUp-open-colorView/ThatOpenTagViewer`](../SketchUp-open-colorView/ThatOpenTagViewer)
  — for the product spec this extension started from, and the geometry/
  transform/triangulation approach this version still uses unchanged.
