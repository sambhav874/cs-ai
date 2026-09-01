"use client";

import React, { useCallback, useEffect, useState } from "react";
import { AlertCircle, Loader2, UserMinus, UserPlus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/apiClient";
import {
  createDelegation,
  fetchDelegations,
  revokeDelegation,
  type Delegation,
} from "@/lib/reviewQueue";

type Member = { id: string; name: string };

/** Hand a role to a colleague while you are away, and take it back. */
export function DelegationPanel({ accountId }: { accountId: string | null }) {
  const apiUrl = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL;

  const [delegations, setDelegations] = useState<Delegation[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [role, setRole] = useState<"approver" | "editor">("approver");
  const [delegateId, setDelegateId] = useState<string>("");
  const [until, setUntil] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setDelegations(await fetchDelegations());
      if (apiUrl && accountId && accountId !== "personal") {
        const response = await apiFetch(`${apiUrl}/teams/${accountId}`);
        const data = await response.json();
        if (response.ok && Array.isArray(data.members)) {
          setMembers(
            data.members
              .map((member: any) => ({
                id: member.userId,
                name: member.username || member.email || member.userId,
              }))
              .sort((a: Member, b: Member) => a.name.localeCompare(b.name)),
          );
        }
      }
    } catch (loadError: any) {
      setError(loadError?.message || "Could not load delegations.");
    } finally {
      setIsLoading(false);
    }
  }, [apiUrl, accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = useCallback(async () => {
    if (!delegateId) return;
    setIsSaving(true);
    setError(null);
    try {
      await createDelegation({
        role,
        delegateUserId: delegateId,
        // A date input gives a day; the role should last through it.
        until: until ? new Date(`${until}T23:59:59`).toISOString() : null,
      });
      toast({ title: "Delegated", description: "They will see this work in their own queue." });
      setDelegateId("");
      setUntil("");
      await load();
    } catch (saveError: any) {
      setError(saveError?.message || "Could not create the delegation.");
    } finally {
      setIsSaving(false);
    }
  }, [role, delegateId, until, load]);

  const revoke = useCallback(async (delegationId: string) => {
    try {
      await revokeDelegation(delegationId);
      toast({ title: "Delegation revoked", description: "The role is yours again." });
      await load();
    } catch (revokeError: any) {
      toast({
        title: "Error",
        description: revokeError?.message || "Could not revoke the delegation.",
        variant: "destructive",
      });
    }
  }, [load]);

  const active = delegations.filter((delegation) => delegation.active);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-semibold text-foreground">While you are away</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Hand a role to a colleague so your contracts do not sit waiting. It lapses on
        its own — you do not have to remember to take it back.
      </p>

      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {active.length > 0 && (
            <ul className="mt-4 flex flex-col gap-2">
              {active.map((delegation) => (
                <li
                  key={delegation.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm"
                >
                  <span>
                    <Badge variant="outline" className="mr-2 text-xs capitalize">
                      {delegation.role}
                    </Badge>
                    {delegation.delegate_name || delegation.delegateUserId}
                    {delegation.until && (
                      <span className="text-muted-foreground">
                        {" "}
                        until {new Date(delegation.until).toLocaleDateString()}
                      </span>
                    )}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => revoke(delegation.id)}>
                    <UserMinus className="mr-1 h-3.5 w-3.5" />
                    Take back
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="delegation-role" className="text-xs">Role</Label>
              <Select value={role} onValueChange={(value) => setRole(value as "approver" | "editor")}>
                <SelectTrigger id="delegation-role" className="h-9 w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="approver">Approver</SelectItem>
                  <SelectItem value="editor">Editor</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="delegation-user" className="text-xs">Covered by</Label>
              <Select value={delegateId} onValueChange={setDelegateId}>
                <SelectTrigger id="delegation-user" className="h-9 w-48">
                  <SelectValue placeholder="Pick a colleague" />
                </SelectTrigger>
                <SelectContent>
                  {members.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="delegation-until" className="text-xs">Until (optional)</Label>
              <Input
                id="delegation-until"
                type="date"
                className="h-9 w-40"
                value={until}
                onChange={(event) => setUntil(event.target.value)}
              />
            </div>

            <Button onClick={submit} disabled={isSaving || !delegateId} className="h-9">
              {isSaving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="mr-2 h-4 w-4" />
              )}
              Delegate
            </Button>
          </div>

          {members.length === 0 && (
            <p className="mt-3 text-sm text-muted-foreground">
              Delegation needs a team — a personal workspace has only you.
            </p>
          )}

          {error && (
            <p className="mt-3 flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}
