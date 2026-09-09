# **MINCIRKLEN**
 
*(formerly **"**Project Sanctuary**"**) — mincirklen.dk*
 
An AI-moderated, anonymous peer support platform
 
**Founding Roadmap ****&**** Milestone Document**
 
Idea conceived: Saturday, August 1, 2026 — 1:14 AM
 
Founder: Mahan Hazrati
 
**Document version: v5 — last updated 2026-08-11 (added Addendum D: Moderation Transparency ****&**** Gated Source Access; added Section 11: Engineering TODO for Claude Code)**
 
*"**Make a safe and cosy place on the internet where people can finally open up and improve their mental health.**"*
 
# 0. The Milestone
 
This document marks the moment the idea was formalized: 1:14 AM, Saturday, August 1, 2026. Everything below is the first structured translation of that 1 AM idea into a working plan — legal footing, safety architecture, product scope, data strategy, and funding path. Keep this page for the eventual founding-story marketing material; the timestamp and the original framing are worth preserving verbatim.
 
# 1. Non-Negotiable Principles
 
Before any code, agree on the constitution. These are not features to prioritize later — they are constraints the architecture must satisfy from day one, because retrofitting safety into a mental-health platform after an incident is how people get hurt and how projects die.
 
- This is not a dating platform, a directory, or a social network. No profiles to browse, no search, no way to look someone up. If a feature makes it easier to find or contact a specific person, it does not ship.
 
- No user may use the platform to solicit, advertise, recruit, defraud, or make contact with another user outside the structured session. Any mechanism for exchanging contact details inside a session is either blocked or heavily throttled and flagged.
 
- Crisis disclosures (self-harm, suicidal ideation, harm to others) always trigger an immediate, deterministic safety response — a resource card and human escalation path — regardless of what the AI model "decides." This path must never depend solely on a single model's discretion.
 
- Anonymity by default. Real names, contact info, and precise location are never required. Anyone who wants to add identity later opts in explicitly, and only that person's own group ever sees it — never a public profile.
 
- Radical transparency as a safety mechanism: published moderation policy, published incident/transparency reports, and gated independent verification of the moderation source for vetted safety partners (refined in Addendum D — full public open-sourcing of the moderation service itself is no longer the model; see Addendum D for the reasoning and the replacement mechanism).
 
Write this as an actual one-page charter, put it in the repo's root as CHARTER.md, and treat any product decision that conflicts with it as a bug, not a trade-off to negotiate.
 
# 2. How I'll Support This (COO / CFO / Security roles)
 
Practically, that support breaks into three lenses I'll keep applying as you build:
 
- COO lens — sequencing, scope discipline, keeping the roadmap realistic, translating "what proven interventions actually help" into product decisions.
 
- Data science lens — how to measure whether a session actually helped someone, how to tune the moderation model without overfitting to false positives, what metrics matter versus what's vanity.
 
- Security lens — threat-modeling the specific ways bad actors will try to abuse an anonymous, emotionally vulnerable user base, and the concrete mitigations for each.
 
- CFO lens — keeping the cost structure lean enough that a pay-what-you-can model can sustain it, and building the credibility (transparency, gated verification, eventual nonprofit wrapper) that makes public/NGO or private funding realistic.
 
# 3. Phase 0 — Legal & Regulatory Foundation (do this before writing product code)
 
## 3.1 Regulatory classification
 
Under EU Medical Device Regulation (MDR 2017/745), software becomes a regulated medical device when its stated purpose is diagnosis, monitoring, prevention, or treatment of a disease — determined by your actual claims and marketing, not just what the code does. A peer-support platform that explicitly does not diagnose, does not create personalized treatment plans, and markets itself as "peer support and structured venting," not "therapy" or "treatment," is very likely positioned as a wellness product rather than a medical device — but this needs a lawyer's sign-off, not an assumption. This single decision affects almost everything downstream, so get written legal advice on positioning before you finalize copy, onboarding language, or the pitch deck.
 
## 3.2 Data protection (GDPR)
 
Anything resembling mental health disclosure is "special category data" under GDPR Article 9, which requires an explicit legal basis (typically explicit consent) and heightened safeguards. Before launch, even a small pilot, you need a Data Protection Impact Assessment (DPIA), a clear data retention policy (how long are session transcripts kept, and why), and ideally a conversation with Datatilsynet (the Danish Data Protection Agency) or a GDPR-specialized lawyer, since "we don't store PII" doesn't fully exempt you — the content of what people say is itself the sensitive data.
 
