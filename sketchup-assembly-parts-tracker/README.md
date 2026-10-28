# Assembly Parts Tracker

A floating JSA panel that lists every top-level Group and ComponentInstance in
the model as a "part", with editable tracking data, and highlights a part in
the model when you click its row. Designed from the Assembly Parts Tracker
mock (Modus look, simplified); runs wherever JSA runs (Desktop, iPad, Web).

## What it does

- **Table** — Unique ID, Part #, Material, Cut Length, Supplier, Installer,
  Status. Status chips with counts, a search box, and an Installed progress bar.
- **Row click → highlight** — `model.updateSelection([entity], 'set')`.
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
- Unverified in a live SketchUp session: attribute read/write on entities from
  `entities.get()`, and `entity.id` formatting. Check these first.

## Load

Point SketchUp at this folder in the repo (see [../docs/CONVENTIONS.md](../docs/CONVENTIONS.md)).
