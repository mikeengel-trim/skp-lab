# Component Table

A JSA extension that opens a floating, resizable window with a live-updating
table: every component in the model, counted and grouped by a chosen
attribute (Tag by default). Pick which attribute columns show up, filter down
to exactly what you're reviewing, and the counts update automatically as the
model changes — no export, no spreadsheet. Built from the "Component Count by
Tag" PRD (draft v0.4).

No model **mutation** anywhere in this extension: there is no `operation.*`/
`op.*` call. Tags, materials, attributes and the active scene are never
edited. Clicking a row *does* call the live `model.updateSelection` API
(US-204) to select components in the model — that's a Selection API call,
not an operation/mutation one, so it changes what's highlighted, never the
model's content.

---

## What it does

- Walks the model and counts every `ComponentInstance`, grouped by tag —
  Tag is the current grouping key, but it's just one column among the same
  set of attributes columns and filters can use; components with no tag land
  in a synthetic **Untagged** group, so tagging gaps surface on their own
  (user story 4).
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
  type (Contains / Does not contain / Equals / Does not equal / Starts with /
  Ends with), and a value. Multiple **positive** filters on the **same**
  field OR together (e.g. two Tag filters = "Doors or Windows" — user story
  10); filters on **different** fields AND together (e.g. Tag = Doors AND
  Phase = 2 — user story 13). **Negated** filters (Does not equal / Does not
  contain) on the same field AND together instead of OR-ing with each other
  or with a positive filter on that field — mixing "Tag equals Doors" with
  "Tag does not equal Doors" under a plain OR would trivially match every
  component, so a negated filter always narrows the result further rather
  than widening it (US-202). A negated filter also matches a component
  missing the field entirely (`null`/`undefined`) — a component with no Tag
  at all does not equal "Doors", so "Tag does not equal Doors" correctly
  includes it, unlike every positive match type, which excludes a missing
  value. Filters on a field that isn't currently a shown column still apply
  and still show up in the active filters summary (user story 14). "Clear
  all" resets in one click, and an empty result shows a clear "no components
  match" message instead of a blank table.
- **Updates live** via `SketchUpApi.observeActiveModel`, the same debounced
  push-notification pattern proven in Instance Color Rules — no clicking
  Refresh after every edit, though Refresh remains as a manual fallback.
- **Click a row to select its components in the model** (US-204), via the
  JSA `Selection` API (`model.updateSelection(entities, 'set')`) — replaces
  whatever is currently selected, the same way clicking an entity directly
  in the viewport does. A tag-group summary row selects every component
  instance in that group; clicking a `Mixed (N)` cell to expand/collapse it
  no longer also re-triggers row selection.
