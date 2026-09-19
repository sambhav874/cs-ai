import { useState } from "react";
import { ChevronDown, FolderOpen, FolderPlus, Loader2, Search, RefreshCw } from "lucide-react";
import { Button } from "@cs/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@cs/components/ui/dialog";
import { Input } from "@cs/components/ui/input";
import { Label } from "@cs/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@cs/components/ui/table";
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
  currentPage = 1,
  totalPages = 1,
  onPageChange,
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
  currentPage?: number;
  totalPages?: number;
  onPageChange?: (page: number) => void;
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
          <h1 className="text-title text-foreground">Spaces</h1>
        </div>
        <p className="text-sm text-muted-foreground">Manage your spaces and the documents and tools in them.</p>
      </div>
      <div className="rounded-lg border border-border bg-card shadow-e1 overflow-hidden animate-slide-up">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between bg-muted/50">
          {/* shrink-0: in the SPA the assistant rail narrows the page, and a
              shrinking filter group wrapped each control onto its own line. */}
          <div className="flex shrink-0 items-center gap-2">
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
          <div className="flex flex-wrap items-center justify-end gap-2 sm:ml-auto">
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
                placeholder="Search spaces…"
                className="h-8 w-44 lg:w-56 rounded-md border border-border bg-card pl-8 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-border"
              />
            </div>

            <Dialog open={isProjectDialogOpen} onOpenChange={onProjectDialogChange}>
              <DialogTrigger asChild>
                <Button size="sm" className="h-8 gap-2 bg-primary-solid text-white hover:bg-primary-solid-hover/90">
                  <FolderPlus className="h-4 w-4" />
                  New space
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>New space</DialogTitle>
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
              [...Array(10)].map((_, index) => (
                <TableRow key={`skeleton-${index}`} className="h-14">
                  <TableCell className="pl-4">
                    <div className="flex items-center gap-3">
                      <div className="h-5 w-5 rounded-sm bg-muted animate-pulse" />
                      <div className="h-4 w-48 rounded bg-muted animate-pulse" />
                    </div>
                  </TableCell>
                  <TableCell><div className="h-4 w-8 rounded bg-muted animate-pulse" /></TableCell>
                  <TableCell><div className="h-4 w-8 rounded bg-muted animate-pulse" /></TableCell>
                  <TableCell><div className="h-4 w-24 rounded bg-muted animate-pulse" /></TableCell>
                </TableRow>
              ))
            ) : displayProjects.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-[560px] text-center text-sm text-muted-foreground">
                  No projects found.
                </TableCell>
              </TableRow>
            ) : (
              <>
                {displayProjects.map((project) => (
                  <TableRow
                    key={project._id}
                    onClick={() => onSelectProject(project._id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectProject(project._id);
                      }
                    }}
                    tabIndex={0}
                    className="cursor-pointer h-14 transition-colors hover:bg-muted/50 focus:outline-none focus:bg-muted/50"
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
                ))}
                {displayProjects.length > 0 && displayProjects.length < 10 && (
                  [...Array(10 - displayProjects.length)].map((_, index) => (
                    <TableRow key={`empty-${index}`} className="h-14 pointer-events-none hover:bg-transparent">
                      <TableCell colSpan={4} />
                    </TableRow>
                  ))
                )}
              </>
            )}
          </TableBody>
          </Table>
        </div>
        
        {/* Pagination Controls */}
        {totalPages > 0 && onPageChange && (
          <div className="flex items-center justify-end border-t border-border/50 p-4">
            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                className="h-8" 
                onClick={() => onPageChange(Math.max(1, currentPage - 1))} 
                disabled={currentPage === 1 || isProjectLoading}
              >
                Previous
              </Button>
              <span className="text-sm font-medium text-foreground">
                Page {currentPage} of {Math.max(totalPages, 1)}
              </span>
              <Button 
                variant="outline" 
                size="sm" 
                className="h-8" 
                onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))} 
                disabled={currentPage >= totalPages || isProjectLoading}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
