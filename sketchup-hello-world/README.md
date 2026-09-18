# Hello World

Shows a "Hello iPad" dialog. Lives in the Sidebar. First extension built from
[`_template-extension/`](../_template-extension).

## What it shows

- The minimal shape of a command: register `SketchUpApi.ui.on('open', ...)`
  before `SketchUpApi.connect()`, so a click that opens the sidebar before the
  page has finished loading isn't missed.
- `SketchUpApi.ui.getModalInput()` used with no `inputs` as a plain
  message dialog.

## Worth knowing

`window.type: "sidebar"` is not exercised by any of the reference
sample-extensions (they use `floating`, `tab`, or `headless`) — this is
untested against the current JSA build. If SketchUp rejects it, fall back to
`"floating"` and confirm the correct sidebar type value from the JSA docs.
