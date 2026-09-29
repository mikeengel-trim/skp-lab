// Space Creator — defines a named, tagged box and places it in the model.
//
// The box itself is built the same way the space-planning sample builds a
// room: a counter-clockwise floor face, pushed up by height, inside one
// performOperation() per click so the whole batch is one undo step.

const INCHES_PER_FOOT = 12;

// Classifies every space as IfcSpace under the IFC4 schema, so it shows up
// correctly in SketchUp's Entity Info > Advanced Attributes panel and in any
// IFC export. IFC 2x3 is the only other schema the JSA currently supports.
const IFC4_SCHEMA_NAME = 'IFC 4';
const IFC4_SCHEMA_URL = 'https://cdn.habitat.sketchup.com/classifications/schemas/IFC4.skc';
const IFC_SPACE_TYPE = 'IfcSpace';

// Above this many copies, placeSpaces() confirms before proceeding — cheap
// insurance against a stray click on the Count stepper flooding the model.
const LARGE_COUNT_THRESHOLD = 10;

const form = document.getElementById('space-form');
const nameInput = document.getElementById('name');
const nameWarning = document.getElementById('name-warning');
const nameError = document.getElementById('name-error');
const widthFt = document.getElementById('width-ft');
const widthIn = document.getElementById('width-in');
const widthError = document.getElementById('width-error');
const depthFt = document.getElementById('depth-ft');
const depthIn = document.getElementById('depth-in');
const depthError = document.getElementById('depth-error');
const heightFt = document.getElementById('height-ft');
const heightIn = document.getElementById('height-in');
const heightError = document.getElementById('height-error');
const tagSelect = document.getElementById('tag-select');
const tagPickerButton = document.getElementById('tag-picker-button');
const tagPickerLabel = document.getElementById('tag-picker-label');
const tagPickerSwatch = document.getElementById('tag-picker-swatch');
const tagPickerList = document.getElementById('tag-picker-list');
const countValue = document.getElementById('count-value');
const countDown = document.getElementById('count-down');
const countUp = document.getElementById('count-up');
const spacingRow = document.getElementById('spacing-row');
const spacingInput = document.getElementById('spacing-in');
const status = document.getElementById('status');
const placeButton = document.getElementById('place');
const addTagsByThemeButton = document.getElementById('add-tags-by-theme');
const themeSelect = document.getElementById('theme-select');
const spaceSelect = document.getElementById('space-select');
const themeFileInput = document.getElementById('theme-file-input');
const chooseThemeFileButton = document.getElementById('choose-theme-file');
const themeHint = document.getElementById('theme-hint');
const addSpacesByThemeButton = document.getElementById('add-spaces-by-theme');

let count = 1;

function report(message, kind) {
  status.textContent = message;
  status.className = kind ?? '';
}

function setCount(next) {
  count = Math.min(50, Math.max(1, next));
  countValue.textContent = String(count);
  // Spacing only means something once there's more than one copy to space
  // out — keep it out of the way (and out of updateButtons()'s validity
  // checks) the rest of the time.
  spacingRow.hidden = count <= 1;
}

countDown.addEventListener('click', () => setCount(count - 1));
countUp.addEventListener('click', () => setCount(count + 1));

function feetAndInchesToInches(feetField, inchesField) {
  const feet = Number(feetField.value) || 0;
  const inches = Number(inchesField.value) || 0;
  return feet * INCHES_PER_FOOT + inches;
}

// Inverse of feetAndInchesToInches, for pre-filling Width/Depth from a
// theme space's derived footprint (US-110).
function setFeetAndInches(feetField, inchesField, totalInches) {
  const rounded = Math.round(totalInches);
  feetField.value = String(Math.floor(rounded / INCHES_PER_FOOT));
  inchesField.value = String(rounded % INCHES_PER_FOOT);
}

