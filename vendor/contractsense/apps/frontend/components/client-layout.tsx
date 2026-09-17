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
  const isAgentPage = pathname === '/agent'
  const shouldHideLayout = noLayoutPages.includes(pathname)

  // Agent page: sidebar always collapsed; contract/playbook workspaces also collapsed
  const [isExpanded, setIsExpanded] = useState(
    !isContractWorkspace && !isPlaybookWorkspace && !isAgentPage
  )
  const [isMobileOpen, setIsMobileOpen] = useState(false)

  useEffect(() => {
    if (isContractWorkspace || isPlaybookWorkspace || isAgentPage) {
      setIsExpanded(false)
      setIsMobileOpen(false)
    }
  }, [isContractWorkspace, isPlaybookWorkspace, isAgentPage])

  const handleMobileMenuClick = () => {
    setIsMobileOpen(!isMobileOpen)
  }

  const handleUploadSuccess = () => {
    setIsMobileOpen(false)
    setIsExpanded(false)
  }

  const shouldShowSidebar = !shouldHideLayout
  // On /agent page, hide the top header entirely
  const shouldShowHeader = shouldShowSidebar && !isAgentPage

  return (
    <BreadcrumbProvider>
      <div className="min-h-screen overflow-x-hidden">
        {shouldShowSidebar && (
          <>
            {shouldShowHeader && (
              <ColabsHeader onMobileMenuClick={handleMobileMenuClick} onUploadSuccess={handleUploadSuccess} isExpanded={isExpanded} />
            )}
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
          ${shouldShowSidebar ? (shouldShowHeader ? 'pt-16' : '') : ''}
          ${shouldShowSidebar ? (isExpanded ? 'md:ml-72' : 'md:ml-16') : ''}
        `}>
          {children}
        </main>
      </div>
    </BreadcrumbProvider>
  )
}
