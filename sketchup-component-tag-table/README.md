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

- Walks the model and counts every `ComponentInstance`, **grouped by
  whatever field you pick** via a "Group by" control (US-210/US-211) —
  built-in or Advanced Attribute, defaulting to Tag for continuity with v1,
  but no field is structurally special anymore: Tag is just another
  selectable/filterable/groupable field like Material or a custom
  attribute. A component whose group-by field is missing/blank lands in a
  fallback bucket — worded **Untagged** specifically when grouping by Tag
  (unchanged from v1, so tagging gaps still surface on their own — user
  story 4), or a generic **(blank)** for every other field.
- **Columns are user-chosen** from whatever attributes actually exist in the
  model — twelve built-ins (Tag, Name, Definition Name, Material, GUID,
  Description, plus Transform → X/Y/Z and Size → Width/Height/Depth — see
  below) plus every Advanced Attribute dictionary/key pair discovered while
  walking the tree, added live as new ones turn up. Add, remove and reorder
  columns; the choice persists across sessions (`localStorage`, this browser
  profile).
- **Transform and Size fields** (US-206) expose each component's placement
  and bounding-box dimensions as six scalar built-ins — `Transform → X/Y/Z`
  (the instance's translation) and `Size → Width/Height/Depth` (its
  `BoundingBox`) — decomposed the same way every other field here is a
  single value, rather than one opaque "transform" column. Both read
  directly off already-present `ComponentInstance` properties (`.transform`,
  `.bounds`), so there's no extra computation or live-update cost beyond
  what this walk already does per instance. Values are SketchUp's raw
  internal inches (no unit conversion), and summed values are rounded to 4
  decimal places for display so real geometry doesn't show up as
  floating-point noise (e.g. `47.999999999997` displays as `48`). **Area is
  deliberately not included** — see the PRD decisions table below for why.
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
- **Optional second grouping level: `<group field>` → Definition Name**
  (US-203, generalized in US-211). A "`<field>` → Definition Name" checkbox
  in the Grouping toolbar switches each top-level group into one row per
  Definition Name found within it, with per-column aggregation computed at
  that sub-group level instead of the whole group. Its label names whichever
  field is currently the primary group-by choice, but the second level
  itself always stays Definition Name — see the "Grouping: relationship to
  the two-level toggle" decision below for why. Off by default (v1's
  original "Tag only" behavior, and the shape every existing single-level
  caller still gets when the option is omitted). A group's blank/fallback
  bucket breaks down by Definition Name the same as any real value; a
  component missing its own Definition Name falls into its own
  `(No Definition Name)` fallback bucket (distinct from the primary field's
  own blank bucket, since it's a different field), sorted last within its
  group the same way the primary blank bucket sorts last overall. Both the
  group-by field and this toggle's state persist across sessions the same
  way columns do (`localStorage`, this browser profile).
- **Save named table configurations and switch between them** (US-207/
  US-208). A "Saved Tables" toolbar lets you "Save table as…" — capturing
  the current columns, filters, group-by field, and second-level toggle
  under a name — and a dropdown next to it lists every saved table so you
  can jump back to, say, "Untagged Audit" or "Door Schedule" in one click.
  Saving under a name that already exists asks to confirm before
  overwriting; Rename/Delete act on whichever saved table is currently
  selected in the dropdown. This is entirely separate from the existing
  auto-saved *unnamed* working state (still the columns/filters/grouping
  you land on when the extension reopens, unchanged from before this
  story) — named configurations are an explicit, opt-in list layered on
  top, not a replacement for it. Loading a saved table **silently replaces**
  whatever you currently have configured — there's no "unsaved changes"
  prompt, consistent with the rest of this extension never having had that
  concept either (columns/filters already auto-save on every edit); use
  "Save table as…" first if you want to keep your current setup under a
  name before switching. If a saved table references an Advanced Attribute
  field the currently-open model hasn't discovered, loading it drops that
  column/filter (and falls the group-by field back to Tag, if that's what's
  missing) instead of crashing.

## PRD decisions made for v1

The PRD (draft v0.4) left several items as open placeholders. These were
resolved for this build:

| Question | Decision | Why |
|---|---|---|
| Grouping depth (tag only vs. tag → definition) | **Tag only by default, with an opt-in second-level toggle (US-203)** | Originally deferred as "a later addition if needed" — that addition landed as an explicit user toggle rather than a default-on behavior change, so every existing saved column/filter setup keeps rendering exactly as before unless the user turns it on. |
| Live update vs. manual refresh | **Live**, with manual Refresh as fallback | Matches Instance Color Rules' proven pattern; a "live inventory" that goes stale the moment you keep modeling defeats the PRD's own framing. |
| Filter combination logic | **OR within one field, AND across fields** (positive filters); **negated filters (US-202) AND together, and AND against any positive filter on the same field** | Satisfies both "filter by one or more tags" (story 10) and "combine tag and attribute filters" (story 13) without a separate AND/OR toggle UI, while keeping a negated filter from being neutralized by OR-ing with a positive one on the same field — see the filter section above. |
| Negated filter vs. missing value (US-202) | **Does not equal / Does not contain both match a `null`/`undefined` field value** | A component missing the field entirely trivially doesn't equal/contain the filter text; excluding it (as every positive match type does) would silently hide the "no value at all" case a user asking for "does not equal" expects to see. |
| Row-to-model selection (story 25) | **Out of scope for v1, shipped in US-204** | Selecting entities is a `Selection` API call (`model.updateSelection`), not an `operation.*`/`op.*` mutation, so it was addable later without breaking the "no model mutation" guarantee the PRD's "read-only in v1" scope decision was actually protecting. |
| Grouping field (not in the original PRD, added in US-210/US-211) | **Any field is a valid group-by choice, not just Tag** — a "Group by" picker replaces the old fixed Tag-only structure, defaulting to Tag for continuity | The PRD assumed Tag was the table's structural spine; generalizing "Component Count by Tag" into "Component Table" (US-201) wasn't structurally true while grouping stayed hardwired to Tag. See the two Open Design Questions resolved below. |
| Grouping: multi-value/highly-variable field values (US-211 open question) | **Bucket by exact string value** — identical to how Tag grouping already worked, just generalized | Consistent with how this extension already buckets Tag and Definition Name; a different scheme (e.g. tokenizing free text) would be a bigger, separate feature. |
| Grouping: numeric fields (US-211 open question) | **Allowed, bucketed by exact value** — not disallowed in the UI | Numeric fields are more naturally *summed* as a column than grouped, but disallowing grouping by them would be an arbitrary restriction the underlying mechanism doesn't need; a user grouping by a mostly-unique numeric field just gets a lot of small buckets, same as grouping by GUID would. |
| Grouping: relationship to the two-level "→ Definition Name" toggle (US-211 open question) | **The second level stays fixed to Definition Name**, layered on top of whichever field is chosen as the primary group-by | US-211's own notes considered making the second level generic too ("any field → any field"), but that's a materially bigger feature (a second field picker, its own blank-bucket/sort rules, etc.) than "generalize the *first* level" — kept as a possible future story rather than scope-creeping this one. |
| Named configs vs. the existing auto-save (US-207 open question) | **Both, kept separate**: the raw auto-saved unnamed "current" state still restores on open exactly as before; named configurations are an additional, explicitly-saved/loaded list on top, under their own `localStorage` key | Replacing the auto-restored "last session" state with "always land on the last-selected named table" would be a real behavior change for every existing user with zero named tables saved yet; keeping them independent needed no migration and matches how columns/filters already auto-save transparently. |
| Unsaved changes when switching saved tables (US-208 open question) | **Silently discarded, no confirmation prompt** | This extension has never had an "unsaved changes" concept anywhere in its UI — columns/filters/grouping already auto-save on every single edit — so adding a dirty-tracking/confirm flow only for this one dropdown would be an inconsistent, disproportionate addition; "Save table as…" is always available first. |
| Nested components (open question 3) | **Counted individually**, not rolled into their parent, keyed by each component's own tag | A nested sub-component can carry a different tag than its parent assembly; collapsing that away would hide exactly the kind of tagging inconsistency this tool exists to surface. |
| Hidden components/tags (open question 4) | **Counted** — visibility is not read at all | This is an inventory/QA tool; a component that's merely hidden in the current view is still part of the model's contents. |
| Column persistence scope (story 24) | **Per browser profile** (`localStorage`), not per model or per scene | Matches every other extension in this repo's own persistence choice (Instance Color Rules' rules, this extension's own filters). Does not sync across devices/sessions. |
| Numeric vs. text detection (open question 6) | **Inferred from values**: numeric only if every present value, across the filtered set, parses as a number | Advanced Attributes carry no reliable declared type to read instead. |
| Client target | Runs anywhere JSA runs (Web, Desktop, iPad) — same as every other extension in this repo | No client-specific code; nothing in this build depends on a platform capability. |
| Built-in field audit (US-206) | **Transform (X/Y/Z translation) and Size (Width/Height/Depth) are real, already-computed properties** (`ComponentInstance.transform`/`.bounds`) — added as six scalar built-ins. **`locked`/`hidden` are also real** built-in booleans this audit found but did not add: a boolean field doesn't fit this extension's numeric-sum/text-list column model without its own design question this story didn't ask to resolve. | Confirmed against the live JSA API reference plus `sketchup-tag-color-viewer`'s own source-verified corrections to it — that reference doc's prose already claims two properties that don't match the real SDK (`ObserverHandle.end()`, `ComponentInstance.transformation`); both are wrong, the real ones are `.stop()`/`.endStream()` and `.transform`. |
| Area (US-206) | **Not implemented — deferred.** Area is not a real per-component/per-definition property; only `Face.area` exists. Computing a component's area would mean walking its own faces (excluding nested sub-instances') on every read | This extension has no real SketchUp session available to validate whether that per-instance face-walk introduces visible live-update lag on a large model — exactly the risk this story's own spike asked to resolve before implementing. Shipping Transform/Size (both free reads) now and deferring Area until it can be measured against a real model was the responsible call over guessing. |

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
    ├── verify.mjs         # imports logic.js directly, 55 assertions
    ├── verify-dom.mjs      # loads the real index.html/app.js into jsdom, 91 assertions
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
| `ComponentInstance.transform` (not `.transformation`) | Transform → X/Y/Z (US-206) |
| `ComponentInstance.bounds` → `BoundingBox.width`/`.height`/`.depth` | Size → Width/Height/Depth (US-206) |
| `ComponentDefinition.name` | the Definition Name field |
| `entity.attributes.allDictionaries` | every Advanced Attribute on an instance or its definition |