function updateButtons() {
  const ready =
    nameInput.value.trim() !== '' &&
    feetAndInchesToInches(widthFt, widthIn) > 0 &&
    feetAndInchesToInches(depthFt, depthIn) > 0 &&
    feetAndInchesToInches(heightFt, heightIn) > 0;
  placeButton.disabled = !ready;
}

// Which fields the user has interacted with (blurred) at least once — an
// error only shows once a field has been touched, never on first load, and
// re-renders on every input so it clears the instant the field becomes
// valid again, with no separate validation path from updateButtons() above.
const touchedFields = { name: false, width: false, depth: false, height: false };

function setFieldError(container, errorEl, invalid) {
  errorEl.hidden = !invalid;
  container.classList.toggle('field-invalid', invalid);
}

function renderFieldErrors() {
  setFieldError(nameInput, nameError, touchedFields.name && nameInput.value.trim() === '');
  setFieldError(widthFt.closest('.feet-inches'), widthError, touchedFields.width && feetAndInchesToInches(widthFt, widthIn) <= 0);
  setFieldError(depthFt.closest('.feet-inches'), depthError, touchedFields.depth && feetAndInchesToInches(depthFt, depthIn) <= 0);
  setFieldError(heightFt.closest('.feet-inches'), heightError, touchedFields.height && feetAndInchesToInches(heightFt, heightIn) <= 0);
}

function markTouched(field) {
  touchedFields[field] = true;
  renderFieldErrors();
}

form.addEventListener('input', () => {
  updateButtons();
  renderFieldErrors();
});

// Checked on blur rather than on every keystroke: it walks the model's
// entity tree, which isn't free, and a name being momentarily "in progress"
// as the user types shouldn't flash a warning.
nameInput.addEventListener('blur', () => {
  markTouched('name');
  void checkDuplicateName();
});
widthFt.addEventListener('blur', () => markTouched('width'));
widthIn.addEventListener('blur', () => markTouched('width'));
depthFt.addEventListener('blur', () => markTouched('depth'));
depthIn.addEventListener('blur', () => markTouched('depth'));
heightFt.addEventListener('blur', () => markTouched('height'));
heightIn.addEventListener('blur', () => markTouched('height'));

// Refresh right before the user opens the tag picker, so a tag added
// elsewhere while this panel stayed open still shows up without needing to
// reopen it — the same trigger the native <select>'s own focus event used.
tagPickerButton.addEventListener('focus', () => {
  void loadTags();
});

// Loads the model's tags into the dropdown. "Untagged" (no tagRef) is always
// the first option, since a space doesn't have to carry a tag.
//
// TagManager is a point-in-time snapshot, not a live view — it has its own
// refresh() for exactly this reason — so this has to be called again
// whenever the list might be stale, not just once at connect.
// A Tag's color could plausibly come back as a hex string, or as an
// {r,g,b} object (mirroring SketchUp::Color) — handled defensively since
// nothing else in this repo has read a tag's color back before (only ever
// set via Color.fromHex). Anything else unrecognized renders no swatch
// rather than a broken one.
function tagColorToCss(color) {
  if (!color) return undefined;
  if (typeof color === 'string') return color;
  if (typeof color.r === 'number' && typeof color.g === 'number' && typeof color.b === 'number') {
    return `rgb(${color.r}, ${color.g}, ${color.b})`;
  }
  return undefined;
}

async function loadTags() {
  const previousValue = tagSelect.value;

  const model = await SketchUpApi.getActiveModel();
  const tagManager = await model.getTagManager();

  tagSelect.replaceChildren(new Option('Untagged', ''));
  for (const tag of tagManager.tags) {
    // The model's own built-in default tag is also named "Untagged" — skip
    // it so it doesn't duplicate the synthetic "no tag" option above.
    if (tag.name === 'Untagged') continue;
    const option = new Option(tag.name, tag.name);
    const color = tagColorToCss(tag.color);
    if (color) option.dataset.color = color;
    tagSelect.append(option);
  }

  // Keep whatever was selected if it still exists; a tag added elsewhere
  // shouldn't reset a choice the user already made.
  if (tagManager.getTagByName(previousValue) !== undefined) {
    tagSelect.value = previousValue;
  }

  renderTagPicker();
}

