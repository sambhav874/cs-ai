import re

with open("apps/frontend/app/dashboard/page.tsx", "r") as f:
    lines = f.readlines()

# Find the start of types (interface WorkflowRoles)
start_types = -1
for i, line in enumerate(lines):
    if "interface WorkflowRoles {" in line:
        start_types = i
        break

# Find the start of Dashboard (export default function Dashboard)
start_dashboard = -1
for i, line in enumerate(lines):
    if "export default function Dashboard()" in line:
        start_dashboard = i
        break

# Find the end of DashboardContent (function ProjectSwitcher)
start_project_switcher = -1
for i, line in enumerate(lines):
    if line.startswith("function ProjectSwitcher("):
        start_project_switcher = i
        break

# Remove types and utilities (from start_types to start_dashboard - 2)
# Insert imports at start_types
imports = """import type {
  WorkflowRoles, Document, DocumentWithProgress, UserCredits, UserInDB,
  JobStatusResponse, ContractStatusResponse, ProjectStats, Project,
  AgentArtifact, AgentDocumentSummary, AgentDocumentPreview, ContractKPI,
  AIProvider, ProjectTab, ContractView
} from "@/components/dashboard/types";
import {
  emptyStats, cx, formatDate, truncateMiddle, isActiveJobStatus,
  completedStatusForJob, getProcessingLabel, statusClass
} from "@/components/dashboard/utils";
import { ContractExplorer } from "@/components/dashboard/ContractExplorer";
import { ProjectOverview } from "@/components/dashboard/ProjectOverview";
import { ProjectSwitcher } from "@/components/dashboard/ProjectSwitcher";
import { ProjectAssistantWorkspace } from "@/components/dashboard/ProjectAssistantWorkspace";
import { ProjectKPIWorkspace } from "@/components/dashboard/ProjectKPIWorkspace";

const PROJECT_SELECTION_KEY = "dashboardSelectedProject";
"""

new_lines = lines[:start_types] + [imports] + lines[start_dashboard-1:start_project_switcher]

# Now we need to process the DashboardContent styles
content = "".join(new_lines)

# Standardize headers (text-3xl font-bold text-foreground, text-muted-foreground breadcrumbs)
# ensure consistent padding (p-6 or p-8) across the layout

content = content.replace('className="min-h-screen bg-white font-InterVar text-gray-900"', 'className="min-h-screen bg-background font-InterVar text-foreground"')
content = content.replace('className="fixed inset-0 z-50 flex items-center justify-center bg-white"', 'className="fixed inset-0 z-50 flex items-center justify-center bg-background"')

content = content.replace('text-gray-500', 'text-muted-foreground')
content = content.replace('text-gray-900', 'text-foreground')
content = content.replace('text-gray-800', 'text-foreground/80')
content = content.replace('text-gray-600', 'text-muted-foreground/80')
content = content.replace('text-gray-700', 'text-foreground/70')

content = content.replace('bg-gray-50', 'bg-muted/50')
content = content.replace('bg-white', 'bg-background')

content = content.replace('border-gray-200', 'border-border')
content = content.replace('border-gray-100', 'border-border/50')

# Padding fixes
content = content.replace('px-4 py-4 md:px-10', 'p-6 md:p-8')
content = content.replace('px-4 py-6 md:px-10', 'p-6 md:p-8')
content = content.replace('px-4 md:px-10', 'px-6 md:px-8')

# Fix a specific place
content = content.replace('border-b border-border bg-muted/50/70 p-6 md:p-8', 'border-b border-border bg-muted/50 p-6 md:p-8')

with open("apps/frontend/app/dashboard/page.tsx", "w") as f:
    f.write(content)

