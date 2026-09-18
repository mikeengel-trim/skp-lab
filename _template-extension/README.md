# Template Extension

Starting point for a new JSA extension. Copy this whole folder to
`sketchup-<your-extension-name>/` and:

1. Edit `manifest.json` — give it a unique `id` and a `name`.
2. Build out `index.html` and `app.js`. No build step, no bundler — split
   files freely, `<script src="app.js">` just works (see
   [../docs/CONVENTIONS.md](../docs/CONVENTIONS.md)).
3. Update this README with what the extension does.
4. Add a row to the root [README.md](../README.md) table. Point SketchUp at
   this folder in the GitHub repo to load it — no packaging step.

## What it shows

Nothing yet — it's a blank shell that connects to `SketchUpApi` and enables
one button once connected.