// A custom listbox layered over the (now hidden) native <select> above,
// which stays the single source of truth: this only ever reads/writes
// tagSelect.value, so placeSpaces()/applySpaceSelection() need no changes.
function renderTagPicker() {
  tagPickerList.replaceChildren();
  for (const option of tagSelect.options) {
    const item = document.createElement('li');
    item.className = 'tag-picker-option';
    item.setAttribute('role', 'option');
    item.tabIndex = -1;
    item.dataset.value = option.value;

    const swatch = document.createElement('span');
    swatch.classList.add('tag-swatch');
    if (option.dataset.color) {
      swatch.style.backgroundColor = option.dataset.color;
    } else {
      // "Untagged" (and any tag with no readable color) gets a neutral
      // placeholder rather than no swatch at all, per US-102.
      swatch.classList.add('tag-swatch-none');
    }
    item.append(swatch);

    const label = document.createElement('span');
    label.textContent = option.textContent;
    item.append(label);

    item.addEventListener('click', () => selectTagOption(option.value));
    tagPickerList.append(item);
  }
  syncTagPickerButton();
}

function syncTagPickerButton() {
  const selected = tagSelect.options[tagSelect.selectedIndex];
  tagPickerLabel.textContent = selected ? selected.textContent : 'Untagged';
  if (selected?.dataset.color) {
    tagPickerSwatch.style.backgroundColor = selected.dataset.color;
    tagPickerSwatch.classList.remove('tag-swatch-none');
  } else {
    tagPickerSwatch.style.backgroundColor = '';
    tagPickerSwatch.classList.add('tag-swatch-none');
  }
  for (const item of tagPickerList.children) {
    item.setAttribute('aria-selected', String(item.dataset.value === tagSelect.value));
  }
}

function selectTagOption(value) {
  tagSelect.value = value;
  syncTagPickerButton();
  closeTagPicker();
  tagPickerButton.focus();
}

let tagPickerOpen = false;

function openTagPicker() {
  tagPickerOpen = true;
  tagPickerList.hidden = false;
  tagPickerButton.setAttribute('aria-expanded', 'true');
  const items = [...tagPickerList.children];
  const current = items.find(item => item.dataset.value === tagSelect.value) ?? items[0];
  current?.focus();
}

function closeTagPicker() {
  tagPickerOpen = false;
  tagPickerList.hidden = true;
  tagPickerButton.setAttribute('aria-expanded', 'false');
}

tagPickerButton.addEventListener('click', () => {
  if (tagPickerOpen) {
    closeTagPicker();
  } else {
    openTagPicker();
  }
});

// Standard listbox keyboard nav: Up/Down move between options, Home/End
// jump to the ends, Enter/Space selects, Escape closes without changing
// the selection — the "keyboard navigation continues to work" this
// control replaces a native <select>'s built-in behavior with.
tagPickerList.addEventListener('keydown', event => {
  const items = [...tagPickerList.children];
  const currentIndex = items.indexOf(document.activeElement);

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    items[Math.min(items.length - 1, currentIndex + 1)]?.focus();
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    items[Math.max(0, currentIndex - 1)]?.focus();
  } else if (event.key === 'Home') {
    event.preventDefault();
    items[0]?.focus();
  } else if (event.key === 'End') {
    event.preventDefault();
    items[items.length - 1]?.focus();
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    if (items[currentIndex]) selectTagOption(items[currentIndex].dataset.value);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closeTagPicker();
    tagPickerButton.focus();
  }
});

document.addEventListener('click', event => {
  if (tagPickerOpen && !document.getElementById('tag-picker').contains(event.target)) {
    closeTagPicker();
  }
});

