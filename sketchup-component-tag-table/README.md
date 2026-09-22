# Component Tag Table

A JSA extension that opens a floating, resizable window with a live-updating
table: every component in the model, counted and grouped by tag. Pick which
attribute columns show up, filter down to exactly what you're reviewing, and
the counts update automatically as the model changes — no export, no
spreadsheet. Built from the "Component Count by Tag" PRD (draft v0.4).

Read-only: there is no `operation.*`/`op.*` call anywhere in this extension.
Tags, materials, attributes and the active scene are never touched.

---

## What it does

- Walks the model and counts every `ComponentInstance`, grouped by its own
  tag. Components with no tag land in a synthetic **Untagged** group, so
  tagging gaps surface on their own (user story 4).
- **Columns are user-chosen** from whatever attributes actually exist in the
  model — six built-ins (Tag, Name, Definition Name, Material, GUID,
  Description) plus every Advanced Attribute dictionary/key pair discovered
  while walking the tree, added live as new ones turn up. Add, remove and
  reorder columns; the choice persists across sessions (`localStorage`, this
  browser profile).
- **Numeric columns sum** per tag group; **text columns list unique values**,
  collapsing to `Mixed (N)` past 3 distinct values, click to expand the full
  list (user stories 21–23). A column counts as numeric only if every value
  present for it, across the whole filtered set, parses as a number — there
  is no declared attribute type to read, so this is inferred from the data.
