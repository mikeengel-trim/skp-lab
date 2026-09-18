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

// Loads the model's tags into the dropdown. "Untagged" (no tagRef) is always
// the first option, since a space doesn't have to carry a tag.
async function loadTags() {
  const model = await SketchUpApi.getActiveModel();
  const tagManager = await model.getTagManager();

  tagSelect.replaceChildren(new Option('Untagged', ''));
  for (const tag of tagManager.tags) {
    tagSelect.append(new Option(tag.name, tag.name));
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

SketchUpApi.connect()
  .then(async () => {
    await loadTags();
    updateButtons();
    report('Ready.', 'ok');
  })
  .catch(err => {
    report(`Failed to connect: ${err}`, 'error');
  });
