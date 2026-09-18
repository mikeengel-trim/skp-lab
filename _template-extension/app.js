// Template Extension — blank shell.
//
// Copy this whole folder to get started. Swap the body of the click handler
// for real model changes, and connect() before anything else touches
// SketchUpApi.

const status = document.getElementById('status');
const runButton = document.getElementById('run');

runButton.addEventListener('click', async () => {
  const model = await SketchUpApi.getActiveModel();

  await model.performOperation(async operation => {
    // model changes go here
  }, 'Template Operation');
});

SketchUpApi.connect()
  .then(() => {
    status.textContent = 'Connected';
    runButton.disabled = false;
  })
  .catch(err => {
    status.textContent = `Failed to connect: ${err}`;
  });
