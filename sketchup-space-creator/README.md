# Space Creator

Defines a new enclosed space — a named, tagged box — and places it in the
model. Lives in the Sidebar.

## What it shows

- Splitting a dimension into separate feet/inches fields and combining them
  before they reach the API (`feetAndInchesToInches`).
- Populating a `<select>` from the model's actual tags via
  `model.getTagManager()` → `tagManager.tags`, with an "Untagged" option that
  simply omits `drawingElementSetTag`.
- Looking a tag up by name before creating it (`tagManager.findTag(name) ??
  operation.createTag(name)`), so picking an existing tag never creates a
  duplicate.
- Placing several copies as one undo step: the loop over `count` and every
  `createGroup`/`createFace`/`facePushPull`/`groupSetName`/`drawingElementSetTag`
  call for it all run inside a single `performOperation()`.
- Re-fetching `TagManager` rather than caching it: it's a point-in-time
  snapshot (it has its own `refresh()` for exactly this reason), so
  `loadTags()` runs again on `tagSelect`'s `focus` event and on
  `SketchUpApi.ui.on('open', ...)`, not just once at connect. The JSA SDK has
  no push-based "a tag changed" observer to subscribe to instead, so
  re-fetching at the moments the list is about to matter is the fix.
- **"Add Tags by Theme"** reads a theme JSON file and creates one tag per
  entry in its `departments` array, colored from that entry's `color`.
  Existing tags are looked up by name
  (`tagManager.getTagByName(name) ?? operation.createTag(name)`) rather than
  duplicated, and `operation.tagSetColor(tagRef, SketchUpApi.Color.fromHex(color))`
  runs on every tag every time, so re-clicking after editing the JSON re-syncs
  colors safely. Note this uses `getTagByName`, not `findTag` — `findTag` is
  used elsewhere in this file but doesn't exist on the shipped SDK's
  `TagManager` class; `getTagByName` is the confirmed-correct method name.
- The **Theme** dropdown lists the sample themes bundled in this repo (fetched
  with a plain relative `fetch()`, since this extension's files are served
  straight from the repo — no bundling step) plus an "Upload JSON file…"
  option that opens a native file picker and reads the chosen file with
  `FileReader`, so a theme doesn't have to live in this repo to be used.

## Themes

A theme is a JSON file describing the tags — one per "department" — a
building type is organized around. Two samples ship in this repo:

- [`hospitality_theme.json`](hospitality_theme.json) — a hotel's departments.
- [`multifamily_theme.json`](multifamily_theme.json) — a cold-climate
  market-rate apartment building, with a `spaces` breakdown under each
  department (unit mix, amenity program, BOH, parking).

[`theme_template.json`](theme_template.json) is the starting point for a new
one. Schema:

```jsonc
{
  "themeName": "string — documentation only",
  "description": "string — documentation only",
  "departments": [
    {
      "name": "string — required; becomes the tag name",
      "description": "string — optional, documentation only",
      "color": "#RRGGBB — required; becomes the tag color",
      "spaces": [
        // optional, documentation only — a place to note the individual
        // spaces and target areas a department is made of.
        { "name": "string", "targetArea": "string", "notes": "string" }
      ]
    }
  ]
}
```

Only `departments[].name` and `departments[].color` are read by the app;
everything else exists so the JSON file itself can carry the program
reasoning behind a theme. A new theme can either be added to
`BUNDLED_THEMES` in [`app.js`](app.js) to appear in the dropdown, or used
as-is via the "Upload JSON file…" option — no code change required for the
latter.

## Assumptions worth checking against the real UI

- **`window.type: "sidebar"`** — not exercised by any of the reference
  sample-extensions (they use `floating`, `tab`, or `headless`); confirmed
  working against the current JSA build.
- **`commands.open.icon: "icon.svg"`.** No sample extension or reachable doc
  demonstrates a manifest icon field at all, so both the key name and where
  it belongs (per-command vs. top-level `icon`/`icons`) are a guess based on
  toolbar buttons and menu items both being driven by the same `open`
  command. `icon.svg` itself is a single-color, `currentColor`-based glyph
  with no background — standard for a toolbar/menu icon that the host tints
  and adds button chrome around, unlike the colored badge icon shown in the
  panel-header mockup (that's a different kind of icon, not this one). If
  the icon doesn't show up, this is the thing to check first.
- **All copies place at the origin, stacked.** The mockup's Count field has
  no accompanying spacing/position control, so `count` copies are created at
  identical coordinates for the user to drag apart — unlike the
  `content-3d` sample, which spaces its stamped instances along an axis. If
  the intent was a spaced row or grid instead, this is the one thing to
  change (add a spacing input and translate each copy in `buildSpace`).
- **Tag dropdown is plain text, no color swatch.** A native `<select><option>`
  can't reliably render a background color across platforms, so the colored
  square in the mockup was dropped rather than faked with a custom
  non-native dropdown. `tag.color` (red/green/blue/alpha) is available from
  `TagManager.tags` if a custom dropdown is wanted later.
- **Floor face winding order.** Confirmed via live testing that `createFace`'s
  vertex order determines which way `facePushPull(floor, height)` extrudes —
  the wrong order built the box with its top at the origin instead of its
  base. `buildSpace` now uses the order that puts the base at z=0.
- **Tag dropdown's "Untagged" tag.** The model's own built-in default tag is
  also literally named "Untagged", so `loadTags()` skips it by name when
  copying `tagManager.tags` into the dropdown — otherwise it'd duplicate the
  synthetic "no tag" option already at the top.
