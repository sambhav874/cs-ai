import { FolderOpen, FolderPlus, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "./utils";
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
}) {
  return (
    <div className="p-6 md:p-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-start">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative sm:w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={projectSearch}
              onChange={(event) => onProjectSearchChange(event.target.value)}
              placeholder="Search projects..."
              className="h-10 border-border bg-card pl-9 text-sm"
            />
          </div>

          <Dialog open={isProjectDialogOpen} onOpenChange={onProjectDialogChange}>
            <DialogTrigger asChild>
              <Button size="sm" className="h-10 gap-2">
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
      <div className="rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="w-[320px] pl-4">Name</TableHead>
              <TableHead className="w-24">Contracts</TableHead>
              <TableHead className="w-28">Processing</TableHead>
              <TableHead className="w-32">Pending</TableHead>
              <TableHead className="w-28">Completed</TableHead>
              <TableHead className="w-32">Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="bg-card">
            {isProjectLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-sm text-muted-foreground">
                  Loading projects...
                </TableCell>
              </TableRow>
            ) : projects.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-sm text-muted-foreground">
                  No projects found.
                </TableCell>
              </TableRow>
            ) : (
              projects.map((project) => (
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
                  <TableCell className="text-muted-foreground/80">{project.stats?.pending_approval_count || 0}</TableCell>
                  <TableCell className="text-muted-foreground/80">{project.stats?.completed_count || 0}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(project.updatedAt)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
