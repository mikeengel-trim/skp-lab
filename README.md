# skp-lab

Extensions built on SketchUp's JavaScript Adapter (JSA) — the API surface for
SketchUp on iOS and Web. Each top-level folder is one independent extension:
its own `manifest.json`, source, and README. Nothing is shared between them
at runtime; shared knowledge lives in [docs/](docs).

## Extensions

| Folder | Extension | Status |
|---|---|---|
| [`sketchup-hello-world/`](sketchup-hello-world) | Hello World | Done |

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
- `scripts/` — shared tooling usable by any extension.

## Conventions

See [docs/CONVENTIONS.md](docs/CONVENTIONS.md) for JSA-specific rules learned
the hard way (loading, connecting, testing).

## Resources

- [JSA API documentation](https://d38s2ymumupq87.cloudfront.net/sketchup/jsa/latest/) — the SketchUp JavaScript Adapter reference.
