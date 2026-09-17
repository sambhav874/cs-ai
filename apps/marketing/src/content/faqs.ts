export type FAQ = { q: string; a: string }

export const homeFaqs: FAQ[] = [
  {
    q: 'Is draftLegal really free?',
    a: 'Yes. The full product is AGPL-3.0 licensed and free to self-host forever — no feature gating, no seat caps. Managed cloud and enterprise tiers will arrive once we have real traction and SLAs to stand behind.',
  },
  {
    q: 'Can I self-host on my own servers or VPC?',
    a: 'Yes. Clone the repo, run docker compose up, and you have the full platform on your infrastructure. Your contracts and data never leave your network. The repo is the same code we run on our public evaluation demo.',
  },
  {
    q: 'What about the public demo at app.draft-legal.com?',
    a: 'It is a free evaluation environment so you can try the product without installing anything. It runs on free-tier infrastructure (scale-to-zero compute, sandbox search, free Postgres) with deliberate scale and speed limits, so do not put production data in it. Self-host for production.',
  },
  {
    q: 'Where does my data go?',
    a: 'Self-host: your data stays in your VPC. Public demo: stored in our project on Google Cloud / Neon for evaluation only. Encrypted at rest and in transit either way. Single-tenant + region pinning will be available on the enterprise tier once it ships.',
  },
  {
    q: 'Which AI models does draftLegal use?',
    a: 'Anthropic Claude, OpenAI GPT, and Google Gemini are all supported and switchable per agent. Bring your own API keys to control spend and data routing.',
  },
  {
    q: 'What contract types are supported?',
    a: 'Out of the box: NDA, MSA, SOW, DPA, BAA, vendor agreement, employment, IP assignment, MTA, license, customer SLA, and more. Add your own contract types with custom fields and playbooks in the admin panel.',
  },
]
