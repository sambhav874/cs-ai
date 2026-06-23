import { FolderOpen } from "lucide-react";
import { formatDate } from "./utils";
import type { Project } from "./types";

export function ProjectOverview({
  projects,
  onSelectProject,
}: {
  projects: Project[];
  selectedProject?: Project | null;
  onSelectProject: (id: string | null) => void;
}) {
  return (
    <div className="p-6 md:p-8">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-foreground">All projects</h2>
          <p className="mt-1 text-sm text-muted-foreground">Select a project to work with its contracts and workflow roles.</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[760px]">
          <div className="flex h-8 items-center border-b border-border text-xs font-medium text-muted-foreground">
            <div className="w-[320px] shrink-0 pl-2">Name</div>
            <div className="w-24 shrink-0">Contracts</div>
            <div className="w-28 shrink-0">Processing</div>
            <div className="w-32 shrink-0">Pending</div>
            <div className="w-28 shrink-0">Completed</div>
            <div className="w-32 shrink-0">Updated</div>
          </div>
          {projects.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">No projects yet.</div>
          ) : (
            projects.map((project) => (
              <button
                key={project._id}
                onClick={() => onSelectProject(project._id)}
                className="flex h-12 w-full items-center border-b border-border/50 text-left text-sm transition-colors hover:bg-muted/50"
              >
                <div className="flex w-[320px] shrink-0 items-center gap-2 pl-2">
                  <FolderOpen className="h-4 w-4 text-muted-foreground" />
                  <span className="truncate font-medium text-foreground">{project.name}</span>
                </div>
                <div className="w-24 shrink-0 text-muted-foreground/80">{project.stats?.total_documents || 0}</div>
                <div className="w-28 shrink-0 text-muted-foreground/80">{project.stats?.processing_count || 0}</div>
                <div className="w-32 shrink-0 text-muted-foreground/80">{project.stats?.pending_approval_count || 0}</div>
                <div className="w-28 shrink-0 text-muted-foreground/80">{project.stats?.completed_count || 0}</div>
                <div className="w-32 shrink-0 text-muted-foreground">{formatDate(project.updatedAt)}</div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
