# GDPR ban/disclosure logic reference (local dev only)

**This is not a production runbook, and never has authorized manual
production database work.** It documents and lets you exercise, against
the local dev stack only, the two pieces of ban/disclosure logic that
`/manage`'s admin tooling needs to expose as real, RBAC-gated actions
(see `TODO.md`'s "Admin page: GDPR/trust & safety tooling") — the shape
of an `account_bans`/`account_ban_evidence` row, and what a disclosure
response must contain. Use it to understand and test that logic locally
via `https://adminer.dev-mincirklen.dk`, nothing more.

## Production: no manual database work, by anyone, ever

Nobody has standing direct access to the production database — not an
operator, not a moderator, not the platform's own founder. A ban or a
post-deletion disclosure response is only ever performed through the
`/manage` admin action once it's built; hand-editing production tables to
work around missing tooling is not an acceptable substitute, regardless
of platform scale or urgency. If the tooling described in `TODO.md`
doesn't exist yet, the action doesn't happen in production — build the
tooling first.

The one narrow exception: a trusted, NDA'd, employed operator performing
a defined infrastructure duty (an incident, a migration, a backup
restore) may get temporary, least-privilege, audited database access
scoped to that duty. That access is for infrastructure maintenance —
never for reading, handling, or acting on user content, and never as a
stand-in for the admin tooling above.

## 1. Ban logic (local dev)

Used when a user has committed a serious, confirmed policy violation
(predatory contact, harassment, crisis-language abuse, illegal content)
and the account should never be able to use the platform again — even if
they delete their account and try to sign up again with the same Google
account. This is the shape the real `/manage` ban action needs to write;
exercise it locally to understand it before it's built.

**Why this survives account deletion at all.** `account_bans` is
deliberately not foreign-keyed to `users.id` — deleting a `users` row
never touches it. The legal basis for retaining this past a deletion
request: GDPR **Article 17(3)(e)** (erasure doesn't apply to the extent
retention is necessary "for the establishment, exercise or defence of
legal claims") and **Article 6(1)(f)** / **Recital 47** (legitimate
interest in fraud/abuse prevention). This is a narrow, proportionate
record — a category and a written summary, not a copy of everything the
person ever did — which is what keeps it defensible.

**Local dev steps:**

1. In `account_bans`, insert a row:
   - `identity_hash` — the value from that user's `user_identities.provider_subject_hash`
     row (look it up by `user_id` before you delete/ban them — you'll
     need this exact value, since it's what a future login attempt gets
     checked against).
   - `provider` — `google` (currently the only provider).
   - `reason_category` — one of `predatory_contact`, `harassment`,
     `crisis_abuse`, `illegal_content`, `other`.
   - `decision_summary` — a plain-language explanation of *why*, written
     as if the banned person will read it eventually (because they might,
     via §2 below). Something like: "Repeated unsolicited off-platform
     contact requests directed at another member after being asked to
     stop, confirmed via message content on 2026-03-04."
   - `banned_by` — your name or role for local testing (e.g.
     `operator:mahan`). The real admin action must record an actual
     moderator identity here, not free text — see `TODO.md` item 4.
   - `user_id_at_ban_time` — the `users.id` you're acting on, purely as a
     historical breadcrumb (it may dangle later if the account gets
     deleted — that's expected).
2. In `account_ban_evidence`, insert one or more rows with `ban_id` set
   to the row you just created. Use `evidence_type` = `message` for a
   specific offending message (`snapshot`: `{"body": "...", "sessionId":
   "...", "createdAt": "..."}`), `moderation_event` for a relevant
   classifier/human-review outcome, or `operator_note` for anything else
   worth recording. **Don't attribute evidence to a specific reporter** —
   describe the violating content/behavior itself, not who reported it.
   This platform's reporting relies on reporters not fearing retaliation;
   that protection needs to hold even in a retained ban record.
3. If the account should be locked out immediately (not just blocked from
   *re-registering* after deletion), also set `users.banned_at` to now()
   on that user's row. This is what actually kills their current session
   and blocks further login while the account still exists — the
   `account_bans` row alone only prevents a *future* registration attempt
   with the same Google account after the account is gone.
4. Whether to also delete the account at this point is a separate call —
   `account_bans` works the same either way, since it was never linked to
   the `users` row to begin with.

## 2. Disclosure-response logic (local dev)

A banned-and-deleted user (or anyone claiming to be them) emails asking
what evidence justified banning them — this is a GDPR Article 15 (right
of access) request specifically about the `account_bans`/
`account_ban_evidence` record itself, since that's the only thing left
once their account is gone. This is the shape the real `/manage`
disclosure-response action needs to assemble; exercise it locally to
understand it before it's built.

**Local dev steps:**

1. Ask for enough to identify the right record — you likely can't ask
   them for their old `user_id` (they may not have it), so identify by
   whatever they can provide (approximate date, the Google account
   email if they're willing to share it — you'd need to recompute
   `hashIdentitySubject(subject, IDENTITY_HASH_KEY)` against it to match
   `identity_hash`, not search by the raw email, which isn't stored
   anywhere).
2. Look up the matching `account_bans` row and every `account_ban_evidence`
   row with that `ban_id`.
3. Reply with: the `reason_category`, the full `decision_summary`, and
   the evidence snapshots. Don't need to fabricate a friendlier version —
   the `decision_summary` was written in §1 specifically to be legible to
   the person it's about.
4. Include a short line on why this exists at all despite their account
   being deleted, e.g.: *"We retain a limited record of confirmed policy
   violations, independent of your account, to prevent repeat abuse.
   This is permitted under GDPR Article 17(3)(e) and Article 6(1)(f)."*
5. If the violation category was ever something subject to independent
   mandatory legal reporting (e.g. CSAM), that reporting obligation
   exists on its own, separate from this GDPR basis — don't conflate the
   two in your response, and don't treat this runbook as covering that
   process (it doesn't; no such reporting infrastructure exists in this
   codebase).

## Caveat

This runbook and the retention design it documents are built from a
careful reading of the relevant GDPR articles, not a lawyer's sign-off.
`DPIA_PRELAUNCH.md` tracks the real DPIA/lawyer consult this needs before
launch — that should happen before leaning on any of this as final legal
compliance, especially the retention-exception reasoning above, which is
the part most likely to draw regulator scrutiny if ever challenged.
