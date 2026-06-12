import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  FolderOpen,
  HistoryIcon,
  LayoutGrid,
  MessageSquare,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Settings,
  Table2,
} from "lucide-react"
import { useAccountContext } from "@/app/context/AccountContext"
import { useAuth } from "@/hooks/useAuth"

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
  const { selectedAccountId, isInitialized: accountInitialized } = useAccountContext()
  const { isAuthenticated, authenticatedFetch } = useAuth()
  const [isMobile, setIsMobile] = React.useState(false)
  const [recentProjects, setRecentProjects] = React.useState<ProjectSummary[]>([])
  const [recentAssistantSessions, setRecentAssistantSessions] = React.useState<AssistantSessionSummary[]>([])
  const [currentUser, setCurrentUser] = React.useState<UserSummary | null>(null)
  const [showRecentProjects, setShowRecentProjects] = React.useState(true)
  const [showAssistantHistory, setShowAssistantHistory] = React.useState(true)

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
          authenticatedFetch(`${apiUrl}/projects/?${projectParams.toString()}`),
          authenticatedFetch(`${apiUrl}/users/me/`),
          authenticatedFetch(`${apiUrl}/agent/sessions/recent?limit=8`),
        ])

        if (!cancelled && !projectsResult.error) {
          const projects = projectsResult.data
          setRecentProjects(Array.isArray(projects) ? projects.slice(0, 5) : [])
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
  }, [selectedAccountId, accountInitialized, pathname, isAuthenticated, authenticatedFetch])

  const navItems = [
    { href: "/dashboard", label: "Projects", icon: FolderOpen },
    { href: "/tabular-reviews", label: "Reviews", icon: Table2 },
    { href: "/playbooks", label: "Playbooks", icon: BookOpen },
    { href: "/integrations", label: "Integrations", icon: Plug },
    { href: "/support", label: "Support", icon: MessageSquare },
    { href: "/history", label: "History", icon: HistoryIcon },
  ]

  const isSettingsActive = pathname === "/account"
  const isNavItemActive = (href: string) => {
    if (href === "/dashboard") {
      return pathname === "/dashboard" || pathname.startsWith("/contracts/")
    }
    return pathname === href || pathname.startsWith(`${href}/`)
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

      <aside
        className={`
          fixed inset-y-0 left-0 z-[100] border-r border-gray-200 bg-gray-50 font-InterVar
          transition-[transform,width] duration-100 ease-out
          ${isMobile ? (isMobileOpen ? "translate-x-0" : "-translate-x-full") : "translate-x-0"}
          ${sidebarExpanded ? "w-80" : "w-16"}
        `}
      >
        <div className="flex h-full min-h-0 flex-col">
          <div className={sidebarExpanded ? "flex h-20 shrink-0 items-center justify-between px-5" : "flex h-20 shrink-0 items-center justify-center"}>
            {sidebarExpanded ? (
              <Link href="/dashboard" className="flex min-w-0 items-center gap-3" title="ContractSense">
                <img src="/logo.png" alt="ContractSense" className="h-9 w-9 rounded-[8px]" />
                <span className="truncate text-2xl font-semibold text-gray-950">ContractSense</span>
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => setIsExpanded(true)}
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-gray-300 bg-white text-gray-900 shadow-sm transition-colors hover:bg-gray-100"
                title="Expand sidebar"
              >
                <PanelLeftOpen className="h-5 w-5" />
              </button>
            )}

            {sidebarExpanded && !isMobile && (
              <button
                type="button"
                onClick={() => setIsExpanded(false)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-gray-300 bg-white text-gray-900 shadow-sm transition-colors hover:bg-gray-100"
                title="Collapse sidebar"
              >
                <PanelLeftClose className="h-5 w-5" />
              </button>
            )}
          </div>

          <nav className={sidebarExpanded ? "shrink-0 px-3 pb-5" : "flex shrink-0 flex-col items-center gap-3 py-4"}>
            {navItems.map((item) => {
              const Icon = item.icon
              const active = isNavItemActive(item.href)

              if (!sidebarExpanded) {
                return (
                  <Tooltip key={item.href} content={item.label} enabled>
                    <Link
                      href={item.href}
                      className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
                        active ? "bg-white text-gray-950 shadow-sm ring-1 ring-gray-200" : "text-gray-500 hover:bg-white hover:text-gray-950"
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                    </Link>
                  </Tooltip>
                )
              }

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setIsMobileOpen(false)}
                  className={`mb-1 flex h-12 items-center gap-3 rounded-xl px-4 text-lg font-medium transition-colors ${
                    active ? "bg-gray-100 text-gray-950" : "text-gray-600 hover:bg-gray-100 hover:text-gray-950"
                  }`}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </Link>
              )
            })}
          </nav>

          {sidebarExpanded && (
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
              <SidebarSection
                title="Recent Projects"
                isOpen={showRecentProjects}
                onToggle={() => setShowRecentProjects((value) => !value)}
              >
                {recentProjects.length > 0 ? (
                  <div className="space-y-1">
                    {recentProjects.map((project) => (
                      <Link
                        key={project._id}
                        href={`/dashboard?project_id=${encodeURIComponent(project._id)}`}
                        onClick={() => selectProject(project._id)}
                        className="flex h-10 min-w-0 items-center gap-3 rounded-xl px-1 text-sm text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-950"
                        title={project.name}
                      >
                        <FolderOpen className="h-4 w-4 shrink-0 text-gray-500" />
                        <span className="truncate">{project.name}</span>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl px-1 py-2 text-sm text-gray-400">No recent projects</div>
                )}
              </SidebarSection>

              <SidebarSection
                title="Assistant History"
                isOpen={showAssistantHistory}
                onToggle={() => setShowAssistantHistory((value) => !value)}
              >
                {recentAssistantSessions.length > 0 ? (
                  <div className="space-y-1">
                    {recentAssistantSessions.map((session, index) => {
                      const title = assistantSessionTitle(session)
                      const context = assistantSessionContext(session)
                      return (
                        <Link
                          key={session.session_id}
                          href={assistantSessionHref(session)}
                          onClick={() => setIsMobileOpen(false)}
                          className={`flex min-h-11 min-w-0 items-center justify-between gap-2 rounded-xl px-2 py-2 text-sm transition-colors hover:bg-gray-100 ${
                            index === 0 ? "bg-gray-100 text-gray-950" : "text-gray-600"
                          }`}
                          title={`${context}: ${title}`}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium text-gray-800">{title}</span>
                            <span className="block truncate text-xs text-gray-400">{truncateLabel(context, 28)}</span>
                          </span>
                          {index === 0 && <MoreHorizontal className="h-4 w-4 shrink-0 text-gray-500" />}
                        </Link>
                      )
                    })}
                  </div>
                ) : (
                  <div className="rounded-xl px-1 py-2 text-sm text-gray-400">No recent chats</div>
                )}
              </SidebarSection>
            </div>
          )}

          <Link
            href="/account"
            onClick={() => setIsMobileOpen(false)}
            className={`
              mt-auto shrink-0 border-t border-gray-200 bg-white transition-colors hover:bg-gray-50
              ${sidebarExpanded ? "flex h-20 items-center gap-3 px-5" : "flex h-20 items-center justify-center"}
              ${isSettingsActive ? "text-gray-950" : "text-gray-600"}
            `}
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-gray-900 bg-gray-800 text-lg font-medium text-white shadow-sm">
              {accountInitial}
            </span>
            {sidebarExpanded && (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-medium text-gray-950">{username}</span>
                  <span className="block text-sm text-gray-400">Free</span>
                </span>
                <Settings className="h-4 w-4 shrink-0 text-gray-400" />
              </>
            )}
          </Link>
        </div>
      </aside>
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
        className="mb-3 flex w-full items-center justify-between text-sm font-semibold text-gray-500"
      >
        <span>{title}</span>
        {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {isOpen && children}
    </section>
  )
}

export default Sidebar
