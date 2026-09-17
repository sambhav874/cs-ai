// components/new/RoleReassignmentModal.tsx
"use client";
import React, { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, AlertCircle, ShieldCheck, Sparkles } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/apiClient";

interface AccountMember {
  id: string;
  name: string;
}

interface AssignWorkflowRolesRequest {
  editorUserId: string | null;
  approverUserId: string | null;
}

interface RoleReassignmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onReassignSuccess: () => void;
  contractId: string;
  contractName: string;
  currentEditorId: string | null;
  currentApproverId: string | null;
  accountId: string;
}

export function RoleReassignmentModal({
  isOpen,
  onClose,
  onReassignSuccess,
  contractId,
  contractName,
  currentEditorId,
  currentApproverId,
  accountId,
}: RoleReassignmentModalProps) {
  const [selectedEditorId, setSelectedEditorId] = useState<string | null>(null);
  const [selectedApproverId, setSelectedApproverId] = useState<string | null>(
    null
  );

  const [accountMembers, setAccountMembers] = useState<AccountMember[]>([]);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [memberFetchError, setMemberFetchError] = useState<string | null>(null);

  const [isUpdating, setIsUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const apiUrl = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL;

  useEffect(() => {
    if (isOpen) {
      setSelectedEditorId(currentEditorId);
      setSelectedApproverId(currentApproverId);
      setUpdateError(null);
      setIsUpdating(false);
    } else {
      setAccountMembers([]);
      setIsLoadingMembers(false);
      setMemberFetchError(null);
    }
  }, [isOpen, currentEditorId, currentApproverId]);

  useEffect(() => {
    const fetchMembers = async () => {
      if (!isOpen || !accountId || accountId === 'personal' || !apiUrl) {
        setAccountMembers([]);
        setMemberFetchError(null);
        return;
      }

      setIsLoadingMembers(true);
      setMemberFetchError(null);
      setAccountMembers([]);

      try {
        const response = await apiFetch(`${apiUrl}/teams/${accountId}`);
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.detail || `Failed to fetch members (${response.status})`);
        if (data && Array.isArray(data.members)) {
          const formattedMembers = data.members
            .map((m: any) => ({
              id: m.userId,
              name: m.username || m.email || m.userId,
            }))
            .sort((a: AccountMember, b: AccountMember) =>
              a.name.localeCompare(b.name)
            );
          setAccountMembers(formattedMembers);
        } else {
          throw new Error("Invalid member data format");
        }
      } catch (err: any) {
        const errorMsg = err.message || "Could not load members.";
        setMemberFetchError(errorMsg);
        setAccountMembers([]);
        toast({
          title: "Error Loading Members",
          description: errorMsg,
          variant: "destructive",
        });
        console.error("Error fetching account members:", err);
      } finally {
        setIsLoadingMembers(false);
      }
    };

    if (isOpen && accountId) {
       fetchMembers();
    }
  }, [isOpen, accountId, apiUrl]);


  const handleUpdateRoles = useCallback(async () => {
    if (!apiUrl || !contractId) {
      toast({ title: "Error", description: "Missing required data.", variant: "destructive" });
      return;
    }

     if (selectedEditorId === currentEditorId && selectedApproverId === currentApproverId) {
        toast({ title: "No Changes", description: "Editor and Approver roles were not changed.", variant: "default" });
        return;
     }

    setIsUpdating(true);
    setUpdateError(null);

    try {
      const payload: AssignWorkflowRolesRequest = {
        editorUserId: selectedEditorId,
        approverUserId: selectedApproverId,
      };
      const response = await apiFetch(`${apiUrl}/contracts/${contractId}/roles`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.detail || `Failed to update roles (${response.status})`);
      }

      toast({
        title: "Roles Updated",
        description: `Roles successfully reassigned for ${contractName}.`,
        variant: "default",
      });
      onReassignSuccess();

    } catch (err: any) {
      const errorMsg = err.message || "An unexpected error occurred.";
      setUpdateError(errorMsg);
      toast({
        title: "Update Failed",
        description: errorMsg,
        variant: "destructive",
      });
      console.error(`Error reassigning roles for ${contractId}:`, err);
    } finally {
      setIsUpdating(false);
    }
  }, [
    contractId,
    contractName,
    selectedEditorId,
    selectedApproverId,
    currentEditorId,
    currentApproverId,
    apiUrl,
    onReassignSuccess,
  ]);

  const hasChanges = selectedEditorId !== currentEditorId || selectedApproverId !== currentApproverId;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="gap-0 overflow-hidden border-gray-200 bg-white p-0 shadow-2xl sm:max-w-[520px] sm:rounded-2xl">
        <div className="border-b border-gray-100 px-4 py-3.5 sm:px-5">
          <div className="flex items-center gap-2.5 pr-8">
            <div className="flex h-8 w-8 flex-none items-center justify-center rounded-full border border-gray-200 bg-white text-gray-900 shadow-sm">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-sm font-semibold leading-5 text-gray-800">
                Reassign roles
              </DialogTitle>
              <DialogDescription className="mt-0.5 truncate text-xs leading-5 text-gray-500">
                {contractName}
              </DialogDescription>
            </div>
          </div>
        </div>

        <div className="space-y-4 px-4 py-4 sm:px-5">
          {isLoadingMembers && (
            <div className="flex items-center rounded-2xl border border-gray-200 bg-white px-3 py-4 text-xs leading-5 text-gray-500 shadow-sm">
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              Loading team members...
            </div>
          )}

          {memberFetchError && !isLoadingMembers && (
            <div className="flex items-start rounded-2xl border border-red-200 bg-red-50 px-3 py-3 text-xs leading-5 text-red-700">
              <AlertCircle className="mr-2 mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span>Error loading members: {memberFetchError}</span>
            </div>
          )}

          {!isLoadingMembers && !memberFetchError && accountMembers.length > 0 && (
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-3">
                <ShieldCheck className="h-3.5 w-3.5 text-gray-500" />
                <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-gray-400">
                  Workflow roles
                </div>
              </div>
              <div className="grid gap-3 px-3 py-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="editor" className="text-[10px] font-medium uppercase tracking-[0.08em] text-gray-400">
                    Editor
                  </Label>
                  <Select
                    value={selectedEditorId ?? "none"}
                    onValueChange={(value) => setSelectedEditorId(value === "none" ? null : value)}
                    disabled={isUpdating}
                  >
                    <SelectTrigger id="editor" className="h-8 rounded-full border-gray-200 bg-gray-50 px-3 text-xs text-gray-700 shadow-none">
                      <SelectValue placeholder="Select editor..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {accountMembers.map((member) => (
                        <SelectItem key={member.id} value={member.id}>
                          {member.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="approver" className="text-[10px] font-medium uppercase tracking-[0.08em] text-gray-400">
                    Approver
                  </Label>
                  <Select
                    value={selectedApproverId ?? "none"}
                    onValueChange={(value) => setSelectedApproverId(value === "none" ? null : value)}
                    disabled={isUpdating}
                  >
                    <SelectTrigger id="approver" className="h-8 rounded-full border-gray-200 bg-gray-50 px-3 text-xs text-gray-700 shadow-none">
                      <SelectValue placeholder="Select approver..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {accountMembers.map((member) => (
                        <SelectItem key={member.id} value={member.id}>
                          {member.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          {!isLoadingMembers && !memberFetchError && accountMembers.length === 0 && (
            <div className="rounded-2xl border border-gray-200 bg-white px-3 py-4 text-center text-xs leading-5 text-gray-500 shadow-sm">
              No members found in this account to assign roles.
            </div>
          )}

          {updateError && (
            <div className="flex items-start rounded-2xl border border-red-200 bg-red-50 px-3 py-3 text-xs leading-5 text-red-700">
              <AlertCircle className="mr-2 mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span>Update error: {updateError}</span>
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-gray-100 px-4 py-3 sm:flex-row sm:justify-end sm:px-5">
          <Button
            type="button"
            variant="outline"
            className="h-8 rounded-full border-gray-200 px-3 text-xs text-gray-600 shadow-none hover:bg-gray-50"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="h-8 rounded-[10px] bg-gradient-to-b from-neutral-700 to-black px-3 text-xs text-white hover:from-neutral-800 hover:to-black"
            onClick={handleUpdateRoles}
            disabled={
              isLoadingMembers ||
              isUpdating ||
              !hasChanges ||
              !!memberFetchError ||
              accountMembers.length === 0
            }
          >
            {isUpdating ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Saving
              </>
            ) : (
              "Save changes"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