- **Filters reuse the same field/match-type/text pattern** as
  [Instance Color Rules](../sketchup-tag-color-viewer)'s rule editor — pick a
  field (any built-in or Advanced Attribute, including Tag itself), a match
  type (Contains / Equals / Starts with / Ends with), and a value. Multiple
  filters on the **same** field OR together (e.g. two Tag filters = "Doors
  or Windows" — user story 10); filters on **different** fields AND together
  (e.g. Tag = Doors AND Phase = 2 — user story 13). Filters on a field that
  isn't currently a shown column still apply and still show up in the active
  filters summary (user story 14). "Clear all" resets in one click, and an
  empty result shows a clear "no components match" message instead of a
  blank table.
- **Updates live** via `SketchUpApi.observeActiveModel`, the same debounced
  push-notification pattern proven in Instance Color Rules — no clicking
  Refresh after every edit, though Refresh remains as a manual fallback.

## PRD decisions made for v1

The PRD (draft v0.4) left several items as open placeholders. These were
resolved for this build:

| Question | Decision | Why |
|---|---|---|
| Grouping depth (tag only vs. tag → definition) | **Tag only** | User decision — keeps the table to one row per tag; definition-level breakdown can be a later addition if needed. |
| Live update vs. manual refresh | **Live**, with manual Refresh as fallback | Matches Instance Color Rules' proven pattern; a "live inventory" that goes stale the moment you keep modeling defeats the PRD's own framing. |
| Filter combination logic | **OR within one field, AND across fields** | Satisfies both "filter by one or more tags" (story 10) and "combine tag and attribute filters" (story 13) without a separate AND/OR toggle UI — see the filter section above. |
| Row-to-model selection (story 25) | **Out of scope for v1** | User decision, consistent with the PRD's own "Out of Scope" section (read-only view in v1). |
| Nested components (open question 3) | **Counted individually**, not rolled into their parent, keyed by each component's own tag | A nested sub-component can carry a different tag than its parent assembly; collapsing that away would hide exactly the kind of tagging inconsistency this tool exists to surface. |
| Hidden components/tags (open question 4) | **Counted** — visibility is not read at all | This is an inventory/QA tool; a component that's merely hidden in the current view is still part of the model's contents. |
| Column persistence scope (story 24) | **Per browser profile** (`localStorage`), not per model or per scene | Matches every other extension in this repo's own persistence choice (Instance Color Rules' rules, this extension's own filters). Does not sync across devices/sessions. |
| Numeric vs. text detection (open question 6) | **Inferred from values**: numeric only if every present value, across the filtered set, parses as a number | Advanced Attributes carry no reliable declared type to read instead. |
| Client target | Runs anywhere JSA runs (Web, Desktop, iPad) — same as every other extension in this repo | No client-specific code; nothing in this build depends on a platform capability. |

## Layout

```
sketchup-component-tag-table/
├── manifest.json     # JSA manifest — one floating-window command
├── index.html        # markup + style link + script tags
├── style.css          # toolbar/table styling
├── logic.js           # pure logic: fields, filtering, grouping, aggregation — no DOM/JSA
├── app.js              # model walk (JSA calls) + DOM wiring; imports logic.js
├── icon.svg             # extension + command icon
└── verify/               # pure-logic + DOM sanity tests
    ├── verify.mjs         # imports logic.js directly, 31 assertions
    ├── verify-dom.mjs      # loads the real index.html/app.js into jsdom
    └── package.json
```

`logic.js` and `app.js` are both real ES modules (`<script type="module">`),
not the single-file-inlined pattern Instance Color Rules had to use — this
repo no longer ships extensions as a drag-and-drop zip (see
[docs/CONVENTIONS.md](../docs/CONVENTIONS.md)), so relative `<script src>`/
`import` paths resolve normally and files can be split freely.

## JSA APIs used

| API | Used for |
|---|---|
| `SketchUpApi.connect()` / `.getActiveModel()` / `.disconnect()` | session lifecycle |
| `SketchUpApi.observeActiveModel(callback)` | live updates |
| `model.entities.get()` (on `Model`, `Group`, `ComponentDefinition`) | recursive tree walk |
| `model.findEntity(ref)` | resolve a `ComponentInstance.definition` to its `ComponentDefinition` |
| `model.refresh()` | re-snapshot before a manual Refresh |
| `model.getTagManager()` | resolve `tagId` → tag name |
| `model.getMaterials()` → `Materials.findMaterialById(id)` | resolve `materialId` → material name |
| `ComponentInstance.name` / `.tagId` / `.materialId` / `.guid` / `.description` / `.definition` | per-component built-in fields |
| `ComponentDefinition.name` | the Definition Name field |
| `entity.attributes.allDictionaries` | every Advanced Attribute on an instance or its definition |

## Verification

```bash
cd sketchup-component-tag-table/verify
npm install
npm test
```

`verify.mjs` (31 assertions) covers field id encode/decode, attribute
flattening/merging, filter matching (all four match types, non-string value
coercion), the OR-within-field/AND-across-field filter combination, tag
grouping (Untagged sentinel, sort order), numeric-value/numeric-field
detection, and column aggregation (empty/sum/single/list/mixed, including the
`Mixed (N)` threshold and its expand-on-demand formatting).

`verify-dom.mjs` loads the real shipped `index.html` into jsdom and confirms
every element id `app.js` looks up actually exists in the markup, starting
UI state (banners hidden, Refresh disabled, empty containers), plus two
regression guards: this extension stays read-only (no `operation.*`/
`performOperation` call anywhere), and the live-update handle is stopped via
`.stop()` rather than a nonexistent `.end()` — the same ObserverHandle
method-name mistake `sketchup-tag-color-viewer`'s own history already caught
once (its `JSA_API_COMPLETE.md` reference claims `.end()`; the real object
exposes `.stop()`/`.endStream()`).

**Not covered, and why:** the live `SketchUpApi.connect()` handshake and
`observeActiveModel` push notifications against a real model — this needs a
real SketchUp session to exercise, the same limitation noted in Instance
Color Rules' own README. **Not yet tested inside a real SketchUp session.**

## Limitations

- Only `ComponentInstance` entities are counted — raw geometry (faces,
  edges) and `Group`s are not components and are walked through but never
  counted themselves.
- No row-to-model selection yet (clicking a row doesn't select those
  components in the viewport) — out of scope for v1, see the decisions
  table above.
- No CSV/Excel export and no tag/component editing from the table — both are
  explicitly out of scope per the PRD.
- Advanced Attribute discovery only offers fields the model walk has already
  found by the time you open a field picker; a brand-new attribute on
  geometry not yet encountered won't appear until the next read (Refresh, or
  the next live-update tick) surfaces it — same caveat Instance Color Rules
  documents for the same reason.
- Stops at 200,000 components (`MAX_COMPONENTS`) and says so in the footer
  banner, for the same "don't hang on a pathological model" reason Instance
  Color Rules caps at 1.5M triangles.