## 3.3 Legal entity
 
Denmark's nonprofit landscape runs on two tracks: ordinary (non-commercial) foundations supervised by Civilstyrelsen, and commercial foundations supervised by Erhvervsstyrelsen; associations (foreninger) are the lighter-weight, faster-to-set-up option many early-stage NGOs use before converting to a fond once there's real capital and a track record. Given your funding strategy (public bodies, NGOs, eventual government backing), a nonprofit association now, with a path to a fond later, is the structure that matches how Danish funders expect to evaluate you — commercial structures are explicitly excluded by name from several major funders' eligibility rules, including TrygFonden. (Current operating status: deferred — see the Entity & Funding Path addendum; Selkomark sole proprietorship operates the platform for now.)
 
## 3.4 Insurance & liability
 
Get professional liability / general liability coverage before opening this to real strangers, and have a lawyer draft terms of service that state plainly what the platform is not (not a crisis line, not a replacement for professional treatment, not a substitute for emergency services) — this is both an ethical obligation and your primary legal shield.
 
# 4. Phase 1 — Trust & Safety / Security Architecture
 
This is the part that decides whether the platform is safe or a liability. Threat-model it explicitly rather than bolting on moderation later.
 
## 4.1 Threat model — who will try to abuse this, and how
 
- Predators seeking vulnerable people: mitigate with a hard rule against sharing contact info (phone, socials, addresses, external links) — detect and auto-redact in real time, not just after the fact — and no user directory, no search, no way to "find" someone across sessions.
 
- Advertisers / spam / scams: rate-limit message frequency and links, run every message through a lightweight classifier before it's shown to the group, and shadow-throttle repeat offenders rather than instantly banning (instant bans teach abusers to evade detection faster).
 
- Self-harm or harm-to-others disclosures: this is not a "moderation" problem, it's a safety-response problem. The system must surface a crisis resource (e.g., Livslinien in Denmark, or the relevant local equivalent based on user locale) immediately and deterministically, and separately alert a human-in-the-loop reviewer — never rely on the fine-tuned model's judgment alone for this category.
 
- Bots / sybil accounts / AI-generated participants: the anonymity requirement makes this the hardest problem on the list, because most bot-prevention tech (government ID, biometrics, phone-linked accounts) directly conflicts with the anonymity promise. The practical middle ground in 2026 is proof-of-personhood without identity disclosure — approaches like zero-knowledge personhood credentials (e.g., Semaphore-based schemes), passkey/WebAuthn device attestation, or a one-time phone-number check that's hashed and immediately discarded (never stored, never linked to the pseudonym). None of these are perfect; combine 2–3 weak signals rather than betting on one strong one.
 
- Data breach / subpoena exposure: minimize retention aggressively (auto-delete transcripts after the safety-review window closes), encrypt at rest and in transit, and design so that even you, as operator, cannot casually re-identify a user from stored data.
 
## 4.2 The AI moderator — two tiers, not one
 
Tier 1: a fast, cheap, real-time classifier that screens every message before or as it's shown, tuned for toxicity, solicitation, and crisis-language detection — this can be a small, well-audited open model rather than a frontier LLM, since it needs to be fast, explainable, and cheap enough to run on every message. Tier 2: a slower session-level pass (a more capable fine-tuned model, prompted with clinical-communication guidelines) that looks at patterns across a whole session for things a single message won't reveal, like slow-building grooming behavior or a user quietly escalating toward crisis. Critically, Tier 1's crisis-flag path must be hard-wired to a deterministic response (resource card + human alert), not gated behind Tier 2's slower, more "judgment-based" pass.
 
## 4.3 Human backstop
 
Even at the smallest pilot scale, budget for a human moderator or clinical advisor who can be paged when the AI flags something serious. Fully autonomous crisis handling is where every comparable platform has drawn the line — Crisis Text Line, for instance, remains volunteer-and-staff powered even with tech tooling underneath. This is the one place where "lean" should lose to "safe."
 
# 5. Phase 2 — MVP Scope
 
Resist the urge to build the full round-robin, multi-group-type, agentic system first. A believable MVP is small enough that a human can review every flagged message manually.
 
- One room type, one small cohort size (6–8 people), text-only, strict round-robin turn order.
 
- One Tier-1 classifier (toxicity, solicitation, crisis keywords) reviewed by a human for every flag, no exceptions, at this scale.
 
- One on-call human moderator / advisor for the pilot's live hours.
 
