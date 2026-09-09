# Charter

*"Make a safe and cosy place on the internet where people can finally
open up and improve their mental health."*

This is a constraint, not a feature backlog. Any product decision that
conflicts with the principles below is a bug, not a trade-off to
negotiate. Full rationale and detail lives in `docs/roadmap.md` and
`docs/tech_spec.md` — this page is the one-page version that has to hold
up on its own.

## 1. No directory, no search, no lookup

This is not a dating platform, a directory, or a social network. No
profiles to browse, no search, no way to look someone up. If a feature
makes it easier to find or contact a specific person, it does not ship.

## 2. No solicitation, no out-of-session contact

No user may use the platform to solicit, advertise, recruit, defraud, or
make contact with another user outside the structured session. Any
mechanism for exchanging contact details inside a session is either
blocked or heavily throttled and flagged.

## 3. Deterministic crisis escalation

Crisis disclosures (self-harm, suicidal ideation, harm to others) always
trigger an immediate, deterministic safety response — a resource card
and a human escalation path — regardless of what the AI model "decides."
This path must never depend solely on a single model's discretion, and
it must never have a conditional bypass anywhere in the call chain.

## 4. Anonymity by default

Real names, contact info, and precise location are never required.
Anyone who wants to add identity later opts in explicitly, and only that
person's own group ever sees it — never a public profile.

Essential account-operation data (e.g. a login email) is the one
exception: it may be collected as a condition of account creation when
there is a legitimate, stated operational reason (account security,
required user contact, legal/regulatory need) — never for building a
public or lookup-able identity (that stays governed by principle 1). Any
such data must be (a) disclosed plainly in Terms & Conditions as part of
what's collected and why, (b) encrypted at rest the same way other
identifying account data already is, and (c) fully deletable via the same
account-deletion request that removes everything else — never retained
past that request except where a *different*, already-documented legal
basis requires it (see `docs/gdpr-runbook.md`). Added 2026-09-05, alongside
the `/manage` RBAC system and its master-admin bootstrap, which is the
first feature to rely on this exception.

## 5. Radical transparency as a safety mechanism

Published moderation policy, published incident/transparency reports,
and gated independent verification of the moderation source for vetted
safety partners. (The moderation service's source itself is not publicly
open-sourced — see `docs/roadmap.md` Addendum D for why, and for the
gated-access mechanism that replaces full open-sourcing.)

---

A PR that violates any of the above is broken, not a trade-off to
negotiate — treat it the way you'd treat a failing test.
