#!/bin/sh

set -eu

repo_root=$(unset CDPATH; cd -- "$(dirname -- "$0")/.." && pwd)
skills_root="$repo_root/.agents/skills"
claude_skills="$repo_root/.claude/skills"

if [ ! -L "$claude_skills" ] || [ "$(readlink "$claude_skills")" != "../.agents/skills" ]; then
  echo "error: .claude/skills must link to ../.agents/skills" >&2
  exit 1
fi

found=0
for skill_file in "$skills_root"/*/SKILL.md; do
  [ -f "$skill_file" ] || continue
  found=1
  skill_dir=$(basename -- "$(dirname -- "$skill_file")")
  frontmatter=$(awk '
    NR == 1 && $0 == "---" { inside = 1; next }
    inside && $0 == "---" { exit }
    inside { print }
  ' "$skill_file")

  name=$(printf '%s\n' "$frontmatter" | sed -n 's/^name:[[:space:]]*//p')
  description=$(printf '%s\n' "$frontmatter" | sed -n 's/^description:[[:space:]]*//p')

  if [ "$name" != "$skill_dir" ]; then
    echo "error: $skill_file name must be '$skill_dir'" >&2
    exit 1
  fi
  if [ -z "$description" ]; then
    echo "error: $skill_file needs a non-empty description" >&2
    exit 1
  fi
  if ! printf '%s\n' "$name" | grep -Eq '^[a-z0-9]+(-[a-z0-9]+)*$'; then
    echo "error: $skill_file name must use lowercase kebab-case" >&2
    exit 1
  fi
  if printf '%s\n' "$frontmatter" | grep -Eq '^(allowed-tools|argument-hint|context|disable-model-invocation|user-invocable):'; then
    echo "error: $skill_file contains vendor-specific frontmatter" >&2
    exit 1
  fi

  echo "OK ${skill_file#"$repo_root/"}"
done

if [ "$found" -eq 0 ]; then
  echo "error: no skills found under .agents/skills" >&2
  exit 1
fi
