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