## Verification

```bash
cd sketchup-component-table/verify
npm install
npm test
```

`verify.mjs` (55 assertions) covers field id encode/decode, attribute
flattening/merging, filter matching (all four match types, non-string value
coercion), the OR-within-field/AND-across-field filter combination, generic
field grouping (`groupComponentsByField` — the Tag-preserving `Untagged`
bucket, a non-Tag built-in field, an Advanced Attribute field, the generic
`(blank)` bucket, and the `→ Definition Name` second level composing with
any of those — US-210/US-211), row-to-model selection's
`getSelectionEntities` helper (US-204), saved-table-configuration helpers
`sortSavedConfigs`/`pruneMissingFields` (US-207/US-208), the Transform/Size
built-in fields including their `null`-when-absent behavior (US-206),
numeric-value/numeric-field detection, and column aggregation (empty/sum/
single/list/mixed, including the `Mixed (N)` threshold, its expand-on-demand
formatting, and the 4-decimal-place rounding a summed value gets before
display).

`verify-dom.mjs` (91 assertions) loads the real shipped `index.html` into
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
`ComponentInstance`s across three tags and two materials, `getTagManager`/
`getMaterials`/`entities.get`/`updateSelection` all stubbed), waits for the
app's own `init()` to finish its walk and initial render, then drives it
with real simulated DOM events for the rest of one continuous "session"
(app.js only runs its module-level setup once per process, so every
scenario below reuses the same loaded instance rather than re-importing):
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
- **Generic grouping (US-210/US-211):** Tag renders as a normal selectable
  column option; switching the "Group by" picker to Material re-groups the
  table, relabels the header/footer away from "Tag", and a row click still
  selects the right components for that non-Tag grouping.
- **Transform/Size fields (US-206):** adding the `Transform → X` and
  `Size → Width` columns sums each correctly per tag group from the mocked
  instances' `.transform`/`.bounds`, and a component with neither (the mock
  window) renders the empty `—` dash rather than a stray `0`.
- **Saved table configurations (US-207/US-208):** a config seeded straight
  into the mocked `localStorage` *before* `app.js` is imported (referencing
  an Advanced Attribute field this session never discovers) shows up in the
  dropdown without crashing; the full "Save table as…" → overwrite-
  confirmation → Rename → Delete flow runs through the same inline UI;
  loading a saved config discards an unsaved column change (the decided
  "silently discard" behavior); loading the config with the missing field
  drops it and falls the group-by field back to Tag rather than crashing;
  and deleting every saved config leaves the dropdown in its documented
  empty state.

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
- No Area field (US-206) — not a real per-component property (only
  `Face.area` exists), and computing it would require an unvalidated
  per-instance face-walk on every read; deferred until it can be measured
  against a real model in a real SketchUp session. See the PRD decisions
  table above.
