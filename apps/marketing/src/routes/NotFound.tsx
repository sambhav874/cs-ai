import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { SEO } from '@/lib/seo'

export default function NotFound() {
  return (
    <>
      <SEO title="Not found" description="That page doesn't exist." path="/404" />
      <section className="grid min-h-[60vh] place-items-center bg-white px-6 py-24">
        <div className="text-center">
          <div className="font-mono text-sm uppercase tracking-wider text-emerald-700">404</div>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            That page got redlined out.
          </h1>
          <p className="mx-auto mt-4 max-w-md text-base text-slate-600">
            The link you followed may be broken, or the page may have been moved.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Button asChild>
              <Link to="/">Back to home</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/product">See the product</Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  )
}
