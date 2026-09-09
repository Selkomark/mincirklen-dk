# Rejected ideas

A durable record of product/feature ideas evaluated against `CHARTER.md`
and rejected — kept so a rejected idea stays rejected on the record even
after a conversation moves past it, and can be re-litigated deliberately
later rather than re-proposed from scratch. Maintained by the
`idea-review` skill.

## 2026-09-05 — AI as an investigative quasi-therapist per session

**Idea:** During a live session, an AI actively investigates each
message a user sends for underlying psychological issues (using
CBT/DBT-style techniques), asks guided questions to help the user
articulate the real problem rather than offering solutions, and builds a
persistent, private "report card" map of the user's issues over time,
visible only to the user via 2FA/SMS/email-gated access. Consent for
this was proposed to be folded into the existing AI-training-consent
toggle.

**Verdict:** rejected.

**Why:** Conflicts directly with `CHARTER.md` §3 — crisis handling on
this platform must be deterministic, never left to a model's judgment
mid-conversation ("this path must never depend solely on a single
model's discretion, and it must never have a conditional bypass anywhere
in the call chain"). An AI actively investigating root causes and
deciding what to probe next is model discretion as the entire mechanism,
applied to anonymous users who may be in genuine crisis — if it misreads
someone and keeps investigating instead of surfacing crisis resources,
that's the exact failure mode §3 exists to prevent, not a UX bug.
Separately: naming clinical techniques (CBT/DBT) and systematically
building a psychological profile moves this from peer-support moderation
into automated mental-health-triage territory, a different regulatory
category regardless of how it's described in-product. Also rejected the
framing of consent: "use my messages to train a model" and "build and
store a persistent psychological profile of me" are not the same
consent — the second is GDPR Article 9 special-category processing
needing its own DPIA, and folding it into the training-consent toggle
would conflate two very different things a user is agreeing to.

See `PROMISING_IDEAS.md`'s matching entry for the narrower version worth
exploring instead.

## 2026-09-05 — Session-context severity as a posting bypass

**Idea:** Introduce a severity gradient to moderation using session
context: a plain red flag always blocks the message and shows the
warning modal, but if the session's context suggests low severity, the
system might allow the otherwise-flagged message to post anyway.

**Verdict:** rejected.

**Why:** Word-for-word CHARTER.md §3 — "This path must never depend
solely on a single model's discretion, and it must never have a
conditional bypass anywhere in the call chain." Letting session-context
severity decide whether a flagged message posts is exactly that
bypass — it just moved the discretion from message-level to
session-level, same mechanism. The failure case is also the worst one:
ambiguous "ending it" phrasing is precisely where a wrong contextual
read costs the most. Severity can still shape the *response* within the
existing fail-closed framework (resource-card wording, human-review
priority) — it can never decide whether the deterministic safety
response fires at all. See `PROMISING_IDEAS.md`'s matching entry for the
part of this idea that is sound: feeding session context into the
classifier to improve the *same* deterministic call's accuracy, not to
bypass it.
