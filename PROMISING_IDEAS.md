# Promising ideas

A durable record of product/feature ideas evaluated against `CHARTER.md`
and judged worth pursuing — as proposed, or in a narrower form — so a
good idea survives past the session it was floated in. Maintained by the
`idea-review` skill.

## 2026-09-05 — Structured self-reflection prompts for users

**Idea:** Narrower version of the "AI as investigative quasi-therapist"
idea in `REJECTED_IDEAS.md`. Instead of an AI silently profiling every
message a user sends and building a persistent psychological map, offer
a small set of static, clinician-reviewed reflection prompts a user can
optionally pull up themselves during or between sessions — the same
underlying goal (help someone articulate what they're actually
struggling with before a session, or between sessions) without any AI
investigation, no per-user profile, no persistent psychological data
stored anywhere.

**Verdict:** promising (narrower: fully static content, no AI
involvement, no persistent per-user data at all — the user pulls the
prompts up themselves, nothing is logged against their identity).

**Why:** Keeps the platform's actual differentiator (anonymous peer
support, deterministic safety handling per `CHARTER.md` §3) untouched —
this is just better self-serve content, not a new AI-driven decision
surface in the crisis-handling path. Sidesteps the GDPR Article 9 /
DPIA problem entirely since nothing is captured or stored — the user's
own reflection stays in their own head or notes, never touches the
platform's data model. Needs a clinician's input on the actual prompt
set before shipping (not something to write from general knowledge) and
a decision on where it surfaces in the UI — not yet scoped further than
this.

## 2026-09-05 — Launch now, build a proprietary training dataset once consented users are active

**Idea:** Launch with the current moderation model as-is, accept its
known quality gaps for a pilot run. Once reaching 50 daily active users
who consented to AI training, start labeling their conversations to
build a training dataset and fine-tune the moderation model — framed as
a proprietary competitive edge.

**Verdict:** promising (narrower: scope labeling to the flagged/crisis/
human-reviewed subset only, not all messages from consenting users; run
the DPIA in parallel with reaching the data threshold, not after it;
make the consent copy explicit that a human reviews flagged content for
training, not just an automated pipeline).

