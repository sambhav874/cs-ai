import { useState } from "react";
import { ChevronDown, FolderOpen, FolderPlus, Loader2, Search, RefreshCw, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, cx } from "./utils";
import type { Project } from "./types";

export function ProjectOverview({
  projects,
  onSelectProject,
  projectSearch,
  isProjectLoading,
  isProjectDialogOpen,
  newProjectName,
  newProjectDescription,
  isCreatingProject,
  onProjectSearchChange,
  onProjectDialogChange,
  onProjectNameChange,
  onProjectDescriptionChange,
  onCreateProject,
  onRefresh,
  isRefreshing,
  useLocalMarker,
  onToggleLocalMarker,
}: {
  projects: Project[];
  selectedProject?: Project | null;
  onSelectProject: (id: string | null) => void;
  projectSearch: string;
  isProjectLoading: boolean;
  isProjectDialogOpen: boolean;
  newProjectName: string;
  newProjectDescription: string;
  isCreatingProject: boolean;
  onProjectSearchChange: (value: string) => void;
  onProjectDialogChange: (open: boolean) => void;
  onProjectNameChange: (value: string) => void;
  onProjectDescriptionChange: (value: string) => void;
  onCreateProject: () => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  useLocalMarker?: boolean;
  onToggleLocalMarker?: (checked: boolean) => void;
}) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortConfig, setSortConfig] = useState<{ field: "updatedAt"; direction: "asc" | "desc" }>({
    field: "updatedAt",
    direction: "desc",
  });

  const displayProjects = [...projects].sort((a, b) => {
    const dateA = new Date(a.updatedAt).getTime();
    const dateB = new Date(b.updatedAt).getTime();
    return sortConfig.direction === "asc" ? dateA - dateB : dateB - dateA;
  });

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6 flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">All Projects</h1>
          {process.env.NEXT_PUBLIC_BRANCH_ENV === "development" && onToggleLocalMarker && (
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 w-9 bg-card hover:bg-muted p-0" title="Settings">
                  <Settings className="h-4 w-4" />
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Processing Settings</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="flex items-center gap-2">
                    <Checkbox id="use-local-marker" checked={useLocalMarker} onCheckedChange={(c) => onToggleLocalMarker(c === true)} />
                    <Label htmlFor="use-local-marker">Use local marker for processing</Label>
                  </div>
                  <p className="text-sm text-muted-foreground">Local marking can be faster but may differ from the standard pipeline.</p>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>
        <p className="text-sm text-muted-foreground">Manage your projects and access all associated documents and tools.</p>
      </div>
      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden animate-slide-up">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between bg-muted/50">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="h-8 appearance-none rounded-md border border-border bg-background pl-3 pr-8 text-xs font-medium text-foreground/80 outline-none transition-colors hover:bg-muted/30"
              >
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/80" />
            </div>

            <button
              onClick={() =>
                setSortConfig((prev) => ({
                  field: "updatedAt",
                  direction: prev.direction === "desc" ? "asc" : "desc",
                }))
              }
              className="flex h-8 items-center gap-2 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground/80 transition-colors hover:bg-muted/30"
            >
              Date
              <ChevronDown className={cx("h-4 w-4 transition-transform text-foreground/80", sortConfig.direction === "asc" && "rotate-180")} />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            {onRefresh && (
              <Button
                onClick={onRefresh}
                variant="outline"
                size="sm"
                className="h-8 gap-2 bg-card hover:bg-muted border-border"
                disabled={isRefreshing}
              >
                <RefreshCw className={cx("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
                Refresh
              </Button>
            )}
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={projectSearch}
                onChange={(event) => onProjectSearchChange(event.target.value)}
                placeholder="Search projects..."
                className="h-8 w-56 rounded-md border border-border bg-card pl-8 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-border"
              />
            </div>

            <Dialog open={isProjectDialogOpen} onOpenChange={onProjectDialogChange}>
              <DialogTrigger asChild>
                <Button size="sm" className="h-8 gap-2 bg-cs-primary text-white hover:bg-cs-primary/90">
                  <FolderPlus className="h-4 w-4" />
                  New project
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>New Project</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="space-y-2">
                    <Label htmlFor="project-name">Name</Label>
                    <Input id="project-name" value={newProjectName} onChange={(event) => onProjectNameChange(event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="project-description">Description</Label>
                    <Input
                      id="project-description"
                      value={newProjectDescription}
                      onChange={(event) => onProjectDescriptionChange(event.target.value)}
                      placeholder="Optional"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => onProjectDialogChange(false)}>Cancel</Button>
                  <Button onClick={onCreateProject} disabled={!newProjectName.trim() || isCreatingProject}>
                    {isCreatingProject && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Create
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
        <div className="w-full overflow-x-auto">
          <Table>
            <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="w-[320px] pl-4">Name</TableHead>
              <TableHead className="w-24">Contracts</TableHead>
              <TableHead className="w-28">Processing</TableHead>
              <TableHead className="w-32">Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="bg-card">
            {isProjectLoading ? (
              <TableRow>
                <TableCell colSpan={4} className="h-32 text-center text-sm text-muted-foreground">
                  Loading projects...
                </TableCell>
              </TableRow>
            ) : displayProjects.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-32 text-center text-sm text-muted-foreground">
                  No projects found.
                </TableCell>
              </TableRow>
            ) : (
              displayProjects.map((project) => (
                <TableRow
                  key={project._id}
                  onClick={() => onSelectProject(project._id)}
                  className="cursor-pointer h-14 transition-colors hover:bg-muted/50"
                >
                  <TableCell className="pl-4">
                    <div className="flex items-center gap-3">
                      <FolderOpen className="h-5 w-5 text-muted-foreground" />
                      <span className="truncate font-medium text-foreground">{project.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground/80">{project.stats?.total_documents || 0}</TableCell>
                  <TableCell className="text-muted-foreground/80">{project.stats?.processing_count || 0}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(project.updatedAt)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
