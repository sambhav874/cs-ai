// app/teams/[teamId]/analytics/members/page.tsx
'use client';

import React, { useEffect, useState, useCallback, Suspense } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from '@/components/ui/skeleton';
import { BarChart2, Users, User as UserIcon, ArrowLeft, ArrowRight, FileText, AlertCircle, CalendarDays } from 'lucide-react';

// --- Import Types ---
import type { TeamMemberUsageData } from '@/types/analytics'; // Adjust path if needed

const logger = {
    error: (...args: any[]) => console.error('[MemberUsagePage]', ...args),
    info: (...args: any[]) => console.info('[MemberUsagePage]', ...args),
};

// Helper to wrap the component with Suspense for useSearchParams
function MemberUsagePageComponent() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams(); // For reading query parameters like 'filter'

  const teamId = params?.teamId as string;
  const initialTimeFilter = (searchParams.get('filter') || 'week') as 'day' | 'week' | 'month';

  const { isAuthenticated, authChecked, authenticatedFetch } = useAuth();
  const apiBaseWithPrefix = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL;

  const [memberUsageData, setMemberUsageData] = useState<TeamMemberUsageData | null>(null);
  const [teamNameForDisplay, setTeamNameForDisplay] = useState<string>('Team');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTimeFilter, setSelectedTimeFilter] = useState<'day' | 'week' | 'month'>(initialTimeFilter);

  const fetchMemberUsage = useCallback(async (currentTeamId: string, filter: string) => {
    if (!authChecked || !isAuthenticated || !apiBaseWithPrefix) return;

    setIsLoading(true);
    setError(null);

    try {
      const url = `${apiBaseWithPrefix}/audit/analytics/teams/${currentTeamId}/member-usage?time_filter=${filter}`;
      logger.info("Fetching per-member usage from URL:", url);

      const { data, error: fetchError } = await authenticatedFetch(url);

      if (fetchError) {
        if (fetchError.includes("403 Forbidden") || fetchError.includes("401 Unauthorized")) {
            toast({ title: "Access Denied", description: "You may not have permission to view this data.", variant: "destructive" });
            router.push(`/teams/${currentTeamId}`); // Redirect to team page or dashboard
            setError("Access Denied.");
            return; 
        }
        throw new Error(fetchError);
      }
      if (!data) throw new Error("No data received from member usage API.");
      
      setMemberUsageData(data as TeamMemberUsageData);
      if (data.team_name) {
        setTeamNameForDisplay(data.team_name);
      } else if (typeof currentTeamId === 'string') {
        setTeamNameForDisplay(`Team ${currentTeamId.substring(0,8)}...`);
      }

    } catch (err: any) {
      logger.error("Error fetching member usage:", err);
      setError(err.message || "Could not load member usage data.");
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [authChecked, isAuthenticated, apiBaseWithPrefix, authenticatedFetch, router]);

  useEffect(() => {
    if (authChecked) {
      if (isAuthenticated && teamId && typeof teamId === 'string') {
        fetchMemberUsage(teamId, selectedTimeFilter);
      } else if (!isAuthenticated) {
        setError("Please log in to view analytics.");
        setIsLoading(false);
      } else if (!teamId) {
        setError("Team ID is missing.");
        setIsLoading(false);
      }
    }
  }, [authChecked, isAuthenticated, teamId, selectedTimeFilter, fetchMemberUsage]);

  const handleTimeFilterChange = (value: string) => {
    const newFilter = value as 'day' | 'week' | 'month';
    setSelectedTimeFilter(newFilter);
    // Update URL query param for sharable links / refresh persistence
    router.push(`/teams/${teamId}/analytics/members?filter=${newFilter}`);
    // useEffect will pick up selectedTimeFilter change and refetch
  };
  
  const formatDateRange = (start?: string, end?: string) => {
    if (!start || !end) return "N/A";
    const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
    const startDate = new Date(start).toLocaleDateString(undefined, options);
    const endDate = new Date(end).toLocaleDateString(undefined, options);
    return `${startDate} - ${endDate}`;
  };

  if (!authChecked || (isLoading && !memberUsageData && !error)) {
    return (
      <div className="container mx-auto py-8 px-4 sm:px-6 lg:px-8 animate-pulse">
        <div className="flex justify-between items-center mb-6">
            <Skeleton className="h-8 w-1/4 bg-gray-200 dark:bg-slate-700" />
            <Skeleton className="h-9 w-32 bg-gray-200 dark:bg-slate-700 rounded-md" />
        </div>
        <Skeleton className="h-10 w-full mb-4 bg-gray-200 dark:bg-slate-700" />
        {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full mb-2 bg-gray-200 dark:bg-slate-700 rounded-md" />)}
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center mb-6">
            <Link href={`/teams/${teamId}/analytics`} className="text-blue-600 hover:underline flex items-center text-sm mr-4">
                <ArrowLeft size={16} className="mr-1" /> Back to Team Analytics
            </Link>
        </div>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-6">Member Usage Error</h1>
        <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-600 text-red-800 dark:text-red-300 p-4 rounded-md shadow">
          <div className="flex items-start"><AlertCircle className="h-5 w-5 mr-2.5 flex-shrink-0 text-red-500 dark:text-red-400" /><p>{error}</p></div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto mt-[4rem] py-6 sm:py-8 px-2 sm:px-4 lg:px-6">
      <div className="mb-6 sm:mb-8">
        <div className="flex items-center mb-2">
            <Link href={`/teams/${teamId}/analytics`} className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 flex items-center text-sm">
                <ArrowLeft size={16} className="mr-1.5" />
                Analytics for {memberUsageData?.team_name || teamNameForDisplay}
            </Link>
        </div>
        <div className="flex flex-col md:flex-row justify-between md:items-center gap-3">
            <h1 className="text-xl sm:text-2xl font-semibold text-gray-800 dark:text-gray-100 flex items-center">
                <Users className="h-6 w-6 sm:h-7 sm:w-7 mr-2.5 text-blue-600 dark:text-blue-400" />
                Member Credit Usage
            </h1>
            <div className="flex items-center gap-3 w-full md:w-auto">
                <span className="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">Period:</span>
                <Select value={selectedTimeFilter} onValueChange={handleTimeFilterChange}>
                    <SelectTrigger className="w-full md:w-[150px] bg-white dark:bg-slate-800 dark:text-gray-300 dark:border-slate-600">
                        <SelectValue placeholder="Select period" />
                    </SelectTrigger>
                    <SelectContent className="dark:bg-slate-800 dark:border-slate-700">
                        <SelectItem value="day" className="dark:focus:bg-slate-700">Last 24 Hrs</SelectItem>
                        <SelectItem value="week" className="dark:focus:bg-slate-700">Last 7 Days</SelectItem>
                        <SelectItem value="month" className="dark:focus:bg-slate-700">Last 30 Days</SelectItem>
                    </SelectContent>
                </Select>
            </div>
        </div>
        {memberUsageData && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Displaying usage for {formatDateRange(memberUsageData.period_start_date, memberUsageData.period_end_date)}</p>}
      </div>

      {(!memberUsageData || memberUsageData.member_usage.length === 0) && !isLoading ? (
        <div className="text-center py-12 sm:py-16 text-gray-500 dark:text-gray-400 bg-white dark:bg-slate-800/50 shadow rounded-lg border border-gray-200 dark:border-slate-700">
            <Users className="h-12 w-12 sm:h-16 sm:w-16 mx-auto mb-4 text-gray-300 dark:text-gray-500" />
            <p className="text-lg sm:text-xl font-medium">No Member Usage Data</p>
            <p className="mt-1 text-sm">No credit usage by members found for this period.</p>
        </div>
      ) : memberUsageData && (
        <div className="bg-white dark:bg-slate-800 shadow rounded-lg overflow-hidden border border-gray-200 dark:border-slate-700">
          <Table>
            <TableHeader className="bg-gray-50 dark:bg-slate-700/50">
              <TableRow>
                <TableHead className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Member</TableHead>
                <TableHead className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider w-[150px] sm:w-[200px]">Credits Used</TableHead>
                <TableHead className="px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider w-[120px] text-center">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-gray-200 dark:divide-slate-700">
              {isLoading && memberUsageData.member_usage.length > 0 &&
                <TableRow><TableCell colSpan={3} className="text-center py-6 text-gray-400 dark:text-gray-500 italic">Updating...</TableCell></TableRow>
              }
              {memberUsageData.member_usage.map((member) => (
                <TableRow key={member.member_id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                  <TableCell className="px-4 py-3.5 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="h-8 w-8 bg-slate-200 dark:bg-slate-700 rounded-full flex items-center justify-center mr-3 text-slate-500 dark:text-slate-400 text-sm font-medium">
                        {member.member_name ? member.member_name.substring(0, 1).toUpperCase() : <UserIcon size={16}/>}
                      </div>
                      <div>
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{member.member_name || "Unknown User"}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">ID: {member.member_id.length > 8 ? member.member_id.slice(0,4) + '...' + member.member_id.slice(-4) : member.member_id}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="px-4 py-3.5 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300 font-semibold">
                    {member.credits_used}
                  </TableCell>
                  <TableCell className="px-4 py-3.5 whitespace-nowrap text-sm text-center">
                    <Link href={`/teams/${teamId}/analytics/members/${member.member_id}?filter=${selectedTimeFilter}`} legacyBehavior>
                      <Button variant="link" size="sm" className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 p-0 h-auto">
                        View Log
                        <ArrowRight className="ml-1 h-3.5 w-3.5" />
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}


// Wrap the page component with Suspense for useSearchParams
export default function MemberUsagePageWithSuspense() {
    return (
        <Suspense fallback={<InitialLoadingState />}> {/* Or your preferred full-page skeleton */}
            <MemberUsagePageComponent />
        </Suspense>
    );
}

// A simple loading state for Suspense fallback
const InitialLoadingState = () => (
    <div className="container mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <div className="mb-8"><Skeleton className="h-10 w-1/3 rounded-md bg-gray-200 dark:bg-slate-700" /></div>
        <Skeleton className="h-96 w-full rounded-lg bg-gray-200 dark:bg-slate-700" />
    </div>
);