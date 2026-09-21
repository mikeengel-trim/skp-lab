// Space Creator — defines a named, tagged box and places it in the model.
//
// The box itself is built the same way the space-planning sample builds a
// room: a counter-clockwise floor face, pushed up by height, inside one
// performOperation() per click so the whole batch is one undo step.

const INCHES_PER_FOOT = 12;

const form = document.getElementById('space-form');
const nameInput = document.getElementById('name');
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
const status = document.getElementById('status');
const placeAndNewButton = document.getElementById('place-and-new');
const placeButton = document.getElementById('place');
const addTagsByThemeButton = document.getElementById('add-tags-by-theme');

let count = 1;

function report(message, kind) {
  status.textContent = message;
  status.className = kind ?? '';
}

function setCount(next) {
  count = Math.min(50, Math.max(1, next));
  countValue.textContent = String(count);
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
  placeAndNewButton.disabled = !ready;
  placeButton.disabled = !ready;
}

form.addEventListener('input', updateButtons);

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
    tagSelect.append(new Option(tag.name, tag.name));
  }

  // Keep whatever was selected if it still exists; a tag added elsewhere
  // shouldn't reset a choice the user already made.
  if (tagManager.findTag(previousValue) !== undefined) {
    tagSelect.value = previousValue;
  }
}

// Builds one box: a counter-clockwise floor rectangle so its front points up,
// pushed to height, named and tagged.
function buildSpace(operation, { width, depth, height, name, tagRef }) {
  const group = operation.createGroup(operation.model);

  const floor = operation.createFace(group, [
    [0, 0, 0],
    [width, 0, 0],
    [width, depth, 0],
    [0, depth, 0],
  ]);

  operation.facePushPull(floor, height);
  operation.groupSetName(group, name);

  if (tagRef !== undefined) {
    operation.drawingElementSetTag(group, tagRef);
  }
}

// Places `count` copies of the same space, all at the origin — this tool has
// no click-to-place step, so copies stack there for the user to drag apart,
// the same way a stamped instance would.
async function placeSpaces() {
  const name = nameInput.value.trim();
  const width = feetAndInchesToInches(widthFt, widthIn);
  const depth = feetAndInchesToInches(depthFt, depthIn);
  const height = feetAndInchesToInches(heightFt, heightIn);
  const tagName = tagSelect.value;

  placeAndNewButton.disabled = true;
  placeButton.disabled = true;
  try {
    const model = await SketchUpApi.getActiveModel();

    await model.performOperation(async operation => {
      let tagRef;
      if (tagName !== '') {
        const tagManager = await model.getTagManager();
        tagRef = tagManager.findTag(tagName) ?? operation.createTag(tagName);
      }

      for (let i = 0; i < count; i += 1) {
        const instanceName = count === 1 ? name : `${name} ${i + 1}`;
        buildSpace(operation, { width, depth, height, name: instanceName, tagRef });
      }
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

// Fetches the theme file bundled next to this extension's own files — works
// the same way app.js/style.css load, since SketchUp serves this folder
// straight from the repo (see docs/CONVENTIONS.md).
async function loadTheme() {
  const response = await fetch('hospitality_theme.json');
  if (!response.ok) {
    throw new Error(`Could not load hospitality_theme.json (${response.status})`);
  }
  const theme = await response.json();
  if (!Array.isArray(theme.hotelDepartments)) {
    throw new Error('hospitality_theme.json is missing a "hotelDepartments" array.');
  }
  return theme.hotelDepartments;
}

// Creates (or reuses) one tag per department and syncs its color to the
// theme's hex value. Safe to re-run: existing tags are looked up by name
// rather than duplicated, and their color is refreshed to match the theme
// every time, so editing the JSON and re-clicking keeps tags in sync.
async function addTagsByTheme() {
  addTagsByThemeButton.disabled = true;
  try {
    const departments = await loadTheme();
    const model = await SketchUpApi.getActiveModel();

    await model.performOperation(async operation => {
      const tagManager = await model.getTagManager();
      for (const department of departments) {
        const tagRef = tagManager.getTagByName(department.name) ?? operation.createTag(department.name);
        operation.tagSetColor(tagRef, SketchUpApi.Color.fromHex(department.color.hex));
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

form.addEventListener('submit', async event => {
  event.preventDefault();
  const placed = await placeSpaces();
  if (placed) {
    // "+ Create New" clears just the name, so dimensions/tag/count carry over
    // for the next space in the same batch.
    nameInput.value = '';
    nameInput.focus();
    updateButtons();
  }
});

// Register before connecting so reopening/refocusing the sidebar re-runs
// this and picks up tags added while it was last shown.
SketchUpApi.ui.on('open', () => {
  void loadTags();
});

SketchUpApi.connect()
  .then(async () => {
    await loadTags();
    updateButtons();
    report('Ready.', 'ok');
  })
  .catch(err => {
    report(`Failed to connect: ${err}`, 'error');
  });
