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

## Assumptions worth checking against the real UI

- **`window.type: "sidebar"`** — not exercised by any of the reference
  sample-extensions (they use `floating`, `tab`, or `headless`); unverified
  against the current JSA build, same caveat as `sketchup-hello-world`.
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
- **"Place Space" vs "Place Space + Create New"** both create `count`
  copies with the current form values; the "+ Create New" variant then
  clears just the Name field (keeping dimensions/tag/count) and refocuses it
  for entering the next space. Plain "Place Space" leaves the form untouched.
  The mockup doesn't specify the difference beyond the label, so this is a
  guess at intent.
