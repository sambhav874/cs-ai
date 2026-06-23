import { FolderOpen, FolderPlus, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cx } from "./utils";
import type { Project } from "./types";

export function ProjectSwitcher({
  projects,
  selectedProjectId,
  projectSearch,
  isProjectLoading,
  isProjectDialogOpen,
  newProjectName,
  newProjectDescription,
  isCreatingProject,
  onSelectProject,
  onProjectSearchChange,
  onProjectDialogChange,
  onProjectNameChange,
  onProjectDescriptionChange,
  onCreateProject,
}: {
  projects: Project[];
  selectedProjectId: string | null;
  projectSearch: string;
  isProjectLoading: boolean;
  isProjectDialogOpen: boolean;
  newProjectName: string;
  newProjectDescription: string;
  isCreatingProject: boolean;
  onSelectProject: (id: string | null) => void;
  onProjectSearchChange: (value: string) => void;
  onProjectDialogChange: (open: boolean) => void;
  onProjectNameChange: (value: string) => void;
  onProjectDescriptionChange: (value: string) => void;
  onCreateProject: () => void;
}) {
  return (
    <section className="border-b border-border bg-muted/30 p-6 md:p-8">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <FolderOpen className="h-5 w-5 shrink-0 text-muted-foreground" />
          <span className="font-serif text-3xl font-bold text-foreground">Projects</span>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative sm:w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={projectSearch}
              onChange={(event) => onProjectSearchChange(event.target.value)}
              placeholder="Search projects..."
              className="h-10 border-border bg-background pl-9 text-sm"
            />
          </div>

          <Dialog open={isProjectDialogOpen} onOpenChange={onProjectDialogChange}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="h-10 gap-2">
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

      <div className="mt-5 overflow-x-auto">
        <div className="flex min-w-max gap-2 pb-1">
          <button
            onClick={() => onSelectProject(null)}
            className={cx(
              "flex h-10 items-center rounded-md border px-4 text-sm transition-colors",
              !selectedProjectId
                ? "border-primary bg-background text-foreground shadow-sm ring-1 ring-primary/20"
                : "border-border bg-background/50 text-muted-foreground hover:bg-background hover:text-foreground",
            )}
          >
            All projects
          </button>

          {isProjectLoading ? (
            [1, 2, 3].map((item) => (
              <div key={item} className="h-10 w-40 rounded-md border border-border bg-background/50 animate-pulse" />
            ))
          ) : projects.length === 0 ? (
            <div className="flex h-10 items-center rounded-md border border-dashed border-border bg-background/50 px-4 text-sm text-muted-foreground">
              No projects found
            </div>
          ) : (
            projects.map((project) => (
              <button
                key={project._id}
                onClick={() => onSelectProject(project._id)}
                title={project.name}
                className={cx(
                  "flex h-10 max-w-[220px] items-center gap-2 rounded-md border px-4 text-left text-sm transition-colors",
                  selectedProjectId === project._id
                    ? "border-primary bg-background text-foreground shadow-sm ring-1 ring-primary/20"
                    : "border-border bg-background/50 text-muted-foreground hover:bg-background hover:text-foreground",
                )}
              >
                <span className="truncate font-medium">{project.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground/80">{project.stats?.total_documents || 0}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