- A simple post-session feedback signal (a single anonymous 1–5 rating: "did this help?") — this is your first data science instrument, and it's enough to start.
 
- Recruit the pilot cohort from a trusted, small circle first — friends-of-friends or a partnership with an existing peer-support NGO (see Phase 4) — rather than opening it to the public internet on day one.
 
# 6. Phase 3 — Data Science: Measuring Whether It's Actually Helping
 
The honest answer to "is this session good" is hard to get directly, so triangulate with proxies and be skeptical of any single number.
 
- Behavioral proxies: return rate (do people come back to another session), completion rate (do they finish the round instead of leaving mid-session), and time-to-return after a rough session.
 
- Direct signal: the 1–5 post-session rating, plus an optional one-line "what would have made this better" free-text field, read by a human, not just aggregated.
 
- Moderation quality: track false-positive rate (messages wrongly flagged, which erodes trust) and false-negative rate (things that should've been flagged and weren't) as a first-class metric, not an afterthought — this is the number that should drive retraining priority, more than raw engagement.
 
- Resist vanity metrics like "messages sent" or "time on platform" as success measures — for a mental health tool, more engagement isn't obviously good, and optimizing for it is a known failure mode of consumer social products you explicitly don't want to copy.
 
As you get real session data, this is where I can help directly with model selection (what's the right size/type of model for the Tier 1 classifier), evaluation design (how to avoid overfitting the crisis-detection model to your specific pilot cohort), and the statistics of interpreting a small early sample without fooling yourself.
 
# 7. Phase 4 — Business Model & Funding (CFO lens)
 
## 7.1 Revenue shape
 
Pay-what-you-can subscription starting at roughly $1/month for extra rounds or priority queue access, with a free tier that always covers basic access — this matches your stated end goal of the platform eventually being free for everyone, funded increasingly by grants and donations rather than user payments as those come online. (Refined in Appendix C: free tier is 5 sessions/week; paid tier is $1 or $5, weekly or monthly, raising the session cap only — never turn length or speaking time.)
 
## 7.2 Cost discipline
 
Your dominant variable cost will be LLM inference. Keep the real-time Tier 1 classifier on a small, self-hostable or cheap open model, and reserve any frontier-model calls for the rarer Tier 2 session-level pass or genuinely ambiguous escalations — this is both a cost decision and a safety one, since a smaller, well-understood model is easier to audit for why it flagged (or missed) something.
 
## 7.3 Nonprofit wrapper + funding path
 
Register as a forening (association) now — fast, cheap, matches early-stage NGO norms in Denmark — with a stated path to convert into a fond once there's a track record and real capital, since several major funders (TrygFonden explicitly among them) exclude commercially structured applicants by rule. (Current status: deferred — see the Entity & Funding Path addendum.) Concretely worth approaching, roughly in order of fit:
 
- TrygFonden — funds tryghed (safety/security), sundhed (health), and trivsel (wellbeing) projects specifically, runs two annual application rounds (deadlines March 1 and September 1), explicitly funds NGOs/associations/researchers, and explicitly excludes commercial or political projects — a strong structural match if you're registered as a forening.
 
- Novo Nordisk Fonden — Denmark's largest private research/health foundation; less likely for an early pilot but relevant once you have pilot data and want to scale into a research-backed phase.
 
- Innovationsfonden (Danish public innovation fund) and EU programs like EIT Health / Horizon Europe digital-health calls — worth tracking once you have a working pilot and some outcome signal, since public innovation funding usually wants evidence of traction, not just an idea.
 
- Sundhedsstyrelsen (Danish Health Authority) and municipal social-affairs departments — the public-sector angle you specifically wanted; preventive, low-cost-to-operate mental health tools fit squarely inside public health strategy, but this is a relationship to build over months, generally after you can show pilot outcomes, not before.
 
- Partnership over cold outreach: existing Danish peer-support organizations — Headspace Danmark (youth-focused, endorsed in 30 municipalities), Psykiatrifonden, and Livslinien (suicide-prevention hotline) — are natural pilot partners and credibility co-signers long before you need a government meeting; a warm introduction through one of them will open doors that a cold pitch to a ministry won't.
 
## 7.4 Transparency as a funding asset
 
Publishing a moderation policy manifesto and an annual transparency report (finances, incident summaries, moderation false-positive/negative rates) is not just an ethical stance — it's a strong credibility signal for a Danish public-sector or foundation funder evaluating a mental-health-adjacent nonprofit. (Refined in Addendum D: the moderation service's source is not publicly open-sourced; instead, gated independent verification is offered to vetted NGO/research/government safety partners under NDA, which preserves both the safety rationale for keeping detection specifics private and a credible, auditable answer to funders who ask "how do we know the deterministic-escalation claim is true.")
 
