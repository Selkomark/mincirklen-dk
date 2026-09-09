# Executive blueprint

This project is built with [Claude Code](https://claude.com/claude-code)
as both the primary engineering agent and a working tool for
CTO-level/executive decisions — this doc is here so anyone following
along as a blueprint can see the actual tooling behind both, not just the
resulting code.

## Skills

Beyond Claude Code's defaults, this project's sessions run with
[`mattpocock-skills`](https://github.com/mattpocock/skills) (MIT
licensed) installed as a plugin. It packages a set of skills — reusable,
on-demand instructions Claude Code loads only when a task matches —
covering engineering *and* decision-making workflows that come up
repeatedly. `grilling` and `wizard` in particular get used as much for
stress-testing a business/product decision as for engineering work:

| Skill | What it's for |
|---|---|
| `diagnosing-bugs` | A structured diagnosis loop for hard bugs and performance regressions |
| `tdd` | Red-green-refactor, test-first feature work |
| `prototype` | Throwaway prototypes to sanity-check a design question before committing to it |
| `research` | Investigating a question against primary sources, captured as a doc in-repo |
| `domain-modeling` | Building and sharpening this project's own domain vocabulary (`CONTEXT.md`, ADRs) |
| `codebase-design` | Shared vocabulary for designing deep modules and finding seams |
| `code-review` | Reviewing a diff against this repo's own documented standards, and against the originating spec |
| `resolving-merge-conflicts` | Resolving an in-progress merge/rebase conflict |
| `wizard` | Generating a wizard for steps only a human can do (provisioning, credentials, one-off migrations) |
| `grilling` | Stress-testing a plan or decision before acting on it |
| `writing-for-agents` | Writing documents an agent consumes — skills, `AGENTS.md`/`CLAUDE.md`, this doc |

Separately, this project also uses a small custom skill of its own,
`idea-review` (not part of the plugin above — locally authored, lives
outside this repo at `~/.claude/skills/idea-review/`): evaluates a
proposed product idea against `CHARTER.md` and logs the verdict to
`REJECTED_IDEAS.md` / `PROMISING_IDEAS.md`, so a rejected idea stays
rejected on the record instead of getting silently re-proposed later.

## Why this is documented at all

`CHARTER.md` §5 treats transparency as a safety mechanism, not just
project hygiene. That principle extends to the tooling: how the code
actually gets written should be as legible as the code itself.
