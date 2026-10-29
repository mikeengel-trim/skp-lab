# skp-lab

Extensions built on SketchUp's JavaScript Adapter (JSA) — the API surface for
SketchUp on iOS and Web. Each top-level folder is one independent extension:
its own `manifest.json`, source, and README. Nothing is shared between them
at runtime; shared knowledge lives in [docs/](docs).

## Extensions

| Folder | Extension | Status |
|---|---|---|
| [`sketchup-space-creator/`](sketchup-space-creator) | Space Creator | Done |
| [`sketchup-tag-color-viewer/`](sketchup-tag-color-viewer) | Instance Color Rules | Done |
| [`sketchup-north-arrow/`](sketchup-north-arrow) | North Arrow | Untested in a live SketchUp session — see its README |
| [`sketchup-component-tag-table/`](sketchup-component-tag-table) | Component Tag Table | Untested in a live SketchUp session — see its README |
| [`sketchup-assembly-parts-tracker/`](sketchup-assembly-parts-tracker) | Assembly Parts Tracker | Loads on iPad; data persists across save/reopen — see its README |

## Adding a new extension

1. Copy [`_template-extension/`](_template-extension) to a new top-level folder
   named `sketchup-<your-extension-name>`.
2. Update `manifest.json`: give it a unique `id` and a `name`.
3. Build it out. No packaging step — SketchUp loads the extension straight
   from this GitHub repo, so pushing your commit is the deliverable. See
   [docs/CONVENTIONS.md](docs/CONVENTIONS.md).
4. Add a row to the table above.

## Repo layout

- `sketchup-*/` — one folder per extension.
- `_template-extension/` — starting point for a new extension.
- `docs/` — conventions and gotchas that apply across extensions.
- `scripts/` — shared tooling usable by any extension, including `build-zips.py`.
- `zips/` — install zips, one per extension, rebuilt on every commit by a pre-commit hook (run `git config core.hooksPath .githooks` once per clone). Use these to load on the web.

## Conventions

See [docs/CONVENTIONS.md](docs/CONVENTIONS.md) for JSA-specific rules learned
the hard way (loading, connecting, testing).

## Resources

- [JSA documentation (Trimble Developer)](https://developer.trimble.com/docs/sketchup/jsa/welcome/) — welcome, tutorials, examples, and API reference.
- [JSA API documentation](https://d38s2ymumupq87.cloudfront.net/sketchup/jsa/latest/) — the SketchUp JavaScript Adapter reference.
- [JSA example extensions](https://github.com/SketchUp/sketchup-js-api-tutorials/tree/main/examples) — official samples: hello-world, menu-items, toolbar-headless, modal-form, sidebar-panel, server-hosted.
- [docs/RESOURCES.md](docs/RESOURCES.md) — summary of the above for context.
