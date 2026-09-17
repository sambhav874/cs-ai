import { useParams, Link, Navigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { learnArticles, stubLearnEntry } from '@/content/learn'
import { learnSlugs } from '@/lib/routes'
import { CtaStrip } from '@/components/sections/CtaStrip'
import { SEO } from '@/lib/seo'
import { SITE_URL } from '@/lib/utils'

const titleCase = (s: string) =>
  s
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/Nda|Msa|Dpa|Baa|Sow|Mta|Clm/g, (m) => m.toUpperCase())

export default function LearnArticle() {
  const { slug } = useParams<{ slug: string }>()
  if (!slug || !learnSlugs.includes(slug as (typeof learnSlugs)[number])) {
    return <Navigate to="/learn" replace />
  }
  const article = learnArticles[slug] ?? stubLearnEntry(slug)

  const articleSchema = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: article.tldr,
    url: `${SITE_URL}/learn/${article.slug}`,
    author: { '@type': 'Organization', name: 'Draft Legal' },
    datePublished: '2026-05-01',
  }

  const definedTermSchema =
    article.category === 'Concept' || article.category === 'Contract type'
      ? {
          '@context': 'https://schema.org',
          '@type': 'DefinedTerm',
          name: article.title,
          description: article.tldr,
          url: `${SITE_URL}/learn/${article.slug}`,
        }
      : null

  return (
    <>
      <SEO
        title={article.title}
        description={article.tldr}
        path={`/learn/${article.slug}`}
        schema={definedTermSchema ? [articleSchema, definedTermSchema] : articleSchema}
      />

      <article className="bg-white py-20 md:py-24">
        <div className="container-prose">
          <Link to="/learn" className="text-sm font-medium text-slate-500 hover:text-emerald-700">
            ← All articles
          </Link>
          <div className="mt-4 inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-800">
            {article.category}
          </div>
          <h1 className="mt-4 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
            {article.title}
          </h1>

          <div className="mt-8 rounded-xl border border-emerald-200 bg-emerald-50/50 p-6">
            <div className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
              TL;DR
            </div>
            <p className="mt-2 text-base leading-7 text-slate-800">{article.tldr}</p>
          </div>

          <div className="prose-marketing mt-12">
            {article.sections.map((s) => (
              <section key={s.heading}>
                <h2>{s.heading}</h2>
                <p>{s.body}</p>
              </section>
            ))}
          </div>

          {article.productLink && (
            <div className="mt-12 rounded-2xl border border-slate-200 bg-slate-50 p-6 md:p-8">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                In Draft Legal
              </div>
              <a
                href={article.productLink.href}
                className="mt-2 inline-flex items-center gap-2 text-base font-semibold text-emerald-700 hover:text-emerald-800"
              >
                {article.productLink.label}
                <ArrowRight className="h-4 w-4" />
              </a>
            </div>
          )}

          <div className="mt-16 border-t border-slate-200 pt-10">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Related reading
            </div>
            <ul className="mt-4 grid gap-3 md:grid-cols-2">
              {article.relatedSlugs.map((s) => (
                <li key={s}>
                  <Link
                    to={`/learn/${s}`}
                    className="block rounded-lg border border-slate-200 p-4 transition-colors hover:border-emerald-200 hover:bg-emerald-50/40"
                  >
                    <div className="text-sm font-semibold text-slate-900">{titleCase(s)}</div>
                    <div className="mt-1 text-xs text-slate-500">Read article →</div>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </article>

      <CtaStrip />
    </>
  )
}