// Builds one box: a floor rectangle pushed to height, named and tagged.
//
// Vertex order matters here: confirmed via live testing that this winding
// order is what makes facePushPull(floor, height) extrude upward, leaving
// the base at the origin (z=0) and the top at z=height. The reverse order
// extrudes downward instead, leaving the top at the origin.
async function buildSpace(operation, { width, depth, height, name, tagRef, originX = 0, originY = 0 }) {
  const definition = operation.createDefinition(name);

  const floor = operation.createFace(definition, [
    [originX, originY, 0],
    [originX, originY + depth, 0],
    [originX + width, originY + depth, 0],
    [originX + width, originY, 0],
  ]);

  operation.facePushPull(floor, height);

  const instance = operation.createInstance(operation.model, definition, SketchUpApi.Transformation.IDENTITY);
  operation.instanceSetName(instance, name);

  if (tagRef !== undefined) {
    operation.drawingElementSetTag(instance, tagRef);
  }

  // entityForRef() resolves asynchronously, so .definition has to be read
  // off the awaited entity rather than off the pending promise.
  const entity = await operation.entityForRef(instance);
  operation.definitionAddClassification(entity.definition, IFC4_SCHEMA_NAME, IFC_SPACE_TYPE);
}

// Loads the IFC4 schema into the model if it isn't already, so
// definitionAddClassification(..., IFC4_SCHEMA_NAME, ...) has a schema to
// classify against. Safe to call every time a space is placed: schemas stay
// loaded for the life of the model, so this only pays the load cost once.
async function ensureIfc4SchemaLoaded(model, operation) {
  const classifications = await model.getClassifications();
  const alreadyLoaded = classifications.some(schema => schema.name === IFC4_SCHEMA_NAME);
  if (!alreadyLoaded) {
    await operation.modelLoadSchemaFromUrl(IFC4_SCHEMA_URL);
  }
}

