---
name: docs-index
description: Use whenever adding, renaming, or removing a markdown file directly under docs/. Keeps README.md's "Documentation" section in sync so every doc is discoverable from the root README.
---

`README.md`'s **Documentation** section (above **Project layout**) is a
hand-maintained index of every file directly under `docs/`. It doesn't
update itself — whenever you touch `docs/`, update it in the same change:

- **New doc added** (e.g. `docs/foo.md`): add a bullet point
  `- [docs/foo.md](docs/foo.md) — <one-line summary of what it covers>`,
  matching the style of the existing entries.
- **Doc renamed/moved**: update the existing bullet's path and link text.
  Also grep the whole repo for the old path (`grep -rn OLD_NAME .`,
  excluding `.git`/`node_modules`) — other files (workflows, other docs,
  `docker-compose.yml` comments, `SECURITY.md`) may reference it too.
- **Doc removed**: delete its bullet.

Keep each bullet to one line: the link, then an em dash, then a short
summary of what the doc covers — not a restatement of the filename.

Don't add subdirectories of `docs/` to this index unless the user asks;
it's scoped to files directly under `docs/`, matching what's there today.
