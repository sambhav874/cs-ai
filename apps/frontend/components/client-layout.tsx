'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Sidebar } from '@/components/Sidebar'
import { ColabsHeader } from "./new/header"

interface ClientLayoutProps {
  children: React.ReactNode
}

const noLayoutPages = ['/', '/signin', '/signup','/beta','/assessment']

export default function ClientLayout({ children }: ClientLayoutProps) {
  const pathname = usePathname()
  const isContractWorkspace = pathname.startsWith('/contracts/')
  const shouldHideLayout = noLayoutPages.includes(pathname)
  const [isExpanded, setIsExpanded] = useState(!isContractWorkspace)
  const [isMobileOpen, setIsMobileOpen] = useState(false)

  useEffect(() => {
    if (isContractWorkspace) {
      setIsExpanded(false)
      setIsMobileOpen(false)
    }
  }, [isContractWorkspace])

  const handleMobileMenuClick = () => {
    setIsMobileOpen(!isMobileOpen)
  }

  const handleUploadSuccess = () => {
    setIsMobileOpen(false)
    setIsExpanded(false)
  }

  const shouldShowSidebar = !shouldHideLayout
  const isDashboardPage = pathname === '/dashboard'

  return (
    <div className="min-h-screen overflow-x-hidden">
      {shouldShowSidebar && (
        <>
          {!isContractWorkspace && (
            <div className={isDashboardPage ? 'md:hidden' : undefined}>
              <ColabsHeader onMobileMenuClick={handleMobileMenuClick} onUploadSuccess={handleUploadSuccess} />
            </div>
          )}
          <Sidebar
            isExpanded={isExpanded}
            setIsExpanded={setIsExpanded}
            isMobileOpen={isMobileOpen}
            setIsMobileOpen={setIsMobileOpen}
          />
        </>
      )}
      <main className={`
        transition-[margin]
        duration-100
        ${shouldShowSidebar ? (isExpanded ? 'md:ml-80' : 'md:ml-16') : ''}
      `}>
        {children}
      </main>
    </div>
  )
}
