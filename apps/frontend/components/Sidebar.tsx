import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  FolderOpen,
  HistoryIcon,
  LayoutGrid,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Settings,
  Table2,
  ChevronRight,
  ChevronLeft,
  LogOut,
  Sparkles
} from "lucide-react"
import { useAccountContext } from "@/app/context/AccountContext"
import { useAuth } from "@/hooks/useAuth"
import AccountSwitcher from "@/components/layout/AccountSwitcher"

// Inline tooltip for collapsed sidebar nav items
function Tooltip({
  content,
  enabled,
  children,
}: {
  content: string;
  enabled?: boolean;
  children: React.ReactNode;
}) {
  if (!enabled) return <>{children}</>
  return (
    <div className="relative group/tooltip">
      {children}
      <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs text-white opacity-0 shadow-md transition-opacity group-hover/tooltip:opacity-100">
        {content}
      </span>
    </div>
  )
}

interface SidebarProps {
  isExpanded: boolean;
  setIsExpanded: (value: boolean) => void;
  isMobileOpen: boolean;
  setIsMobileOpen: (value: boolean) => void;
}

interface ProjectSummary {
  _id: string;
  name: string;
  description?: string | null;
}

interface UserSummary {
  username?: string;
  email?: string;
}

interface AssistantSessionSummary {
  session_id: string;
  contract_id: string;
  contract_name?: string;
  project_id?: string;
  project_name?: string;
  is_project_session?: boolean;
  title?: string;
  message_count?: number;
  updated_at?: string;
}

const PROJECT_SELECTION_KEY = "dashboardSelectedProject"

