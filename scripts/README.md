# scripts

Shared tooling usable by any extension in this repo (e.g. test harnesses).

## build-zips.py

Builds `zips/<manifest id>.zip` for every `sketchup-*` extension (manifest at
the zip root, runtime files only; `verify/`, `*.md` and dev leftovers are
left out). Output is reproducible, so a zip only changes when its extension's
shipped files do.

```bash
python3 scripts/build-zips.py
```

A versioned pre-commit hook (`.githooks/pre-commit`) runs it and stages
`zips/` on every commit, so the zips are always current with the repo.
Enable it once per clone:

```bash
git config core.hooksPath .githooks
```

Extensions still load straight from this GitHub repo on iPad (see
[../docs/CONVENTIONS.md](../docs/CONVENTIONS.md)); the zips are for loading on
the web.
