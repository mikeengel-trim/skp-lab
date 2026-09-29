# Repository Feature Roadmap

## 🛠 Workflow Rules (Read First)
1. **Branching:** Before writing any code for a user story, check the git branch. If you are on `main` or `master`, create and switch to a new branch named `feature/[story-id]-[short-description]` (e.g., `feature/us-201-component-table-rename`).
2. **Focus:** Work on exactly **one user story** at a time. Do not jump ahead.
3. **Sign-off:** A story is only complete when all of its *Acceptance Criteria* pass and any breaking test failures are resolved. Update the checkbox to `[x]`, commit the changes locally, and wait for my instruction before starting the next story.

---
# Notes to User - Agents to ignore

Sample prompt to kickoff work by claude based on the Todo.md 
"Please read our todo.md file. Follow the Workflow Rules to verify your active branch, spin up a new feature branch for [US-201], and then execute the tasks needed to generalize the repository name and documentation from 'Component Tag Table' to 'Component Table'. Let me know when you've successfully created the branch and modified the files."
---

## 📋 User Stories

### [US-201] Generalize Project to 'Component Table'
* **As a** Developer and Extension User  
* **I want** the extension name, descriptions, and UI headers generalized from "Component Tag Table" to "Component Table"  
* **So that** the tool is understood as a generic component matrix rather than a utility strictly limited to sorting by SketchUp tags.

#### Acceptance Criteria
- [x] **Repository Configuration:** Update the directory name or references within metadata files (like `manifest.json` and `package.json`) to reflect the new `sketchup-component-table` naming schema.
- [x] **User Interface Headers:** Change the primary application header text in `index.html` from "Component Tag Table" or "Component Count by Tag" to "Component Table".
- [x] **Documentation Updates:** Rewrite the `README.md` file to scrub explicit "Tag Table" terminology. Redraft sentences to frame *tags* as just one example of an attribute column or grouping constraint rather than the core architecture.
- [x] **Code Refactoring:** Audit `app.js`, `logic.js`, and the test suites (`verify/verify.mjs`, `verify/verify-dom.mjs`) for variable names, comments, or hardcoded strings that explicitly pigeonhole the extension as tag-exclusive, updating them to generic component nomenclature.
- [x] **Test Pipeline:** Ensure that running `npm test` inside the `/verify` directory passes with 0 failures after strings and references have been updated.

### [US-202] Add "Does Not Equal" and "Does Not Contain" Filter Match Types
* **As a** Developer and Extension User
* **I want** two additional filter match types — "Does not equal" and "Does not contain" — alongside the existing Contains / Equals / Starts with / Ends with
* **So that** I can exclude components (e.g. "Tag does not equal Doors", "Description does not contain draft") instead of only ever narrowing down to positive matches.

**Open Design Question (resolve before/while implementing, do not silently guess):** Filters on the *same* field currently combine with OR (`groupFiltersByField` in `logic.js`), which is correct for two positive filters (e.g. "Tag equals Doors" OR "Tag equals Windows"). Mixing a positive and a negated match type on the same field under OR produces confusing results (e.g. "Tag equals Doors" OR "Tag does not equal Doors" matches everything). Decide and document: (a) negated filters combine with AND instead of OR when mixed with other filters on the same field, (b) negated filters are restricted to their own field slot / can't be combined with a positive filter on that field in the UI, or (c) some other explicit rule — then add test coverage in `verify/verify.mjs` proving the chosen behavior.

