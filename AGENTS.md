# Project instructions

## Architecture

Backend services (`services/trpc-api`, `services/websocket-service`,
`services/moderation-service`) must follow `ARCHITECTURE.md` at the repo
root — Clean Architecture layering, Hono on Bun, Kysely, and TDD with a
100% coverage target. Read it before adding or changing backend code.

## Git commits

Do not append a `Co-Authored-By` trailer or any other AI attribution to
commit messages in this repo. Write commit messages as if authored solely by
the developer.

## Agent skills

Store project skills in `.agents/skills/<skill-name>/SKILL.md`. The
`.claude/skills` path is a symlink to that canonical directory so Claude Code,
Codex, and GitHub Copilot use the same files.

Keep shared skill frontmatter portable: use a lowercase kebab-case `name` that
matches the directory and a specific `description` that says when the skill
applies. Do not put vendor-specific invocation fields or substitutions in a
shared skill. Run `.agents/validate-skills.sh` after adding or changing skills.
