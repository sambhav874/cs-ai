import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { industries } from '@/content/industries'
import { CtaStrip } from '@/components/sections/CtaStrip'
import { SEO } from '@/lib/seo'

export default function IndustriesHub() {
  return (
    <>
      <SEO
        title="Industries — CLM by vertical"
        description="Draft Legal builds for SaaS, healthcare, manufacturing, biotech, and logistics legal teams. See how the platform fits your industry's contracts."
        path="/industries"
      />

      <section className="bg-white py-20 md:py-24">
        <div className="container-page">
          <div className="mx-auto max-w-3xl text-center">
            <div className="text-sm font-semibold uppercase tracking-wide text-emerald-700">
              Industries
            </div>
            <h1 className="mt-3 heading-display text-slate-900">
              Same product. Your contracts.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-slate-600">
              Healthcare cares about BAAs and PHI. Manufacturing cares about supplier MSAs and
              force majeure. Same Draft Legal — different framings.
            </p>
          </div>
        </div>
      </section>

      <section className="bg-slate-50 py-16">
        <div className="container-page">
          <ul className="mx-auto grid max-w-5xl gap-5 md:grid-cols-2 lg:grid-cols-3">
            {Object.values(industries).map((i) => (
              <li
                key={i.slug}
                className="group rounded-2xl border border-slate-200 bg-white p-6 transition-shadow hover:shadow-md"
              >
                <Link to={`/industries/${i.slug}`} className="block">
                  <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                    {i.label}
                  </div>
                  <h2 className="mt-2 text-lg font-bold tracking-tight text-slate-900 group-hover:text-emerald-700">
                    {i.hero}
                  </h2>
                  <p className="mt-3 text-sm leading-6 text-slate-600 line-clamp-3">{i.intro}</p>
                  <div className="mt-5 inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                    See how it fits <ArrowRight className="h-3 w-3" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <CtaStrip />
    </>
  )
}
