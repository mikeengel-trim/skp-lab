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

- [ ] **US-101: Space spacing/grid placement**
  As a user placing multiple copies of a space, I want each copy offset from
  the last instead of stacked at the origin, so that I don't have to manually
  drag 50 overlapping boxes apart before I can see or use them.
  - Acceptance Criteria:
    - A spacing input (inches) appears next to the Count control, only when
      Count > 1.
    - Copies are placed in a row along one axis, each offset from the
      previous by `width + spacing` (or a documented equivalent), still
      inside the single `performOperation()` undo step.
    - Count = 1 behaves exactly as it does today (no spacing input shown, no
      offset applied).
    - Existing single-space placement tests continue to pass.

- [ ] **US-102: Tag color swatch in the tag dropdown**
  As a user picking a tag for a new space, I want to see each tag's color
  next to its name, so that I can match the space to the right department at
  a glance instead of reading names only.
  - Acceptance Criteria:
    - The native `<select>` is replaced with a custom dropdown (or
      equivalent) that renders a small color swatch from `tag.color` beside
      each tag name.
    - "Untagged" still appears first with no swatch (or a neutral swatch).
    - Keyboard navigation and the existing `focus`-triggered `loadTags()`
      refresh continue to work with the new control.
    - Selecting a tag still sets the same underlying value used by
      `placeSpaces()`.

- [ ] **US-103: Inline field validation messages**
  As a user filling out the Space Creator form, I want to see which specific
  field is invalid (not just a disabled Place button), so that I know what to
  fix without guessing.
  - Acceptance Criteria:
    - When Name, Width, Depth, or Height fails validation, that field shows
      a visible inline error state (e.g., outline + short message) once the
      user has interacted with it.
    - `updateButtons()`'s existing disabled-state logic is unchanged; this
      adds messaging on top of it, not a new validation path.
    - Errors clear as soon as the field becomes valid, without needing to
      click elsewhere.

- [ ] **US-104: Warn on duplicate space name in the active model**
  As a user placing a space, I want a warning if a definition with the same
  name already exists in the model, so that I don't accidentally create a
  confusing near-duplicate.
  - Acceptance Criteria:
    - Before `placeSpaces()` runs, existing definition names in the model are
      checked against the entered name.
    - On a match, the status area shows a non-blocking warning (placement is
      still allowed, not blocked) explaining the name is already in use.
    - No warning appears for a name that's unique, or on first load before
      any input.