# 8. Phase 5 — Go-to-Market & Outreach
 
- Closed pilot with a small cohort, ideally co-recruited with one NGO partner for legitimacy and safety backstop (they may already have crisis-response infrastructure you can lean on rather than building from scratch).
 
- Collect 2–3 months of pilot data (feedback ratings, moderation performance, return rates) before any public launch or funding pitch — you need a story with numbers, not just the idea.
 
- Approach one warm NGO partner first (Headspace Danmark or Psykiatrifonden are the closest thematic fits) for endorsement or co-pilot status.
 
- Apply to TrygFonden's next round once registered as a forening and once you have pilot data — note the March 1 / September 1 deadlines.
 
- Use this document's Phase 0 milestone (today, August 1, 2026) as the founding-story anchor for later press/marketing material once there's a real pilot to point to.
 
# 9. Immediate Next Actions (this month)
 
- Write CHARTER.md (Section 1 above) and put it in the repo root before writing any product code.
 
- Book a short consult with a Danish lawyer familiar with digital health / GDPR to sanity-check the MDR/wellness positioning, draft baseline ToS, and template the moderation-source NDA + acceptable-use agreement described in Addendum D.
 
- Register the forening — this is fast and cheap, and unlocks NGO-appropriate funding conversations early (deferred for now per the Entity & Funding Path addendum).
 
- Draft the pilot design (Phase 2 MVP) as a one-pager and identify 1 candidate NGO partner to approach for a co-pilot.
 
- Draft the public moderation manifesto page (Addendum D) once the moderation service is finalized.
 
# 10. Open Risks Worth Sitting With
 
A few things worth being honest about rather than optimistic about: fully automated crisis detection will have false negatives no matter how good the model is, so the human backstop in Section 4.3 is not a temporary MVP shortcut — it's a permanent structural requirement, and the business model needs to keep budgeting for it even at scale. Anonymity and abuse-prevention are in genuine tension; every mitigation in Section 4.1 is a partial one, and the honest framing to funders and users alike is "we've reduced the risk substantially," not "we've solved it." Regulatory positioning (Section 3.1) is a legal judgment call, not a technical one — get it in writing from a lawyer before it's load-bearing for your funding pitch or your liability exposure. And the gated-transparency model in Addendum D is itself a trade-off, not a solved problem: a skeptical funder or journalist can fairly characterize it as "trust me, but for the vetted few" — have that framing ready rather than being caught by it.
 
# Appendix A — Progressive Trust & the "Live Thought Stream" Feature
 
Founder's idea (added post-launch of this document): new users start in a probationary tier where their messages are heavily monitored before being shown. Good behavior over time (a set number of hours, days, or messages) earns a hidden "respect" score, visible only to the system, never to the user or the group. Once earned, a user unlocks "live" mode — their text appears to the group character-by-character as they type it, so it reads as a real-time stream of thought rather than a submitted message, building presence and anticipation.
 
## A.1 The trust ladder — good instinct, solid precedent
 
This is a well-tested pattern, not a novel gamble: Discourse's trust-level system and Stack Overflow's reputation gating both work the same way — new accounts run under tighter constraints and unlock capabilities as behavior demonstrates they're not a problem. Applying it here is sound. Two changes make it fit this specific platform:
 
- Keep the score fully invisible — not just hidden from other users, but never surfaced to the user themselves either, as a number, a badge, or a progress bar. The moment it's visible as "points," people optimize for the score instead of for genuinely engaging, which is exactly the gamification dynamic a mental-health space should avoid.
 
- Split what feeds the score into two categories that must never be conflated: safety violations (advertising, harassment, solicitation, attempts to extract contact info, repeated guideline-breaking) should lower trust and slow someone's progression. Distress content — self-harm disclosure, suicidal ideation, expressions of hopelessness — must never lower trust, even though it triggers the Section 4.1 crisis response.
 
## A.2 The live-typing feature — the effect is worth having, the raw version isn't safe
 
The fix keeps almost all of the emotional effect while closing the gap: reveal in small buffered chunks — at natural pauses (word or clause boundaries) with a short rolling delay (on the order of a second or two) — rather than raw keystrokes. That delay is enough room for the Tier-1 classifier to scan each chunk before it renders, while still reading as "live" to everyone watching.
 