// A theme space's targetArea is free text ("650 NSF", "25,200 GSF", "1,500
// SF") — extracts the leading numeric square-footage value, stripping comma
// thousands separators and a trailing unit. Returns undefined for anything
// that isn't a clean positive number, which callers treat as "unparsable".
function parseTargetAreaSqFt(targetArea) {
  if (typeof targetArea !== 'string') return undefined;
  const match = targetArea.match(/^\s*([\d,]+(?:\.\d+)?)\s*(?:NSF|GSF|SF)?\s*$/i);
  if (!match) return undefined;
  const value = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

// A theme space specifies an area, not a width/depth pair — this app has no
// other basis to prefer one aspect ratio over another, so it uses a square
// footprint: side = sqrt(area). Converts sq ft to sq in (12x12 per sq ft)
// before the square root, since the rest of this app works in inches.
function squareFootprintFromArea(areaSqFt) {
  const sideInches = Math.sqrt(areaSqFt * INCHES_PER_FOOT * INCHES_PER_FOOT);
  return { width: sideInches, depth: sideInches };
}

// Theme-driven placement (US-109) has no single form-level spacing input to
// draw from — each department's spaces are placed as their own row, so this
// is just the gap between copies within one space entry and between rows.
const DEFAULT_THEME_SPACING_IN = 24;

// Places `count` copies of one space, each offset from the last along the
// width axis by `width + spacing` — spacing of 0 (or count === 1) collapses
// back to today's single stacked-at-origin behavior.
async function placeSpacedCopies(operation, { width, depth, height, spacing, count: copyCount, baseName, tagRef, originX = 0, originY = 0 }) {
  for (let i = 0; i < copyCount; i += 1) {
    const instanceName = copyCount === 1 ? baseName : `${baseName} ${i + 1}`;
    await buildSpace(operation, {
      width,
      depth,
      height,
      name: instanceName,
      tagRef,
      originX: originX + i * (width + spacing),
      originY,
    });
  }
}

// Walks the model's entity tree (recursing into Groups, and into each
// distinct ComponentDefinition once) collecting every definition name found,
// so a new space's name can be checked against what's already in the model.
// Mirrors the tree walk sketchup-component-tag-table uses to enumerate
// components (model.entities.get() / model.findEntity()), simplified down to
// just the names this warning needs.
const MAX_NAME_CHECK_DEPTH = 20;

async function collectDefinitionNames(model) {
  const names = new Set();
  const visitedDefinitionIds = new Set();

  async function walk(container, depth) {
    if (depth > MAX_NAME_CHECK_DEPTH) return;
    const children = await container.entities.get();
    for (const child of children) {
      const typeName = child?.constructor?.name || '';
      if (typeName === 'Group') {
        await walk(child, depth + 1);
      } else if (typeName === 'ComponentInstance') {
        const definition = await model.findEntity(child.definition);
        if (definition?.name) names.add(definition.name);
        if (definition && !visitedDefinitionIds.has(definition.id)) {
          visitedDefinitionIds.add(definition.id);
          await walk(definition, depth + 1);
        }
      }
    }
  }

  await walk(model, 0);
  return names;
}

// Non-blocking heads-up, not a validation error: a name matching an existing
// definition is still perfectly placeable, just easy to do by accident (e.g.
// re-running this tool with the same Name left over from last time).
async function checkDuplicateName() {
  const name = nameInput.value.trim();
  if (name === '') {
    nameWarning.hidden = true;
    return;
  }

  const model = await SketchUpApi.getActiveModel();
  const names = await collectDefinitionNames(model);
  nameWarning.textContent = `A space named "${name}" already exists in this model.`;
  nameWarning.hidden = !names.has(name);
}

async function placeSpaces() {
  const name = nameInput.value.trim();
  const width = feetAndInchesToInches(widthFt, widthIn);
  const depth = feetAndInchesToInches(depthFt, depthIn);
  const height = feetAndInchesToInches(heightFt, heightIn);
  const tagName = tagSelect.value;
  const spacing = count > 1 ? Number(spacingInput.value) || 0 : 0;

  await checkDuplicateName();

  if (count > LARGE_COUNT_THRESHOLD) {
    const proceed = window.confirm(`Place ${count} copies of "${name}"? That will add ${count} spaces to the model.`);
    if (!proceed) return false;
  }

  placeButton.disabled = true;
  try {
    const model = await SketchUpApi.getActiveModel();

    await model.performOperation(async operation => {
      await ensureIfc4SchemaLoaded(model, operation);

      let tagRef;
      if (tagName !== '') {
        const tagManager = await model.getTagManager();
        tagRef = tagManager.getTagByName(tagName) ?? operation.createTag(tagName);
      }

      await placeSpacedCopies(operation, { width, depth, height, spacing, count, baseName: name, tagRef });
    }, 'Create space');

    report(`Placed ${count} ${count === 1 ? 'copy' : 'copies'} of "${name}".`, 'ok');
    return true;
  } catch (error) {
    report(String(error), 'error');
    return false;
  } finally {
    updateButtons();
  }
}

placeButton.addEventListener('click', () => {
  void placeSpaces();
});

// Fallback list, used only if THEMES_INDEX_FILE can't be loaded/parsed at
// connect time (see populateThemeSelect below) — kept in sync manually, the
// same as before US-108.
const BUNDLED_THEMES = [
  { id: 'hospitality_theme.json', label: 'Hospitality' },
  { id: 'multifamily_theme.json', label: 'Multifamily Residential' },
];

// A checked-in index of every theme file bundled in this repo — adding a
// theme means adding its JSON file plus one entry here, not an app.js edit.
// Fetched the same way app.js/style.css load, since SketchUp serves this
// folder straight from the repo (see docs/CONVENTIONS.md).
const THEMES_INDEX_FILE = 'themes.json';

const CUSTOM_THEME_OPTION = 'custom';

const THEME_STORAGE_KEY = 'space-creator:lastTheme:v1';

// Holds the most recently uploaded theme, keyed by { name, departments }, so
// re-clicking "Add Tags by Theme" after an upload doesn't need to re-prompt
// the file picker.
let uploadedTheme = null;

// Populates the Theme dropdown from themes.json (every theme file bundled in
// this repo), falling back to the static BUNDLED_THEMES list above if that
// index can't be fetched or is malformed — this only runs once, at connect,
// not on every reopen/refocus of the sidebar (that's the separate tag-only
// refresh below, via SketchUpApi.ui.on('open', ...)).
async function populateThemeSelect() {
  let themes = BUNDLED_THEMES;
  try {
    const response = await fetch(THEMES_INDEX_FILE);
    if (!response.ok) {
      throw new Error(`Could not load ${THEMES_INDEX_FILE} (${response.status})`);
    }
    const data = await response.json();
    if (!Array.isArray(data.themes)) {
      throw new Error(`${THEMES_INDEX_FILE} is missing a "themes" array.`);
    }
    const discovered = data.themes.filter(
      theme => typeof theme?.fileName === 'string' && typeof theme?.label === 'string',
    );
    if (discovered.length > 0) {
      themes = discovered.map(theme => ({ id: theme.fileName, label: theme.label }));
    }
  } catch {
    // Falling back silently is deliberate: an out-of-date/missing index file
    // shouldn't leave the Theme dropdown empty, just less complete.
    themes = BUNDLED_THEMES;
  }

  themeSelect.replaceChildren();
  for (const theme of themes) {
    themeSelect.append(new Option(theme.label, theme.id));
  }
  themeSelect.append(new Option('Upload JSON file…', CUSTOM_THEME_OPTION));
}

// Restores the last bundled theme the user picked, if it's still an option.
// "Upload JSON file…" is deliberately never saved/restored (see the change
// listener below) since an uploaded file isn't available across sessions.
function restoreLastTheme() {
  let saved;
  try {
    saved = localStorage.getItem(THEME_STORAGE_KEY);
  } catch (error) {
    console.warn('[Space Creator] could not read saved theme selection', error);
    return;
  }
  if (!saved || saved === CUSTOM_THEME_OPTION) return;

  const stillAvailable = [...themeSelect.options].some(option => option.value === saved);
  if (stillAvailable) {
    themeSelect.value = saved;
  }
}

// A theme file's "departments" array is the one thing the rest of this app
// depends on; everything else (themeName, description, per-space detail) is
// documentation only, so validation stops there.
function parseTheme(theme, sourceLabel) {
  if (!Array.isArray(theme.departments)) {
    throw new Error(`${sourceLabel} is missing a "departments" array.`);
  }
  return theme.departments;
}

async function loadBundledTheme(fileName) {
  const response = await fetch(fileName);
  if (!response.ok) {
    throw new Error(`Could not load ${fileName} (${response.status})`);
  }
  return parseTheme(await response.json(), fileName);
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`));
    reader.readAsText(file);
  });
}

themeFileInput.addEventListener('change', async () => {
  const file = themeFileInput.files[0];
  themeFileInput.value = '';
  if (!file) return;

  try {
    const text = await readFileAsText(file);
    const departments = parseTheme(JSON.parse(text), file.name);
    uploadedTheme = { name: file.name, departments };
    themeSelect.value = CUSTOM_THEME_OPTION;
    themeHint.textContent = `Using uploaded theme: ${file.name}`;
    // themeSelect.value was set programmatically above, which doesn't fire
    // its own 'change' event, so the Space dropdown needs refreshing here.
    void refreshSpaceOptions();
  } catch (error) {
    report(String(error), 'error');
  }
});

// Selecting "Upload JSON file…" here is inert on its own — reveals the
// "Choose file…" button, which is the only thing that opens the native
// picker now. Triggering it as a synthetic click from this change event (the
// old behavior) could be silently blocked in the SketchUp sidebar webview,
// since it isn't a direct user gesture on the input itself.
themeSelect.addEventListener('change', () => {
  if (themeSelect.value === CUSTOM_THEME_OPTION) {
    themeHint.textContent = 'Choose a JSON file to upload.';
    chooseThemeFileButton.hidden = false;
  } else {
    themeHint.textContent = 'Creates a tag for each department in the theme, colored to match.';
    chooseThemeFileButton.hidden = true;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, themeSelect.value);
    } catch (error) {
      console.warn('[Space Creator] could not save theme selection', error);
    }
  }
  void refreshSpaceOptions();
});

chooseThemeFileButton.addEventListener('click', () => {
  themeFileInput.click();
});

// Loads whichever theme is currently selected: a bundled sample fetched from
// this repo, or the last file the user uploaded via the file picker.
async function loadSelectedTheme() {
  if (themeSelect.value === CUSTOM_THEME_OPTION) {
    if (!uploadedTheme) {
      throw new Error('Choose a JSON file to upload first.');
    }
    return uploadedTheme.departments;
  }
  return loadBundledTheme(themeSelect.value);
}

// Creates (or reuses) one tag per department and syncs its color to the
// theme's hex value. Safe to re-run: existing tags are looked up by name
// rather than duplicated, and their color is refreshed to match the theme
// every time, so editing the JSON and re-clicking keeps tags in sync.
async function addTagsByTheme() {
  addTagsByThemeButton.disabled = true;
  try {
    const departments = await loadSelectedTheme();
    const model = await SketchUpApi.getActiveModel();

    await model.performOperation(async operation => {
      const tagManager = await model.getTagManager();
      for (const department of departments) {
        const tagRef = tagManager.getTagByName(department.name) ?? operation.createTag(department.name);
        operation.tagSetColor(tagRef, SketchUpApi.Color.fromHex(department.color));
      }
    }, 'Add tags by theme');

    await loadTags();
    report(`Added ${departments.length} tag${departments.length === 1 ? '' : 's'} from theme.`, 'ok');
  } catch (error) {
    report(String(error), 'error');
  } finally {
    addTagsByThemeButton.disabled = false;
  }
}

addTagsByThemeButton.addEventListener('click', () => {
  void addTagsByTheme();
});

// Does everything addTagsByTheme() does (same tag create-or-reuse-by-name +
// color sync), plus builds an actual tagged space for every entry in each
// department's `spaces` array — so this button alone, on a model with no
// tags yet, ends up with the same tags addTagsByTheme() would have created.
// A department with no `spaces` array still gets its tag, just no space.
async function addSpacesByTheme() {
  addSpacesByThemeButton.disabled = true;
  try {
    const departments = await loadSelectedTheme();
    const model = await SketchUpApi.getActiveModel();
    const height = feetAndInchesToInches(heightFt, heightIn);
    const skippedSpaceNames = [];
    let spacesPlaced = 0;

    await model.performOperation(async operation => {
      await ensureIfc4SchemaLoaded(model, operation);
      const tagManager = await model.getTagManager();

      // Each space entry gets its own row (offset along depth), so a
      // department's whole space list reads as a grid rather than one long
      // line; departments follow on from wherever the last one left off.
      let originY = 0;

      for (const department of departments) {
        const tagRef = tagManager.getTagByName(department.name) ?? operation.createTag(department.name);
        operation.tagSetColor(tagRef, SketchUpApi.Color.fromHex(department.color));

        for (const space of department.spaces ?? []) {
          const areaSqFt = parseTargetAreaSqFt(space.targetArea);
          if (areaSqFt === undefined) {
            skippedSpaceNames.push(space.name ?? '(unnamed space)');
            continue;
          }

          const { width, depth } = squareFootprintFromArea(areaSqFt);
          const spaceCount = typeof space.count === 'number' && space.count > 0 ? space.count : 1;

          await placeSpacedCopies(operation, {
            width,
            depth,
            height,
            spacing: DEFAULT_THEME_SPACING_IN,
            count: spaceCount,
            baseName: space.name,
            tagRef,
            originY,
          });

          spacesPlaced += spaceCount;
          originY += depth + DEFAULT_THEME_SPACING_IN;
        }
      }
    }, 'Add spaces by theme');

    await loadTags();
    let message = `Added ${departments.length} tag${departments.length === 1 ? '' : 's'} and ${spacesPlaced} space${spacesPlaced === 1 ? '' : 's'} from theme.`;
    if (skippedSpaceNames.length > 0) {
      message += ` Skipped (unparsable target area): ${skippedSpaceNames.join(', ')}.`;
    }
    report(message, 'ok');
  } catch (error) {
    report(String(error), 'error');
  } finally {
    addSpacesByThemeButton.disabled = false;
  }
}

addSpacesByThemeButton.addEventListener('click', () => {
  void addSpacesByTheme();
});

// Populates the Space dropdown from the currently selected theme's spaces,
// grouped by department. A space whose targetArea doesn't parse (see
// parseTargetAreaSqFt) is left out entirely rather than offered as a
// selection that can't actually pre-fill Width/Depth.
const CUSTOM_SPACE_OPTION = 'custom';
let spaceOptionsIndex = new Map(); // option value -> { departmentName, space }

async function refreshSpaceOptions() {
  spaceOptionsIndex = new Map();
  spaceSelect.replaceChildren(new Option('Custom…', CUSTOM_SPACE_OPTION));

  let departments;
  try {
    departments = await loadSelectedTheme();
  } catch {
    // No usable theme selected yet (e.g. "Upload JSON file…" with nothing
    // uploaded) — leave just "Custom…", not an error state of its own.
    return;
  }

  let nextOptionId = 0;
  for (const department of departments) {
    const spaces = (department.spaces ?? []).filter(space => parseTargetAreaSqFt(space.targetArea) !== undefined);
    if (spaces.length === 0) continue;

    const optgroup = document.createElement('optgroup');
    optgroup.label = department.name;
    for (const space of spaces) {
      const value = String(nextOptionId++);
      spaceOptionsIndex.set(value, { departmentName: department.name, space });
      optgroup.append(new Option(space.name, value));
    }
    spaceSelect.append(optgroup);
  }
}

// Pre-fills the form from a theme space — a convenience on top of the
// existing fields, not a separate placement path. Every field stays
// editable afterward, and placeSpaces() itself is unchanged.
function applySpaceSelection({ departmentName, space }) {
  nameInput.value = space.name;

  const areaSqFt = parseTargetAreaSqFt(space.targetArea);
  const { width, depth } = squareFootprintFromArea(areaSqFt);
  setFeetAndInches(widthFt, widthIn, width);
  setFeetAndInches(depthFt, depthIn, depth);

  if (typeof space.count === 'number') {
    setCount(space.count);
  }

  const tagAlreadyExists = [...tagSelect.options].some(option => option.value === departmentName);
  if (tagAlreadyExists) {
    tagSelect.value = departmentName;
  } else {
    tagSelect.value = '';
    report(`"${departmentName}" isn't a tag in this model yet — use "Add Tags by Theme" to create it.`);
  }
  syncTagPickerButton();

  updateButtons();
  renderFieldErrors();
  void checkDuplicateName();
}

spaceSelect.addEventListener('change', () => {
  const entry = spaceOptionsIndex.get(spaceSelect.value);
  // "Custom…" (or any unrecognized value) leaves the form exactly as-is.
  if (!entry) return;
  applySpaceSelection(entry);
});

// Register before connecting so reopening/refocusing the sidebar re-runs
// this and picks up tags added while it was last shown.
SketchUpApi.ui.on('open', () => {
  void loadTags();
});

SketchUpApi.connect()
  .then(async () => {
    await populateThemeSelect();
    restoreLastTheme();
    await refreshSpaceOptions();
    await loadTags();
    updateButtons();
    report('Ready.', 'ok');
  })
  .catch(err => {
    report(`Failed to connect: ${err}`, 'error');
  });
