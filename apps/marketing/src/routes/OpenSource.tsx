import { Github, Scale, Heart, Map, MessageSquare } from 'lucide-react'
import { CtaStrip } from '@/components/sections/CtaStrip'
import { Button } from '@/components/ui/button'
import { SEO } from '@/lib/seo'
import { GITHUB_URL, SITE_URL } from '@/lib/utils'

const articleSchema = {
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: 'Draft Legal — Open Source CLM',
  description:
    'AGPL-3.0 licensed contract lifecycle management. Read the code, run it on your own infrastructure, contribute to the roadmap.',
  url: `${SITE_URL}/open-source`,
  author: { '@type': 'Organization', name: 'Draft Legal' },
}

export default function OpenSource() {
  return (
    <>
      <SEO
        title="Open Source CLM — AGPL-3.0 licensed, self-hostable"
        description="draftLegal is open source under AGPL-3.0. Read the code, run it yourself in 3 commands, contribute to the roadmap. The full platform — no commercial-only modules."
        path="/open-source"
        schema={articleSchema}
      />

      <section className="relative isolate overflow-hidden bg-slate-950 py-20 text-white md:py-28">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-[radial-gradient(70%_60%_at_50%_-10%,rgba(16,185,129,0.18),transparent_60%)]"
        />
        <div className="container-page">
          <div className="mx-auto max-w-3xl text-center">
            <div className="text-sm font-semibold uppercase tracking-wide text-emerald-400">
              Open source
            </div>
            <h1 className="mt-3 heading-display text-white">
              Read the code. Run it anywhere. Own your CLM.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-slate-300">
              draftLegal is AGPL-3.0 licensed and lives on GitHub. The full platform — every agent,
              every screen, every endpoint — is yours to fork, audit, and deploy on your own
              infrastructure.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button asChild variant="light" size="lg">
                <a href={GITHUB_URL} target="_blank" rel="noreferrer">
                  <Github className="mr-2 h-4 w-4" />
                  View on GitHub
                </a>
              </Button>
              <Button asChild size="lg" className="bg-emerald-700 hover:bg-emerald-600">
                <a href={`${GITHUB_URL}#setup`} target="_blank" rel="noreferrer">
                  Self-host quickstart →
                </a>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white py-20">
        <div className="container-page">
          <div className="mx-auto max-w-3xl">
            <h2 className="heading-section text-slate-900">Self-host in 3 commands.</h2>
            <p className="mt-4 text-base leading-7 text-slate-600">
              The setup story below is straight from our README. If you have Docker and Node 22,
              you have everything you need.
            </p>
          </div>

          <div className="mx-auto mt-10 max-w-3xl overflow-hidden rounded-xl border border-slate-200 bg-slate-950 text-slate-100">
            <div className="flex items-center gap-2 border-b border-slate-800 bg-slate-900 px-4 py-2 text-xs text-slate-400">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
              <span className="ml-3 font-mono">~/projects</span>
            </div>
            <pre className="overflow-x-auto p-5 font-mono text-sm leading-relaxed">
              <code>
                <span className="text-slate-500"># 1. Clone the repo</span>
                {'\n'}
                <span className="text-emerald-400">$</span> git clone {GITHUB_URL}.git draft-legal
                {'\n'}
                <span className="text-emerald-400">$</span> cd draft-legal
                {'\n\n'}
                <span className="text-slate-500"># 2. Set up env (only JWT_SECRET is required to start)</span>
                {'\n'}
                <span className="text-emerald-400">$</span> cp .env.example .env
                {'\n\n'}
                <span className="text-slate-500"># 3. Bring up the full stack — API, web, agents, postgres, redis, minio</span>
                {'\n'}
                <span className="text-emerald-400">$</span> docker compose up -d
                {'\n'}
                <span className="text-emerald-400">$</span> pnpm install && pnpm dev
                {'\n\n'}
                <span className="text-slate-500"># Open http://localhost:5173 — sign in with admin@demo.com / password123</span>
              </code>
            </pre>
          </div>

          <div className="mt-16 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {[
              {
                icon: Scale,
                title: 'AGPL-3.0 License',
                body: 'Use it commercially, modify it, run it anywhere. No commercial-only modules. If you offer a modified version as a network service, share your changes back — or take a commercial license to opt out.',
              },
              {
                icon: Heart,
                title: 'Why we open-sourced',
                body: 'Legal teams shouldn\'t have to trust a black box with their most sensitive documents. The fix is to make the box transparent.',
              },
              {
                icon: Map,
                title: 'Public roadmap',
                body: 'BUILD_TRACKER.md tracks every phase. RFCs live in the repo. Vote on issues, send PRs.',
              },
              {
                icon: MessageSquare,
                title: 'Community',
                body: 'GitHub Discussions for product Q&A, a Discord for live conversation, and a monthly community call.',
              },
            ].map((c) => (
              <div
                key={c.title}
                className="rounded-xl border border-slate-200 bg-white p-6 transition-shadow hover:shadow-md"
              >
                <span className="grid h-10 w-10 place-items-center rounded-md bg-emerald-50 text-emerald-700">
                  <c.icon className="h-5 w-5" />
                </span>
                <h3 className="mt-5 text-lg font-semibold tracking-tight text-slate-900">
                  {c.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{c.body}</p>
              </div>
            ))}
          </div>

          <div className="mt-16 grid gap-6 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-8">
              <h3 className="text-xl font-bold tracking-tight text-slate-900">
                Contributing
              </h3>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Issues with a "good first issue" label are vetted entry points. Larger features
                start with an RFC in /docs/rfcs. We respond to every PR within 48 hours during the
                week.
              </p>
              <a
                href={`${GITHUB_URL}/blob/main/CONTRIBUTING.md`}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 hover:text-emerald-800"
              >
                Read CONTRIBUTING.md →
              </a>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-8">
              <h3 className="text-xl font-bold tracking-tight text-slate-900">
                Forking & sponsorship
              </h3>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                AGPL-3.0 means you can fork and self-host freely. If you want to ship a closed
                commercial product on top of draftLegal, a commercial license lifts the
                network-copyleft terms — and we run a sponsorship program for orgs that want to
                fund specific features.
              </p>
              <a
                href="/contact?source=sponsor"
                className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 hover:text-emerald-800"
              >
                Talk to us about sponsorship →
              </a>
            </div>
          </div>
        </div>
      </section>

      <CtaStrip
        eyebrow="Try the public demo"
        title="Or kick the tyres on our hosted evaluation site."
        subtitle="Same code, same agents — running on free-tier infrastructure for product evaluation. Not for production data."
      />
    </>
  )
}
