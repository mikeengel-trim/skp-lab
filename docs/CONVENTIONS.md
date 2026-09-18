# JSA extension conventions

Rules that apply across every extension in this repo, learned from building
and debugging real ones. Extension-specific notes belong in that extension's
own README, not here.

## Delivery: load straight from this GitHub repo

Extensions are no longer packaged as a `.zip` for installation. Point
SketchUp at the extension's folder in this repo and it loads `manifest.json`
and its `mainFile` directly — pushing a commit is the deliverable.

Because there's no zip step, there's also no single-file constraint: split
`index.html`, `app.js`, and `style.css` freely. A relative `<script src="app.js">`
or `<link rel="stylesheet" href="style.css">` resolves against the extension's
own files in the repo, so it works normally — unlike the old drag-and-drop
zip loader, which cloned the HTML into its own document and broke relative
paths. Reference the SDK from `_template-extension/index.html` for the
current script URL (`cdn.habitat.sketchup.com`) rather than hardcoding it
elsewhere, since it can change between JSA versions.

## Connect before anything else

Call `SketchUpApi.connect()` once at startup, before doing anything else with
`SketchUpApi`. Register any event handlers (e.g. `SketchUpApi.ui.on()`)
before calling `connect()`, not after, so a command that fires early isn't
missed.

## Writes need an operation, reads don't

Anything that changes the model — `createGroup`, `createFace`,
`facePushPull`, etc. — must run inside a `model.performOperation(async
operation => { ... }, 'Name')` call. Everything inside one call becomes a
single undo step, so batch a logical action (e.g. "create room") into one
`performOperation`, not one per API call. Reads (querying entities, current
selection, etc.) don't need an operation.

## Units are always inches

SketchUp stores geometry in inches regardless of the model's display units.
Convert before handing numbers to the API (e.g. multiply feet by 12).

## Testing UI-touching changes: jsdom over hand-rolled `vm` fixtures

For any change that touches DOM wiring (ids/classes, event listeners, tab
switching, dynamically rendered lists) — not just pure data/query logic — use
`jsdom` to load the real `index.html` verbatim, with only the remote SDK
`<script src>` swapped for an inline stub defining a fake `window.SketchUpApi`.
This keeps the test fixture structurally identical to what ships. Pure
data/schema logic with no DOM involved can still use a simpler Node `vm`
harness.

Caveats:

- When a view has multiple toggled panels (JSON/Table, tabs, etc.), assert
  against whichever element the *currently active* view actually renders to.
- jsdom's `.hidden` property and `getComputedStyle` do **not** reliably catch
  `[hidden]`-vs-`display` bugs — a custom author `display` rule silently
  beats the `[hidden] { display: none }` user-agent rule in a real browser,
  but jsdom doesn't reproduce that precedence bug. Use one global
  `[hidden] { display: none !important; }` rule rather than per-selector
  patches, and confirm visually in a real browser before shipping.

## Debugging fetch failures

If `curl` succeeds but a browser `fetch()` fails, get the actual DevTools
console error before theorizing — Private Network Access blocks, CORS, and
mixed-content all look identical (a network error with no detail) until you
read the console message.
