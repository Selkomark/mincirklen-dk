# Scripts the manual "sign up, create an org, create a team, create a
# project, copy the DSN" flow every GlitchTip getting-started guide has you
# click through by hand — run non-interactively via `manage.py shell` by
# the one-shot `glitchtip-init` service in docker-compose.yml. Every step
# is get_or_create, so this is safe to re-run on every `docker compose up`
# the same way vault-init is.
#
# One project per service (matching Sentry/GlitchTip's own "one project per
# app" convention — keeps each service's issues/logs filterable rather than
# one shared bucket), all under the same org/team.
#
# Model shapes read directly from the installed glitchtip/glitchtip:6
# image's own source (/code/apps/{organizations_ext,teams,projects}) rather
# than assumed — this app uses django-organizations under the hood, whose
# Organization/OrganizationUser/OrganizationOwner split isn't obvious from
# the outside.
import os

from django.contrib.auth import get_user_model

from apps.organizations_ext.constants import OrganizationUserRole
from apps.organizations_ext.models import Organization, OrganizationOwner, OrganizationUser
from apps.projects.models import Project, ProjectKey
from apps.teams.models import Team

User = get_user_model()

email = os.environ["GLITCHTIP_INIT_EMAIL"]
password = os.environ["GLITCHTIP_INIT_PASSWORD"]
org_name = os.environ.get("GLITCHTIP_INIT_ORG", "mincirklen")
team_slug = os.environ.get("GLITCHTIP_INIT_TEAM", "engineering")
domain = os.environ["GLITCHTIP_DOMAIN"].rstrip("/")
host = domain.split("://")[-1]

# (project name, platform hint, .env var to set, internal?) — platform is
# just a documentation/UI hint (Project.platform has no choices
# constraint), not validated against anything.
#
# internal=True uses this container's own docker-compose service name
# (glitchtip:8000) as the DSN host instead of the public
# glitchtip.dev-mincirklen.dk domain — same "internal calls go straight
# container-to-container over plain HTTP, never back out through Caddy"
# convention this repo already uses for MODERATION_SVC_URL/
# WEBSOCKET_SERVICE_URL. It's not just style: the mkcert CA that makes
# *.dev-mincirklen.dk trusted is only installed on the host/browser, not
# inside any container, so a backend service's Sentry SDK calling the
# public HTTPS domain fails TLS verification. web-app's DSN is the one
# exception — it's read by browser JS, which only ever reaches GlitchTip
# through Caddy at the public domain.
PROJECTS = [
    ("web-app", "javascript-react", "VITE_SENTRY_DSN", False),
    ("trpc-api", "bun", "TRPC_API_SENTRY_DSN", True),
    ("websocket-service", "bun", "WEBSOCKET_SERVICE_SENTRY_DSN", True),
    ("moderation-service", "bun", "MODERATION_SERVICE_SENTRY_DSN", True),
]
INTERNAL_HOST = "glitchtip:8000"

user, created = User.objects.get_or_create(
    email=email, defaults={"is_staff": True, "is_superuser": True, "is_active": True}
)
if created:
    user.set_password(password)
    user.save()
    print(f"[glitchtip-init] created superuser {email}")
else:
    print(f"[glitchtip-init] superuser {email} already exists")

org, created = Organization.objects.get_or_create(name=org_name)
print(f"[glitchtip-init] organization {org_name}: {'created' if created else 'already exists'}")

org_user, created = OrganizationUser.objects.get_or_create(
    organization=org, user=user, defaults={"role": OrganizationUserRole.OWNER}
)
OrganizationOwner.objects.get_or_create(organization=org, organization_user=org_user)

team, created = Team.objects.get_or_create(organization=org, slug=team_slug)
print(f"[glitchtip-init] team {team_slug}: {'created' if created else 'already exists'}")
team.members.add(org_user)

print("[glitchtip-init] ---")
for project_name, platform, env_var, internal in PROJECTS:
    project, created = Project.objects.get_or_create(
        organization=org, name=project_name, defaults={"platform": platform}
    )
    print(f"[glitchtip-init] project {project_name}: {'created' if created else 'already exists'}")
    team.projects.add(project)

    key, _ = ProjectKey.objects.get_or_create(project=project)
    scheme = "http" if internal else "https"
    dsn_host = INTERNAL_HOST if internal else host
    dsn = f"{scheme}://{key.public_key.hex}@{dsn_host}/{project.id}"
    # Set each of these (in .env, or the matching service's docker-compose
    # environment block) to point that service's Sentry SDK at this local
    # GlitchTip instance instead of real Sentry. Left as a manual, explicit
    # step rather than auto-written — a real Sentry DSN already set is a
    # deliberate choice, not something to silently overwrite.
    print(f"[glitchtip-init] {env_var}={dsn}")

print("[glitchtip-init] ---")
print(f"[glitchtip-init] login at {domain}/login with {email} / (GLITCHTIP_INIT_PASSWORD)")
