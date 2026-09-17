import { Routes, Route, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { Nav } from '@/components/layout/Nav'
import { Footer } from '@/components/layout/Footer'
import { StickyCta } from '@/components/layout/StickyCta'

import Home from '@/routes/Home'
import Product from '@/routes/Product'
import Security from '@/routes/Security'
import Pricing from '@/routes/Pricing'
import OpenSource from '@/routes/OpenSource'
import Contact from '@/routes/Contact'
import Alternatives from '@/routes/Alternatives'
import ComparePage from '@/routes/compare/ComparePage'
import LearnHub from '@/routes/learn/LearnHub'
import LearnArticle from '@/routes/learn/LearnArticle'
import TemplatesHub from '@/routes/templates/TemplatesHub'
import TemplateDetail from '@/routes/templates/TemplateDetail'
import IndustriesHub from '@/routes/industries/IndustriesHub'
import IndustryDetail from '@/routes/industries/IndustryDetail'
import NotFound from '@/routes/NotFound'

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

export default function App() {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <ScrollToTop />
      <Nav />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/product" element={<Product />} />
          <Route path="/security" element={<Security />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/open-source" element={<OpenSource />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/alternatives" element={<Alternatives />} />
          <Route path="/compare/:slug" element={<ComparePage />} />
          <Route path="/learn" element={<LearnHub />} />
          <Route path="/learn/:slug" element={<LearnArticle />} />
          <Route path="/templates" element={<TemplatesHub />} />
          <Route path="/templates/:slug" element={<TemplateDetail />} />
          <Route path="/industries" element={<IndustriesHub />} />
          <Route path="/industries/:slug" element={<IndustryDetail />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <Footer />
      <StickyCta />
    </div>
  )
}
