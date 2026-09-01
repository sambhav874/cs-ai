import { memo } from "react";
import Link from "next/link";
import { FileText, Play, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cx, formatDate, truncateMiddle } from "./utils";
import type { Document, DocumentWithProgress, UserInDB } from "./types";
import { ProcessingPill } from "./ProcessingPill";

function RolePill({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      {label}
    </span>
  );
}

export const ContractExplorer = memo(function ContractExplorer({
  documents,
  currentUserInfo,
  currentlyProcessing,
  isLoading,
  displayStatusForDoc,
  onProcess,
  onEditRoles,
}: {
  documents: DocumentWithProgress[];
  currentUserInfo: UserInDB | null;
  currentlyProcessing: string | null;
  isLoading: boolean;
  displayStatusForDoc: (doc: DocumentWithProgress) => string;
  onProcess: (contractId: string) => void;
  onEditRoles: (doc: Document) => void;
}) {
  if (isLoading && documents.length === 0) {
    return (
      <div className="py-3">
        {[1, 2, 3].map((item) => (
          <div key={item} className="mb-2 h-12 rounded-md bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-center">
        <FileText className="h-10 w-10 text-muted-foreground/50" />
        <p className="mt-3 text-sm font-medium text-foreground/80">No contracts found</p>
        <p className="mt-1 text-sm text-muted-foreground">Upload a contract or adjust the current filters.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[980px]">
        <div className="grid grid-cols-[2fr_1fr_1.5fr_0.5fr_1fr_0.5fr] gap-4 p-4 border-b border-border text-[10px] uppercase tracking-wider font-bold text-muted-foreground bg-muted/30">
          <div className="hover:text-foreground hover:underline transition-all duration-300 cursor-pointer">Name</div>
          <div className="hover:text-foreground hover:underline transition-all duration-300 cursor-pointer">Status</div>
          <div className="hover:text-foreground hover:underline transition-all duration-300 cursor-pointer">Roles</div>
          <div className="hover:text-foreground hover:underline transition-all duration-300 cursor-pointer">Pages</div>
          <div className="hover:text-foreground hover:underline transition-all duration-300 cursor-pointer">Uploaded</div>
          <div className="text-right hover:text-foreground hover:underline transition-all duration-300 cursor-pointer">Actions</div>
        </div>
        {documents.map((doc) => {
          const displayStatus = displayStatusForDoc(doc);
          const currentUserId = currentUserInfo?._id;
          const isUploader = currentUserId === doc.uploaded_by;
          const isEditor = currentUserId === doc.workflowRoles?.editorUserId;
          const isApprover = currentUserId === doc.workflowRoles?.approverUserId;
          const isAccountOwner = !!(
            currentUserInfo?.ownedAccountId &&
            doc.ownerType === "team" &&
            doc.ownerId === currentUserInfo.ownedAccountId
          );
          const canEditRoles = doc.ownerType === "team" && (isUploader || isAccountOwner);
          const isActive = doc.isProcessing || currentlyProcessing === doc._id;
          const canProcess = doc.status === "Uploaded" || doc.status === "error" || doc.error;

          return (
            <div key={doc._id} className="group grid grid-cols-[2fr_1fr_1.5fr_0.5fr_1fr_0.5fr] gap-4 p-4 items-center border-b border-border/50 text-sm transition-colors hover:bg-muted/30">
              <div className="flex items-start gap-3 min-w-0">
                <FileText className="h-4 w-4 shrink-0 text-destructive/80 mt-0.5 transition-transform duration-300 group-hover:scale-110" />
                <div className="min-w-0">
                  <Link href={`/contracts/${doc._id}/kpis`} className="block truncate font-medium text-foreground group-hover:text-primary transition-colors duration-300">
                    {truncateMiddle(doc.contract_name)}
                  </Link>
                  <div className="truncate text-xs text-muted-foreground mt-0.5">
                    Uploaded by {doc.uploader_name || truncateMiddle(doc.uploaded_by, 12)}
                  </div>
                </div>
              </div>
              <div>
                {isActive ? (
                  <ProcessingPill doc={doc} />
                ) : (
                  <span className={cx("inline-flex items-center rounded-full border px-2 py-1 text-xs font-medium", 
                    displayStatus === "Uploaded" || displayStatus === "Submitted" ? "bg-muted text-muted-foreground border-border" : 
                    displayStatus === "Approved" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                    displayStatus === "Ready to Edit" || displayStatus === "Ingested" || displayStatus === "Indexed" ? "bg-sky-50 text-sky-700 border-sky-200" :
                    displayStatus === "Editing" ? "bg-indigo-50 text-indigo-700 border-indigo-200" :
                    displayStatus === "Pending Approval" || displayStatus === "Pending Your Approval" ? "bg-purple-50 text-purple-700 border-purple-200" :
                    displayStatus === "Error" || displayStatus === "Rejected" ? "bg-destructive/10 text-destructive border-destructive/20" :
                    displayStatus === "Completed" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                    "bg-amber-50 text-amber-700 border-amber-200"
                  )}>
                    {displayStatus}
                  </span>
                )}
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {isUploader && <RolePill label="Uploader" />}
                {isEditor && <RolePill label="Editor" />}
                {isApprover && <RolePill label="Approver" />}
                {!isUploader && !isEditor && !isApprover && doc.ownerType === "team" && (
                  <span className="text-xs text-muted-foreground/80">Team contract</span>
                )}
                {doc.ownerType === "user" && <span className="text-xs text-muted-foreground/80">Personal</span>}
              </div>
              <div className="text-sm text-muted-foreground">{doc.page_count || 0}</div>
              <div className="text-sm text-muted-foreground font-medium lowercase">{formatDate(doc.uploaded_at)}</div>
              <div className="flex items-center justify-end gap-2">
                {canEditRoles && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs"
                    onClick={() => onEditRoles(doc)}
                  >
                    Roles
                  </Button>
                )}
                {canProcess ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1 px-2 text-xs shadow-sm hover:-translate-y-0.5 transition-all duration-300"
                    onClick={() => onProcess(doc._id)}
                    disabled={!!currentlyProcessing}
                  >
                    {doc.error ? <RefreshCw className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                    {doc.error ? "Retry" : "Process"}
                  </Button>
                ) : (
                  <Button asChild variant="outline" size="sm" className="px-3 py-1.5 h-auto rounded border border-border text-xs font-medium text-foreground hover:bg-muted transition-all duration-300 bg-background shadow-sm hover:shadow-md hover:-translate-y-0.5">
                    <Link href={`/contracts/${doc._id}/kpis`}>View</Link>
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
