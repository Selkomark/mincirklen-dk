export type PublicPageId =
  | 'how-it-works'
  | 'safety-and-moderation'
  | 'account-and-data'
  | 'crisis-resources'
  | 'privacy-policy'
  | 'community-guidelines'
  | 'terms-and-conditions'
  | 'about'
  | 'pricing'
  | 'facilitators'
  | 'contact'

export interface PublicPageData {
  id: PublicPageId
  title: string
  intro: string
  sections: { heading: string; body: string }[]
  urgent?: boolean
}

// Builds a real, shareable path for a public page — e.g. "/privacy-policy" in dev,
// "/MinCirklen.dk/privacy-policy" once deployed. Always use this instead of a raw
// string so links keep working under the GitHub Pages base path. Page ids live at the
// top level (not under "/p/") — App.tsx guards against them colliding with the app's
// own reserved routes (system-design, new, s).
export function publicPagePath(id: PublicPageId): string {
  return `${import.meta.env.BASE_URL}${id}`
}

export const PUBLIC_PAGE_ORDER: PublicPageId[] = [
  'how-it-works',
  'safety-and-moderation',
  'account-and-data',
  'crisis-resources',
  'community-guidelines',
  'privacy-policy',
  'terms-and-conditions',
  'pricing',
  'facilitators',
  'about',
  'contact',
]