## A.3 Make it opt-in, not automatic, even once unlocked
 
Recommend that reaching the trust threshold unlocks the option to go live, rather than switching everyone into it automatically.
 
## A.4 Sequencing
 
Treat this as a Phase 2.5 feature: build it once the Tier-1 classifier has real accuracy data from the pilot.
 
# Appendix B — Vanguard Modeling Language (VML) as the Moderation Backbone
 
Adopted as an independent, versioned dependency (git submodule, github.com/Selkomark/vanguard-modeling-language, v1.1.0 on PyPI) for authoring the rules, threat-model definitions, and fine-tuning/context-injection material the platform's AI moderator needs. Compile-time only — no runtime orchestrator; that piece is built separately, scoped to this platform's MVP needs.
 
# Addendum — Entity & Funding Path (Aug 1, 2026)
 
Decision: MinCirklen operates under Selkomark (sole proprietorship, CVR 45008118, Denmark) as the operating entity for now. The Section 3.3 forening recommendation is deferred, not abandoned. Self-funded at 2,000–5,000 DKK/month. Conversion trigger: once the platform shows real traction, bring in an investor or partner to fund and support conversion to a nonprofit structure, reopening the NGO and public-funding path.
 
# Addendum — Open Unknown: Cost-Per-Session (Aug 1, 2026)
 
Flagged as a deliberate open unknown: the true fully-loaded cost of running one group session is unmeasured. Plan: treat the alpha/beta pilot as the instrument for measuring this. Until this data exists, no pricing tier, revenue projection, or profitability claim in this document should be treated as more than a placeholder.
 
# Appendix C — Round Pacing & Access Model (Aug 4, 2026)
 
## C.1 Round pacing mechanic
 
Round-robin order is preserved. Each person's turn opens with a 5–10 second engage-window; if unclaimed, the system skips to the next person in order. A missed engage-window is a skip, never an elimination. On engage, roughly 60 seconds to type, with dynamic extension while typing, then a 2–3 second "sending…" grace beat with cancel/edit before auto-send. A manual send button remains available.
 
## C.2 Access & pricing model
 