function truncateLabel(value: string, maxLength = 34) {
  if (!value || value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 3)}...`
}

function assistantSessionTitle(session: AssistantSessionSummary) {
  const title = session.title?.trim()
  if (title && title.toLowerCase() !== "untitled chat") return title
  return session.is_project_session || session.contract_id?.startsWith("project:")
    ? "Project assistant chat"
    : "Contract assistant chat"
}

function assistantSessionContext(session: AssistantSessionSummary) {
  return session.project_name || session.contract_name || "Contract"
}

function assistantSessionHref(session: AssistantSessionSummary) {
  if ((session.is_project_session || session.contract_id?.startsWith("project:")) && session.project_id) {
    return `/dashboard?project_id=${encodeURIComponent(session.project_id)}&tab=assistant&session_id=${encodeURIComponent(session.session_id)}`
  }
  return `/contracts/${session.contract_id}?session_id=${encodeURIComponent(session.session_id)}`
}

export function Sidebar({ isExpanded, setIsExpanded, isMobileOpen, setIsMobileOpen }: SidebarProps) {
  const pathname = usePathname()
  const { selectedAccountId, setSelectedAccount, isInitialized: accountInitialized } = useAccountContext()
  const { isAuthenticated, authenticatedFetch, logout } = useAuth()
  const router = useRouter()
  const [isMobile, setIsMobile] = React.useState(false)
  const [recentProjects, setRecentProjects] = React.useState<ProjectSummary[]>([])
  const [recentAssistantSessions, setRecentAssistantSessions] = React.useState<AssistantSessionSummary[]>([])
  const [currentUser, setCurrentUser] = React.useState<UserSummary | null>(null)
  
  const [showRecentProjects, setShowRecentProjects] = React.useState(true)
  const [showAssistantHistory, setShowAssistantHistory] = React.useState(true)
  const [showAllProjects, setShowAllProjects] = React.useState(false)
  const [showAllHistory, setShowAllHistory] = React.useState(false)

  React.useEffect(() => {
    const handleResize = () => {
      const isMobileView = window.innerWidth < 768
      setIsMobile(isMobileView)
      if (!isMobileView) setIsMobileOpen(false)
    }

    handleResize()
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [setIsMobileOpen])

  React.useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL
    if (!isAuthenticated || !apiUrl || !accountInitialized) return

    let cancelled = false

    async function loadSidebarData() {
      try {
        const projectParams = new URLSearchParams()
        if (selectedAccountId) projectParams.set("context_id", selectedAccountId)

        const [projectsResult, userResult, sessionsResult] = await Promise.all([
          authenticatedFetch(`${apiUrl}/projects/all${projectParams.toString() ? `?${projectParams.toString()}` : ""}`),
          authenticatedFetch(`${apiUrl}/users/me/`),
          authenticatedFetch(`${apiUrl}/agent/sessions/recent?limit=20`),
        ])

        if (!cancelled && !projectsResult.error) {
          const projects = projectsResult.data
          setRecentProjects(Array.isArray(projects) ? projects : [])
        }

        if (!cancelled && !userResult.error) {
          setCurrentUser(userResult.data as UserSummary)
        }

        if (!cancelled && !sessionsResult.error) {
          const sessions = sessionsResult.data?.sessions
          setRecentAssistantSessions(Array.isArray(sessions) ? sessions : [])
        }
      } catch (error) {
        console.error("Failed to load sidebar data:", error)
      }
    }

    loadSidebarData()
    return () => {
      cancelled = true
    }
  }, [selectedAccountId, accountInitialized, isAuthenticated, authenticatedFetch])

  const isTestUser = currentUser?.username === "test-uploader" || currentUser?.username === "demouser"

  const navItems = [
    { href: "/home", label: "Home", icon: LayoutGrid },
    { href: "/dashboard", label: "Projects", icon: FolderOpen },
    { href: "/agent", label: "AI Agent", icon: Sparkles },
    { href: "/tabular-reviews", label: "Reviews", icon: Table2 },
    { href: "/playbooks", label: "Playbooks", icon: BookOpen },
    ...(isTestUser ? [{ href: "/evaluations", label: "Evaluations", icon: HistoryIcon }] : []),
    { href: "/integrations", label: "Integrations", icon: Plug },
  ]

  const isSettingsActive = pathname === "/account"
  const isNavItemActive = (href: string) => {
    const baseHref = href.split("?")[0]
    if (baseHref === "/dashboard") {
      return pathname === "/dashboard" || pathname.startsWith("/contracts/")
    }
    return pathname === baseHref || pathname.startsWith(`${baseHref}/`)
  }

  const sidebarExpanded = isMobile || isExpanded
  const username = currentUser?.username || currentUser?.email?.split("@")[0] || "Account"
  const accountInitial = username.charAt(0).toUpperCase() || "A"

  const selectProject = (projectId: string) => {
    if (typeof window !== "undefined" && selectedAccountId) {
      localStorage.setItem(`${PROJECT_SELECTION_KEY}_${selectedAccountId}`, projectId)
    }
    setIsMobileOpen(false)
  }

  return (
    <>
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm md:hidden"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      <motion.aside
        initial={false}
        animate={{
          width: sidebarExpanded ? 288 : 64,
          x: isMobile ? (isMobileOpen ? 0 : "-100%") : 0,
        }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="fixed inset-y-0 left-0 z-[100] border-r border-border bg-card font-InterVar flex flex-col shadow-sm"
      >
        {!isMobile && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="absolute -right-3 top-6 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm hover:text-foreground transition-transform"
            aria-label={isExpanded ? "Collapse sidebar" : "Expand sidebar"}
          >
            {isExpanded ? <ChevronLeft className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        )}

        <div className="flex h-16 shrink-0 items-center px-4 overflow-hidden">
          <Link href="/home" className="flex min-w-0 items-center gap-3 w-full" title="ContractSense">
            <img src="/logo.png" alt="ContractSense" className="h-8 w-8 rounded-lg shrink-0" />
            <AnimatePresence>
              {sidebarExpanded && (
                <motion.span
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: "auto" }}
                  exit={{ opacity: 0, width: 0 }}
                  className="truncate text-xl font-bold text-foreground"
                >
                  ContractSense
                </motion.span>
              )}
            </AnimatePresence>
          </Link>
        </div>


        <div className="h-px bg-border mx-4 mb-4" />

        <nav className={sidebarExpanded ? "shrink-0 px-3 pb-2" : "flex shrink-0 flex-col items-center gap-2 pb-4"}>
          {navItems.map((item) => {
            const Icon = item.icon
            const active = isNavItemActive(item.href)

            if (!sidebarExpanded) {
              return (
                <Tooltip key={item.href} content={item.label} enabled>
                  <Link
                    href={item.href}
                    aria-label={item.label}
                    className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
                      active ? "bg-primary/10 text-primary" : "text-foreground/80 hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </Link>
                </Tooltip>
              )
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setIsMobileOpen(false)}
                className={`mb-1 flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors ${
                  active 
                    ? "bg-primary/10 text-primary" 
                    : "text-foreground/80 hover:bg-muted hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </Link>
            )
          })}
        </nav>

        {sidebarExpanded && <div className="h-px bg-border mx-4 mb-4 mt-2" />}

        <AnimatePresence>
          {sidebarExpanded && (
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }} 
              className="min-h-0 flex-1 overflow-y-auto px-4 pb-5 custom-scrollbar"
            >
              <SidebarSection
                title="Recent Projects"
                isOpen={showRecentProjects}
                onToggle={() => setShowRecentProjects((value) => !value)}
              >
                {recentProjects.length > 0 ? (
                  <div className="relative">
                    <div className={`space-y-0.5 ${!showAllProjects && recentProjects.length > 5 ? "[mask-image:linear-gradient(to_bottom,black_80%,transparent_100%)] max-h-[160px] overflow-hidden" : ""}`}>
                      {recentProjects.slice(0, showAllProjects ? undefined : 6).map((project) => (
                        <Link
                          key={project._id}
                          href={`/dashboard/projects/${encodeURIComponent(project._id)}`}
                          onClick={() => selectProject(project._id)}
                          className="flex h-8 min-w-0 items-center gap-2.5 rounded-md px-2 text-sm text-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
                          title={project.name}
                        >
                          <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                          <span className="truncate">{project.name}</span>
                        </Link>
                      ))}
                    </div>
                    {recentProjects.length > 5 && (
                      <button 
                        onClick={() => setShowAllProjects(!showAllProjects)} 
                        className="mt-1 flex items-center text-xs font-medium text-muted-foreground hover:text-primary pl-2 transition-colors"
                      >
                        {showAllProjects ? "See less" : `See all (${recentProjects.length})`}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="rounded-md px-2 py-2 text-xs text-muted-foreground/70">No recent projects</div>
                )}
              </SidebarSection>

              <SidebarSection
                title="Assistant History"
                isOpen={showAssistantHistory}
                onToggle={() => setShowAssistantHistory((value) => !value)}
              >
                {recentAssistantSessions.length > 0 ? (
                  <div className="relative">
                    <div className={`space-y-0.5 ${!showAllHistory && recentAssistantSessions.length > 5 ? "[mask-image:linear-gradient(to_bottom,black_80%,transparent_100%)] max-h-[220px] overflow-hidden" : ""}`}>
                      {recentAssistantSessions.slice(0, showAllHistory ? undefined : 6).map((session, index) => {
                        const title = assistantSessionTitle(session)
                        const context = assistantSessionContext(session)
                        return (
                          <Link
                            key={session.session_id}
                            href={assistantSessionHref(session)}
                            onClick={() => setIsMobileOpen(false)}
                            className="flex min-h-10 min-w-0 items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted text-foreground/80"
                            title={`${context}: ${title}`}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px]">{title}</span>
                              <span className="block truncate text-xs opacity-70">{truncateLabel(context, 28)}</span>
                            </span>
                          </Link>
                        )
                      })}
                    </div>
                    {recentAssistantSessions.length > 5 && (
                      <button 
                        onClick={() => setShowAllHistory(!showAllHistory)} 
                        className="mt-1 flex items-center text-xs font-medium text-muted-foreground hover:text-primary pl-2 transition-colors"
                      >
                        {showAllHistory ? "See less" : `See all (${recentAssistantSessions.length})`}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="rounded-md px-2 py-2 text-xs text-muted-foreground/70">No recent chats</div>
                )}
              </SidebarSection>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-auto shrink-0 border-t border-border">
          <div className={`flex items-center ${sidebarExpanded ? "justify-between px-4 py-3" : "justify-center py-3"}`}>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={`flex items-center gap-3 transition-colors hover:bg-muted/50 rounded-md ${sidebarExpanded ? "flex-1 px-2 py-1.5" : ""}`}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-card text-sm font-semibold text-foreground shadow-sm">
                    {accountInitial}
                  </span>
                  <AnimatePresence>
                    {sidebarExpanded && (
                      <motion.div
                        initial={{ opacity: 0, width: 0 }}
                        animate={{ opacity: 1, width: "auto" }}
                        exit={{ opacity: 0, width: 0 }}
                        className="flex min-w-0 flex-1 flex-col items-start overflow-hidden text-left pr-2"
                      >
                        <span className="block truncate text-sm font-medium text-foreground max-w-full">{username}</span>
                        <span className="block text-xs text-muted-foreground">Account Options</span>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-48 rounded-lg border border-border bg-white z-[100] shadow-xl p-1" align="end" side="top" sideOffset={12}>
                <button
                  onClick={() => router.push('/account')}
                  className="w-full flex items-center gap-2 rounded-sm px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
                >
                  <Settings className="h-4 w-4 text-muted-foreground" />
                  Settings
                </button>
                <button
                  onClick={() => logout()}
                  className="w-full flex items-center gap-2 rounded-sm px-3 py-2 text-sm text-red-600 hover:bg-red-50 hover:text-red-700 transition-colors"
                >
                  <LogOut className="h-4 w-4" />
                  Log out
                </button>
              </PopoverContent>
            </Popover>

            <AnimatePresence>
              {sidebarExpanded && (
                <motion.div
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: "auto" }}
                  exit={{ opacity: 0, width: 0 }}
                  className="shrink-0 overflow-hidden"
                >
                  <Link
                    href="/account"
                    onClick={() => setIsMobileOpen(false)}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    title="Settings"
                  >
                    <Settings className="h-4 w-4" />
                  </Link>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.aside>
    </>
  )
}

function SidebarSection({
  title,
  isOpen,
  onToggle,
  children,
}: {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6">
      <button
        type="button"
        onClick={onToggle}
        className="mb-2 flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wider text-foreground/80 transition-colors hover:text-foreground"
        aria-expanded={isOpen}
        aria-controls={title.toLowerCase().replace(/\s+/g, "-")}
      >
        <span>{title}</span>
        {isOpen ? <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
      </button>
      {isOpen && <div id={title.toLowerCase().replace(/\s+/g, "-")}>{children}</div>}
    </section>
  )
}

export default Sidebar
