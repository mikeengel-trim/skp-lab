// Hello World — first extension built from the template.
//
// Shows the shape of the smallest possible command: register the 'open'
// handler before connect() so a click that opened the sidebar before the
// page finished loading isn't missed, then greet the user with a dialog.

const status = document.getElementById('status');

async function greet() {
  await SketchUpApi.ui.getModalInput({
    title: 'Hello World',
    message: 'Hello iPad',
    actions: 'ok',
    inputs: {},
  });
}

SketchUpApi.ui.on('open', () => {
  void greet();
});

SketchUpApi.connect()
  .then(() => {
    status.textContent = 'Connected';
  })
  .catch(err => {
    status.textContent = `Failed to connect: ${err}`;
  });
