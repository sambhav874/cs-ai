// app/teams/[teamId]/audit/page.tsx
'use client';

import React, { useEffect, useState, useCallback, Suspense, useMemo } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { ListFilter, Search, ArrowLeft, ChevronLeft, ChevronRight, AlertCircle, Activity, Info, CalendarIcon, X as CloseIcon, RotateCcw } from 'lucide-react';
import { format, isValid as isValidDate, parseISO } from 'date-fns';
import type { DateRange } from "react-day-picker";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';

import type { PaginatedAuditLogs, AuditLogEntry, AuditLogDetail } from '@/types/audit';

const logger = {
    error: (...args: any[]) => console.error('[TeamActivityLogPage]', ...args),
    info: (...args: any[]) => console.info('[TeamActivityLogPage]', ...args),
    warn: (...args: any[]) => console.warn('[TeamActivityLogPage]', ...args),
};

const ITEMS_PER_PAGE = 15;

const AUDIT_ACTION_OPTIONS = [
  { value: "", label: "All Actions" },
  { value: "CONTRACT_UPLOADED", label: "Contract Uploaded" },
  { value: "PROCESSING_CREDITS_DEDUCTED", label: "Credits Deducted" },
  { value: "PROCESSING_CHAIN_INITIATED", label: "Processing Initiated" },
  { value: "PROCESSING_CHAIN_FAILED_TO_QUEUE", label: "Processing Queue Fail" },
  { value: "WORKFLOW_ROLES_UPDATED", label: "Roles Updated" },
  { value: "DRAFT_SAVED", label: "Draft Saved" },
  { value: "NEW_VERSION_SAVED", label: "New Version Saved" },
  { value: "SUBMITTED_FOR_APPROVAL", label: "Submitted for Approval" },
  { value: "CONTRACT_APPROVED", label: "Contract Approved" },
  { value: "CONTRACT_REJECTED", label: "Contract Rejected" },
  { value: "PERSONAL_CONTRACT_COMPLETED", label: "Personal Contract Completed" },
  { value: "TEAM_MEMBER_ADDED", label: "Team Member Added" },
  { value: "TEAM_MEMBER_REMOVED", label: "Team Member Removed" },
  { value: "QUESTION_CATEGORY_CREATED", label: "Category Created" },
  { value: "QUESTION_CATEGORY_UPDATED", label: "Category Updated" },
  { value: "QUESTION_CATEGORY_DELETED", label: "Category Deleted" },
];

interface ActionStyle {
  bgColor: string; textColor: string; borderColor: string;
}
const getActionBadgeStyle = (action: string): ActionStyle => {
  const normalizedAction = action.toUpperCase();
  if (normalizedAction.includes("CREATE") || normalizedAction.includes("UPLOADED") || normalizedAction.includes("ADDED")) return { bgColor: 'bg-green-50 dark:bg-green-900/30', textColor: 'text-green-700 dark:text-green-300', borderColor: 'border-green-200 dark:border-green-700' };
  if (normalizedAction.includes("UPDATE") || normalizedAction.includes("SAVED") || normalizedAction.includes("SUBMITTED") || normalizedAction.includes("ASSIGNED") || normalizedAction.includes("EDIT")) return { bgColor: 'bg-blue-50 dark:bg-blue-900/30', textColor: 'text-blue-700 dark:text-blue-300', borderColor: 'border-blue-200 dark:border-blue-700' };
  if (normalizedAction.includes("APPROVE") || normalizedAction.includes("COMPLETE")) return { bgColor: 'bg-teal-50 dark:bg-teal-900/30', textColor: 'text-teal-700 dark:text-teal-300', borderColor: 'border-teal-200 dark:border-teal-700' };
  if (normalizedAction.includes("REJECT") || normalizedAction.includes("REMOVE") || normalizedAction.includes("DELETE")) return { bgColor: 'bg-red-50 dark:bg-red-900/30', textColor: 'text-red-700 dark:text-red-300', borderColor: 'border-red-200 dark:border-red-700' };
  if (normalizedAction.includes("TASK_STARTED") || normalizedAction.includes("PROCESSING") || normalizedAction.includes("INDEXING") || normalizedAction.includes("SUMMARIZING") || normalizedAction.includes("CHAIN_INITIATED") || normalizedAction.includes("CHAIN_FAILED")) return { bgColor: 'bg-yellow-50 dark:bg-yellow-900/30', textColor: 'text-yellow-700 dark:text-yellow-300', borderColor: 'border-yellow-200 dark:border-yellow-700' };
  return { bgColor: 'bg-slate-100 dark:bg-slate-700', textColor: 'text-slate-700 dark:text-slate-300', borderColor: 'border-slate-300 dark:border-slate-600' };
};

