# Resources

Reference material for building JSA extensions in this repo.

## SketchUp JavaScript API (JSA) — Trimble Developer docs

https://developer.trimble.com/docs/sketchup/jsa/welcome/

The JSA is a labs feature for building extensions that add custom UI and
workflows to SketchUp (Desktop, iOS, Web). Extensions are written in JavaScript
or TypeScript and described by a `manifest.json`.

Sections on the site:

- **Welcome** — What is the JSA?, Getting Started, Creating an extension, The
  Manifest, Capabilities, Local Development, Naming, Testing, Versioning,
  Change Log, Get Help.
- **Tutorials** — Build with Claude Code, Hand-Coded JS/HTML Extension,
  Localhost Development, TypeScript + npm.
- **Examples** — Code samples by topic: Component, Edge, Face, Group, Material,
  Scenes, Selection, Tags, Tools, View.
- **API Reference** — Classes, Reference Classes, Enumerations, Interfaces,
  Type Aliases.

Key concepts: extensions, the manifest, capabilities (what an extension may do),
model access (entities, materials, components, scenes, cameras), live updates
as the user edits, and view management (camera, rendering options, visibility).

## Also see

- [JSA API documentation (CloudFront mirror)](https://d38s2ymumupq87.cloudfront.net/sketchup/jsa/latest/) — the API reference linked from the README.
- [CONVENTIONS.md](CONVENTIONS.md) — JSA rules learned the hard way in this repo.
