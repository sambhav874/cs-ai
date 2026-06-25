'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Sidebar } from '@/components/Sidebar'
import { ColabsHeader } from "./new/header"
import { BreadcrumbProvider } from '@/app/context/BreadcrumbContext'

interface ClientLayoutProps {
  children: React.ReactNode
}

const noLayoutPages = ['/', '/signin', '/signup','/beta','/assessment']

export default function ClientLayout({ children }: ClientLayoutProps) {
  const pathname = usePathname()
  const isContractWorkspace = pathname.startsWith('/contracts/')
  const isPlaybookWorkspace = pathname.startsWith('/playbooks/')
  const shouldHideLayout = noLayoutPages.includes(pathname)
  const [isExpanded, setIsExpanded] = useState(!isContractWorkspace && !isPlaybookWorkspace)
  const [isMobileOpen, setIsMobileOpen] = useState(false)

  useEffect(() => {
    if (isContractWorkspace || isPlaybookWorkspace) {
      setIsExpanded(false)
      setIsMobileOpen(false)
    }
  }, [isContractWorkspace, isPlaybookWorkspace])

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
    <BreadcrumbProvider>
      <div className="min-h-screen overflow-x-hidden">
        {shouldShowSidebar && (
          <>
            <ColabsHeader onMobileMenuClick={handleMobileMenuClick} onUploadSuccess={handleUploadSuccess} isExpanded={isExpanded} />
            <Sidebar
              isExpanded={isExpanded}
              setIsExpanded={setIsExpanded}
              isMobileOpen={isMobileOpen}
              setIsMobileOpen={setIsMobileOpen}
            />
          </>
        )}
        <main id="main-content" className={`
          transition-[margin]
          duration-100
          ${shouldShowSidebar ? 'pt-16' : ''}
          ${shouldShowSidebar ? (isExpanded ? 'md:ml-72' : 'md:ml-16') : ''}
        `}>
          {children}
        </main>
      </div>
    </BreadcrumbProvider>
  )
}
