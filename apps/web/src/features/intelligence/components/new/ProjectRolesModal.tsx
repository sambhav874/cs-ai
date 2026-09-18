import React, { useCallback, useEffect, useState } from "react";
import { AlertCircle, Loader2, Users } from "lucide-react";

import { Button } from "@cs/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@cs/components/ui/dialog";
import { Label } from "@cs/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@cs/components/ui/select";
import { toast } from "@cs/hooks/use-toast";
import { apiFetch } from "@cs/lib/apiClient";

const UNASSIGNED = "__unassigned__";

type AccountMember = { id: string; name: string };

type ProjectRolesModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
  projectId: string;
  projectName: string;
  accountId: string;
};

export function ProjectRolesModal({
  isOpen,
  onClose,
  onSaved,
  projectId,
  projectName,
  accountId,
}: ProjectRolesModalProps) {
  const apiUrl = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL;

  const [members, setMembers] = useState<AccountMember[]>([]);
  const [editorId, setEditorId] = useState<string>(UNASSIGNED);
  const [approverId, setApproverId] = useState<string>(UNASSIGNED);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!apiUrl || !projectId || !accountId || accountId === "personal") return;
    setIsLoading(true);
    setError(null);
    try {
      const [teamResponse, rolesResponse] = await Promise.all([
        apiFetch(`${apiUrl}/teams/${accountId}`),
        apiFetch(`${apiUrl}/projects/${projectId}/roles`),
      ]);
      const teamData = await teamResponse.json();
      const rolesData = await rolesResponse.json();
      if (!teamResponse.ok) throw new Error(teamData.detail || "Could not load members.");
      if (!rolesResponse.ok) throw new Error(rolesData.detail || "Could not load current roles.");

      setMembers(
        (teamData.members || [])
          .map((member: any) => ({
            id: member.userId,
            name: member.username || member.email || member.userId,
          }))
          .sort((a: AccountMember, b: AccountMember) => a.name.localeCompare(b.name)),
      );
      setEditorId(rolesData.editorUserId || UNASSIGNED);
      setApproverId(rolesData.approverUserId || UNASSIGNED);
    } catch (loadError: any) {
      setError(loadError?.message || "Could not load project roles.");
    } finally {
      setIsLoading(false);
    }
  }, [apiUrl, projectId, accountId]);

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  const save = useCallback(async () => {
    if (!apiUrl) return;
    setIsSaving(true);
    setError(null);
    try {
      const response = await apiFetch(`${apiUrl}/projects/${projectId}/roles`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // "" clears a role; the backend leaves anything omitted untouched.
        body: JSON.stringify({
          editorUserId: editorId === UNASSIGNED ? "" : editorId,
          approverUserId: approverId === UNASSIGNED ? "" : approverId,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Could not save project roles.");

      toast({
        title: "Project roles updated",
        description: "Contracts in this project inherit these unless they set their own.",
      });
      onSaved?.();
      onClose();
    } catch (saveError: any) {
      setError(saveError?.message || "Could not save project roles.");
    } finally {
      setIsSaving(false);
    }
  }, [apiUrl, projectId, editorId, approverId, onSaved, onClose]);

  const memberOptions = (
    <>
      <SelectItem value={UNASSIGNED}>Nobody</SelectItem>
      {members.map((member) => (
        <SelectItem key={member.id} value={member.id}>
          {member.name}
        </SelectItem>
      ))}
    </>
  );

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Workflow roles for {projectName}
          </DialogTitle>
          <DialogDescription>
            Every contract in this project inherits these. A contract that sets its own
            editor or approver keeps them.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="project-editor">Editor</Label>
              <Select value={editorId} onValueChange={setEditorId}>
                <SelectTrigger id="project-editor">
                  <SelectValue placeholder="Nobody" />
                </SelectTrigger>
                <SelectContent>{memberOptions}</SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="project-approver">Approver</Label>
              <Select value={approverId} onValueChange={setApproverId}>
                <SelectTrigger id="project-approver">
                  <SelectValue placeholder="Nobody" />
                </SelectTrigger>
                <SelectContent>{memberOptions}</SelectContent>
              </Select>
            </div>

            {error && (
              <p className="flex items-start gap-2 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {error}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={isSaving || isLoading}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save roles
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
