# Assembly Parts Tracker

A floating JSA panel that lists every top-level Group and ComponentInstance in
the model as a "part", with editable tracking data, and highlights a part in
the model when you click its row. Designed from the Assembly Parts Tracker
mock (Modus look, simplified); runs wherever JSA runs (Desktop, iPad, Web).

## What it does

- **Table** — Unique ID, Part #, Material, Cut Length, Supplier, Installer,
  Status. Status chips with counts, a search box, and an Installed progress bar.
- **Row click → highlight** — `model.updateSelection([entity], 'replace')`.
- **Finish** — read-only column showing the material applied to the group/
  component in SketchUp (read live from the entity, never stored). Blank (—)
  when no material is applied. Separate from the editable Material column.
- **Edits persist** — values are stored in the `AssemblyParts` attribute
  dictionary on each entity (`partNumber`, `material`, `cutLength`,
  `supplier`, `installer`, `status`), written inside `performOperation`
  ("Edit Part" = one undo step).
- **Live** — re-reads on `observeActiveModel` changes (paused while a cell has
  focus); Refresh is the manual fallback.
- **Fill demo data** — fills empty fields only, for demoing on a bare model.

## Decisions / limits

- **Floating, not modal.** JSA modals block the model, which defeats
  select-to-highlight.
- Only top-level groups/components are rows (no recursion into nesting).
- Unique ID is derived from the entity id (`P-<id>`), nothing is stamped.
- Defaults when unset: Part # = entity name, Material = applied material name,
  Status = Pending.
- "Add Part" and per-row delete from the mock are intentionally omitted.
- Verified on iPad: the panel loads, attribute read/write works, and edited
  values persist after saving and reopening the model. Row selection needed
  `'replace'` (not `'set'`) as the `updateSelection` mode; re-test highlight
  after that fix.

## Load

Point SketchUp at this folder in the repo (see [../docs/CONVENTIONS.md](../docs/CONVENTIONS.md)).
