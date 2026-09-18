# Template Extension

Starting point for a new JSA extension. Copy this whole folder to
`sketchup-<your-extension-name>/` and:

1. Edit `manifest.json` — give it a unique `id` and a `name`.
2. Build out `index.html`. Keep all JavaScript inline in the file (see
   [../docs/CONVENTIONS.md](../docs/CONVENTIONS.md) for why).
3. Update this README with what the extension does.
4. Package as a `.zip` for distribution (see
   [../docs/CONVENTIONS.md](../docs/CONVENTIONS.md)) and add a row to the
   root [README.md](../README.md) table.

## What it shows

Nothing yet — it's a blank shell that connects to `SketchUpApi` and enables
one button once connected.
