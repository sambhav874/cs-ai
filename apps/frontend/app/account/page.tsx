"use client";

import Link from 'next/link';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from '@/components/ui/skeleton';
import { User, Crown, Loader2, AlertCircle, SettingsIcon, Users as TeamIcon } from 'lucide-react';
// Assuming Loader is a custom component you have. If not, replace Loader with Loader2 from lucide-react.
// For example, if you don't have a custom Loader:
// import { Loader2 as Loader } from 'lucide-react'; 

import { useAccountContext } from '@/app/context/AccountContext';
import { useBreadcrumbs } from '@/app/context/BreadcrumbContext';
import { apiFetch } from '@/lib/apiClient';

// --- Interface Definitions ---
interface UserInDB {
    _id: string;
    username: string;
    email: string;
    ownedAccountId?: string | null;
    tokens?: number;
    teamIds?: string[];
}

interface TeamMemberInfoFromAPI {
  userId: string;
  team_role: 'admin' | 'member';
  username?: string;
  email?: string;
}

interface SelectedTeamDetails {
    id: string; // Should be populated from _id by backend or frontend mapping
    name: string;
    creatorId: string;
    members: TeamMemberInfoFromAPI[];
    // Add other fields your /teams/{id} endpoint returns
}

export default function AccountPage() {
    const [currentUserInfo, setCurrentUserInfo] = useState<UserInDB | null>(null);
    const [selectedTeamDetails, setSelectedTeamDetails] = useState<SelectedTeamDetails | null>(null);
    
    const [isLoadingUser, setIsLoadingUser] = useState(true);
    const [isLoadingTeam, setIsLoadingTeam] = useState(false);
    const [isUpgrading, setIsUpgrading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    
    const router = useRouter();
    const apiUrl = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL;
    
    const { selectedAccountId, setSelectedAccount, isInitialized } = useAccountContext();
    const { setBreadcrumbs } = useBreadcrumbs();

    useEffect(() => {
        setBreadcrumbs([{ label: "Account Settings" }]);
    }, [setBreadcrumbs]);

    // --- Fetch Current User Data ---
    const fetchCurrentUser = useCallback(async () => {
        setIsLoadingUser(true);
        setError(null);
        if (!apiUrl) {
            setError("API URL is not configured.");
            setIsLoadingUser(false);
            return;
        }

        try {
            const response = await apiFetch(`${apiUrl}/users/me/`);
            const data = await response.json();
            if (!response.ok) {
                 let msg = data.detail || `Failed to load user information (${response.status})`;
                 if (response.status === 401) { 
                     localStorage.removeItem('token'); 
                     router.push('/signin'); 
                     msg = "Your session has expired. Please sign in again."; 
                 }
                 throw new Error(msg);
            }
            setCurrentUserInfo(data as UserInDB);
        } catch (err: any) {
            console.error("Error fetching current user:", err);
            setError(err.message); 
            setCurrentUserInfo(null);
            toast({ title: "Error Loading User", description: err.message, variant: "destructive" });
        } finally {
            setIsLoadingUser(false);
        }
    }, [apiUrl, router]);

    useEffect(() => {
        fetchCurrentUser();
    }, [fetchCurrentUser]);

    // --- Fetch Selected Team/Account Details ---
    const fetchSelectedTeamDetails = useCallback(async () => {
        if (!isInitialized || !selectedAccountId || selectedAccountId === 'personal' || !currentUserInfo) {
            setSelectedTeamDetails(null);
            setIsLoadingTeam(false);
            return;
        }

        setIsLoadingTeam(true);
        // setError(null); // Clearing error here might hide a user fetch error
        if (!apiUrl) {
            // setError(!token ? "Authentication Token Missing." : "API URL is not configured.");
            // Avoid overwriting a more primary error (like user fetch error)
            if (!error) setError("API URL is not configured.");
            setIsLoadingTeam(false);
            return;
        }

        try {
            const response = await apiFetch(`${apiUrl}/teams/${selectedAccountId}`);
            const data = await response.json();
            if (!response.ok) {
                const errorMsg = data.detail || `Failed to load account details (${response.status}) for ID: ${selectedAccountId}`;
                if (response.status === 403 || response.status === 404) {
                    toast({ title: "Access Issue", description: `Could not load details for the selected account. You may no longer have access. Switching to personal context.`, duration: 7000 });
                    setSelectedAccount('personal');
                    setSelectedTeamDetails(null); // Ensure it's cleared
                }
                throw new Error(errorMsg);
            }
            // Ensure 'id' field is present, mapping from '_id' if necessary
            // Your backend /teams/{id} GET endpoint should ideally return 'id' directly
            // if it's using Pydantic model TeamInDB with alias.
            if (data._id && !data.id) {
                data.id = String(data._id);
            }
            setSelectedTeamDetails(data as SelectedTeamDetails);
            setError(null); // Clear general errors if team fetch is successful
        } catch (err: any) {
            console.error("Error fetching selected account details:", err);
            setError(err.message); // Set this error
            setSelectedTeamDetails(null);
            if (!err.message.includes("Could not load details for account")) { // Avoid double toast
                 toast({ title: "Error Loading Selected Account", description: err.message, variant: "destructive" });
            }
        } finally {
            setIsLoadingTeam(false);
        }
    }, [isInitialized, selectedAccountId, apiUrl, currentUserInfo, setSelectedAccount, error]); // Added error to dep array

    useEffect(() => {
        if (isInitialized && currentUserInfo) { // Ensure context is ready and user is loaded
            fetchSelectedTeamDetails();
        }
    }, [isInitialized, currentUserInfo, fetchSelectedTeamDetails]); // fetchSelectedTeamDetails has selectedAccountId in its deps

    // --- Handle Upgrade Action ---
    const handleUpgrade = useCallback(async () => {
        if (!apiUrl || !currentUserInfo) return;
        setIsUpgrading(true);
        try {
            const response = await apiFetch(`${apiUrl}/users/me/upgrade-to-pro`, {
                method: 'POST'
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.detail || 'Upgrade failed');
            }
            toast({
                title: "Upgrade Successful",
                description: "Your account has been successfully upgraded to Pro.",
            });
            // Re-fetch user details to get the new ownedAccountId
            await fetchCurrentUser();
            // Switch selection context to the new team/account if returned
            if (data.accountId) {
                setSelectedAccount(data.accountId);
            }
        } catch (err: any) {
            console.error("Error upgrading user to pro:", err);
            toast({
                title: "Upgrade Failed",
                description: err.message || "An unexpected error occurred during upgrade.",
                variant: "destructive"
            });
        } finally {
            setIsUpgrading(false);
        }
    }, [apiUrl, currentUserInfo, fetchCurrentUser, setSelectedAccount]);

    // --- Derived State Based on Context ---
    const isContextPersonal = !selectedAccountId || selectedAccountId === 'personal';
    
    const displayAccountName = useMemo(() => {
        if (isContextPersonal) {
            return "Your Personal Settings";
        }
        return selectedTeamDetails ? selectedTeamDetails.name : (isLoadingTeam && isInitialized ? "Loading Account..." : "Selected Account");
    }, [isContextPersonal, selectedTeamDetails, isLoadingTeam, isInitialized]);

    const displayPlanName = useMemo(() => {
        if (isContextPersonal) {
            return currentUserInfo?.ownedAccountId ? "Pro Enabled" : "Individual";
        }
        return selectedTeamDetails ? "Pro Account" : "";
    }, [isContextPersonal, currentUserInfo?.ownedAccountId, selectedTeamDetails]);

    const displayPlanIcon = useMemo(() => {
        if (isContextPersonal) {
            return currentUserInfo?.ownedAccountId ? <Crown className="w-5 h-5 text-yellow-500" /> : <User className="w-5 h-5 text-gray-500" />;
        }
        return selectedTeamDetails ? <TeamIcon className="w-5 h-5 text-gray-700" /> : <Loader2 className="w-5 h-5 animate-spin text-gray-500"/>;
    }, [isContextPersonal, currentUserInfo?.ownedAccountId, selectedTeamDetails]);

    const isCurrentUserAdminOfSelectedTeam = useMemo(() => {
        if (isContextPersonal || !currentUserInfo || !selectedTeamDetails || !selectedTeamDetails.members) {
            return false;
        }
        return selectedTeamDetails.members.some(
            member => member.userId === currentUserInfo._id && member.team_role === 'admin'
        );
    }, [isContextPersonal, currentUserInfo, selectedTeamDetails]);
    
    const doesCurrentUserOwnThisSelectedTeamContext = useMemo(() => {
        if (isContextPersonal || !currentUserInfo || !selectedTeamDetails) return false;
        // Ensure selectedTeamDetails.id is compared, which should be the string representation of the ObjectId
        return selectedTeamDetails.id === currentUserInfo.ownedAccountId;
    }, [isContextPersonal, currentUserInfo, selectedTeamDetails]);

    // --- Render Logic ---
    const pageIsLoading = !isInitialized || isLoadingUser || (selectedAccountId !== 'personal' && isLoadingTeam && !selectedTeamDetails);

    // Determine if we should show the main content card or an error/loading state for it
    const canShowMainCard = isInitialized && 
                            !isLoadingUser && 
                            currentUserInfo && 
                            (isContextPersonal || (!isLoadingTeam && selectedTeamDetails));

    return (
        <div className="min-h-screen bg-white pt-20 font-InterVar text-gray-900">
            <div className="border-b border-gray-200 px-4 py-5 md:px-10">
                <div className="flex items-center gap-3">
                    <SettingsIcon className="h-5 w-5 text-gray-700"/>
                    <div>
                        <h1 className="font-serif text-3xl font-light text-gray-900">Account Settings</h1>
                        <p className="mt-1 text-sm text-gray-500">Manage your personal profile and account context.</p>
                    </div>
                </div>
            </div>
            <main className="mx-auto max-w-2xl px-4 py-6 sm:px-6 lg:px-10">

                {pageIsLoading && (
                    <Card className="rounded-md border-gray-200 shadow-none">
                        <CardHeader><Skeleton className="h-6 w-3/5" /><Skeleton className="h-4 w-4/5 mt-1" /></CardHeader>
                        <CardContent className="space-y-3"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-4 w-2/5" /><div className="border-t my-3"></div><Skeleton className="h-8 w-1/3" /></CardContent>
                        <CardFooter><Skeleton className="h-10 w-28" /></CardFooter>
                    </Card>
                )}

                {!pageIsLoading && error && ( /* Show general error if not loading and error exists (and primary data isn't available) */
                    !canShowMainCard && (
                        <Card className="rounded-md border-red-200 bg-red-50 text-red-700 shadow-none">
                             <CardHeader><CardTitle className="flex items-center gap-2"><AlertCircle /> Error Loading Data</CardTitle></CardHeader>
                             <CardContent><p>{error}</p></CardContent>
                        </Card>
                    )
                )}

                {/* Settings Content: Render if page is initialized, user is loaded, and (if team context) team is loaded, and no fatal error */}
                {canShowMainCard && !error && (
                    <Card className="rounded-md border-gray-200 shadow-none">
                        <CardHeader>
                            <CardTitle>{displayAccountName}</CardTitle>
                            <CardDescription>
                                {isContextPersonal ? "View your personal details and manage your plan." : `Manage settings for the ${selectedTeamDetails?.name || 'selected'} account.`}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {currentUserInfo && (
                                <>
                                    <div className="space-y-1">
                                        <p className="text-sm font-medium text-gray-500">Logged in as</p>
                                        <p className="text-base font-semibold text-gray-900">{currentUserInfo.username}</p>
                                        <p className="text-xs text-gray-600">{currentUserInfo.email}</p>
                                    </div>
                                    <div className="border-t my-4"></div>
                                </>
                            )}
                            
                            <div className="space-y-1">
                                <p className="text-sm font-medium text-gray-500">Current Account Plan</p>
                                <p className={`text-base font-semibold flex items-center gap-2`}>
                                    {displayPlanIcon} {displayPlanName}
                                </p>
                            </div>

                            {!isContextPersonal && selectedTeamDetails && selectedTeamDetails.id && (
                                 <div className="text-xs text-gray-500 pt-1">
                                     <span>Account ID: {selectedTeamDetails.id}</span>
                                     {/* Example: Display creator info if available and different */}
                                     {/* {selectedTeamDetails.creatorId !== currentUserInfo?._id && (
                                        <p>Creator: User ID {selectedTeamDetails.creatorId.substring(0,8)}...</p>
                                     )} */}
                                 </div>
                            )}
                        </CardContent>
                        <CardFooter className="flex flex-col items-start justify-between gap-3 rounded-b-md border-t border-gray-200 bg-gray-50/50 p-4 sm:flex-row sm:items-center">
                            {isContextPersonal && !currentUserInfo?.ownedAccountId && (
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between w-full gap-2">
                                     <p className="text-sm text-gray-600 font-medium flex items-center gap-1.5">
                                         Upgrade to a collaborative Pro account to share and manage document analysis with your team.
                                     </p>
                                     <Button 
                                         variant="default" 
                                         size="sm" 
                                         onClick={handleUpgrade}
                                         disabled={isUpgrading}
                                     >
                                         {isUpgrading ? (
                                             <>
                                                 <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                 Upgrading...
                                             </>
                                         ) : "Upgrade to Pro"}
                                     </Button>
                                 </div>
                            )}

                            {isContextPersonal && currentUserInfo?.ownedAccountId && (
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between w-full gap-2">
                                     <p className="text-sm text-green-700 font-medium">Your personal profile is Pro enabled as you own a Pro Account.</p>
                                     {currentUserInfo.ownedAccountId && ( // Ensure ownedAccountId is truthy for the Link href
                                        <Link href={`/teams/${currentUserInfo.ownedAccountId}`}>
                                            <Button variant="outline" size="sm" onClick={() => {
                                                if (currentUserInfo.ownedAccountId) {
                                                    setSelectedAccount(currentUserInfo.ownedAccountId);
                                                }
                                            }}>
                                                Manage Your Pro Account
                                            </Button>
                                        </Link>
                                     )}
                                 </div>
                            )}

                            {!isContextPersonal && selectedTeamDetails && selectedTeamDetails.id && (
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between w-full gap-2">

                                    { (isCurrentUserAdminOfSelectedTeam || doesCurrentUserOwnThisSelectedTeamContext) ? (
                                        <Link href={`/teams/${selectedTeamDetails.id}`}>
                                            <Button variant="outline" size="sm">
                                            Manage Members
                                            </Button>
                                        </Link>

                                    ) : (
                                        <p className="text-sm text-gray-500">You are a member of this account. Contact an admin for changes.</p>
                                    )}
                                </div>
                            )}
                            {/* Fallback if in team context but details still loading or ID missing, and not an error state from fetch */}
                            {!isContextPersonal && (!selectedTeamDetails || !selectedTeamDetails.id) && !isLoadingTeam && !error && (
                                <div className="w-full text-center sm:text-left">
                                    <p className="text-sm text-gray-500">Loading team account information or ID is missing...</p>
                                </div>
                            )}
                        </CardFooter>
                    </Card>
                )}

                {/* Fallback for when data isn't available after loading and no overriding error is shown */}
                {isInitialized && !pageIsLoading && !error && !canShowMainCard && (
                     <Card className="rounded-md border-gray-200 bg-gray-50 text-gray-700 shadow-none">
                         <CardHeader><CardTitle>Account Information</CardTitle></CardHeader>
                         <CardContent><p>Could not load detailed account information at this time. Please ensure you have selected an account context.</p></CardContent>
                    </Card>
                )}
            </main>
        </div>
    );
}
