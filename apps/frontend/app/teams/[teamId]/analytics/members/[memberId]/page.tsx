// app/teams/[teamId]/analytics/members/[memberId]/page.tsx
'use client';

import React, { useEffect, useState, useCallback, Suspense } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from '@/components/ui/skeleton';
import { User as UserIcon, ArrowLeft,ChevronLeft, ChevronRight,  AlertCircle, CalendarDays, Activity } from 'lucide-react';

// --- Import Types using YOUR names from your types file ---
import type { DetailedMemberLogData, DetailedCreditLogEntryItem, } from '@/types/analytics'; // Adjust path if needed

const logger = {
    error: (...args: any[]) => console.error('[DetailedMemberLogPage]', ...args),
    info: (...args: any[]) => console.info('[DetailedMemberLogPage]', ...args),
};

const ITEMS_PER_LOG_PAGE = 15;

// Initial Loading Skeleton for Suspense Fallback
const InitialLoadingSkeleton = () => (
    <div className="container mx-auto py-8 px-4 sm:px-6 lg:px-8 animate-pulse">
        <Skeleton className="h-8 w-1/2 mb-2 rounded-md bg-gray-200 dark:bg-slate-700" />
        <Skeleton className="h-10 w-3/4 mb-6 rounded-md bg-gray-200 dark:bg-slate-700" />
        <Skeleton className="h-9 w-32 mb-6 rounded-md bg-gray-200 dark:bg-slate-700" />
        <div className="bg-white dark:bg-slate-800 shadow rounded-lg border border-gray-200 dark:border-slate-700 p-4">
            <div className="space-y-3">
                {[...Array(Math.floor(ITEMS_PER_LOG_PAGE / 3) || 5)].map((_, i) => (
                    <div key={i} className="grid grid-cols-4 gap-4 items-center">
                        <Skeleton className="h-5 bg-gray-200 dark:bg-slate-600 rounded col-span-1" />
                        <Skeleton className="h-5 bg-gray-200 dark:bg-slate-600 rounded col-span-1" />
                        <Skeleton className="h-5 bg-gray-200 dark:bg-slate-600 rounded col-span-1" />
                        <Skeleton className="h-5 bg-gray-200 dark:bg-slate-600 rounded col-span-1" />
                    </div>
                ))}
            </div>
        </div>
    </div>
);

