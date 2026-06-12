// app/teams/[teamId]/page.tsx
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from "next/navigation";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import LoadingScreen from "@/components/animation/LoadingScreen";
import {
    Users, ShieldCheck, User as UserIcon, Plus, ArrowLeft, Loader2, UserX, AlertTriangle, Pencil,
    BarChart2, FileText
} from "lucide-react";
import Link from 'next/link';

// --- Shadcn UI Dialog Components ---
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/apiClient";

// --- Interface Definitions ---
interface UserInDB { _id: string; username: string; email: string; }
interface TeamMemberInfo { userId: string; team_role: 'admin' | 'member'; addedAt: string; addedBy: string; username?: string; email?: string; }
interface TeamDetails { id: string; name: string; creatorId: string; members: TeamMemberInfo[]; createdAt: string; updatedAt: string; }
interface AddMemberPayload { email: string; }

// --- Component ---
export default function TeamDetailsPage() {
  // --- State Variables ---
  const [teamDetails, setTeamDetails] = useState<TeamDetails | null>(null);
  const [currentUserInfo, setCurrentUserInfo] = useState<UserInDB | null>(null);
  const [isLoadingTeam, setIsLoadingTeam] = useState(true);
  const [isLoadingUser, setIsLoadingUser] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAddMemberDialogOpen, setIsAddMemberDialogOpen] = useState(false);
  const [addMemberEmail, setAddMemberEmail] = useState('');
  const [isAddingMember, setIsAddingMember] = useState(false);
  const [editingMember, setEditingMember] = useState<TeamMemberInfo | null>(null);
  const [selectedNewRole, setSelectedNewRole] = useState<'admin' | 'member'>('member');
  const [isUpdatingRole, setIsUpdatingRole] = useState(false);
  const [isRemovingMemberInModal, setIsRemovingMemberInModal] = useState(false);

  // --- Hooks ---
  const router = useRouter();
  const params = useParams();
  const teamId = typeof params?.teamId === 'string' ? params.teamId : undefined;
  const apiUrl = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL;

  // --- Data Fetching Callbacks ---
  const fetchCurrentUser = useCallback(async () => {
    setIsLoadingUser(true);
    if (!apiUrl) { setError("API URL Missing"); setIsLoadingUser(false); return; }

    try {
      const response = await apiFetch(`${apiUrl}/users/me/`);
      const data = await response.json();
      if (!response.ok) {
        const message = data.detail || `Failed to fetch user (${response.status})`;
        setError(message);
        setCurrentUserInfo(null);
        if (response.status === 401) { localStorage.removeItem('token'); router.push('/signin'); }
        console.error("User fetch failed:", message);
        return;
      }
      setCurrentUserInfo(data as UserInDB);
    } catch (err: any) {
      const message = err.message || "Could not load your user information.";
      console.error("Error fetching current user:", err);
      setError(message);
      setCurrentUserInfo(null);
    } finally {
      setIsLoadingUser(false);
    }
  }, [apiUrl, router]);

  const fetchTeamDetails = useCallback(async (refreshing = false) => {
    if (isLoadingUser || !teamId || (!refreshing && !currentUserInfo && !isLoadingUser)) {
      if (!isLoadingUser && !currentUserInfo) {
        console.warn("Skipping team fetch: User info not available.");
        setIsLoadingTeam(false);
      }
      return;
    }

    setIsLoadingTeam(true);
    if (!apiUrl) {
      setError("API URL Missing");
      setIsLoadingTeam(false);
      return;
    }

    try {
      const response = await apiFetch(`${apiUrl}/teams/${teamId}`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || `Failed to fetch team details (${response.status})`);
      }
      setTeamDetails(data as TeamDetails);
      setError(null);
    } catch (err: any) {
      const message = err.message || "Failed to load team details.";
      console.error("Error fetching team details:", err);
      setError(message);
      setTeamDetails(null);
    } finally {
      setIsLoadingTeam(false);
    }
  }, [teamId, apiUrl, isLoadingUser, currentUserInfo]);

  // --- Effects for Data Fetching ---
  useEffect(() => {
    fetchCurrentUser();
  }, [fetchCurrentUser]);

  useEffect(() => {
    if (!isLoadingUser && teamId) {
      fetchTeamDetails();
    }
  }, [isLoadingUser, teamId, fetchTeamDetails]);

  // --- Memoized Derived State ---
  const currentUserId = currentUserInfo?._id;

  const isAdmin = useMemo(() => {
    return !!(
        currentUserId &&
        teamDetails?.members?.some(member => member.userId === currentUserId && member.team_role === 'admin')
    );
  }, [currentUserId, teamDetails?.members]);

  const adminCount = useMemo(() => {
    return teamDetails?.members?.filter(m => m.team_role === 'admin').length ?? 0;
  }, [teamDetails?.members]);

  // --- Action Handlers ---
  const handleAddMemberSubmit = async (event?: React.FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!addMemberEmail.trim() || !teamId || !isAdmin) {
        toast({ title: "Cannot Add Member", description: !isAdmin ? "Only admins can add members." : "Email is required.", variant: "destructive" });
        return;
    }

    if (!apiUrl) {
        toast({ title: "Config Error", variant: "destructive" });
        return;
    }

    setIsAddingMember(true);
    setError(null);
    const payload: AddMemberPayload = { email: addMemberEmail };

    try {
        const response = await apiFetch(`${apiUrl}/teams/${teamId}/members`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const responseData = await response.json();
        if (!response.ok) {
            throw new Error(responseData.detail || `Failed to add member (${response.status})`);
        }

        toast({ title: "Success", description: `User ${addMemberEmail} added.` });
        setIsAddMemberDialogOpen(false);
        setAddMemberEmail('');
        fetchTeamDetails(true);

    } catch (err: any) {
        const message = err.message || "An unexpected error occurred.";
        console.error("Add member error:", err);
        setError(message);
        toast({ title: "Error Adding Member", description: message, variant: "destructive" });
    } finally {
        setIsAddingMember(false);
    }
  };

  const handleRemoveMemberInModal = async () => {
    if (!editingMember || !teamId || !isAdmin || !currentUserId) {
        toast({ title: "Error", description: "Cannot remove member. Invalid context.", variant: "destructive" });
        return;
    }

    const memberToRemove = editingMember;
    const isCreator = memberToRemove.userId === teamDetails?.creatorId;
    const isLastAdmin = memberToRemove.team_role === 'admin' && adminCount <= 1;

    if (isCreator) {
        toast({ title: "Action Denied", description: "The original team creator cannot be removed.", variant: "destructive"});
        return;
    }
    if (isLastAdmin) {
      toast({ title: "Action Denied", description: "Cannot remove the last admin.", variant: "destructive"});
      return;
    }

    if (!apiUrl) {
        toast({ title: "Config Error", variant: "destructive" });
        return;
    }

    setIsRemovingMemberInModal(true);
    setError(null);

    try {
        const response = await apiFetch(`${apiUrl}/teams/${teamId}/members/${memberToRemove.userId}`, {
            method: 'DELETE',
        });

        if (response.status === 204) {
            toast({ title: "Success", description: `${memberToRemove.username || memberToRemove.email?.split('@')[0] || 'Member'} removed.` });
            setEditingMember(null);
            fetchTeamDetails(true);
        } else {
            let errorDetail = `Failed to remove member (${response.status})`;
            try { const errorData = await response.json(); errorDetail = errorData.detail || errorDetail; } catch (e) { /* Ignore */ }
            throw new Error(errorDetail);
        }
    } catch (err: any) {
        const message = err.message || "An unexpected error occurred.";
        console.error("Remove member error (modal):", err);
        setError(message);
        toast({ title: "Error Removing Member", description: message, variant: "destructive" });
    } finally {
        setIsRemovingMemberInModal(false);
    }
  };

  const handleUpdateRole = async () => {
    if (!teamId || !isAdmin || !editingMember || !selectedNewRole) {
      toast({ title: "Cannot Update Role", description: "Invalid state or permissions.", variant: "destructive" });
      return;
    }

    if (selectedNewRole === editingMember.team_role) {
      toast({ title: "No Change", description: "Role is already set to this value.", variant: "default" });
      setEditingMember(null);
      return;
    }

    if (editingMember.team_role === 'admin' && selectedNewRole === 'member' && adminCount <= 1) {
        toast({ title: "Action Denied", description: "Cannot demote the last admin. Assign another admin first.", variant: "destructive" });
        return;
    }
    if (teamDetails?.creatorId === editingMember.userId && selectedNewRole === 'member') {
        toast({ title: "Action Denied", description: "The original team creator cannot be demoted by another admin.", variant: "destructive" });
        return;
    }

    if (!apiUrl) {
      toast({ title: "Config Error", variant: "destructive" });
      return;
    }

    setIsUpdatingRole(true);
    setError(null);

    const payload = { new_role: selectedNewRole };

    try {
      const response = await apiFetch(`${apiUrl}/teams/${teamId}/members/${editingMember.userId}/role`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const responseData = await response.json();

      if (!response.ok) {
        throw new Error(responseData.detail || `Failed to update role (${response.status})`);
      }

      toast({ title: "Success", description: `${editingMember.username || editingMember.email?.split('@')[0] || 'Member'}'s role updated to ${selectedNewRole}.` });
      setEditingMember(null);
      fetchTeamDetails(true);

    } catch (err: any) {
      const message = err.message || "An unexpected error occurred.";
      console.error("Update role error:", err);
      setError(message);
      toast({ title: "Error Updating Role", description: message, variant: "destructive" });
    } finally {
      setIsUpdatingRole(false);
    }
  };

  // --- Render Logic ---
  const isLoading = isLoadingUser || isLoadingTeam;

  if (!teamId && !isLoading) {
    return (
        <div className="container mx-auto py-8 text-center">
            <AlertTriangle className="mx-auto h-12 w-12 text-destructive mb-4" />
            <h2 className="text-xl font-semibold text-destructive">Invalid Team</h2>
            <p className="text-muted-foreground">The team ID is missing from the URL.</p>
            <Button onClick={() => router.push('/teams')} className="mt-4">Back to Teams</Button>
        </div>
    );
  }

  return (
    <>
      <div>
        <title>{teamDetails ? `Team: ${teamDetails.name}` : 'Team Details'} - ContractSense</title>
      </div>
      <div className="font-GullyVar min-h-screen bg-[#FAFAFA] dark:bg-slate-900">
        <main className="max-w-4xl mx-auto mt-12 py-8 px-4 sm:px-6 lg:px-8">
           <Link
            href="/account"
            className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 mb-6"
          >
            <ArrowLeft size={16} />
            Account Details
          </Link>

           {isLoading && (
              <div className="space-y-6">
                <Skeleton className="h-10 w-3/4 rounded-md" />
                <div className="space-y-4">
                    <Skeleton className="h-20 w-full rounded-lg" />
                    <Skeleton className="h-20 w-full rounded-lg" />
                    <Skeleton className="h-20 w-full rounded-lg" />
                </div>
              </div>
           )}

           {!isLoading && error && !teamDetails && (
              <div className="text-center text-red-600 bg-red-100 dark:bg-red-900/20 dark:text-red-400 p-4 rounded-md border border-red-300 dark:border-red-700 shadow-sm mb-6 mx-auto max-w-lg">
                 <AlertTriangle className="h-6 w-6 inline-block mr-2 text-red-500 dark:text-red-400" />
                 <span className="font-semibold">Error:</span> {error}
              </div>
           )}

           {!isLoading && teamDetails && currentUserInfo && (
             <>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-8 border-b dark:border-slate-700 pb-4 gap-3">
                   <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-3 truncate">
                      <Users className="h-8 w-8 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                      <span className="truncate" title={teamDetails.name}>Team: {teamDetails.name}</span>
                   </h1>
                   <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                        {isAdmin && (
                            <Dialog open={isAddMemberDialogOpen} onOpenChange={setIsAddMemberDialogOpen}>
                                <DialogTrigger asChild>
                                <Button className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-2" size="sm">
                                    <Plus className="h-4 w-4" /> Add Member
                                </Button>
                                </DialogTrigger>
                                <DialogContent className="sm:max-w-[425px]">
                                    <DialogHeader>
                                    <DialogTitle>Add Member to "{teamDetails.name}"</DialogTitle>
                                    <DialogDescription>Enter the email address of the registered user to add.</DialogDescription>
                                    </DialogHeader>
                                    <form onSubmit={handleAddMemberSubmit}>
                                    <div className="grid gap-4 py-4">
                                        <div className="grid grid-cols-4 items-center gap-4">
                                            <Label htmlFor="add-email" className="text-right">Email</Label>
                                            <Input id="add-email" type="email" placeholder="user@example.com" value={addMemberEmail} onChange={(e) => setAddMemberEmail(e.target.value)} required className="col-span-3" disabled={isAddingMember} />
                                        </div>
                                    </div>
                                    <DialogFooter>
                                        <DialogClose asChild><Button type="button" variant="outline" disabled={isAddingMember}>Cancel</Button></DialogClose>
                                        <Button type="submit" disabled={isAddingMember || !addMemberEmail.trim()} className="bg-[#0084C7] hover:bg-[#0073b0]">
                                            {isAddingMember && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                            {isAddingMember ? 'Adding...' : 'Add Member'}
                                        </Button>
                                    </DialogFooter>
                                    </form>
                                </DialogContent>
                            </Dialog>
                        )}
                   </div>
                </div>

                {!isLoading && error && teamDetails && (
                     <div className="text-sm text-red-600 bg-red-50 p-3 rounded-md border border-red-200 shadow-sm mb-4">
                        <AlertTriangle className="h-4 w-4 inline-block mr-1.5" /> {error}
                     </div>
                )}

                <div className="bg-white/80 dark:bg-slate-800/50 backdrop-blur-sm rounded-xl shadow-sm border border-[#0084C7]/10 dark:border-slate-700 p-4 md:p-6">
                   <h2 className="text-xl font-semibold mb-4">Members ({teamDetails.members.length})</h2>
                   {teamDetails.members.length === 0 ? (
                       <p className="text-gray-500 dark:text-gray-400 italic text-center py-3">No members yet.</p>
                   ) : (
                      <ul className="space-y-3">
                         {teamDetails.members.map((member) => {
                            const isThisMemberTheLoggedInUser = member.userId === currentUserId;
                            const displayName = member.username || member.email?.split('@')[0] || `User ID: ${member.userId.substring(0,8)}...`;
                            const displaySubtext = member.email || `ID: ${member.userId}`;

                            const isThisMemberTheCreator = member.userId === teamDetails.creatorId;
                            const isThisMemberAdmin = member.team_role === 'admin';

                            const canEditThisMember = isAdmin && !isThisMemberTheLoggedInUser;

                            const canRemoveThisMember =
                                isAdmin &&
                                !isThisMemberTheLoggedInUser &&
                                !isThisMemberTheCreator &&
                                !(isThisMemberAdmin && adminCount <= 1);

                            return (
                              <li key={member.userId} className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-3 bg-gray-50/70 dark:bg-slate-700/50 rounded-lg border border-gray-200/80 dark:border-slate-600 gap-3 hover:bg-gray-100/50 dark:hover:bg-slate-700 transition-colors">
                                <div className="flex items-center gap-3 flex-grow min-w-0">
                                  <span className={`p-1.5 rounded-full flex-shrink-0 ${member.team_role === 'admin' ? 'bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300' : 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300'}`}>
                                      {member.team_role === 'admin' ? <ShieldCheck size={18} /> : <UserIcon size={18} />}
                                  </span>
                                  <div className="overflow-hidden">
                                      <p className="font-medium text-gray-800 dark:text-gray-200 truncate flex items-center gap-1.5">
                                          <span className="truncate" title={member.username || member.email}>{displayName}</span>
                                          {isThisMemberTheLoggedInUser && <span className="ml-1 text-xs font-semibold text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-900/50 px-1.5 py-0.5 rounded-full flex-shrink-0">(You)</span>}
                                          {isThisMemberTheCreator && <span className="ml-1 text-xs font-semibold text-purple-700 dark:text-purple-300 bg-purple-100 dark:bg-purple-900/50 px-1.5 py-0.5 rounded-full flex-shrink-0">Creator</span>}
                                      </p>
                                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate" title={displaySubtext}>{displaySubtext}</p>
                                      <p className={`mt-0.5 text-xs font-medium capitalize px-1.5 py-0.5 rounded-full w-fit ${member.team_role === 'admin' ? 'bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300' : 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-300'}`}>
                                          {member.team_role}
                                      </p>
                                  </div>
                                </div>

                                <div className="flex items-center flex-shrink-0 w-full sm:w-auto justify-end mt-2 sm:mt-0">
                                  {canEditThisMember && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="text-gray-600 hover:text-blue-600 hover:bg-blue-50 dark:text-gray-300 dark:hover:text-blue-300 dark:hover:bg-slate-600"
                                      onClick={() => {
                                        setEditingMember(member);
                                        setSelectedNewRole(member.team_role);
                                      }}
                                      title="Edit Member"
                                      disabled={isUpdatingRole || isRemovingMemberInModal}
                                    >
                                      <Pencil className="h-4 w-4" />
                                    </Button>
                                  )}
                                  {isAdmin && !isThisMemberTheLoggedInUser && !canEditThisMember && (
                                        <span className="text-xs text-gray-400 italic self-center"></span>
                                  )}
                                    {isAdmin && isThisMemberTheLoggedInUser && (
                                        <span className="text-xs text-gray-500 dark:text-gray-400 italic self-center"></span>
                                    )}
                                </div>
                              </li>
                            );
                         })}
                      </ul>
                   )}
                </div>

                {/* === NEW CODE: Audits & Analytics Cards === */}
                <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">

                  {/* Card 1: Audits */}
                  <Card className="flex flex-col bg-white/80 dark:bg-slate-800/50 backdrop-blur-sm shadow-sm border border-[#0084C7]/10 dark:border-slate-700">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                        Audits
                      </CardTitle>
                      <CardDescription>
                        View detailed audit logs of team activities and changes.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="flex-grow">
                      {/* Intentionally left blank for future content if needed */}
                    </CardContent>
                    <CardFooter className="flex justify-end">
                      <Link href={`/teams/${teamId}/audit`} passHref>
                        <Button
                           variant="outline"
                           className="dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-700 text-[12px] font-normal"
                        >
                           View Detailed Logs
                        </Button>
                      </Link>
                    </CardFooter>
                  </Card>

                  {/* Card 2: Analytics - Only shown to admins */}
                  {isAdmin && (
                    <Card className="flex flex-col bg-white/80 dark:bg-slate-800/50 backdrop-blur-sm shadow-sm border border-[#0084C7]/10 dark:border-slate-700">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <BarChart2 className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                          Analytics
                        </CardTitle>
                        <CardDescription>
                          View page credit usage for the account and its members.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="flex-grow">
                        {/* Intentionally left blank for future content if needed */}
                      </CardContent>
                      <CardFooter className="flex justify-end">
                        <Link href={`/teams/${teamId}/analytics`} passHref>
                          <Button
                            variant="outline"
                            className="dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-700 text-[12px] font-normal"
                          >
                            View Page Credit Usage
                          </Button>
                        </Link>
                      </CardFooter>
                    </Card>
                  )}

                </div>

                {!isAdmin && (
                   <p className="mt-6 text-sm text-center text-gray-500 dark:text-gray-400 italic p-4 bg-gray-50 dark:bg-slate-800/50 rounded-md border dark:border-slate-700">
                      Only team admins can manage members or change roles.
                   </p>
                )}

                {editingMember && teamDetails && currentUserInfo && (
                  <Dialog open={!!editingMember} onOpenChange={(isOpen) => { if (!isOpen) setEditingMember(null); }}>
                    <DialogContent className="sm:max-w-md p-0">
                      <Card className="shadow-none border-0 rounded-lg">
                        <CardHeader className="p-4 sm:p-6 border-b dark:border-slate-700">
                          <DialogTitle className="text-lg">
                            Edit Member: <span className="font-semibold">{editingMember.username || editingMember.email?.split('@')[0] || `User ID ${editingMember.userId.substring(0,8)}...`}</span>
                          </DialogTitle>
                          <CardDescription>
                            Update their role or remove them from the team.
                          </CardDescription>
                        </CardHeader>

                        <CardContent className="p-4 sm:p-6 space-y-6">
                          <div className="space-y-3">
                            <h3 className="text-base font-medium text-gray-800 dark:text-gray-200">Change Role</h3>
                            <div className="grid grid-cols-3 items-center gap-3">
                              <Label htmlFor="role-select-modal" className="text-sm text-gray-600 dark:text-gray-300">
                                New Role:
                              </Label>
                              <div className="col-span-2">
                                <Select
                                  value={selectedNewRole}
                                  onValueChange={(value: 'admin' | 'member') => setSelectedNewRole(value)}
                                  disabled={isUpdatingRole || isRemovingMemberInModal}
                                >
                                  <SelectTrigger id="role-select-modal" className="dark:border-gray-600">
                                    <SelectValue placeholder="Select a role" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="admin">Admin</SelectItem>
                                    <SelectItem value="member">Member</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>

                            {editingMember.team_role === 'admin' && selectedNewRole === 'member' && (
                              <>
                                {teamDetails.creatorId === editingMember.userId && (
                                    <p className="text-xs text-orange-600 dark:text-orange-300 text-center py-1 px-2 bg-orange-50 dark:bg-orange-900/50 border border-orange-200 dark:border-orange-700 rounded-md">The original team creator cannot be demoted by other admins.</p>
                                )}
                                {adminCount <= 1 && teamDetails.creatorId !== editingMember.userId && (
                                    <p className="text-xs text-orange-600 dark:text-orange-300 text-center py-1 px-2 bg-orange-50 dark:bg-orange-900/50 border border-orange-200 dark:border-orange-700 rounded-md">Cannot demote the last admin in the team.</p>
                                )}
                              </>
                            )}

                            <Button
                              type="button"
                              onClick={handleUpdateRole}
                              disabled={isUpdatingRole || isRemovingMemberInModal || selectedNewRole === editingMember.team_role}
                              className="w-full bg-blue-600 hover:bg-blue-700 text-white mt-2 dark:bg-blue-700 dark:hover:bg-blue-800"
                            >
                              {isUpdatingRole && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                              {isUpdatingRole ? 'Saving Role...' : 'Save Role Changes'}
                            </Button>
                          </div>

                          <hr className="my-6 border-gray-200 dark:border-slate-700"/>

                          <div className="space-y-3">
                            <h3 className="text-base font-medium text-red-600 dark:text-red-400">Remove Member</h3>
                            <p className="text-sm text-gray-600 dark:text-gray-300">
                              This will permanently remove <span className="font-semibold">{editingMember.username || editingMember.email?.split('@')[0]}</span> from the team.
                            </p>

                            {(() => {
                              const isCreator = editingMember.userId === teamDetails.creatorId;
                              const isLastAdmin = editingMember.team_role === 'admin' && adminCount <= 1;
                              const canBeRemoved = !isCreator && !isLastAdmin;

                              if (!canBeRemoved) {
                                return (
                                  <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-md text-sm">
                                    <p className="text-yellow-700 dark:text-yellow-300 font-medium">
                                      This member cannot be removed:
                                    </p>
                                    <ul className="list-disc list-inside text-yellow-600 dark:text-yellow-300 text-xs mt-1">
                                      {isCreator && <li>They are the team creator.</li>}
                                      {isLastAdmin && <li>They are the last admin. Assign another admin first.</li>}
                                    </ul>
                                  </div>
                                );
                              }
                              return (
                                <Dialog>
                                  <DialogTrigger asChild>
                                    <Button
                                      variant="outline"
                                      className="w-full text-red-600 dark:text-red-400 border-red-300 dark:border-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-700 dark:hover:text-red-300"
                                      disabled={isUpdatingRole || isRemovingMemberInModal}
                                    >
                                      <UserX className="mr-2 h-4 w-4" /> Remove from Team
                                    </Button>
                                  </DialogTrigger>
                                  <DialogContent>
                                    <DialogHeader>
                                      <DialogTitle>Confirm Removal</DialogTitle>
                                      <DialogDescription>
                                        Are you sure you want to remove <span className="font-bold">{editingMember.username || editingMember.email?.split('@')[0]}</span>? This action is permanent.
                                      </DialogDescription>
                                    </DialogHeader>
                                    <DialogFooter>
                                      <DialogClose asChild><Button variant="outline" disabled={isRemovingMemberInModal}>Cancel</Button></DialogClose>
                                      <Button
                                        variant="destructive"
                                        onClick={handleRemoveMemberInModal}
                                        disabled={isRemovingMemberInModal}
                                      >
                                        {isRemovingMemberInModal && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                        {isRemovingMemberInModal ? "Removing..." : "Yes, Remove Member"}
                                      </Button>
                                    </DialogFooter>
                                  </DialogContent>
                                </Dialog>
                              );
                            })()}
                          </div>
                        </CardContent>
                      </Card>
                    </DialogContent>
                  </Dialog>
                )}
             </>
           )}
        </main>
      </div>
    </>
  );
}
