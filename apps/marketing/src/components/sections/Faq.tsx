import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import type { FAQ } from '@/content/faqs'

export function Faq({
  items,
  title = 'Frequently asked questions',
  eyebrow = 'FAQ',
}: {
  items: FAQ[]
  title?: string
  eyebrow?: string
}) {
  return (
    <section className="bg-white py-20 md:py-24">
      <div className="container-page grid gap-10 md:grid-cols-3">
        <div>
          <div className="text-sm font-semibold uppercase tracking-wide text-emerald-700">
            {eyebrow}
          </div>
          <h2 className="mt-3 heading-section text-slate-900">{title}</h2>
          <p className="mt-4 text-base leading-7 text-slate-600">
            Don't see your question?{' '}
            <a
              href="/contact"
              className="font-semibold text-emerald-700 underline underline-offset-4 hover:text-emerald-800"
            >
              Talk to us
            </a>
            .
          </p>
        </div>
        <div className="md:col-span-2">
          <Accordion type="single" collapsible>
            {items.map((item, i) => (
              <AccordionItem key={i} value={`q-${i}`}>
                <AccordionTrigger>{item.q}</AccordionTrigger>
                <AccordionContent>{item.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </section>
  )
}
