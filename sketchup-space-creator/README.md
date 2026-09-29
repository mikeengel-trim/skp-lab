# Space Creator

Defines a new enclosed space — a named, tagged box — and places it in the
model. Lives in the Sidebar.

## What it shows

- Splitting a dimension into separate feet/inches fields and combining them
  before they reach the API (`feetAndInchesToInches`).
- Populating a `<select>` from the model's actual tags via
  `model.getTagManager()` → `tagManager.tags`, with an "Untagged" option that
  simply omits `drawingElementSetTag`. The native `<select>` (`#tag-select`)
  is kept as the actual source of truth — `placeSpaces()` and
  `applySpaceSelection()` both still just read `tagSelect.value` — but it's
  visually hidden behind a custom listbox (`#tag-picker-button` +
  `#tag-picker-list`) that renders a small color swatch from each tag's
  `.color` beside its name, since a native `<option>` can't do that.
  "Untagged" (and any tag with no readable color) gets a neutral gray swatch
  instead of none. The custom list supports the same Up/Down/Home/End/Enter/
  Escape keyboard navigation a `<select>` gives for free, and still refreshes
  via `loadTags()` when the button receives focus, same trigger as before.
- Looking a tag up by name before creating it (`tagManager.getTagByName(name)
  ?? operation.createTag(name)`), so picking an existing tag never creates a
  duplicate.
- Placing several copies as one undo step: the loop over `count` and every
  `createGroup`/`createFace`/`facePushPull`/`groupSetName`/`drawingElementSetTag`
  call for it all run inside a single `performOperation()`.
- Inline validation messages on Name/Width/Depth/Height, layered on top of
  `updateButtons()`'s existing disabled-state check rather than replacing it:
  a `touchedFields` map tracks which fields the user has blurred at least
  once, so an error only ever appears after interaction (never on first
  load), and every `input` event re-renders it immediately so it clears the
  instant the field becomes valid again.
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
  colors safely. `getTagByName` is the confirmed-correct method on the shipped
  SDK's `TagManager` class — `findTag` doesn't exist on it and is no longer
  used anywhere in this file.
- The **Theme** dropdown is populated once, at connect, from
  [`themes.json`](themes.json) — a checked-in index of every sample theme
  bundled in this repo, fetched with a plain relative `fetch()` the same way
  `app.js`/`style.css` load (no bundling step). Adding a theme means adding
  its JSON file plus one entry to `themes.json`, not an `app.js` change. If
  that index can't be fetched or parsed, the dropdown falls back to a small
  static list (`BUNDLED_THEMES`) rather than coming up empty.
- The dropdown also remembers the last **bundled** theme selected, in
  `localStorage` (key `space-creator:lastTheme:v1`), and restores it on the
  next connect. Choosing "Upload JSON file…" is never saved/restored — an
  uploaded file isn't available in a future session — so that option only
  ever appears if picked again by hand.
- **"Upload JSON file…"** reveals a "Choose file…" button, which opens the
  native file picker (via `themeFileInput.click()`) and reads the chosen file
  with `FileReader`, so a theme doesn't have to live in this repo to be used.
  That click has to come from the button itself, a direct user gesture —
  triggering it as a synthetic click from the `<select>`'s own `change` event
  (the original approach) risked being silently blocked in the SketchUp
  sidebar webview, since a `<select>` changing isn't a gesture on the file
  input.
- **"Add Spaces by Theme"** does everything "Add Tags by Theme" does, plus
  actually builds a tagged box (via the same `buildSpace()` used by the
  regular Place Space flow) for every entry in each department's `spaces`
  array — a department with no `spaces` still gets its tag, just no space.
  A space's `targetArea` (free text like `"650 NSF"` or `"25,200 GSF"`) is
  parsed down to a square-footage number and turned into a square footprint
  (`side = sqrt(area)`, converted to inches); a `count` places that many
  copies, spaced out the same way the regular Count/Spacing placement does.
  A space whose `targetArea` doesn't parse is skipped (and named in the
  final status) rather than failing the whole click.
- The **Space** dropdown (below Theme) lists every parseable space in the
  selected theme, grouped by department, and pre-fills Name/Width/Depth/
  Count from picking one — using the same `targetArea` derivation as "Add
  Spaces by Theme" — plus the matching Tag if that department's tag already
  exists in this model. Every field stays editable afterward; this only
  pre-fills the existing Place Space flow, `placeSpaces()` itself is
  unchanged. "Custom…" (the default) leaves the form untouched.

## Themes

A theme is a JSON file describing the tags — one per "department" — a
building type is organized around. Three samples ship in this repo, listed in
[`themes.json`](themes.json):

- [`hospitality_theme.json`](hospitality_theme.json) — a hotel's departments.
- [`multifamily_theme.json`](multifamily_theme.json) — a cold-climate
  market-rate apartment building, with a `spaces` breakdown under each
  department (unit mix, amenity program, BOH, parking).
- [`singleFamily_theme.json`](singleFamily_theme.json) — a single-family
  house's departments (room/private/circulation/utility/active spaces).

[`theme_template.json`](theme_template.json) is the starting point for a new
one — deliberately left out of `themes.json` since it isn't a real theme.
Schema:

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
[`themes.json`](themes.json) to appear in the dropdown, or used as-is via the
"Upload JSON file…" option — no code change required for either.

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