const InitialLoadingSkeleton = () => (
    <div className="container mx-auto py-8 px-4 sm:px-6 lg:px-8 animate-pulse">
        <Skeleton className="h-8 w-1/2 mb-2 rounded-md bg-gray-200 dark:bg-slate-700" />
        <Skeleton className="h-10 w-3/4 mb-6 rounded-md bg-gray-200 dark:bg-slate-700" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6 items-end">
            <Skeleton className="h-10 w-full bg-gray-200 dark:bg-slate-700 rounded-md" />
            <Skeleton className="h-10 w-full bg-gray-200 dark:bg-slate-700 rounded-md" />
            <Skeleton className="h-10 w-full lg:col-span-1 bg-gray-200 dark:bg-slate-700 rounded-md" />
        </div>
        <Skeleton className="h-96 w-full rounded-lg bg-gray-200 dark:bg-slate-700" />
    </div>
);

function TeamActivityLogPageComponent() {
  const params = useParams();
  const router = useRouter();
  const searchParamsHook = useSearchParams();
  const teamId = params?.teamId as string;
  const { isAuthenticated, authChecked, authenticatedFetch } = useAuth();
  const apiBaseWithPrefix = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL;
  const [logData, setLogData] = useState<PaginatedAuditLogs | null>(null);
  const [teamName, setTeamName] = useState<string>('Team'); 
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedLogDetails, setSelectedLogDetails] = useState<AuditLogDetail | null>(null);

  const [currentPage, setCurrentPage] = useState(() => Number(searchParamsHook.get('page')) || 1);
  const [actionFilter, setActionFilter] = useState(() => searchParamsHook.get('action') || '');
  const [userFilterInput, setUserFilterInput] = useState(() => searchParamsHook.get('user') || '');
  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
    const fromParam = searchParamsHook.get('from');
    const toParam = searchParamsHook.get('to');
    const from = fromParam && isValidDate(parseISO(fromParam)) ? parseISO(fromParam) : undefined;
    const to = toParam && isValidDate(parseISO(toParam)) ? parseISO(toParam) : from ? from : undefined;
    return from ? { from, to } : undefined;
  });
  const [sortBy, setSortBy] = useState(() => searchParamsHook.get('sortBy') || 'timestamp');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(() => (searchParamsHook.get('sortOrder') as 'asc' | 'desc') || 'desc');

  const buildUrlQueryString = useCallback(() => {
    const query = new URLSearchParams();
    if (actionFilter) query.set('action', actionFilter);
    if (userFilterInput.trim()) query.set('user', userFilterInput.trim());
    if (dateRange?.from) query.set('from', format(dateRange.from, "yyyy-MM-dd"));
    if (dateRange?.to) query.set('to', format(dateRange.to, "yyyy-MM-dd"));
    query.set('sortBy', sortBy);
    query.set('sortOrder', sortOrder);
    query.set('page', currentPage.toString());
    return query.toString();
  }, [actionFilter, userFilterInput, dateRange, sortBy, sortOrder, currentPage]);

  const fetchTeamActivityLog = useCallback(async () => {
    if (!authChecked) { setIsLoading(true); return; }
    if (!isAuthenticated) { setError("Authentication required."); setIsLoading(false); setLogData(null); return; }
    if (!apiBaseWithPrefix) { setError("API URL not configured."); setIsLoading(false); setLogData(null); return; }
    if (!teamId || typeof teamId !== 'string') { setError("Team ID is missing."); setIsLoading(false); setLogData(null); return; }

    setIsLoading(true); setError(null);
    
    const queryParams = new URLSearchParams({
        page: currentPage.toString(),
        per_page: ITEMS_PER_PAGE.toString(),
        sort_by: sortBy,
        sort_order: sortOrder,
    });
    if (actionFilter) queryParams.append('action', actionFilter);
    if (userFilterInput.trim()) queryParams.append('user', userFilterInput.trim());
    if (dateRange?.from) queryParams.append('start_date', format(dateRange.from, "yyyy-MM-dd"));
    if (dateRange?.to) queryParams.append('end_date', format(dateRange.to, "yyyy-MM-dd"));

    try {
      const url = `${apiBaseWithPrefix}/audit/teams/${teamId}/logs?${queryParams.toString()}`;
      logger.info("Fetching team activity log from URL:", url);
      const { data, error: fetchError } = await authenticatedFetch(url);

      if (fetchError) {
        if (fetchError.includes("403") || fetchError.includes("401")) {
            toast({ title: "Access Denied", description: "You may not have permission.", variant: "destructive" });
            router.push(teamId ? `/teams/${teamId}` : '/dashboard'); setError("Access Denied."); return; 
        }
        throw new Error(fetchError);
      }
      if (!data || !data.logs || !data.pagination) throw new Error("Received invalid data structure from API.");
      
      setLogData(data as PaginatedAuditLogs);
      setTeamName(data.team_name || `Team ${teamId.substring(0,8)}...`); 

    } catch (err: any) {
      logger.error("Error fetching team activity log:", err);
      setError(err.message || "Could not load activity log.");
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setLogData(null);
    } finally {
      setIsLoading(false);
    }
  }, [authChecked, isAuthenticated, apiBaseWithPrefix, authenticatedFetch, router, teamId, currentPage, actionFilter, userFilterInput, dateRange, sortBy, sortOrder]);

  useEffect(() => {
    if (authChecked && isAuthenticated && teamId) {
        fetchTeamActivityLog();
    } else if (authChecked && !isAuthenticated) {
        setError("Please log in to view data."); setIsLoading(false);
    } else if (authChecked && !teamId) {
        setError("Team ID is missing."); setIsLoading(false);
    }
  }, [authChecked, isAuthenticated, teamId, currentPage, actionFilter, userFilterInput, dateRange, sortBy, sortOrder, fetchTeamActivityLog]);

  const handleApplyFilters = () => {
    setCurrentPage(1);
    const query = new URLSearchParams();
    if (actionFilter) query.set('action', actionFilter);
    if (userFilterInput.trim()) query.set('user', userFilterInput.trim());
    if (dateRange?.from) query.set('from', format(dateRange.from, "yyyy-MM-dd"));
    if (dateRange?.to) query.set('to', format(dateRange.to, "yyyy-MM-dd"));
    query.set('sortBy', sortBy);
    query.set('sortOrder', sortOrder);
    query.set('page', '1');
    const queryString = query.toString();
    router.push(`/teams/${teamId}/audit${queryString ? '?' + queryString : ''}`, { scroll: false });
  };

  const handleDateRangeSelect = (selectedRange: DateRange | undefined) => {
    setDateRange(selectedRange);
  };

  const clearActionFilter = () => { setActionFilter(''); };
  const clearUserFilter = () => { setUserFilterInput(''); };
  const clearDateRange = () => { setDateRange(undefined); };

  const handleResetAllFilters = () => {
    setActionFilter('');
    setUserFilterInput('');
    setDateRange(undefined);
    setCurrentPage(1);
    router.push(`/teams/${teamId}/audit`, { scroll: false });
  };

  const handlePageChange = (newPage: number) => {
    if (logData && logData.pagination && newPage > 0 && newPage <= logData.pagination.total_pages) {
        setCurrentPage(newPage);
        const query = new URLSearchParams(searchParamsHook.toString());
        query.set('page', newPage.toString());
        router.push(`/teams/${teamId}/audit?${query.toString()}`, { scroll: false });
    }
  };

  const formatTimestamp = (isoString: string) => {
    try {
      return new Date(isoString).toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    } catch (e) { 
      return isoString; 
    }
  };

  const renderDetailsSummary = (action: string, details: AuditLogDetail): string => { 
    if (!details || Object.keys(details).length === 0) return "No specific details."; 
    let summaryParts: string[] = [];
    
    if (details.oldStatus && details.newStatus) 
      summaryParts.push(`Status: '${details.oldStatus}' → '${details.newStatus}'`);
    
    switch (action.toUpperCase()) {
      case "CONTRACT_UPLOADED": 
        if (details.filename) summaryParts.push(`File: ${String(details.filename).substring(0,30)}${String(details.filename).length > 30 ? '...' : '' }`); 
        if (typeof details.page_count === 'number') summaryParts.push(`Pages: ${details.page_count}`); 
        break;
      case "INDEXING_TASK_STARTED": 
      case "SUMMARIZING_TASK_STARTED": 
      case "PROCESSING_TASK_STARTED": 
      case "PROCESSING_CHAIN_INITIATED": 
        if (details.use_local_marker !== undefined) summaryParts.push(`Local Marker: ${details.use_local_marker}`); 
        if (details.question_count !== undefined) summaryParts.push(`Questions: ${details.question_count}`); 
        if (details.celery_chain_id) summaryParts.push(`Chain: ${String(details.celery_chain_id).substring(0,8)}...`); 
        break;
      case "PROCESSING_CREDITS_DEDUCTED": 
        if(details.credits_deducted) summaryParts.push(`Used: ${details.credits_deducted} credits`); 
        if(details.service_description) summaryParts.push(`For: ${details.service_description}`); 
        break;
      case "DRAFT_SAVED": 
        if (details.draft_qa_count !== undefined) summaryParts.push(`Draft Q&As: ${details.draft_qa_count}`); 
        break;
      case "NEW_VERSION_SAVED": 
        if (details.version_number !== undefined) summaryParts.push(`Version: ${details.version_number}`); 
        break;
      case "CONTRACT_REJECTED": 
        if (details.rejectionReason) { 
          const r = String(details.rejectionReason); 
          summaryParts.push(`Reason: ${r.substring(0,40)}${r.length > 40 ? '...' : ''}`); 
        } 
        break;
      case "WORKFLOW_ROLES_UPDATED": 
        let rc:string[]=[]; 
        if(details.new_editor_username) rc.push(`Editor: ${details.new_editor_username}`);
        else if(details.new_editor_userId===null&&details.old_editor_userId) rc.push(`Editor Unassigned`); 
        if(details.new_approver_username) rc.push(`Approver: ${details.new_approver_username}`);
        else if(details.new_approver_userId===null&&details.old_approver_userId) rc.push(`Approver Unassigned`); 
        if(rc.length>0) summaryParts.push(rc.join(', ')); 
        break;
      case "TEAM_MEMBER_ADDED": 
      case "TEAM_MEMBER_REMOVED": 
        if (details.target_username) summaryParts.push(`User: ${details.target_username}`); 
        if (details.assigned_role_in_team) summaryParts.push(`Role: ${details.assigned_role_in_team}`); 
        break;
      case "QUESTION_CATEGORY_CREATED": 
      case "QUESTION_CATEGORY_DELETED": 
        if(details.category_name) summaryParts.push(`Cat: ${details.category_name}`);
        if(details.question_count!==undefined) summaryParts.push(`Qs: ${details.question_count}`);
        break;
      case "QUESTION_CATEGORY_UPDATED": 
        if (details.changes&&Array.isArray(details.changes)&&details.changes.length>0){
          const cf=details.changes.map((c:any)=>c.field).join(', ');
          summaryParts.push(`Updated: ${cf}`);
        }else if(details.category_id) summaryParts.push(`Cat ID: ${String(details.category_id).slice(-6)}...`);
        break;
      case "PRO_ACCOUNT_CREATED": 
        if(details.account_name_created) summaryParts.push(`Account: ${details.account_name_created}`); 
        break;
      default: 
        const k=Object.keys(details)[0]; 
        if(k){
          const v=String(details[k]);
          summaryParts.push(`${k}: ${v.substring(0,50)}${v.length>50?'...':''}`);
        }
    }
    
    if(summaryParts.length===0) return "View details";
    return summaryParts.join('; ').substring(0,100)+(summaryParts.join('; ').length>100?'...':'');
  };

  if (!authChecked || (isLoading && !logData && !error && !searchParamsHook.get('page'))) { 
    return <InitialLoadingSkeleton />; 
  }
  
  if (error) { 
    return (
      <div className="container mx-auto mt-[4rem] py-6 sm:py-8 px-2 sm:px-4 lg:px-6">
        <div className="mb-3">
          <Link href={teamId ? `/teams/${teamId}` : '/teams'} className="text-[#006294] hover:text-[#00a6fa] dark:text-blue-400 dark:hover:text-blue-300 flex items-center text-sm font-medium">
            <ArrowLeft size={16} className="mr-1.5" />
            Team Management
          </Link>
        </div>
        <div className="bg-red-50 border-l-4 border-red-600 text-red-800 p-4 sm:p-6 rounded-md shadow" role="alert">
          <div className="flex items-start">
            <AlertCircle className="h-5 w-5 sm:h-6 sm:w-6 mr-2.5 sm:mr-3 flex-shrink-0 text-red-500" />
            <div>
              <p className="font-semibold text-base sm:text-lg">Error Loading Activity Log</p>
              <p className="text-sm mt-1">{error}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto mt-[4rem] py-6 sm:py-8 px-2 sm:px-4 lg:px-6">
      <div className="mb-3">
        <Link href={teamId ? `/teams/${teamId}` : '/teams'} className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 flex items-center text-sm font-medium">
            <ArrowLeft size={16} className="mr-1.5" />
            Team Management
        </Link>
      </div>
      <div className="mb-6 sm:mb-8 flex flex-col md:flex-row justify-between md:items-center gap-3 border-b dark:border-slate-700 pb-4">
        <h1 className="text-xl sm:text-2xl font-semibold text-gray-800 dark:text-gray-100 flex items-center">
            <Activity className="h-6 w-6 sm:h-7 sm:w-7 mr-2.5 text-sky-600 dark:text-sky-400" />
            Activity Log for {teamName}
        </h1>
      </div>
      
      <Card className="mb-6 dark:bg-slate-800/30 dark:border-slate-700">
        <CardHeader className="pb-4 flex flex-row items-center justify-between">
            <div>
                <CardTitle className="text-xl font-bold text-gray-700 dark:text-gray-300 flex items-center">
                    <ListFilter className="h-4 w-4 mr-2"/>Filters
                </CardTitle>
                <CardDescription className="text-xs text-gray-500 dark:text-gray-400">
                    Refine the activity log results.
                </CardDescription>
            </div>
            <Button 
                variant="ghost" 
                size="sm" 
                onClick={handleResetAllFilters}
                className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                disabled={!actionFilter && !userFilterInput && !dateRange?.from} 
            >
                <RotateCcw className="h-3.5 w-3.5 mr-1.5"/> Reset All
            </Button>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-5 items-end">
            <div className="relative">
                <Label htmlFor="actionFilterSelect" className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Action Type</Label>
                <Select value={actionFilter} onValueChange={(value) => setActionFilter(value === "ALL_ACTIONS_PLACEHOLDER" ? "" : value)}>
                    <SelectTrigger id="actionFilterSelect" className="text-sm h-9 dark:bg-slate-700 dark:border-slate-600 w-full pr-8">
                        <SelectValue placeholder="All Actions" />
                    </SelectTrigger>
                    <SelectContent className="dark:bg-slate-800 dark:border-slate-700">
                        {AUDIT_ACTION_OPTIONS.map(opt => (
                            <SelectItem key={opt.value || 'all_actions_key'} value={opt.value || "ALL_ACTIONS_PLACEHOLDER"} className="dark:focus:bg-slate-700 text-xs sm:text-sm">
                                {opt.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                {actionFilter && (
                    <Button variant="ghost" size="sm" onClick={clearActionFilter} className="absolute right-1 top-[25px] h-6 w-6 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300">
                        <CloseIcon className="h-3.5 w-3.5" />
                    </Button>
                )}
            </div>

            <div className="relative">
                <Label htmlFor="userFilterInput" className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">User (ID or Name)</Label>
                <Input id="userFilterInput" placeholder="User ID or Username" value={userFilterInput} onChange={e => setUserFilterInput(e.target.value)} className="text-sm h-9 dark:bg-slate-700 dark:border-slate-600 pr-8"/>
                {userFilterInput && (
                     <Button variant="ghost" size="sm" onClick={clearUserFilter} className="absolute right-1 top-[25px] h-6 w-6 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300">
                        <CloseIcon className="h-3.5 w-3.5" />
                    </Button>
                )}
            </div>

            <div className="sm:col-span-2 lg:col-span-1 relative">
                <Label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Date Range</Label>
                <Popover>
                    <PopoverTrigger asChild>
                        <Button id="date-range-picker-trigger" variant={"outline"}
                            className={`w-full h-9 justify-start text-left font-normal text-sm dark:bg-slate-700 dark:border-slate-600 dark:hover:bg-slate-600 pr-8 ${!dateRange?.from && "text-muted-foreground dark:text-gray-400"}`}>
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {dateRange?.from ? (dateRange.to ? (<>{format(dateRange.from, "LLL dd, y")} - {format(dateRange.to, "LLL dd, y")}</>) : (format(dateRange.from, "LLL dd, y"))) : (<span>Pick a date range</span>)}
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0 dark:bg-slate-900 border-slate-700" align="start">
                        <Calendar initialFocus mode="range" defaultMonth={dateRange?.from} selected={dateRange} onSelect={handleDateRangeSelect} numberOfMonths={2}
                            className="p-3 dark:bg-slate-900 [&_button[disabled]]:opacity-50 dark:[&_button[disabled]]:text-slate-600 dark:[&_.rdp-day_selected]:bg-blue-600 dark:[&_.rdp-day_selected]:text-white dark:[&_.rdp-button:hover]:bg-slate-700 dark:[&_.rdp-nav_button]:text-slate-300 dark:[&_.rdp-nav_button:hover]:text-slate-100 dark:[&_.rdp-caption_label]:text-slate-200 dark:[&_.rdp-head_cell]:text-slate-400 dark:[&_.rdp-day]:text-slate-300 dark:[&_.rdp-day_outside]:text-slate-600"/>
                    </PopoverContent>
                </Popover>
                 {dateRange?.from && (
                    <Button variant="ghost" size="sm" onClick={clearDateRange} className="absolute right-1 top-[25px] h-6 w-6 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300">
                        <CloseIcon className="h-3.5 w-3.5" />
                    </Button>
                )}
            </div>

            <Button onClick={handleApplyFilters} size="sm" className="w-full h-9 bg-[#0084c7] hover:bg-[#006294] dark:bg-blue-500 dark:hover:bg-blue-600 self-end">
                 Apply Filters
            </Button>
        </CardContent>
      </Card>

      {(!logData || !logData.logs || logData.logs.length === 0) && !isLoading ? (
         <div className="text-center py-12 sm:py-16 text-gray-500 dark:text-gray-400 bg-white dark:bg-slate-800/50 shadow rounded-lg border border-gray-200 dark:border-slate-700">
            <Activity className="h-12 w-12 sm:h-16 sm:w-16 mx-auto mb-4 text-gray-300 dark:text-gray-500" />
            <p className="text-lg sm:text-xl font-medium">No Activity Found</p>
            <p className="mt-1 text-sm">No audit logs found for this team matching your filters.</p>
        </div>
      ) : logData && logData.logs && (
        <>
          <div className="bg-white dark:bg-slate-800 shadow rounded-lg overflow-x-auto border border-gray-200 dark:border-slate-700">
            <Table>
              <TableHeader className="bg-gray-50 dark:bg-slate-700/50">
                <TableRow>
                  <TableHead className="w-[210px] px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Timestamp</TableHead>
                  <TableHead className="w-[180px] px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">User</TableHead>
                  <TableHead className="w-[200px] px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Action</TableHead>
                  <TableHead className="w-[240px] px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Target</TableHead>
                  <TableHead className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-gray-200 dark:divide-slate-700">
                {isLoading && logData.logs.length > 0 &&
                    <TableRow><TableCell colSpan={5} className="text-center py-6 text-gray-400 dark:text-gray-500 italic">Updating logs...</TableCell></TableRow>
                }
                {logData.logs.map((log) => {
                    const actionStyle = getActionBadgeStyle(log.action); 
                    return (
                    <TableRow key={log._id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                        <TableCell className="px-4 py-3.5 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400 align-top">{formatTimestamp(log.timestamp)}</TableCell>
                        <TableCell className="px-4 py-3.5 whitespace-nowrap text-sm text-gray-600 dark:text-gray-300 align-top">
                          <div className="font-medium text-gray-800 dark:text-gray-100">{log.username || <span className="italic text-gray-400 dark:text-gray-500">System/N/A</span>}</div>
                          {log.userId && <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">ID: {log.userId.length > 8 ? log.userId.slice(0,4) + '...' + log.userId.slice(-4) : log.userId}</div>}
                        </TableCell>
                        <TableCell className="px-4 py-3.5 text-xs align-top">
                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold leading-tight border whitespace-nowrap ${actionStyle.bgColor} ${actionStyle.textColor} ${actionStyle.borderColor}`}>
                                {log.action.replace(/_/g, ' ').toUpperCase()}
                            </span>
                        </TableCell>
                        <TableCell className="px-4 py-3.5 text-sm text-gray-600 dark:text-gray-300 align-top">
                          {log.contractName && <div className="font-medium text-gray-800 dark:text-gray-100 truncate" title={log.contractName}>{log.contractName.length > 30 ? log.contractName.substring(0,27) + "..." : log.contractName}</div>}
                          {log.contractId && <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Contract ID: {log.contractId.length > 8 ? log.contractId.slice(0,4) + '...' + log.contractId.slice(-4) : log.contractId}</div>}
                        </TableCell>
                        <TableCell className="px-4 py-3.5 text-xs text-gray-500 dark:text-gray-400 align-top max-w-xs xl:max-w-sm">
                          <div className="flex items-center justify-between space-x-1 group">
                            <span className="flex-grow truncate leading-relaxed" title={renderDetailsSummary(log.action, log.details)}>
                                {renderDetailsSummary(log.action, log.details)}
                            </span>
                            <TooltipProvider delayDuration={100}>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button variant="ghost" size="sm" className="h-6 w-6 text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 flex-shrink-0 opacity-60 group-hover:opacity-100 transition-opacity" onClick={() => setSelectedLogDetails(log.details)}>
                                            <Info className="h-4 w-4"/>
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="left" className="max-w-md bg-slate-800 text-white p-3 rounded-lg shadow-xl text-xs z-[1000] border border-slate-700">
                                        <p className="font-semibold mb-1.5 text-sm border-b border-slate-700 pb-1.5">Full Event Details:</p>
                                        <pre className="whitespace-pre-wrap break-all max-h-80 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-slate-700/50 p-1">{JSON.stringify(log.details, null, 2)}</pre>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                          </div>
                        </TableCell>
                    </TableRow>
                    );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Pagination Controls */}
          {logData.pagination && logData.pagination.total_pages > 1 && (
             <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4">
              <Button variant="outline" size="sm" onClick={() => handlePageChange(currentPage - 1)} disabled={isLoading || currentPage === 1} className="w-full sm:w-auto dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-700">
                <ChevronLeft className="h-4 w-4 mr-1.5" /> Previous
              </Button>
              <span className="text-sm text-gray-600 dark:text-gray-400 order-first sm:order-none">
                Page {logData.pagination.current_page} of {logData.pagination.total_pages}
                <span className="hidden sm:inline mx-2 text-gray-300 dark:text-gray-600 font-light">|</span>
                <span className="hidden sm:inline">Total Entries: {logData.pagination.total_items}</span>
              </span>
              <Button variant="outline" size="sm" onClick={() => handlePageChange(currentPage + 1)} disabled={isLoading || currentPage === logData.pagination.total_pages} className="w-full sm:w-auto dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-700">
                Next <ChevronRight className="h-4 w-4 ml-1.5" />
              </Button>
            </div>
          )}
        </>
      )}

      {/* Modal for Full Details */}
      {selectedLogDetails && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[1000] flex items-center justify-center p-4 transition-opacity duration-150 ease-out"
          onClick={() => setSelectedLogDetails(null)}
        >
          <div 
            className="bg-white dark:bg-slate-800 p-5 sm:p-6 rounded-lg shadow-xl max-w-xl lg:max-w-2xl w-full max-h-[85vh] overflow-y-auto flex flex-col animate-modal-show border dark:border-slate-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4 pb-3 border-b border-gray-200 dark:border-slate-700">
              <h2 className="text-lg sm:text-xl font-semibold text-gray-700 dark:text-gray-200">Log Event Details</h2>
              <Button variant="ghost" size="icon" className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 rounded-full h-8 w-8" onClick={() => setSelectedLogDetails(null)}>
                <CloseIcon className="h-5 w-5"/>
              </Button>
            </div>
            <pre className="text-xs sm:text-sm bg-slate-50 dark:bg-slate-900 p-3 sm:p-4 rounded-md whitespace-pre-wrap break-words border border-gray-200 dark:border-slate-700 flex-grow overflow-auto scrollbar-thin scrollbar-thumb-slate-400 dark:scrollbar-thumb-slate-600 scrollbar-track-slate-200 dark:scrollbar-track-slate-800 text-gray-700 dark:text-gray-300">
              {JSON.stringify(selectedLogDetails, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

export default function TeamActivityLogPageWithSuspense() {
    return (
        <Suspense fallback={<InitialLoadingSkeleton />}>
            <TeamActivityLogPageComponent />
        </Suspense>
    );
}
