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
const widthFt = document.getElementById('width-ft');
const widthIn = document.getElementById('width-in');
const depthFt = document.getElementById('depth-ft');
const depthIn = document.getElementById('depth-in');
const heightFt = document.getElementById('height-ft');
const heightIn = document.getElementById('height-in');
const tagSelect = document.getElementById('tag-select');
const countValue = document.getElementById('count-value');
const countDown = document.getElementById('count-down');
const countUp = document.getElementById('count-up');
const spacingRow = document.getElementById('spacing-row');
const spacingInput = document.getElementById('spacing-in');
const status = document.getElementById('status');
const placeButton = document.getElementById('place');
const addTagsByThemeButton = document.getElementById('add-tags-by-theme');
const themeSelect = document.getElementById('theme-select');
const themeFileInput = document.getElementById('theme-file-input');
const chooseThemeFileButton = document.getElementById('choose-theme-file');
const themeHint = document.getElementById('theme-hint');

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

function updateButtons() {
  const ready =
    nameInput.value.trim() !== '' &&
    feetAndInchesToInches(widthFt, widthIn) > 0 &&
    feetAndInchesToInches(depthFt, depthIn) > 0 &&
    feetAndInchesToInches(heightFt, heightIn) > 0;
  placeButton.disabled = !ready;
}

form.addEventListener('input', updateButtons);

// Checked on blur rather than on every keystroke: it walks the model's
// entity tree, which isn't free, and a name being momentarily "in progress"
// as the user types shouldn't flash a warning.
nameInput.addEventListener('blur', () => {
  void checkDuplicateName();
});

// Refresh right before the user picks a tag, so one added elsewhere while
// this panel stayed open still shows up without needing to reopen it.
tagSelect.addEventListener('focus', () => {
  void loadTags();
});

// Loads the model's tags into the dropdown. "Untagged" (no tagRef) is always
// the first option, since a space doesn't have to carry a tag.
//
// TagManager is a point-in-time snapshot, not a live view — it has its own
// refresh() for exactly this reason — so this has to be called again
// whenever the list might be stale, not just once at connect.
async function loadTags() {
  const previousValue = tagSelect.value;

  const model = await SketchUpApi.getActiveModel();
  const tagManager = await model.getTagManager();

  tagSelect.replaceChildren(new Option('Untagged', ''));
  for (const tag of tagManager.tags) {
    // The model's own built-in default tag is also named "Untagged" — skip
    // it so it doesn't duplicate the synthetic "no tag" option above.
    if (tag.name === 'Untagged') continue;
    tagSelect.append(new Option(tag.name, tag.name));
  }

  // Keep whatever was selected if it still exists; a tag added elsewhere
  // shouldn't reset a choice the user already made.
  if (tagManager.getTagByName(previousValue) !== undefined) {
    tagSelect.value = previousValue;
  }
}

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

// Register before connecting so reopening/refocusing the sidebar re-runs
// this and picks up tags added while it was last shown.
SketchUpApi.ui.on('open', () => {
  void loadTags();
});

SketchUpApi.connect()
  .then(async () => {
    await populateThemeSelect();
    restoreLastTheme();
    await loadTags();
    updateButtons();
    report('Ready.', 'ok');
  })
  .catch(err => {
    report(`Failed to connect: ${err}`, 'error');
  });