function DetailedMemberLogPageComponent() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();

  const teamId = params?.teamId as string;
  const memberId = params?.memberId as string;
  const initialTimeFilter = (searchParams.get('filter') || 'week') as 'day' | 'week' | 'month';

  const { isAuthenticated, authChecked, authenticatedFetch } = useAuth();
  const apiBaseWithPrefix = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL;

  const [logData, setLogData] = useState<DetailedMemberLogData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTimeFilter, setSelectedTimeFilter] = useState<'day' | 'week' | 'month'>(initialTimeFilter);
  const [currentLogPage, setCurrentLogPage] = useState(1);

  const fetchDetailedMemberLog = useCallback(async (
    currentTeamId: string, 
    currentMemberId: string, 
    filter: string, 
    page: number
  ) => {
    if (!authChecked) { setIsLoading(true); return; }
    if (!isAuthenticated) {
      setError("Authentication required."); setIsLoading(false); setLogData(null);
      toast({ title: "Authentication Required", variant: "destructive" }); return;
    }
    if (!apiBaseWithPrefix) {
      setError("API URL not configured."); setIsLoading(false); setLogData(null);
      toast({ title: "Configuration Error", variant: "destructive" }); return;
    }

    setIsLoading(true); setError(null);
    try {
      const url = `${apiBaseWithPrefix}/audit/analytics/teams/${currentTeamId}/member-log/${currentMemberId}?time_filter=${filter}&page=${page}&per_page=${ITEMS_PER_LOG_PAGE}`;
      logger.info("Fetching detailed member log from URL:", url);
      const { data, error: fetchError } = await authenticatedFetch(url);

      if (fetchError) {
        if (fetchError.includes("403") || fetchError.includes("401")) {
            toast({ title: "Access Denied", description: "You may not have permission.", variant: "destructive" });
            router.push(teamId ? `/teams/${teamId}/analytics/members?filter=${filter}` : '/dashboard');
            setError("Access Denied."); return; 
        }
        throw new Error(fetchError);
      }
      if (!data || !data.detailed_logs || !data.pagination) {
        logger.error("Received invalid data structure for detailed member log:", data);
        throw new Error("Received invalid data structure from API.");
      }
      setLogData(data as DetailedMemberLogData);
    } catch (err: any) {
      logger.error("Error fetching detailed member log:", err);
      setError(err.message || "Could not load detailed usage log.");
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setLogData(null);
    } finally {
      setIsLoading(false);
    }
  }, [authChecked, isAuthenticated, apiBaseWithPrefix, authenticatedFetch, router, teamId]);

  useEffect(() => {
    if (authChecked) {
      if (isAuthenticated && teamId && memberId && typeof teamId === 'string' && typeof memberId === 'string') {
        fetchDetailedMemberLog(teamId, memberId, selectedTimeFilter, currentLogPage);
      } else {
        setIsLoading(false);
        if (!isAuthenticated) setError("Please log in to view data.");
        else setError("Team ID or Member ID is missing or invalid.");
      }
    }
  }, [authChecked, isAuthenticated, teamId, memberId, selectedTimeFilter, currentLogPage, fetchDetailedMemberLog]);

  const handleTimeFilterChange = (value: string) => {
    const newFilter = value as 'day' | 'week' | 'month';
    setSelectedTimeFilter(newFilter);
    setCurrentLogPage(1); 
    if (teamId && memberId) {
        router.push(`/teams/${teamId}/analytics/members/${memberId}?filter=${newFilter}`);
    }
  };

  const handleLogPageChange = (newPage: number) => {
    if (logData && logData.pagination && newPage > 0 && newPage <= logData.pagination.total_pages) {
        setCurrentLogPage(newPage);
    }
  };
  
  const formatDate = (isoString?: string) => {
    if (!isoString) return "N/A";
    try {
      return new Date(isoString).toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    } catch (e) { return isoString; }
  };

  if (!authChecked || (isLoading && !logData && !error)) {
    return <InitialLoadingSkeleton />;
  }

  if (error) {
    return (
        <div className="container mx-auto py-8 px-4 sm:px-6 lg:px-8">
            <div className="mb-6">
                 <Link href={teamId ? `/teams/${teamId}/analytics/members?filter=${selectedTimeFilter}` : '/dashboard'} className="text-blue-600 hover:underline flex items-center text-sm dark:text-blue-400 dark:hover:text-blue-300"><ArrowLeft size={16} className="mr-1" /> Back to Member Usage</Link>
            </div>
            <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-6">Usage Log Error</h1>
            <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-600 text-red-800 dark:text-red-300 p-4 rounded-md shadow"><div className="flex items-start"><AlertCircle className="h-5 w-5 mr-2.5 flex-shrink-0 text-red-500 dark:text-red-400" /><p>{error}</p></div></div>
        </div>
    );
  }

  return (
    <div className="container mt-[4rem] mx-auto py-6 sm:py-8 px-2 sm:px-4 lg:px-6">
      <div className="mb-6 sm:mb-8">
        <div className="mb-3">
            <Link href={teamId ? `/teams/${teamId}/analytics/members?filter=${selectedTimeFilter}` : '/dashboard'} className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 flex items-center text-sm font-medium">
                <ArrowLeft size={16} className="mr-1.5" />
                Member Usage for {logData?.team_name || (teamId ? `Team ${teamId.substring(0,8)}...` : 'Team')}
            </Link>
        </div>
        <div className="flex flex-col md:flex-row justify-between md:items-center gap-3">
            <h1 className="text-xl sm:text-2xl font-semibold text-gray-800 dark:text-gray-100 flex items-center">
                <UserIcon className="h-6 w-6 sm:h-7 sm:w-7 mr-2.5 text-blue-600 dark:text-blue-400" />
                Credit Usage Log: {logData?.member_name || (memberId ? `User ${memberId.substring(0,8)}...` : 'User')}
            </h1>
            <div className="flex items-center gap-3 w-full md:w-auto">
                <span className="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">Period:</span>
                <Select value={selectedTimeFilter} onValueChange={handleTimeFilterChange}>
                    <SelectTrigger className="w-full md:w-[150px] bg-white dark:bg-slate-800 dark:text-gray-300 dark:border-slate-600"><SelectValue placeholder="Select period" /></SelectTrigger>
                    <SelectContent className="dark:bg-slate-800 dark:border-slate-700">
                        <SelectItem value="day" className="dark:focus:bg-slate-700">Last 24 Hrs</SelectItem>
                        <SelectItem value="week" className="dark:focus:bg-slate-700">Last 7 Days</SelectItem>
                        <SelectItem value="month" className="dark:focus:bg-slate-700">Last 30 Days</SelectItem>
                    </SelectContent>
                </Select>
            </div>
        </div>
        {logData && logData.period_start_date && logData.period_end_date && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Displaying usage for {formatDate(logData.period_start_date)} - {formatDate(logData.period_end_date)}</p>}
      </div>

      {(!logData || !logData.detailed_logs || logData.detailed_logs.length === 0) && !isLoading ? (
        <div className="text-center py-12 sm:py-16 text-gray-500 dark:text-gray-400 bg-white dark:bg-slate-800/50 shadow rounded-lg border border-gray-200 dark:border-slate-700">
            <Activity className="h-12 w-12 sm:h-16 sm:w-16 mx-auto mb-4 text-gray-300 dark:text-gray-500" />
            <p className="text-lg sm:text-xl font-medium">No Credit Usage Activity</p>
            <p className="mt-1 text-sm">This member has not used any credits in the selected period for this team.</p>
        </div>
      ) : logData && logData.detailed_logs && (
        <>
          <div className="bg-white dark:bg-slate-800 shadow rounded-lg overflow-hidden border border-gray-200 dark:border-slate-700">
            <Table>
              <TableHeader className="bg-gray-50 dark:bg-slate-700/50">
                <TableRow>
                  <TableHead className="w-[200px] px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Date & Time</TableHead>
                  <TableHead className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Service / Reason</TableHead>
                  <TableHead className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Contract</TableHead>
                  <TableHead className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider w-[120px]">Credits Used</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-gray-200 dark:divide-slate-700">
                {isLoading && logData.detailed_logs.length > 0 &&
                    <TableRow><TableCell colSpan={4} className="text-center py-6 text-gray-400 dark:text-gray-500 italic">Updating logs...</TableCell></TableRow>
                }
                {logData.detailed_logs.map((log_item: DetailedCreditLogEntryItem, index) => (
                  <TableRow key={`${log_item.timestamp}-${index}-${log_item.contract_id || 'no-contract'}`} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                    <TableCell className="px-4 py-3.5 whitespace-nowrap text-sm text-gray-600 dark:text-gray-300">{formatDate(log_item.timestamp)}</TableCell>
                    <TableCell className="px-4 py-3.5 text-sm text-gray-700 dark:text-gray-200">{log_item.service_description || "Processing"}</TableCell>
                    <TableCell className="px-4 py-3.5 text-sm text-gray-600 dark:text-gray-300">
                      {log_item.contract_name ? (
                        <span title={log_item.contract_name}>
                          {log_item.contract_name.length > 40 ? log_item.contract_name.substring(0, 37) + "..." : log_item.contract_name}
                        </span>
                      ) : log_item.contract_id ? (
                        <span className="italic text-gray-400 dark:text-gray-500">ID: {log_item.contract_id.length > 8 ? log_item.contract_id.slice(0,4) + '...' + log_item.contract_id.slice(-4) : log_item.contract_id}</span>
                      ) : (
                        <span className="italic text-gray-400 dark:text-gray-500">N/A</span>
                      )}
                    </TableCell>
                    <TableCell className="px-4 py-3.5 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200 font-semibold text-right">{log_item.credits_deducted}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Pagination for Detailed Logs */}
          {logData.pagination && logData.pagination.total_pages > 1 && (
             <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4">
              <Button variant="outline" size="sm" onClick={() => handleLogPageChange(currentLogPage - 1)} disabled={isLoading || currentLogPage === 1} className="w-full sm:w-auto dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-700">
                <ChevronLeft className="h-4 w-4 mr-1.5" /> Previous Logs
              </Button>
              <span className="text-sm text-gray-600 dark:text-gray-400 order-first sm:order-none">
                Page {logData.pagination.current_page} of {logData.pagination.total_pages}
                <span className="hidden sm:inline mx-2 text-gray-300 dark:text-gray-600 font-light">|</span>
                <span className="hidden sm:inline">Total Entries: {logData.pagination.total_items}</span>
              </span>
              <Button variant="outline" size="sm" onClick={() => handleLogPageChange(currentLogPage + 1)} disabled={isLoading || currentLogPage === logData.pagination.total_pages} className="w-full sm:w-auto dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-700">
                Next Logs <ChevronRight className="h-4 w-4 ml-1.5" />
              </Button>
            </div>
          )}
        </>
      )}
      {/* Modal for showing raw audit log details has been removed for this specific page.
          If you want to add a way to see the original audit log's 'details' object,
          you would re-introduce the selectedAuditLogDetails state, a button in the row,
          and the modal JSX, along with importing AuditLogDetail type. */}
    </div>
  );
}

export default function DetailedMemberLogPageWithSuspense() {
    return (
        <Suspense fallback={<InitialLoadingSkeleton />}>
            <DetailedMemberLogPageComponent />
        </Suspense>
    );
}