#### Acceptance Criteria
- [ ] **Match Type Options:** Add `notEquals` and `notContains` to the filter match-type list in `logic.js` (`filterMatches`) and to the corresponding `<select>` options rendered in `app.js`/`index.html`.
- [ ] **Null/Undefined Handling:** Decide and document how `notEquals`/`notContains` treat a component where the field's value is `null`/`undefined` (i.e., the field doesn't apply/exist on that component) — currently `filterMatches` short-circuits to `false` for any match type when the value is missing, which would silently exclude "does not equal" results a user would expect to see. Update `filterMatches` accordingly.
- [ ] **Combination Rule Resolved:** Implement and document the same-field combination rule from the Open Design Question above, so mixing positive and negated filters on one field behaves predictably rather than accidentally matching everything or nothing.
- [ ] **UI:** The filter row's match-type dropdown includes both new options with clear labels ("Does not equal", "Does not contain"), consistent with the existing four options' styling and behavior (including the active-filters summary text shown for filters on fields not currently displayed as columns — see US-201's parent feature notes).
- [ ] **Test Coverage:** `verify/verify.mjs` includes assertions for `notEquals` and `notContains`, covering: a matching case, a non-matching case, and the chosen null/undefined behavior.
- [ ] **Test Pipeline:** `npm test` inside `/verify` passes with 0 failures.

### [US-203] Optional Definition-Level Grouping (Tag → Definition Name)
* **As a** Developer and Extension User
* **I want** an optional second grouping level so the table can break each tag group down further by Definition Name
* **So that** I can see not just how many components are on a tag, but which component definitions make up that count — something the v1 PRD explicitly deferred ("Grouping depth... Tag only... definition-level breakdown can be a later addition if needed", per `README.md`).

#### Acceptance Criteria
- [ ] **Toggle:** Add a UI control (e.g. a checkbox/toggle near the existing column picker) to switch between "Tag only" (current v1 behavior, default) and "Tag → Definition Name" grouping.
- [ ] **Grouping Logic:** Extend the grouping logic in `logic.js` to produce a two-level structure (tag group containing definition-name sub-rows) without breaking the existing single-level grouping path or its numeric-sum / text-list aggregation rules.
- [ ] **Untagged Handling:** The synthetic "Untagged" group (see main feature notes) still works correctly when definition-level grouping is on, breaking down by Definition Name within "Untagged" the same as any other tag.
- [ ] **Persistence:** The chosen grouping mode persists across sessions the same way column selection does (`localStorage`, per browser profile — matching the existing precedent noted in `README.md`).
- [ ] **Test Coverage:** `verify/verify.mjs` includes assertions for two-level grouping output, including an Untagged + multi-definition case.
- [ ] **Test Pipeline:** `npm test` inside `/verify` passes with 0 failures.

### [US-204] Row Selection Selects Matching Components in the Model
* **As an** Extension User
* **I want** clicking a row in the table to select the matching component instances in the SketchUp model
* **So that** I can jump from an inventory finding (e.g. "these 12 untagged components") straight to seeing/editing them in the model, without this becoming a general-purpose selection or editing tool.

**Note:** This was explicitly out of scope for v1 ("Row-to-model selection (story 25) — Out of scope for v1", per `README.md`'s PRD decisions table) and the extension is currently read-only with zero `operation.*`/`op.*` calls. Selecting entities is a `Selection` API call, not an `operation.*` mutation, so this can be added without breaking the "read-only, no model mutation" guarantee — but that distinction should be called out explicitly in `README.md` when this ships, since the README currently states there is no such call anywhere in the extension.

#### Acceptance Criteria
- [x] **Click-to-Select:** Clicking a table row selects the corresponding component instance(s) in the active SketchUp model (via the JSA `Selection` API), replacing the current selection.
- [x] **Scope Clarity:** Clicking a tag-group summary row (vs. an individual component row, if the table distinguishes them) selects all component instances in that group.
- [x] **No Mutation:** Confirm and document that this feature uses only selection APIs, not `operation.*`/`op.*` calls — update the "Read-only" claim in `README.md`'s intro to scope it accurately (e.g. "no model *mutation*" rather than implying selection is also excluded).
- [x] **Test Coverage:** `verify/verify-dom.mjs` includes a test simulating a row click and asserting the expected selection call/arguments (mocking the JSA `Selection` API as needed).
- [x] **Test Pipeline:** `npm test` inside `/verify` passes with 0 failures.

### [US-205] Expand DOM/Integration Test Coverage in `verify-dom.mjs`
* **As a** Developer
* **I want** meaningfully broader test coverage in `verify/verify-dom.mjs`
* **So that** the DOM wiring and UI behavior in `app.js` (column picker, filter rows, live-update rendering) has real regression protection, not just the pure logic in `logic.js`.

**Context:** `verify/verify.mjs` (pure logic — filtering, grouping, aggregation) currently carries the bulk of test assertions, while `verify/verify-dom.mjs` (which loads the real `index.html`/`app.js` into `jsdom`, per `README.md`'s Layout section) has only a couple of assertions. That leaves the actual UI wiring — adding/removing filter rows, toggling columns, rendering the Mixed (N) expand/collapse interaction, the "no components match" empty state — effectively untested.

#### Acceptance Criteria
- [ ] **Coverage Audit:** Identify the DOM-facing behaviors currently untested (at minimum: adding/removing a filter row, adding/removing/reordering a column, the Mixed (N) expand-to-full-list click, and the empty "no components match" state) and list them explicitly in the PR description.
- [ ] **New Assertions:** Add `jsdom`-based assertions in `verify/verify-dom.mjs` for each behavior identified above.
- [ ] **No Regressions:** Existing assertions in both `verify.mjs` and `verify-dom.mjs` continue to pass unmodified (unless a genuine bug is found and fixed, in which case note it separately).
- [ ] **Test Pipeline:** `npm test` inside `/verify` passes with 0 failures.

### [US-206] Expand Built-In Fields (Transform, Size, Area, and Others), Including Sub-Attributes
* **As a** Developer and Extension User
* **I want** more of a component's built-in (non-Advanced-Attribute) properties available as columns/filters — starting with Transform, Size, and Area — with composite properties broken out into their own sub-fields (e.g. Transform's X/Y/Z)
* **So that** I can inventory and filter on geometric/placement properties, not just tag/name/material/identity fields.

**Note:** "Instance name" already exists today as the built-in `name` field (labeled "Name" — see `BUILTIN_FIELDS` in `logic.js`, sourced from `instance.name` in `app.js`). No change needed there; listed here only so it's not mistaken for a gap.

**Open Spike — resolve before implementing, do not guess the API shape:** The exact JSA surface for these isn't confirmed anywhere in this repo (no sibling extension under `sketchup-tag-color-viewer`, `sketchup-space-creator`, or `sketchup-north-arrow` reads transform, bounding box, or area today). Before writing `getFieldValue` cases, confirm against the live JSA API reference:
  - `ComponentInstance.transformation` (or similar) — what shape does it return (matrix vs. decomposed translation/rotation/scale), and what are the actual X/Y/Z accessors?
  - Whether "Size" means a `ComponentDefinition`/`ComponentInstance` bounding-box property already exposed by JSA, or something that must be computed from geometry — and if computed, whether that's cheap enough to run live on every model-change callback (`observeActiveModel`) without visible lag on large models.
  - Whether "Area" is a real built-in property (e.g. summed face area) or would also need to be computed — same live-update performance question applies.
  - A full audit of what other built-in `ComponentInstance`/`ComponentDefinition` properties JSA exposes that would be reasonable additions here (the story's own ask — "others like this may also exist" — is itself the first acceptance criterion below, not a rhetorical aside).
  Record the answers (and which properties are in/out of scope for this story vs. deferred) before writing code.

#### Acceptance Criteria
- [ ] **Field Audit:** Produce and record (in the PR description or a repo doc) the list of additional built-in `ComponentInstance`/`ComponentDefinition` properties JSA actually exposes, beyond the six already in `BUILTIN_FIELDS` — confirming Transform, Size, and Area are real, and noting any others found.
- [ ] **Composite Fields Decomposed:** Any built-in that is itself a composite value (Transform → X/Y/Z translation at minimum; note whether rotation/scale components should also be exposed, per the audit) is added as separate sub-fields rather than one opaque field — consistent with how columns/filters already operate on single scalar values elsewhere in this extension.
- [ ] **Field IDs & Labels:** New built-in (including sub-)fields are added to `BUILTIN_FIELDS` (or an equivalent structure if flat `BUILTIN_FIELDS` doesn't cleanly support composites — see audit) with clear labels (e.g. "Transform → X", "Transform → Y", "Transform → Z", "Size", "Area"), following the existing `label` convention.
- [ ] **`getFieldValue` Support:** `getFieldValue` in `logic.js` returns the correct value for every new field, including `null` for components where the property doesn't apply (matching existing behavior for missing fields).
- [ ] **Numeric Aggregation:** Confirm the new fields (Transform X/Y/Z, Size, Area are all numeric) are summed correctly per tag group under the existing numeric-column aggregation rule, and format sensibly (units, decimal precision) rather than raw floating-point noise.
- [ ] **Live Update Performance:** If any new field requires computing a value (not just reading a stored property), verify it doesn't introduce a noticeable lag in the live-update path (`observeActiveModel`) on a reasonably large model; document the finding.
- [ ] **Filtering:** New fields work with the full existing filter match-type set (Contains/Equals/Starts with/Ends with, plus Does not equal/Does not contain from US-202 if that has landed first).
- [ ] **Test Coverage:** `verify/verify.mjs` includes assertions for `getFieldValue` on each new field (including the composite sub-fields) and for numeric aggregation of at least one of them.
- [ ] **Test Pipeline:** `npm test` inside `/verify` passes with 0 failures.

### [US-207] Save Named Table Configurations for Future Sessions
* **As an** Extension User
* **I want** to save the current table setup (columns, filters, and grouping mode once US-203 lands) under a name, so it's stored persistently
* **So that** I can build a table once for a specific review purpose (e.g. "Untagged Audit", "Door Schedule") and come back to it in a later session without reconfiguring columns and filters from scratch.

**Relationship to existing auto-save (do not silently conflict with it):** `app.js` already auto-saves the *current, unnamed* working state (`columns`/`filters`) to `localStorage` under a single `STORAGE_KEY` via `loadState()`/`saveState()`, and restores it automatically on open — see `app.js:138-164`. This story adds *named, explicitly-saved* configurations on top of that; it does not replace it. Decide and document: does the auto-restored "last session" state remain a separate, unnamed "current" slot alongside the named saved list, or does opening the extension always land on the last-*selected* named table (if any) instead of the raw last-edited state? Either is defensible — pick one and note the reasoning, don't leave it ambiguous in the implementation.

#### Acceptance Criteria
- [ ] **Save Action:** Add a "Save table as..." action that prompts for a name and stores the current columns, active filters, and (if landed) grouping mode as a named entry, persisted in `localStorage` (a new key/structure, e.g. a list of `{ id, name, columns, filters, groupingMode, savedAt }`, separate from the existing single auto-save `STORAGE_KEY`).
- [ ] **Overwrite Existing:** Saving under a name that already exists prompts for confirmation before overwriting rather than silently creating a duplicate or silently overwriting.
- [ ] **Rename / Delete:** Users can rename and delete a previously saved table configuration.
- [ ] **Scope:** Saved configurations persist per browser profile (`localStorage`), matching the existing persistence scope for columns/filters noted in `README.md` — not synced across devices/sessions.
- [ ] **Advanced Attribute Fields Missing on Load:** If a saved configuration references an Advanced Attribute column/filter field that isn't discovered in the currently-open model (per `README.md`'s note that Advanced Attribute fields are discovered live while walking the tree), loading it degrades gracefully — the missing field is dropped or shown as unavailable rather than crashing the table.
- [ ] **Test Coverage:** `verify/verify.mjs` and/or `verify/verify-dom.mjs` cover: saving a configuration, overwrite confirmation, rename, delete, and loading a configuration that references a since-removed Advanced Attribute field.
- [ ] **Test Pipeline:** `npm test` inside `/verify` passes with 0 failures.

### [US-208] Dropdown to Select and Load a Saved Table Configuration
* **As an** Extension User
* **I want** a dropdown listing my saved table configurations (from US-207), letting me pick one to load
* **So that** I can switch between different saved views (e.g. "Untagged Audit" vs. "Door Schedule") in a couple of clicks instead of manually rebuilding columns and filters each time.

**Depends on US-207** (the saved-configuration storage this dropdown reads from and writes the "currently selected" pointer to).

#### Acceptance Criteria
- [ ] **Dropdown UI:** Add a dropdown (near the existing column picker/filter controls) listing every saved table configuration by name, sorted in a sensible order (e.g. most-recently-saved or alphabetical — pick one and document it).
- [ ] **Load on Select:** Selecting an entry replaces the current columns, filters, and grouping mode with the saved configuration's values and re-renders the table immediately.
- [ ] **Unsaved-Changes Handling:** If the user has made changes since the last save/load and switches to a different saved configuration (or a "Current (unsaved)" option, if that concept exists per US-207's open question), decide and document whether unsaved changes are silently discarded, confirmed with a prompt, or auto-saved back — don't leave this undefined.
- [ ] **Empty State:** If no configurations have been saved yet, the dropdown reflects that clearly (e.g. disabled with placeholder text, or hidden until at least one exists) rather than showing an empty/broken list.
- [ ] **Stays in Sync:** Renaming, deleting, or saving a new configuration (US-207) updates the dropdown's contents without requiring a reload of the extension window.
- [ ] **Test Coverage:** `verify/verify-dom.mjs` covers: populating the dropdown from saved configurations, selecting an entry loads its columns/filters, and the empty-state rendering.
- [ ] **Test Pipeline:** `npm test` inside `/verify` passes with 0 failures.

### [US-209] Calculated Columns from a User-Defined Formula
* **As an** Extension User
* **I want** to define a custom column backed by a formula I write (referencing other fields), computed on demand from live component data rather than stored
* **So that** I can derive values the model doesn't expose directly (e.g. a unit-cost field times a quantity attribute, or a size field converted to another unit) without this extension writing anything back to the model.

**Design fit with existing architecture:** Every existing column/filter already flows through the single `getFieldValue(component, fieldId)` seam in `logic.js`, which is what lets filtering, numeric-vs-text detection (`isFieldNumeric`), and aggregation (`aggregateColumn`) all work generically for any field id. A calculated field should plug into that same seam — i.e. `getFieldValue` evaluates the stored formula for a calculated field id — so it automatically gets filtering, aggregation, and the numeric-sum vs. text-list behavior "for free," exactly like an Advanced Attribute field does today. Confirm this holds during implementation rather than bolting on a parallel code path.

**Open Design Questions (resolve before/while implementing, do not silently guess):**
- **Formula language and evaluation:** Do **not** implement this with `eval()` or `new Function()` against raw user input — that's a real code-injection surface (the formula string could originate from a saved/shared table config per US-207/208, i.e. untrusted-ish input loaded automatically). Use a small, safe expression parser/evaluator (a minimal arithmetic-expression grammar supporting `+ - * / ()`, comparisons, and field references) — either hand-rolled (the expression grammar needed here is small) or a vetted, audited library. Decide and document the chosen approach.
- **Field reference syntax:** How does a formula reference another field's value — e.g. `{Tag}`, `[Tag]`, or by field id? Must work for built-in fields, Advanced Attribute fields, and (once US-206 lands) sub-fields like Transform X. Decide a syntax and document it in-product (e.g. a short help hint in the formula input UI).
- **Referencing other calculated columns / circular references:** Decide whether a calculated column can reference another calculated column, and if so, detect and reject circular references (A references B references A) with a clear error rather than infinite recursion or a crash.
- **Result type:** A calculated column's result should feed into `isFieldNumeric`/`aggregateColumn` like any other field — decide whether a formula declares its expected type or it's inferred from evaluated results the same way other fields are today (README's PRD note on inferred-not-declared typing).
- **Per-component errors:** If a formula fails for a given component (e.g. references a field that component doesn't have, divide-by-zero, non-numeric operand in an arithmetic op), decide the per-cell behavior (blank, an explicit "Error" marker) — it must not throw and break rendering for the whole table.

#### Acceptance Criteria
- [ ] **Add Calculated Column UI:** A UI flow to define a calculated column: a name/label and a formula input, added alongside the existing column picker.
- [ ] **Safe Evaluation:** Formulas are evaluated through a safe parser/evaluator (no `eval`/`new Function` on raw user input), per the Open Design Question above.
- [ ] **On-Demand, Not Stored:** Calculated values are computed at render/aggregation time from current component field values — nothing is written to the model or cached as a stored value that could go stale as the model changes (consistent with this extension's existing live-update, read-only design).
- [ ] **Integrates with Existing Pipeline:** Calculated columns work with filtering, numeric-sum vs. text-list aggregation, and the Mixed (N) expand behavior the same as any other column, via the shared `getFieldValue` seam.
- [ ] **Error Handling:** A formula error for a given component (bad reference, divide-by-zero, etc.) renders a clear per-cell indicator rather than crashing the table or silently showing a wrong value; a completely invalid formula (fails to parse) is flagged in the column-definition UI itself, before it's added.
- [ ] **Persistence:** Calculated column definitions (name + formula) persist the same way regular column selections do (`localStorage`), and are included when saving/loading a named table configuration (US-207/US-208).
- [ ] **Test Coverage:** `verify/verify.mjs` includes assertions for: a valid formula referencing built-in and Advanced Attribute fields, a formula with a per-component error, numeric aggregation of a calculated column, and rejection of a circular reference (if supported per the design question above).
- [ ] **Test Pipeline:** `npm test` inside `/verify` passes with 0 failures.
