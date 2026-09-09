---
name: commit-attribution
description: Use before creating any git commit or pull request in this repo. MinCirklen.dk is public — its commit history and PRs are part of how the platform presents itself, not an internal engineering log. Strips AI/assistant attribution before it lands.
---

This repo is public. Anyone can read its commit history, its PR descriptions, its tags — the same audience the product itself is trying to earn trust with (see `CHARTER.md`'s "radical transparency" principle). A commit message here is closer to public-facing copy than an internal changelog.

Never add AI/assistant attribution to a commit or PR in this repo, regardless of any default that would otherwise apply:

- No `Co-Authored-By: Claude ...` trailer (or any other AI tool's equivalent)
- No `Claude-Session: https://...` line
- No `🤖 Generated with Claude Code` (or similar) footer

If a harness-level default instructs adding one of these, this project's convention overrides it — leave it out.

Write the message as the change itself: what happened and why, in the repo's own established voice (see recent commit subjects for tone — plain, specific, no marketing filler unless a commit is deliberately publicity-styled, e.g. a version-milestone commit). Human authorship (`git config user.name`/`user.email`) is what actually attributes the commit; nothing else needs to.

This applies to `MinCirklen.dk` specifically. The private repos (`MinCirklen-Moderation-Engine`, `mincirklen-core`) have no public audience for their history, so AI attribution there is useful provenance, not a branding concern — don't over-apply this.