**Why:** Launching now and improving later off real, consented usage
data doesn't conflict with `CHARTER.md` on its face. But "labeling the
conversations" as described is broader than what `TRAINING_CONSIDERATIONS.md`
(sibling repo) already recommended — scoping to the flagged/reviewed
subset only, for data minimization and because that's the actually
high-value signal. It also glosses over that labeling means a human
(not a clinician) reading real crisis/flag disclosures, which the
current consent copy ("we use anonymized messages to train and improve
our AI moderation") doesn't clearly disclose — a transparency gap given
CHARTER §5 treats transparency as a safety mechanism specifically
because this touches the crisis-handling path. And the DPIA
(`docs/roadmap.md` §3.2, still deferred) is the actual gate here, not
the 50-DAU number, which is a data-volume milestone, not a compliance
one.

## 2026-09-05 — Feed session context into the classifier

**Idea:** The moderation classifier currently only ever sees the single
isolated message being classified, no session history. Feed it the
recent conversation context too, so ambiguous phrasing ("perhaps I
should end this conversation") can be judged against tone/history
instead of in a vacuum.

**Verdict:** promising, as scoped (see the rejected companion idea in
`REJECTED_IDEAS.md` for the part of this that does NOT fit).

**Why:** This is a pure information improvement to the existing
deterministic pass/flag/crisis call — same one classification, same
fail-closed mechanism, just better inputs. Directly explains the false
positives observed in testing ("...with a smile", "...with love" both
flagged): with zero context, the deliberate "flag when uncertain" bias
correctly treats every "ending" phrase as ambiguous. More context should
reduce false positives without weakening the crisis catch rate, since
it's improving judgment quality, not adding a bypass path.

## 2026-09-15 — Layered admin-security architecture ahead of public launch

**Idea:** A defense-in-depth security package for `/manage` ahead of
going public/livestreaming: a daily-rotating, randomized admin path
distributed through Teams/email via service accounts; IP-pattern
analysis of employee access to detect and block intruders; rate
limiting and lockout on repeated failed logins; a weekly-retrained
threat-detection model built on observed brute-force/attack patterns;
and a physical/hardware token requirement for the platform's
highest-severity actions, gated behind manual pipeline intervention.
Incidentally, admin login timestamps would double as attendance/
performance evidence, disclosed to staff via a data-collection clause
in their employment contract.

**Verdict:** promising (narrower: drop the rotating-URL obscurity and
the weekly-retrained ML detection model; keep and prioritize hardware/
WebAuthn step-up authentication for high-severity admin actions, an
audited Teams-gated workflow for granting/revoking the `admin.access`
RBAC role, and closing the already-open OAuth-callback rate-limiting
gap. Also: key any lockout mechanism to the source (IP/session), never
the target account, so it can't be turned into a denial-of-service
against the platform's own admins.)

**Why:** `CHARTER.md` doesn't directly govern internal admin-security
architecture — its principles are about user-facing anonymity and
safety, not staff tooling — so this isn't a mission conflict in the
strict sense. The real tension is proportionality against the
platform's own "earn trust by being inspectable, not by promising to be
trustworthy" ethos (principle 5) and its explicitly deliberate,
not-yet-at-scale growth (`docs/roadmap.md`): the rotating-URL piece adds
no real protection on top of the RBAC permission check already gating
every request (knowing the path grants nothing without a permissioned
session), and a weekly-retrained detection model is a data-pipeline/
labeling/drift-monitoring commitment this self-funded early pilot has
no attack volume to justify yet. The parts that survive scrutiny map
directly onto work already on record rather than new surface area:
hardware-key step-up auth and an audited access-grant workflow close
`DPIA_PRELAUNCH.md`'s R8 gap (no audit trail on who granted admin
access, to whom, when), and the rate-limiting piece is
`SECURITY_FINDINGS.md` H1, already flagged and still open.

## 2026-09-15 — Multi-room, topic-based circles with phased matching

**Idea:** Improve the join page beyond "one session to join per topic."
Full scope, as refined across discussion (a future session should be
able to plan/build directly from this without re-deriving any of it):

**1. Rooms, not one growing session.** A "session" in the join page is
really a *topic* (already: admin-curated, may have a limited time
window). When a topic's current room fills (`sessions.capacity`, e.g.
6), the platform doesn't grow that room past capacity — it opens
another bounded room instance of the same topic and routes overflow
joiners into it. A "room" is not a new concept: it's just another
`sessions` row sharing the same `topic_id`, created programmatically
when the current one(s) fill. Round-robin/turn-taking
(`current_turn_user_id`, `turn_claimed_at`, both already on `sessions`
— `packages/shared/migrations/0001_init.ts`) stays scoped *inside* each
room, completely unaffected by how many rooms exist for a topic — this
is what makes it scale to arbitrarily many participants per topic
without ever breaking the turn-taking model a single room depends on.
Scaling happens by spawning more bounded rooms, never by making one
room unbounded.

**2. Matching, phased — build FIFO first, ship matching later:**
   - **Phase 1 (launch)**: dead-simple FIFO — a new joiner goes to
     whichever open room for that topic has a free seat, in join
     order. No analysis, no ranking, nothing to consent to. Appropriate
     because early users are invite-known people who likely already
     have enough in common to sustain a conversation (see the
     feature-gate/waitlist work already shipped).
   - **Phase 2 (later, once validated and campaigning to unknown/public
     users)**: consent-gated content-based matching. For users who
     opt in, use what they've discussed (and/or a direct prompt asking
     what they're looking for right now, e.g. "I have trouble
     sleeping") to route them toward a room where a similar topic has
     come up, instead of pure join order.
   - **Fallback, always**: if no good match is found (or the user
     hasn't consented), fall straight back to FIFO — a user is never
     stuck with no room.
   - **Low-affinity refinement**: if a new user has nothing in common
     with anyone in the best-matched room, an alternative strategy is
     pairing them with more *seasoned* participants instead (defined
     narrowly as prior-session count, not a fuller engagement/frequency
     score) so they have an easier time getting up to speed — this
     stays a simple tenure check, not the behavioral ranking system
     considered and deliberately dropped below.

**3. Consent — the part negotiated in most detail, don't skip re-reading
this before building it:**
   - This is a **new, separate, granular consent purpose** —
     "context-analysis for room matching" — distinct from the existing
     `user_profiles.training_consent` column, which is scoped
     specifically to AI *training* use. Reusing that flag for matching
     would violate GDPR's purpose-specificity requirement (Art. 7);
     matching needs its own explicitly-worded consent, presented
     alongside (not merged into) the training one.
   - This is **also fully separate from the cookie-consent banner**
     (`CookieConsentBanner.tsx`), which covers marketing/analytics/
     behavioral-tracking cookies under ePrivacy/ordinary personal-data
     rules — a different legal basis and a different mechanism from
     Art. 9 explicit consent for special-category health-disclosure
     content. Do not merge the two mechanisms or storage.
   - **Do reuse the cookie banner's UI *pattern*** — equal-weight
     "Allow all" / granular pick-and-choose buttons
     (`equalWeightButtons: true`) — for the new platform-feature
     consent screen, so accepting and customizing/declining stay
     equally easy to click (the specific dark-pattern EDPB guidance
     targets). Same visual weighting, separate mechanism.
   - **The core service must stay fully unconditioned on this
     consent.** FIFO matching (and peer-support participation
     generally) must work exactly as well for someone who declines
     every AI-related consent — no degraded experience, no fewer
     features. Message the benefit as *addition* ("opt in and we can
     match you by what you've actually discussed; without it, you're
     matched by join order, which works well but isn't tailored"),
     never as *subtraction* ("you won't get a quality experience
     without this"). The latter risks failing Art. 7(4)'s
     freely-given-consent test — conditioning a service on consent to
     processing that isn't necessary for it — which would be
     especially exposed here since this is Art. 9 *explicit* consent
     for health-category data, the strictest tier GDPR has. If that
     consent is ever found invalid, the processing built on it becomes
     retroactively unlawful.
   - Presented first at registration (gentle, honest benefit reminder
     if declined, same equal-weight buttons), but must remain
     changeable afterward — already true today via the Account modal's
     Preferences section (where language preference already lives), no
     new revocation surface needs building.

**4. Before this ships**: `DPIA_PRELAUNCH.md` needs a new section
describing this as its own processing operation (purpose, necessity/
proportionality, risk) — it's a genuinely new use of session content
beyond moderation, not covered by the DPIA's current scope.

**Verdict:** promising, as refined through discussion — no further
narrowing needed. Phase 1 (FIFO room-sharding) is safe to plan/build
immediately; Phase 2 (consent-gated matching) waits on the new DPIA
section and the granular consent UI both existing first.

**Why:** Fits `CHARTER.md` cleanly once room-sharding (not one
unbounded room) is the mechanism — small, bounded, moderated circles
stay exactly that, per-room, no matter how many rooms a popular topic
needs; nothing about matching creates a directory or lookup (routing
is server-side, never a searchable profile); anonymity is unaffected
(matching keys off consented content analysis, not identity). The
consent design earns its "promising" verdict specifically *because* it
was pushed to be granular, separately-mechanisms, unconditioned-core-
service, and addition-framed — the bundled/conditioned version of this
same idea, floated earlier in the conversation, would have failed
Art. 7(4) and Art. 9's explicit-consent bar and is not what this entry
approves.

## 2026-09-15 — User-created private/invite-code sessions, with moderated multi-room scaling

**Idea:** Extend "New session" so a user (not just an admin curating
`topics`) can create their own session, optionally private behind a
short, memorable, human-shareable code (originally proposed as 4
digits — kept short by design, not meant as a cryptographic secret;
the point is a code an organizer can say out loud or write on a board,
e.g. a support-group facilitator continuing an existing in-person group
online, or a live event announcing a debate room in person) rather than
a long unguessable link. The code is scoped to one session, expires
when the session does, and is not searchable/browsable — the only way
in is already knowing the code. A private, user-created session can
also scale to multiple rooms exactly like the admin-curated multi-room
feature (`PROMISING_IDEAS.md`'s 2026-09-15 "Multi-room, topic-based
circles" entry — same underlying mechanism: a room is a `sessions` row
sharing a key, round-robin stays scoped per room, overflow spawns a new
room rather than growing one past capacity).

Because these sessions are user-titled and not pre-vetted like admin
`topics`, this introduces a new moderation surface: session *titles*
currently go through no classification at all (`sessions.name` is
free-text, only message *content* is classified by moderation-service).
Rapid growth into multiple rooms is a cheap trigger for human review
(a new session-level review queue, distinct from the existing per-
message one in `ReviewQueueTab.tsx`/`moderation_events`). Rejected
titles build a moderator-maintained blocklist/pattern list (deliberately
not a trained model — see "why" below) so similar titles get routed to
review before they resurface, and a pattern match is a signal that
routes to human review, never an automatic ban — `account_bans`
already has a fixed `reason_category` taxonomy and an evidence trail
(`docs/gdpr-runbook.md`); a new automated title-pattern-match category
would need to fit that same reviewed, evidenced shape, not bypass it.

Certain topics (named example: suicide as the organizing premise of a
public/semi-public room, as opposed to it coming up within an ordinary
support conversation) should be blocked from user-created sessions
until the platform has real clinical moderation resourced for that
specific category — not only a legal-exposure precaution but a
genuine safety one: unsupervised peer groups self-organizing explicitly
around suicide/self-harm as their premise carry a documented contagion
risk in crisis-intervention literature, distinct from crisis language
surfacing within a general conversation, which the existing per-message
deterministic escalation (`CHARTER.md` §3) already handles correctly.
This restriction needs to be named plainly in the ToS (concrete
categories, not vague reserved-rights language) before it's enforced.

Rate limiting the code-entry endpoint specifically (not just login/
OAuth) is required before this ships, independent of how weak or
strong the code format ends up being: with a small code space and
codes reused across sessions over time, an unthrottled guess endpoint
risks an uninvolved person's random or automated guess landing them in
*someone else's* private session by pure collision — a privacy
exposure that exists regardless of whether anyone is deliberately
targeting anyone. Same class of gap as `SECURITY_FINDINGS.md` H1
(OAuth callback / `sendMessage` still uncapped) and should be built
alongside it, not as a separate later pass.

Separately: whether training-data consent for the rejected-title
pattern list is the *same* purpose as the existing
`user_profiles.training_consent` field, or needs its own, is an open
question to answer deliberately rather than assume either way —
unlike the room-matching idea's consent (clearly a different purpose:
routing vs. training), this one plausibly folds into the existing
"help us train AI systems" bucket, but that needs a real answer, not
a default.

**Verdict:** promising, as refined through discussion. Ship order:
rate limiting on the code-entry endpoint is a prerequisite, not a
follow-up; the moderator-maintained blocklist (not a trained model)
and the session-level review queue are new build, not reuse; the ToS
update and the training-consent-scope determination both need answers
before user-created private sessions go live, not after.

**Why:** The core use case volunteered for this — "a real group
therapy can continue online, protected from outsiders" — sits squarely
inside `CHARTER.md`'s actual mission (anonymity, protecting a circle
from outsiders) rather than in tension with it; other possible uses of
the same generic mechanism (a debate room, an event networking session)
are accepted as incidental to what the tool permits, not something
being built for deliberately, which is the right relationship between
a generic mechanism and a specific mission. The moderator-review-over-
automation choice and the pattern-match-flags-for-review (not auto-ban)
choice both follow the same reasoning already established earlier in
this log: simple and auditable before trained and opaque, at a stage
where there isn't yet enough real attack/abuse volume to justify
anything heavier.

## 2026-09-15 — Long-horizon: B2B clinic partnerships, tenant-isolated infrastructure, white-label deployment

**Idea:** Deferred deliberately — not pursued now, logged so the
reasoning survives to whenever it's actually picked back up. Once
there's real revenue, move into B2B: partner with legitimate clinics
to improve their efficiency and reach, letting more people benefit
from clinical resources without directly burdening clinic capacity,
with clinics helping surface needs the platform wouldn't otherwise
know to build for. Possible shape floated: an exclusive/segregated
tier for clinic customers — conceptually like matchmaking segregation
in multiplayer games, but the actual goal is security isolation, not
routing/latency — up to fully separate deployed infrastructure per
tenant tier (own Postgres/Redis/compute, not just a shared app
pointing at separate databases; the isolation only holds if the
*application* processes are separately deployed too, not just the data
stores — a shared process holding credentials to both tiers is still
one blast radius regardless of DB separation). Also floated: a paywall
with a choice between standalone/self-hosted (customer owns their
data, platform keeps supporting it per their subscription/contract) or
managed cloud infra; and using the same mechanism for adjacent, non-
mental-health use cases (short-term multi-room sessions for live
events, debate platforms, general networking tools) as separate
customer types entirely.

**Verdict:** promising as a long-horizon direction, explicitly not
scoped or sequenced yet — no narrowing needed because nothing here is
being built now. The one concrete technical note worth preserving:
this repo's infrastructure is already Terraform (`IaC/`), which is the
right shape for standing up a second isolated environment later (same
application image, separate VPC/Cloud SQL/Redis/GKE namespace) without
needing to touch application code — nothing to build in advance of
actually needing it.

**Why:** Standalone/self-hosted runs directly into an already-decided
policy — `CHARTER.md` principle 5 states the moderation service's
source is deliberately not open-sourced, gated to vetted partners only
— so a self-hosting customer either brings their own moderation
(plausible for a non-mental-health white-label use case) or still
depends on a hosted moderation call-back, meaning "standalone" isn't
fully standalone; this needs resolving before it's ever promised to a
customer, not before it's logged as a direction. More broadly: a
white-label engine serving debate/networking customers is a different
product from MinCirklen's own mission-constrained policy layer
(`CHARTER.md`'s no-directory/no-solicitation/anonymity constraints are
specific to the mental-health use case, not assumed properties of the
generic mechanism) — the reusable part is the rooms/matching engine,
the mission-specific part is the policy on top of it, and conflating
the two when this gets built for real would be the actual mistake, not
the ambition itself. Explicitly out of scope until the stated
milestone (first 100 users, then real revenue) is reached.