export const PUBLIC_PAGES: Record<PublicPageId, PublicPageData> = {
  'how-it-works': {
    id: 'how-it-works',
    title: 'How it works',
    intro: 'MinCirklen connects you with small, anonymous peer-support circles — no account and no real name required.',
    sections: [
      {
        heading: 'Find a circle',
        body: 'Browse circles by topic and time from the sidebar, or start your own with the topic, length, and group size you want. Each circle holds up to 12 people plus a facilitator.',
      },
      {
        heading: 'Turn-based sharing',
        body: "Circles use a simple turn system so everyone gets space to speak. When it's your turn you'll have about 20 seconds before your message sends automatically — or you can turn that off and send whenever you're ready.",
      },
      {
        heading: 'A facilitator is always present',
        body: 'Every session has a trained facilitator who keeps the conversation safe, on-topic, and within the community guidelines. They can pause a session or remove a user if needed.',
      },
      {
        heading: 'Leave anytime',
        body: 'You can leave a session at any point, for any reason, without explaining why. Nothing is held against you, and you can rejoin a different circle whenever you want.',
      },
    ],
  },
  'safety-and-moderation': {
    id: 'safety-and-moderation',
    title: 'Safety and moderation',
    intro: 'Every circle is built around a small set of non-negotiable rules, enforced by a trained facilitator in every session.',
    sections: [
      {
        heading: 'The non-negotiable rules',
        body: 'Protecting anonymity, no advertising or soliciting, no endorsing outside services, and keeping sharing to personal experience rather than medical or legal advice. You agree to these before joining your first circle, and they apply to every session. The full list lives on the Community guidelines page.',
      },
      {
        heading: 'Two layers of moderation',
        body: "Every message passes through a lightweight safety check before the group sees it, tuned to catch things like contact-info sharing, solicitation, and crisis language. A trained human is always reachable behind that — safety decisions that matter are never left to software alone.",
      },
      {
        heading: 'Reporting a concern',
        body: 'Use "Report this session" from any active circle to flag a message or user. Reports are anonymous — nobody in the circle is notified — and go straight to a moderator, usually reviewed within 24 hours.',
      },
      {
        heading: 'What gets a session ended',
        body: 'A facilitator can end a session immediately for harassment, doxxing, solicitation, or anything that puts a user at risk. Repeated or serious violations can result in an account being removed.',
      },
      {
        heading: 'When it becomes an emergency',
        body: "Moderation handles behavior inside a circle. If you or someone else is in immediate danger, that's not something to wait on a report for — see Crisis resources instead.",
      },
      {
        heading: 'Want the deeper answer?',
        body: 'This page covers what moderation feels like from inside a session. For how the crisis-escalation guarantee actually works, what stays private and why, and how an outside organization can request independent verification, see the Moderation & Transparency page in the footer.',
      },
    ],
  },
  'account-and-data': {
    id: 'account-and-data',
    title: 'Account and data',
    intro: "MinCirklen is built to need as little of your data as possible, and to make it easy to remove what's there.",
    sections: [
      {
        heading: 'Anonymous by default',
        body: "You don't need a real name, photo, or email to join a circle. Other users only ever see the anonymous label you're given for that session, like \"User 2.\"",
      },
      {
        heading: 'What we store',
        body: "While a circle is live, messages are visible to that session's users and facilitator for moderation purposes. Session transcripts are not shared with users after the session ends, and are retained only as long as needed for safety review.",
      },
      {
        heading: 'Who can see what',
        body: "Facilitators can see messages within sessions they're facilitating. Moderators can see reported messages and the context immediately around them — never a full account history.",
      },
      {
        heading: 'Deleting your data',
        body: 'You can request deletion of your account and associated data at any time. Deletion is permanent and typically completes within 30 days. See the Privacy policy for the full detail.',
      },
    ],
  },
  'crisis-resources': {
    id: 'crisis-resources',
    title: 'Crisis resources',
    intro: 'MinCirklen is peer support, not emergency or crisis care. If you or someone else is in immediate danger, please reach out to one of the services below right away.',
    urgent: true,
    sections: [
      {
        heading: 'Emergency services',
        body: 'If there is an immediate risk to life, contact your local emergency number — 112 in Denmark and the EU, 911 in the US, 999 in the UK.',
      },
      {
        heading: 'Denmark — Livslinien',
        body: 'Call 70 201 201 (daily, 11:00–04:00) for confidential support around suicidal thoughts, for yourself or someone you\'re worried about.',
      },
      {
        heading: 'United States — 988 Suicide & Crisis Lifeline',
        body: 'Call or text 988, available 24/7, for confidential crisis support.',
      },
      {
        heading: 'United Kingdom & Ireland — Samaritans',
        body: 'Call 116 123, free and available 24/7, for confidential emotional support.',
      },
      {
        heading: 'Inside a session',
        body: 'You can also leave any circle immediately, for any reason, with no explanation needed — the "Leave session" control is always available while a circle is live.',
      },
    ],
  },
  'community-guidelines': {
    id: 'community-guidelines',
    title: 'Community guidelines',
    intro: 'These are the same rules every user agrees to before joining their first circle. They are non-negotiable, and they apply to every session, every time.',
    sections: [
      {
        heading: 'Protect your anonymity',
        body: "Never share your full name, phone number, address, email, or other identifying details in a circle — yours or anyone else's. Anonymity isn't a setting here, it's the foundation everything else is built on.",
      },
      {
        heading: 'No advertising or soliciting',
        body: "Don't promote a business, service, or product, and don't ask other users to pay for anything, in or outside a session.",
      },
      {
        heading: 'No endorsements or recommendations',
        body: "Don't recommend or endorse specific practitioners, treatments, or outside services. This isn't a referral space, and mixing peer support with product recommendations puts vulnerable people at risk.",
      },
      {
        heading: "Support, don't direct",
        body: 'Share your own experience, not medical or legal advice. Listening is always enough — nobody is expected to fix another user, only to be present with them.',
      },
      {
        heading: 'Report or leave anytime',
        body: "If something feels wrong, or you're in crisis, use Report or Crisis resources right away. Nobody has to explain why they left a session, and nothing about leaving is held against you.",
      },
      {
        heading: 'How this is enforced',
        body: 'Every message is screened before the group sees it, and a trained human is always reachable behind that check. Breaking these rules can get a session ended immediately; repeated or serious violations can result in an account being removed. See Safety and moderation for the full picture.',
      },
    ],
  },
  'privacy-policy': {
    id: 'privacy-policy',
    title: 'Privacy policy',
    intro: 'MinCirklen is built to collect as little of your data as possible, and to make it easy to remove what is there. This page explains what we collect, why, and what you can do about it.',
    sections: [
      {
        heading: 'Data controller',
        body: 'MinCirklen is owned and operated by Selkomark (CVR 45008118), Denmark, which is the data controller for the information described on this page under the EU General Data Protection Regulation (GDPR). For any data protection request, contact mahan@selkomark.com.',
      },
      {
        heading: 'What we collect',
        body: "Joining a circle never requires a real name, email, or account. The main thing we process is the content of the messages you send during a live session, for the safety and moderation purposes described in Safety and moderation. Registering also collects a first and last name, country, and mobile number, used only to prevent spam and duplicate accounts — never shown to other users unless you turn anonymity off yourself.",
      },
      {
        heading: 'Sensitive content',
        body: "Because peer-support conversations can touch on mental health, some of what you share may count as special category data under GDPR Article 9. We only process it on the basis of the explicit consent you give when you join a circle, and only for the purposes described here.",
      },
      {
        heading: 'Legal basis for processing',
        body: "Session content and any special category data are processed under your explicit consent (GDPR Article 6(1)(a) and Article 9(2)(a)), given when you agree to the community guidelines and join a circle. Basic account details are processed to perform our agreement with you (Article 6(1)(b)) and to prevent abuse of the service, a legitimate interest (Article 6(1)(f)).",
      },
      {
        heading: 'Retention',
        body: "Session content is kept only as long as needed for safety review, then deleted. We don't build a persistent profile of what you've shared across different sessions.",
      },
      {
        heading: 'Who can see what',
        body: 'Facilitators can see messages within sessions they run. Moderators can see reported messages and the surrounding context — never a full history of everything you have ever said on the platform.',
      },
      {
        heading: 'Cookies',
        body: "We use only the cookies needed to run the site — remembering your theme and your cookie choice. We don't currently use analytics or advertising cookies; if that ever changes, you'll be asked first. You can review or change your choice at any time via \"Cookie preferences\" in the footer of any page.",
      },
      {
        heading: 'Your rights under GDPR',
        body: "You can request access to, correction of, or deletion of your data at any time, restrict or object to how it's processed, ask for it in a portable format, and withdraw consent whenever you like — none of this affects the lawfulness of processing before you withdraw it. You can download a copy of your data or permanently delete your account directly from Settings → Privacy and data; deletion is immediate. In cases of a confirmed serious policy violation, we retain a limited record of the violation — a category and a brief written summary, not your messages or profile — independently of and beyond your account's deletion, specifically to prevent the same person rejoining after deleting their account. This is permitted under GDPR Article 17(3)(e) and Article 6(1)(f). We do not sell or share your data with advertisers. For anything not available directly in Settings, use Contact. You can also lodge a complaint with the Danish Data Protection Agency (Datatilsynet, datatilsynet.dk) if you believe your rights haven't been respected.",
      },
      {
        heading: 'Changes to this policy',
        body: "If this policy changes in a way that matters, we'll make that clear here before it takes effect.",
      },
    ],
  },
  'terms-and-conditions': {
    id: 'terms-and-conditions',
    title: 'Terms and conditions',
    intro: 'Please read these terms before using MinCirklen. By joining a circle, you agree to them.',
    sections: [
      {
        heading: 'What MinCirklen is — and is not',
        body: "MinCirklen is peer support: a structured space to be heard by other people. It is not therapy, not a medical device, not a crisis line, and not a replacement for professional care or emergency services. If you are in danger, see Crisis resources.",
      },
      {
        heading: 'Your conduct',
        body: "You agree to follow the Community guidelines: no soliciting, advertising, or attempting to contact another user outside a structured session; no sharing anyone's personal information, including your own.",
      },
      {
        heading: 'Data we collect',
        body: "To keep your account secure and to contact you about it, we collect and encrypt your email address as part of essential account data — this is not optional and not part of any public profile, and it's never used to build a directory or let anyone look you up. If you no longer want MinCirklen to hold your data, including your email, you can request full account deletion at any time; see Privacy and data in Settings.",
      },
      {
        heading: 'Moderation and enforcement',
        body: 'Sessions are monitored for safety, as described in Safety and moderation. We may end a session, remove a message, or remove an account at our discretion when these terms or the community guidelines are broken.',
      },
      {
        heading: 'No liability for session content',
        body: 'MinCirklen and its facilitators are not liable for advice, opinions, or outcomes shared by users within a session. Nothing said in a circle should be treated as professional, medical, or legal advice.',
      },
      {
        heading: 'Changes to these terms',
        body: "We may update these terms as MinCirklen grows. Continuing to use the platform after a change means you accept the updated terms.",
      },
    ],
  },
  about: {
    id: 'about',
    title: 'About MinCirklen',
    intro: 'Make a safe and cosy place on the internet where people can finally open up and improve their mental health.',
    sections: [
      {
        heading: 'Why we exist',
        body: "MinCirklen started as a simple idea: that peer support, done carefully and safely, genuinely helps — and that most of the internet makes it harder, not easier, to open up.",
      },
      {
        heading: 'How we\'re different',
        body: "There are no profiles to browse, no directory, and no way to look someone up. If a feature would make it easier to find or contact a specific person, we don't build it. Anonymity isn't a setting here — it's the foundation.",
      },
      {
        heading: 'Radical transparency',
        body: 'We earn trust by being inspectable, not by promising to be trustworthy: open-source code, a published moderation policy, and published transparency reports as the platform grows.',
      },
      {
        heading: 'Where we are today',
        body: "MinCirklen is in its earliest pilot stage, self-funded, and growing deliberately rather than quickly — safety architecture comes before scale.",
      },
    ],
  },
  pricing: {
    id: 'pricing',
    title: 'Pricing',
    intro: "We're still in early pilot, and haven't finalized pricing yet — here's what we can commit to today.",
    sections: [
      {
        heading: 'Free during the pilot',
        body: "Every account can join and start circles at no cost while MinCirklen is in pilot. We'll announce pricing clearly, well in advance, before anything changes.",
      },
      {
        heading: 'A free tier, permanently',
        body: 'Whatever pricing we land on, there will always be a free way to join a circle. Nobody will be priced out of support.',
      },
      {
        heading: 'Why it will work this way',
        body: "Charging for more space to express a crisis would contradict what MinCirklen is for. Any future pricing is meant to help fund the platform's running costs, not to buy a better experience for the people who can afford it.",
      },
    ],
  },
  facilitators: {
    id: 'facilitators',
    title: 'Facilitators',
    intro: 'Every circle is guided by a trained facilitator, backed by real-time safety monitoring.',
    sections: [
      {
        heading: 'What a facilitator does',
        body: "A facilitator keeps a session safe, on-topic, and within the community guidelines. They can pause a session or step in directly if something feels off, without waiting for a report.",
      },
      {
        heading: 'Two layers of safety',
        body: 'Messages are screened by a lightweight safety check as they are sent, and a trained person is always reachable behind that check — the two layers work together rather than either one carrying safety alone.',
      },
      {
        heading: 'Becoming a facilitator',
        body: 'Interested in facilitating a circle? We are recruiting a small number of trained facilitators for the current pilot. Reach out from the Contact page.',
      },
    ],
  },
  contact: {
    id: 'contact',
    title: 'Contact',
    intro: "Have a question, a partnership idea, or something that doesn't fit a report? Reach out.",
    sections: [
      {
        heading: 'Who runs MinCirklen',
        body: 'MinCirklen is owned and operated by Selkomark (CVR 45008118), registered in Denmark.',
      },
      {
        heading: 'General inquiries',
        body: 'Email mahan@selkomark.com for anything not covered elsewhere on this site, including press and partnerships.',
      },
      {
        heading: 'Safety concerns',
        body: 'For anything happening inside a live circle, use "Report this session" instead of email — it reaches a moderator faster. See Safety and moderation for how that works.',
      },
    ],
  },
}
