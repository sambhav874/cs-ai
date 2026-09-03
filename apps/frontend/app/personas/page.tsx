"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Loader2, Plus, ShieldCheck, Trash2, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { useAuth } from "@/hooks/useAuth";
import { useAccountContext } from "@/app/context/AccountContext";
import {
  assignPersona,
  createPersona,
  deletePersona,
  fetchAccessReview,
  fetchPersonas,
  fetchPrivileges,
  updatePersona,
  type AccessReview,
  type Persona,
  type PersonaMember,
  type Privilege,
} from "@/lib/personas";

const CAN_EDIT = "account.personas";

export default function PersonasPage() {
  const { isAuthenticated } = useAuth();
  const { selectedAccountId } = useAccountContext();

  const [privileges, setPrivileges] = useState<Privilege[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [members, setMembers] = useState<PersonaMember[]>([]);
  const [myPrivileges, setMyPrivileges] = useState<string[]>([]);
  const [review, setReview] = useState<AccessReview | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftPrivileges, setDraftPrivileges] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isTeam = Boolean(selectedAccountId && selectedAccountId !== "personal");
  const canEdit = myPrivileges.includes(CAN_EDIT);
  const selected = useMemo(
    () => personas.find((persona) => persona.id === selectedId) || null,
    [personas, selectedId],
  );

  const load = useCallback(async () => {
    if (!isTeam || !selectedAccountId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const [privilegeList, overview] = await Promise.all([
        fetchPrivileges(),
        fetchPersonas(selectedAccountId),
      ]);
      setPrivileges(privilegeList);
      setPersonas(overview.personas);
      setMembers(overview.members);
      setMyPrivileges(overview.myPrivileges);
      setSelectedId((current) => current || overview.personas[0]?.id || null);
      if (overview.myPrivileges.includes(CAN_EDIT)) {
        setReview(await fetchAccessReview(selectedAccountId));
      }
    } catch (loadError: any) {
      setError(loadError?.message || "Could not load personas.");
    } finally {
      setIsLoading(false);
    }
  }, [isTeam, selectedAccountId]);

  useEffect(() => {
    if (isAuthenticated) void load();
  }, [isAuthenticated, load]);

  useEffect(() => {
    if (!selected) return;
    setDraftName(selected.name);
    setDraftPrivileges(new Set(selected.privileges));
  }, [selected]);

  const toggle = (privilege: string) => {
    setDraftPrivileges((current) => {
      const next = new Set(current);
      if (next.has(privilege)) next.delete(privilege);
      else next.add(privilege);
      return next;
    });
  };

  const save = async () => {
    if (!selected || !selectedAccountId) return;
    setIsSaving(true);
    setError(null);
    try {
      await updatePersona(selectedAccountId, selected.id, {
        name: draftName.trim(),
        privileges: Array.from(draftPrivileges),
      });
      toast({ title: "Persona saved", description: "Everyone holding it is affected immediately." });
      await load();
    } catch (saveError: any) {
      setError(saveError?.message || "Could not save the persona.");
    } finally {
      setIsSaving(false);
    }
  };

  const addPersona = async () => {
    if (!selectedAccountId) return;
    const name = window.prompt("Name for the new persona");
    if (!name?.trim()) return;
    try {
      const created = await createPersona(selectedAccountId, {
        name: name.trim(),
        privileges: selected ? Array.from(draftPrivileges) : [],
      });
      toast({ title: `${created.name} created`, description: "Nobody holds it yet." });
      await load();
      setSelectedId(created.id);
    } catch (createError: any) {
      toast({ title: "Error", description: createError?.message, variant: "destructive" });
    }
  };

  const removePersona = async () => {
    if (!selected || !selectedAccountId) return;
    if (!window.confirm(`Delete the ${selected.name} persona?`)) return;
    try {
      await deletePersona(selectedAccountId, selected.id);
      toast({ title: "Persona deleted" });
      setSelectedId(null);
      await load();
    } catch (deleteError: any) {
      toast({ title: "Error", description: deleteError?.message, variant: "destructive" });
    }
  };

  const changeMemberPersona = async (userId: string, personaId: string) => {
    if (!selectedAccountId) return;
    try {
      await assignPersona(selectedAccountId, userId, personaId);
      toast({ title: "Persona changed" });
      await load();
    } catch (assignError: any) {
      toast({ title: "Error", description: assignError?.message, variant: "destructive" });
    }
  };

  if (!isTeam) {
    return (
      <div className="mx-auto max-w-3xl p-6 md:p-8">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Personas</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Personas belong to a team account. Switch to a team to set them up.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-6 md:p-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Personas</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What a person may ever do here. Who does it on a given contract is set on the
          project, not here.
        </p>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          <section className="grid gap-6 md:grid-cols-[220px_1fr]">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Personas
                </Label>
                {canEdit && (
                  <Button variant="ghost" size="sm" onClick={addPersona} className="h-7 px-2">
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              {personas.map((persona) => (
                <button
                  key={persona.id}
                  onClick={() => setSelectedId(persona.id)}
                  className={`flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                    persona.id === selectedId
                      ? "border-primary/40 bg-primary/5 font-medium"
                      : "border-border hover:bg-muted/50"
                  }`}
                >
                  <span>{persona.name}</span>
                  <span className="text-xs text-muted-foreground">{persona.privileges.length}</span>
                </button>
              ))}
            </div>

            {selected && (
              <div className="rounded-lg border border-border bg-card p-5">
                <div className="mb-4 flex items-end gap-3">
                  <div className="flex-1 space-y-1">
                    <Label htmlFor="persona-name" className="text-xs">Name</Label>
                    <Input
                      id="persona-name"
                      value={draftName}
                      disabled={!canEdit}
                      onChange={(event) => setDraftName(event.target.value)}
                      className="h-9"
                    />
                  </div>
                  {canEdit && !selected.isSystem && (
                    <Button variant="ghost" size="sm" onClick={removePersona} className="h-9">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  {privileges.map((privilege) => (
                    <label
                      key={privilege.privilege}
                      className="flex items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/40"
                    >
                      <Checkbox
                        checked={draftPrivileges.has(privilege.privilege)}
                        disabled={!canEdit}
                        onCheckedChange={() => toggle(privilege.privilege)}
                        className="mt-0.5"
                      />
                      <span>
                        {privilege.label}
                        <span className="block font-mono text-[11px] text-muted-foreground">
                          {privilege.privilege}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>

                {canEdit && (
                  <div className="mt-4 flex justify-end">
                    <Button onClick={save} disabled={isSaving}>
                      {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Save persona
                    </Button>
                  </div>
                )}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Users className="h-4 w-4" />
              Who holds what
            </h2>
            <div className="flex flex-col gap-2">
              {members.map((member) => (
                <div
                  key={member.userId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card px-4 py-3"
                >
                  <div>
                    <span className="text-sm font-medium">{member.username || member.userId}</span>
                    {member.grants.length > 0 && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        + {member.grants.length} granted
                        {member.grants.some((grant) => grant.until) && " (expiring)"}
                      </span>
                    )}
                  </div>
                  {canEdit ? (
                    <Select
                      value={member.personaId || ""}
                      onValueChange={(value) => changeMemberPersona(member.userId, value)}
                    >
                      <SelectTrigger className="h-8 w-52">
                        <SelectValue placeholder="No persona" />
                      </SelectTrigger>
                      <SelectContent>
                        {personas.map((persona) => (
                          <SelectItem key={persona.id} value={persona.id}>
                            {persona.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge variant="outline">{member.personaName || "No persona"}</Badge>
                  )}
                </div>
              ))}
            </div>
          </section>

          {review && (
            <section>
              <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck className="h-4 w-4" />
                Access review
              </h2>
              <p className="mb-3 text-sm text-muted-foreground">
                The two that matter most in a security review, and any grant still standing.
              </p>
              <div className="flex flex-col gap-2">
                {["contract.approve", "kpi.certify", "account.personas"].map((privilege) => (
                  <div
                    key={privilege}
                    className="rounded-md border border-border bg-card px-4 py-3 text-sm"
                  >
                    <span className="font-medium">{review.holders[privilege]?.label || privilege}</span>
                    <span className="ml-2 text-muted-foreground">
                      {review.holders[privilege]?.members.length
                        ? review.holders[privilege].members
                            .map((member) => member.username || member.userId)
                            .join(", ")
                        : "nobody"}
                    </span>
                  </div>
                ))}
                {review.outstandingGrants.map((grant, index) => (
                  <div
                    key={`${grant.userId}-${grant.privilege}-${index}`}
                    className="rounded-md border border-amber-300/50 bg-amber-50/50 px-4 py-3 text-sm dark:bg-amber-500/5"
                  >
                    <span className="font-medium">{grant.username || grant.userId}</span>
                    <span className="ml-2 font-mono text-xs">{grant.privilege}</span>
                    <span className="ml-2 text-muted-foreground">
                      {grant.until
                        ? `until ${new Date(grant.until).toLocaleDateString()}`
                        : "no expiry"}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
