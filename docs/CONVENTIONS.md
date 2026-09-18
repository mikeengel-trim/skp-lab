# JSA extension conventions

Rules that apply across every extension in this repo, learned from building
and debugging real ones. Extension-specific notes belong in that extension's
own README, not here.

## Delivery: ship a `.zip`, not source

JSA extensions are installed by dragging a `.zip` of the extension folder
(`manifest.json` + the HTML named as `mainFile` + assets) onto SketchUp's
Extension Manager. Source files alone are not a usable deliverable — always
produce or update the `.zip` alongside source changes, and note its path when
you consider the work done.

## Virtual extensions (drag-and-drop zip): inline everything, no load events

SketchUp's virtual-extension loader does **not** navigate to the extension's
`index.html`. It fetches the HTML as text, parses it, and clones each node
into the loader's own already-loaded document. Two consequences:

- **Inline all JavaScript directly in `index.html`** inside a `<script>`
  block. A relative `<script src="app.js">` resolves against the loader's
  location, not the extension's, and 403s.
- **Never gate setup on `DOMContentLoaded` or `window.load`.** Those events
  already fired on the loader's near-empty shell before your script is even
  appended, so they will never fire again. Call setup directly,
  unconditionally, at the top level of the script — after registering any
  `SketchUpApi.ui.on()` handlers, then calling `SketchUpApi.connect()`.

Symptom of getting either of these wrong: the extension loads and the panel
renders, but nothing ever connects or responds, with no console error. Check
the Network tab for a 403 on a relative script first; if that's clean, check
for a load-event listener wrapping setup.

## Testing UI-touching changes: jsdom over hand-rolled `vm` fixtures

For any change that touches DOM wiring (ids/classes, event listeners, tab
switching, dynamically rendered lists) — not just pure data/query logic — use
`jsdom` to load the real `index.html` verbatim, with only the remote
`Sketchup.js` `<script src>` swapped for an inline stub defining a fake
`window.SketchUpApi`. This keeps the test fixture structurally identical to
what ships. Pure data/schema logic with no DOM involved can still use a
simpler Node `vm` harness.

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