- **Optional second grouping level: Tag → Definition Name** (US-203). A
  "Tag → Definition Name" checkbox in a Grouping toolbar switches each tag
  group into one row per Definition Name found within it, with per-column
  aggregation computed at that sub-group level instead of the whole tag
  group. Off by default (v1's original "Tag only" behavior, and the shape
  every existing single-level caller still gets when the option is
  omitted). The synthetic **Untagged** tag group breaks down by Definition
  Name the same as any real tag; a component missing its own Definition
  Name falls into its own `(No Definition Name)` fallback bucket (distinct
  from Untagged, since it's a different field), sorted last within its tag
  group the same way Untagged sorts last overall. The chosen mode persists
  across sessions the same way columns do (`localStorage`, this browser
  profile).

## PRD decisions made for v1

The PRD (draft v0.4) left several items as open placeholders. These were
resolved for this build:

| Question | Decision | Why |
|---|---|---|
| Grouping depth (tag only vs. tag → definition) | **Tag only by default, with an opt-in "Tag → Definition Name" toggle (US-203)** | Originally deferred as "a later addition if needed" — that addition landed as an explicit user toggle rather than a default-on behavior change, so every existing saved column/filter setup keeps rendering exactly as before unless the user turns it on. |
| Live update vs. manual refresh | **Live**, with manual Refresh as fallback | Matches Instance Color Rules' proven pattern; a "live inventory" that goes stale the moment you keep modeling defeats the PRD's own framing. |
| Filter combination logic | **OR within one field, AND across fields** | Satisfies both "filter by one or more tags" (story 10) and "combine tag and attribute filters" (story 13) without a separate AND/OR toggle UI — see the filter section above. |
| Row-to-model selection (story 25) | **Out of scope for v1, shipped in US-204** | Selecting entities is a `Selection` API call (`model.updateSelection`), not an `operation.*`/`op.*` mutation, so it was addable later without breaking the "no model mutation" guarantee the PRD's "read-only in v1" scope decision was actually protecting. |
| Filter combination logic | **OR within one field, AND across fields** (positive filters); **negated filters (US-202) AND together, and AND against any positive filter on the same field** | Satisfies both "filter by one or more tags" (story 10) and "combine tag and attribute filters" (story 13) without a separate AND/OR toggle UI, while keeping a negated filter from being neutralized by OR-ing with a positive one on the same field — see the filter section above. |
| Negated filter vs. missing value (US-202) | **Does not equal / Does not contain both match a `null`/`undefined` field value** | A component missing the field entirely trivially doesn't equal/contain the filter text; excluding it (as every positive match type does) would silently hide the "no value at all" case a user asking for "does not equal" expects to see. |
| Row-to-model selection (story 25) | **Out of scope for v1** | User decision, consistent with the PRD's own "Out of Scope" section (read-only view in v1). |
| Nested components (open question 3) | **Counted individually**, not rolled into their parent, keyed by each component's own tag | A nested sub-component can carry a different tag than its parent assembly; collapsing that away would hide exactly the kind of tagging inconsistency this tool exists to surface. |
| Hidden components/tags (open question 4) | **Counted** — visibility is not read at all | This is an inventory/QA tool; a component that's merely hidden in the current view is still part of the model's contents. |
| Column persistence scope (story 24) | **Per browser profile** (`localStorage`), not per model or per scene | Matches every other extension in this repo's own persistence choice (Instance Color Rules' rules, this extension's own filters). Does not sync across devices/sessions. |
| Numeric vs. text detection (open question 6) | **Inferred from values**: numeric only if every present value, across the filtered set, parses as a number | Advanced Attributes carry no reliable declared type to read instead. |
| Client target | Runs anywhere JSA runs (Web, Desktop, iPad) — same as every other extension in this repo | No client-specific code; nothing in this build depends on a platform capability. |

## Layout

```
sketchup-component-table/
├── manifest.json     # JSA manifest — one floating-window command
├── index.html        # markup + style link + script tags
├── style.css          # toolbar/table styling
├── logic.js           # pure logic: fields, filtering, grouping, aggregation — no DOM/JSA
├── app.js              # model walk (JSA calls) + DOM wiring; imports logic.js
├── icon.svg             # extension + command icon
└── verify/               # pure-logic + DOM sanity tests
    ├── verify.mjs         # imports logic.js directly, 34 assertions
    ├── verify-dom.mjs      # loads the real index.html/app.js into jsdom, 58 assertions
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
| `model.updateSelection(entities, mode)` | click-to-select (US-204), `mode: 'set'` |
| `ComponentInstance.name` / `.tagId` / `.materialId` / `.guid` / `.description` / `.definition` | per-component built-in fields |
| `ComponentDefinition.name` | the Definition Name field |
| `entity.attributes.allDictionaries` | every Advanced Attribute on an instance or its definition |

## Verification

```bash
cd sketchup-component-table/verify
npm install
npm test
```

`verify.mjs` (34 assertions) covers field id encode/decode, attribute
flattening/merging, filter matching (all four match types, non-string value
coercion), the OR-within-field/AND-across-field filter combination, tag
grouping (Untagged sentinel, sort order), row-to-model selection's
`getSelectionEntities` helper (US-204), numeric-value/numeric-field
detection, and column aggregation (empty/sum/single/list/mixed, including the
`Mixed (N)` threshold and its expand-on-demand formatting).

`verify-dom.mjs` (58 assertions) loads the real shipped `index.html` into
jsdom and confirms every element id `app.js` looks up actually exists in the
markup, starting UI state (banners hidden, Refresh disabled, empty
containers), plus regression guards: this extension makes no model-mutating
call (no `operation.*`/`performOperation` anywhere — `model.updateSelection`
is exempt, see the read-only note above), and the live-update handle is
stopped via `.stop()` rather than a nonexistent `.end()` — the same
ObserverHandle method-name mistake `sketchup-tag-color-viewer`'s own history
already caught once (its `JSA_API_COMPLETE.md` reference claims `.end()`;
the real object exposes `.stop()`/`.endStream()`).

Unlike those checks (which only regex-check `app.js`'s source), the second
half of the file actually **executes** the real shipped `app.js` inside
jsdom: it sets the handful of bare globals `app.js` touches (`document`/
`window`/`localStorage`/`SketchUpApi`/`Option`) to a mocked model (7 mock
`ComponentInstance`s across three tags, `getTagManager`/`getMaterials`/
`entities.get`/`updateSelection` all stubbed), waits for the app's own
`init()` to finish its walk and initial render, then drives it with real
simulated DOM events for the rest of one continuous "session" (app.js only
runs its module-level setup once per process, so every scenario below reuses
the same loaded instance rather than re-importing):
- **Click-to-select (US-204):** a real `click` on a rendered row asserts
  `model.updateSelection` was called with exactly that row's entities and
  `mode: 'set'`, and that clicking a different row replaces rather than
  adds to the selection.
- **Column picker (US-205):** adding a column via `add-column-select`,
  reordering it with a chip's move-left button, and removing it via its ✕.
- **Filter rows (US-205):** adding a filter row (asserting its default
  field/match-type), then removing it.
- **Mixed (N) expand/collapse (US-205):** a column with 4 distinct values
  within one tag group renders `Mixed (4)`; clicking it expands to the full
  comma-joined list, clicking again collapses it back — and a click
  elsewhere in the same row still selects it in the model, confirming the
  mixed-cell's `stopPropagation()` only suppresses its own click.
- **Empty "no components match" state (US-205):** a filter matching no
  components hides the table and shows the empty-state message with the
  right footer count; "Clear all" brings the table back.

This execution approach is possible here specifically because the mocked
JSA calls (Selection, tag/material lookups, the tree walk) are all trivially
stubbable, unlike the WebGL/Three.js dependency that keeps every *other*
extension's own `verify-dom.mjs` from executing its script at all.

**Not covered, and why:** the live `SketchUpApi.connect()` handshake and
`observeActiveModel` push notifications against a real model — this needs a
real SketchUp session to exercise, the same limitation noted in Instance
Color Rules' own README. **Not yet tested inside a real SketchUp session.**

## Limitations

- Only `ComponentInstance` entities are counted — raw geometry (faces,
  edges) and `Group`s are not components and are walked through but never
  counted themselves.
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
