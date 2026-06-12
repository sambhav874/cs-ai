"use client"
import { AnimatedUploadIcon } from "@/components/animation/animatedUpload"
import dynamic from "next/dynamic"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { LogOut, Menu, CreditCard, Loader2, Instagram, Facebook, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { LocalMarkerToggle } from "@/components/new/localMarkerToggle"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import AccountSwitcher from "../layout/AccountSwitcher"
import { useAccountContext } from "@/app/context/AccountContext"
import { useAuth } from "@/hooks/useAuth"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const FileUploadModal = dynamic(
  () => import("@/components/new/file-upload-area").then((mod) => mod.FileUploadModal),
  { ssr: false, loading: () => null }
)

function preloadFileUploadModal() {
  void import("@/components/new/file-upload-area")
}

// Add AI provider type
type AIProvider = 'groq' | 'openai' | 'claude' | 'gemini'

interface User {
  username: string
  email: string
  id: string
  [key: string]: any
}

interface Account {
  page_credits: number
  [key: string]: any
}

interface HeaderProps {
  onMobileMenuClick: () => void
  onUploadSuccess?: () => void
}

export function ColabsHeader({ onMobileMenuClick, onUploadSuccess }: HeaderProps) {
  const router = useRouter()
  const pathname = usePathname()
  const authPages = ["/signin", "/signup"]
  const isDashboardPage = pathname === "/dashboard"
  const isAuthPage = authPages.includes(pathname)
  const [isMobile, setIsMobile] = useState(false)
  const [isSmallScreen, setIsSmallScreen] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [account, setAccount] = useState<Account | null>(null)
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState<AIProvider>('groq')
  const [loading, setLoading] = useState({
    user: false,
    account: false,
  })
  const { selectedAccountId, setSelectedAccount } = useAccountContext()
  const { isAuthenticated, authenticatedFetch, logout, authChecked } = useAuth()
  const apiUrl = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (mounted) {
      const handleResize = () => {
        setIsMobile(window.innerWidth < 768)
        setIsSmallScreen(window.innerWidth < 640)
      }
      handleResize()
      window.addEventListener("resize", handleResize)
      return () => window.removeEventListener("resize", handleResize)
    }
  }, [mounted])

  const handleLogout = () => {
    logout()
    if (typeof window !== "undefined") {
      localStorage.removeItem("selectedAccountId")
      localStorage.removeItem("selectedQuestionCategories")
    }
  }

  const getUserDetails = async () => {
    if (!mounted || !isAuthenticated) return
    try {
      setLoading((prev) => ({ ...prev, user: true }))
      const result = await authenticatedFetch(`${apiUrl}/users/me/`)
      if (result.error) {
        console.error("Error fetching user details:", result.error)
        setUser(null)
        return null
      }
      setUser(result.data as User)
      return result.data as User
    } catch (error) {
      console.error("Error fetching user details:", error)
      setUser(null)
      return null
    } finally {
      setLoading((prev) => ({ ...prev, user: false }))
    }
  }

  const getAccountDetails = async () => {
    if (!mounted || !isAuthenticated) return
    let url = `${apiUrl}/account/balance`
    if (selectedAccountId) {
      url += `?context_id=${selectedAccountId}`
    }
    try {
      setLoading((prev) => ({ ...prev, account: true }))
      const result = await authenticatedFetch(url)
      if (result.error) {
        console.error("Error fetching account details:", result.error)
        return
      }
      setAccount(result.data as Account)
    } catch (error) {
      console.error("Error fetching account details:", error)
    } finally {
      setLoading((prev) => ({ ...prev, account: false }))
    }
  }

  useEffect(() => {
    if (mounted && isAuthenticated && authChecked) {
      getUserDetails()
      getAccountDetails()
    }
  }, [mounted, isAuthenticated, authChecked])

  useEffect(() => {
    if (!mounted || !isAuthenticated || isDashboardPage) return
    const scheduleIdle = window.requestIdleCallback ?? ((callback: IdleRequestCallback) => window.setTimeout(callback, 1000))
    const cancelIdle = window.cancelIdleCallback ?? window.clearTimeout
    const idleId = scheduleIdle(() => preloadFileUploadModal())
    return () => cancelIdle(idleId as number)
  }, [mounted, isAuthenticated, isDashboardPage])

  useEffect(() => {
    if (mounted && isAuthenticated) {
      getAccountDetails()
    }
  }, [selectedAccountId])

  const handleUploadSuccess = () => {
    setIsUploadModalOpen(false)
    if (onUploadSuccess) {
      onUploadSuccess()
    }
    if (isAuthenticated && mounted) {
      getAccountDetails()
    }
  }

  const handleAccountChange = (newAccountId: string) => {
    setSelectedAccount(newAccountId)
  }

  // Load saved provider preference from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedProvider = localStorage.getItem('aiProvider') as AIProvider || 'groq'
      setSelectedProvider(savedProvider)
    }
  }, [])

  // Save provider preference to localStorage when it changes
  const handleProviderChange = (provider: AIProvider) => {
    setSelectedProvider(provider)
    if (typeof window !== 'undefined') {
      localStorage.setItem('aiProvider', provider)
      // You can also update the provider in your global state/context here
    }
  }

  if (!mounted) {
    return (
      <header className="fixed top-0 left-0 right-0 z-50 font-InterVar">
        <div className="h-16 flex items-center justify-end border-b border-gray-200 bg-white px-4">
          <span className="text-sm font-medium text-gray-600">ContractSense</span>
        </div>
      </header>
    )
  }

  if (isDashboardPage && !isMobile) {
    return null
  }

  return (
    <>
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-gray-200 bg-white/95 font-InterVar backdrop-blur">
      {/* Top row - ContractSense brand centered, user actions on extreme right */}
      <div className="h-16 flex items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Left side - Mobile menu button (if needed) */}
        <div className="flex items-center">
          {!isAuthPage && isMobile && (
            <button onClick={onMobileMenuClick} className="mr-2 rounded-md border border-gray-200 p-2 transition-colors hover:bg-gray-50">
              <Menu className="h-5 w-5 text-gray-900" />
            </button>
          )}
        </div>

        {/* Right side - User actions */}
        <div className="flex items-center gap-3">
          {!isAuthPage && isAuthenticated && (
            <>
              {/* Credits display */}
              {loading.account ? (
                <Loader2 className="h-4 w-4 animate-spin text-gray-600" />
              ) : account ? (
                <div className="flex h-9 items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 text-sm">
                  <CreditCard className="h-4 w-4 text-gray-700" />
                  <span className="text-sm font-medium text-gray-700">{account.page_credits}</span>
                </div>
              ) : null}

              {/* Upload button */}
              {!isDashboardPage && (
                <Button
                  variant="outline"
                  size="sm"
                  onFocus={preloadFileUploadModal}
                  onClick={() => setIsUploadModalOpen(true)}
                  onMouseEnter={preloadFileUploadModal}
                  className="h-9 gap-2 bg-gray-900 px-4 text-white hover:bg-gray-800"
                >
                  <AnimatedUploadIcon />
                  <span className={isSmallScreen ? "hidden" : "block"}>Upload</span>
                </Button>
              )}

              {/* AI Provider Selector */}
              {process.env.NEXT_PUBLIC_BRANCH_ENV === 'development' && (
                <div className="flex items-center space-x-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="ml-2 h-9 gap-2 border-gray-200 bg-white">
                        {selectedProvider === 'groq' ? 'Groq' :
                         selectedProvider === 'openai' ? 'OpenAI' :
                         selectedProvider === 'claude' ? 'Claude' : 'Gemini'}
                        <ChevronDown className="ml-2 h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleProviderChange('groq')}>
                        Groq
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleProviderChange('openai')}>
                        OpenAI
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleProviderChange('claude')}>
                        Claude
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleProviderChange('gemini')}>
                        Gemini
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}

              {/* Account switcher (hidden on mobile) */}
              <div className="hidden sm:block">
                <AccountSwitcher onAccountChange={handleAccountChange} initialAccountId={selectedAccountId} />
              </div>

              {/* User profile */}
              <Popover>
                <PopoverTrigger asChild>
                  <button className="flex items-center gap-2 rounded-full border border-gray-200 bg-white p-1 transition-colors hover:bg-gray-50">
                    {loading.user ? (
                      <Loader2 className="h-8 w-8 animate-spin text-gray-600" />
                    ) : (
                      <img
                        src="https://picsum.photos/id/237/200/200"
                        alt="Profile"
                        className="h-8 w-8 rounded-full"
                      />
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-56 border-gray-200 bg-white"
                  align="end"
                  sideOffset={10}
                >
                  <div className="flex flex-col space-y-2">
                    <div className="p-2">
                      <p className="text-sm font-medium text-gray-900">
                        {loading.user ? "Loading..." : user?.username || "User"}
                      </p>
                      <p className="text-xs text-gray-500">{loading.user ? "Loading..." : user?.email || ""}</p>
                    </div>
                    <div className="lg:hidden">
                      <LocalMarkerToggle />
                    </div>
                    <div className="sm:hidden py-2">
                      <AccountSwitcher
                        onAccountChange={handleAccountChange}
                        initialAccountId={selectedAccountId}
                      />
                    </div>
                    <Button
                      variant="ghost"
                      className="w-full justify-start text-red-600 hover:text-red-700 hover:bg-red-50"
                      onClick={handleLogout}
                    >
                      <LogOut className="h-4 w-4 mr-2" />
                      Log Out
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            </>
          )}  

          
        </div>
      </div>
    </header>

    {isUploadModalOpen && (
      <FileUploadModal
        userCredits={account?.page_credits || 0}
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onUploadSuccess={handleUploadSuccess}
      />
    )}
    </>
  )
}