- [ ] **US-105: Remember last-used theme selection**
  As a user who regularly uses the same theme, I want Space Creator to
  reopen with my last-selected bundled theme already chosen, so that I don't
  have to re-pick it every session.
  - Acceptance Criteria:
    - Selecting a bundled theme from the dropdown persists that choice
      (e.g., via local storage) keyed to the extension.
    - On reconnect, the Theme dropdown pre-selects the last bundled theme if
      one was saved; otherwise it defaults as it does today.
    - The "Upload JSON file…" choice is never restored automatically (an
      uploaded file isn't available across sessions) — it always falls back
      to the default state.

- [ ] **US-106: Confirm before placing a large count**
  As a user who bumps Count up with the stepper, I want a confirmation step
  before placing an unusually large number of copies, so that I don't
  accidentally flood the model and have to undo/clean up.
  - Acceptance Criteria:
    - Placing with Count above a defined threshold (e.g., 10) shows a
      confirmation prompt before `placeSpaces()` runs.
    - Confirming proceeds exactly as today, still as one undo step.
    - Declining cancels placement with no model changes and no error status.
    - Count ≤ threshold places immediately with no added prompt, matching
      current behavior.

- [ ] **US-107: Fix "Upload JSON file…" theme option**
  As a user who wants to use a theme that isn't bundled with this repo, I
  want choosing "Upload JSON file…" in the Theme dropdown to actually open a
  native file picker and load my chosen file, so that I can use a custom
  theme without editing `BUNDLED_THEMES` in the code.
  - Acceptance Criteria:
    - Selecting "Upload JSON file…" reliably opens the OS file picker inside
      the SketchUp sidebar webview (confirm `themeFileInput.click()` actually
      fires a picker in this host; if the embedded webview blocks a
      synthetic click from a `<select>`'s `change` event, wire the picker
      off a real user gesture instead — e.g., a visible "Choose file…"
      button — rather than a programmatic click).
    - Picking a valid theme JSON file loads it via the existing
      `readFileAsText` / `parseTheme` path, sets `uploadedTheme`, and updates
      `themeHint` to name the uploaded file, exactly as the current code
      intends.
    - Canceling the file picker leaves the previous theme selection and hint
      text unchanged (no error shown).
    - Picking an invalid file (bad JSON, missing `departments`) shows the
      existing error via `report()` and does not leave the dropdown stuck on
      "Upload JSON file…" with no usable theme.
    - "Add Tags by Theme" works against the uploaded theme afterward, same as
      it does today for bundled themes.

- [ ] **US-108: Auto-populate Theme dropdown from all themes in the repo**
  As a user, I want the Theme dropdown to list every theme file that exists
  in this repo (not just the two hardcoded in `BUNDLED_THEMES`), so that a
  theme added to the project shows up without an app.js code change.
  - Acceptance Criteria:
    - On extension connect (a fresh SketchUp session opening the sidebar,
      same timing as today's initial `loadTags()`/`report('Ready.')` flow),
      the app discovers theme JSON files bundled in the repo and populates
      the Theme dropdown from that list instead of (or in addition to
      validating) the static `BUNDLED_THEMES` array.
    - A theme file added to the repo after the last extension/SketchUp
      session load is picked up the next time the extension is opened or
      SketchUp is relaunched — this is explicitly load-time refresh, not a
      live filesystem watch.
    - Reopening/refocusing the sidebar within the same session does not
      need to re-scan (matches "not fully live" — this is separate from the
      existing `SketchUpApi.ui.on('open', ...)` tag refresh, which stays
      as-is).
    - "Upload JSON file…" remains the last entry in the list in both cases.
    - If theme discovery fails (e.g., can't enumerate repo files at
      runtime), the dropdown falls back to today's static `BUNDLED_THEMES`
      list rather than ending up empty.

- [ ] **US-109: "Add Spaces by Theme" button**
  As a user setting up a new building, I want a button that reads the
  selected theme's `spaces` entries and places an actual tagged space (box)
  for each one — not just creates the department tags — so that I get a
  starting layout instead of an empty, if well-tagged, model.
  - Acceptance Criteria:
    - A new "Add Spaces by Theme" button sits alongside the existing "Add
      Tags by Theme" button and reads the same selected theme (bundled or
      uploaded) via `loadSelectedTheme()`.
    - For every department, any tag that doesn't already exist yet is
      created and colored exactly the way "Add Tags by Theme" does today
      (`getTagByName(...) ?? operation.createTag(...)`, followed by
      `tagSetColor`) — a user should be able to click "Add Spaces by Theme"
      alone, on a model with no tags yet, and end up with the same tags
      "Add Tags by Theme" would have created.
    - For every entry in a department's `spaces` array, one space is built
      via the existing `buildSpace()` and tagged with that department's tag,
      named from the space's `name` (and disambiguated the same way multiple
      placed copies are today, e.g. `"Studio / Micro 1"`, `"...2"`, when a
      `count` is present).
    - A space entry's `count` (e.g., `"Studio / Micro", "count": 30`) places
      that many copies of that space, same spaced/offset placement as
      US-101, not just one box; a missing `count` places exactly one.
    - A department with no `spaces` array (e.g., "Circulation" in
      `multifamily_theme.json`) still gets its tag created/synced, with no
      space placed and no error.
    - **Open question to resolve during implementation:** `targetArea` is a
      free-text string (e.g., `"650 NSF"`, `"25,200 GSF"`), not a
      width/depth pair `buildSpace()` needs. Confirm the derivation before
      building: parse the leading numeric value (stripping commas and any
      trailing unit like `NSF`/`GSF`/`SF`), treat it as square footage, and
      use a square footprint (`side = sqrt(area)`) for width and depth; use
      the form's current Height field for every generated space, since
      themes don't specify one. If a `targetArea` is missing or unparsable,
      skip placing that one space (report which one was skipped) rather
      than failing the whole operation.
    - All tag creation and space placement for one click runs inside a
      single `performOperation()`, matching the one-undo-step pattern used
      by both `placeSpaces()` and `addTagsByTheme()` today.
    - On completion, status reports counts of both tags and spaces created
      (e.g., "Added 5 tags and 12 spaces from theme."), and `loadTags()` is
      re-run so the Tag dropdown reflects any newly created tags.

- [ ] **US-110: Pick a single space from the theme instead of typing one in**
  As a user who wants just one space from the theme (not the whole bulk
  add from US-109), I want a dropdown listing every space defined in the
  selected theme, so that choosing one pre-fills the form instead of me
  retyping a name/size I already wrote into the theme JSON.
  - Acceptance Criteria:
    - A new "Space" dropdown appears in the Theme section, below the Theme
      select. Its first option is "Custom…" (or equivalent), which leaves
      the form exactly as it is today (manual entry, unaffected by this
      story).
    - The dropdown is (re)populated from the currently selected theme's
      `spaces` entries (via the same `loadSelectedTheme()` used by US-109),
      grouped by department (e.g. `<optgroup>` per department name), and
      refreshes whenever the Theme dropdown selection changes.
    - A theme/department with no `spaces` array simply contributes no
      entries — no error.
    - Selecting a space populates the Name field with that space's `name`,
      and Width/Depth using the same `targetArea` → square-footprint
      derivation as US-109 (this story depends on that derivation existing;
      implement together or after US-109). Height is left as whatever the
      user currently has entered — themes don't specify one.
    - If the space entry has a `count`, the Count stepper is set to that
      value (clamped to the existing 1–50 range); otherwise Count is left
      unchanged.
    - Tag handling: if the space's department already has a matching option
      in the Tag dropdown, it's selected automatically. If it doesn't (the
      tag hasn't been created in this model yet), the Tag dropdown falls
      back to "Untagged" and the status/hint area notes the tag isn't
      created yet (pointing at "Add Tags by Theme") — this story does not
      create tags, it only pre-fills the form for the normal Place Space
      flow.
    - After picking a space, every pre-filled field remains editable before
      clicking Place Space — this is a pre-fill convenience, not a
      separate placement path; `placeSpaces()` itself is unchanged.
    - Switching back to "Custom…" does not clear whatever the user has
      since typed/edited.