Free tier: 5 sessions per week. Paid tier: $1 or $5, weekly or monthly (user's choice), raises the session cap above 5/week — recurring, not one-time. Turn length and typing time are identical for every user regardless of tier — payment buys more sessions per week, never more time or space to speak within a session.
 
## C.3 Open questions for pilot data
 
The actual distribution of engage-window response times and typing durations; the right fallback behavior for a fully-silent lap; whether the free/paid numbers are right once real usage and cost-per-session data exist.
 
# Addendum D — Moderation Transparency & Gated Source Access (Aug 11, 2026)
 
This addendum supersedes the "open-source everything, including the moderation service" language implied in Section 1 and Section 7.4's earlier drafting. The moderation service's source code is not publicly open-sourced. This is a deliberate decision, made for two stated reasons: (1) safety — publishing exact detection rules, thresholds, and prompts materially helps bad actors probe for and exploit gaps in crisis and abuse detection; and (2) funding — the founder is pursuing a private-investment path in parallel with the public/NGO path, and full public disclosure of the moderation IP would undermine that option. The platform's UI/application code remains open-source (so any org can self-host for full data privacy), but the moderation service — including the fine-tuned model reference, prompts, and detection thresholds — is proprietary.
 
## D.1 What stays open
 
- The full UI and application source code, so any NGO or organization can self-host their own instance for data privacy.
 
- The routing/escalation guarantee — the code path that enforces "if the moderation service returns a crisis flag, the deterministic escalation route always fires, with no model-discretion override" — kept open specifically so the Section 1 safety promise is independently auditable without exposing detection internals.
 
- A public moderation manifesto (see D.2) and ongoing transparency reporting (aggregate false-positive/false-negative rates, incident summaries) per Section 7.4.
 
## D.2 The public moderation manifesto
 
Once the moderation service is finalized, publish a manifesto page on the platform website covering: the categories of content flagged (predatory contact, solicitation, crisis language, harassment) at a category level, not exact rules or keyword lists; the escalation guarantee in plain language; and aggregate transparency metrics from Section 6 tracking. This is the primary public-facing transparency artifact and is designed to satisfy funder and user trust without exposing exploitable specifics.
 
## D.3 Gated source access for vetted safety partners
 
The manifesto page includes a request-access mechanism for independent verification, open to organizations — not individuals — that can demonstrate a genuine safety/public-work affiliation. Proposed flow:
 
- Request form: organization name and type (NGO, university/research institution, government health body, accredited safety researcher), stated purpose (audit, self-hosting evaluation, academic research), and a named contact.
 
- Verification, roughly in order of trust: registered NGO/nonprofit (checked against a national registry, e.g. Danish CVR or equivalent abroad); university/research institution (verified via institutional email domain plus a named supervisor or PI); government health body (verified via official domain).
 
- Manual review of every request — approval is not automated, since this is exactly the kind of judgment call that shouldn't be a form-submit-and-done process.
 
- A legal wrapper before any access is granted: an NDA plus acceptable-use agreement (study/audit only, no redistribution, no derivative commercial use, explicit prohibition on using knowledge gained to build evasion techniques). Template this with the same lawyer engaged for Section 3.4 ToS work.
 
- Time-limited, revocable access via a private repository invite with an expiry, not a permanent grant; watermark or version-track what was shared with whom so a leak is traceable.
 
- Log every request and grant/denial decision — the log itself becomes a citable transparency artifact ("N organizations vetted, M granted access") without exposing the code.
 
## D.4 Known trade-off
 
This model is controlled transparency, not full transparency. It satisfies "independently verifiable" for funders and partners willing to request access, but a skeptical funder, journalist, or user can fairly characterize it as "trust me, but for the vetted few." This trade-off is accepted knowingly, not something to be caught off guard by later. Track NGO/public-sector funder reaction to this model during outreach (Section 7.3) as an early signal of whether the gated approach is sufficient or needs revisiting.
 
# 11. Engineering TODO — For a Future Claude Code Session
 
This section is a working checklist, not narrative documentation — pull it into a Claude Code session when building the platform features it describes. Each item ties back to a section above.
 
- All backend services (tRPC API, WebSocket service, moderation service) must follow the architecture defined in `ARCHITECTURE.md` — Clean Architecture Controller/Service/Repository-Adapter layering, Hono on Bun, Kysely as the only Postgres access layer, and TDD with a 100% coverage target. Treat a PR that violates it the same way `CHARTER.md` treats a product decision that conflicts with Section 1.

- Build the moderation service as a separate Cloud Run service, called by the tRPC API's Cloud Run service — not colocated in the same deployment (Addendum D, D.1).
 
- Set up the separate fine-tuning pipeline repository: trains/fine-tunes the moderation model, then writes a reference (model ID/endpoint) to Secret Manager on successful deploy.
 
- Main platform repo's moderation service reads the fine-tuned model reference from Secret Manager at startup/deploy — never hardcode the model reference in the open-source-adjacent repo.
 
- Implement the deterministic crisis-escalation route as its own small, open-sourced code path (Addendum D.1) — independent of the moderation service's internal detection logic, so it can be audited without exposing detection internals. Verify: a crisis flag from the moderation service always triggers this route, with no conditional bypass anywhere in the call chain.
 
- Build the public moderation manifesto page (Addendum D.2) once the moderation service is finalized — category-level flag descriptions, escalation guarantee, transparency metrics.
 
- Build the gated source-access request flow (Addendum D.3): request form, manual review queue/admin view, NDA + acceptable-use agreement attachment step, time-limited repo invite issuance, and an access-log record (organization, decision, date, expiry).
 
- Round pacing mechanic (Appendix C.1): 5–10s engage-window with skip-not-eliminate behavior, ~60s typing window with dynamic extension, 2–3s send-grace-beat with cancel/edit, manual send override. Sequence as Phase 2.5, after plain round-robin MVP is piloted.
 
- Access/pricing tiers (Appendix C.2): free tier session-cap enforcement (5/week), paid tier cap increase ($1 or $5, weekly or monthly) — implement as a session-count gate only, never a per-turn time or message-length gate, to preserve the Section 1 equity-in-expression constraint.
 
- WebSocket/NATS/Redis fanout architecture per the cloud architecture discussion: GKE Autopilot for WS pods and NATS (standard, non-spot for NATS; spot acceptable for stateless WS pods), Redis for room/matchmaking state (AOF persistence, non-spot), Cloud SQL for chat history, Cloud Run for tRPC + moderation service.
 
- Instrument Section 6 metrics from day one of the pilot: return rate, completion rate, time-to-return, 1–5 post-session rating, free-text feedback, moderation false-positive/negative rate.