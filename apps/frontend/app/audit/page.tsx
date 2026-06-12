// frontend/app/audit/page.tsx
'use client';

import React, { useEffect, useState, useCallback } from 'react';
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
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, ListChecks, ChevronLeft, ChevronRight, Info, X as CloseIcon } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// --- Import Types ---
import type { PaginatedAuditLogs, AuditLogEntry, AuditLogDetail } from '@/types/audit';
// --- Import Custom Auth Hook ---
import { useAuth } from '@/hooks/useAuth';

const ITEMS_PER_PAGE = 9;
// Simple logger for this component
const logger = {
    error: (...args: any[]) => console.error('[AuditPage]', ...args),
    warn: (...args: any[]) => console.warn('[AuditPage]', ...args),
    info: (...args: any[]) => console.info('[AuditPage]', ...args),
};

// --- Helper for Action Badge Styling ---
interface ActionStyle {
  bgColor: string;
  textColor: string;
  borderColor: string;
  // icon?: React.ElementType; // Optional for future use
}

const getActionBadgeStyle = (action: string): ActionStyle => {
  const normalizedAction = action.toUpperCase();

  if (normalizedAction.includes("CREATE") || normalizedAction.includes("UPLOADED") || normalizedAction.includes("ADDED")) {
    return { bgColor: 'bg-green-50 dark:bg-green-900/30', textColor: 'text-green-700 dark:text-green-300', borderColor: 'border-green-200 dark:border-green-700' };
  }
  if (normalizedAction.includes("UPDATE") || normalizedAction.includes("SAVED") || normalizedAction.includes("SUBMITTED") || normalizedAction.includes("ASSIGNED") || normalizedAction.includes("EDIT")) {
    return { bgColor: 'bg-blue-50 dark:bg-blue-900/30', textColor: 'text-blue-700 dark:text-blue-300', borderColor: 'border-blue-200 dark:border-blue-700' };
  }
  if (normalizedAction.includes("APPROVE") || normalizedAction.includes("COMPLETE")) {
    return { bgColor: 'bg-teal-50 dark:bg-teal-900/30', textColor: 'text-teal-700 dark:text-teal-300', borderColor: 'border-teal-200 dark:border-teal-700' };
  }
  if (normalizedAction.includes("REJECT") || normalizedAction.includes("REMOVE") || normalizedAction.includes("DELETE")) {
    return { bgColor: 'bg-red-50 dark:bg-red-900/30', textColor: 'text-red-700 dark:text-red-300', borderColor: 'border-red-200 dark:border-red-700' };
  }
  if (normalizedAction.includes("TASK_STARTED") || normalizedAction.includes("PROCESSING") || normalizedAction.includes("INDEXING") || normalizedAction.includes("SUMMARIZING")) {
    return { bgColor: 'bg-yellow-50 dark:bg-yellow-900/30', textColor: 'text-yellow-700 dark:text-yellow-300', borderColor: 'border-yellow-200 dark:border-yellow-700' };
  }
  return { bgColor: 'bg-slate-100 dark:bg-slate-700', textColor: 'text-slate-700 dark:text-slate-300', borderColor: 'border-slate-300 dark:border-slate-600' };
};
// --- End Helper ---


export default function AuditLogPage() {
  const [auditData, setAuditData] = useState<PaginatedAuditLogs | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedLogDetails, setSelectedLogDetails] = useState<AuditLogDetail | null>(null);

  const { isAuthenticated, authChecked, authenticatedFetch } = useAuth();
  const apiBaseWithPrefix = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL;

  const fetchAuditLogs = useCallback(async (page: number) => {
    if (!authChecked) {
      setIsLoading(true);
      return;
    }
    if (!isAuthenticated) {
      setError("Authentication required to view audit logs.");
      toast({ title: "Authentication Required", description: "Please log in.", variant: "destructive" });
      setIsLoading(false);
      setAuditData(null);
      return;
    }
    if (!apiBaseWithPrefix) {
        setError("Backend API URL is not configured (NEXT_PUBLIC_EXTRACTOR_API_URL).");
        toast({ title: "Configuration Error", description: "API endpoint is missing.", variant: "destructive" });
        setIsLoading(false);
        setAuditData(null);
        return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const relativePath = `/audit/logs/?page=${page}&per_page=${ITEMS_PER_PAGE}&sort_by=timestamp&sort_order=desc`;
      const url = `${apiBaseWithPrefix}${relativePath}`;
      logger.info("Fetching audit logs from URL:", url);
      const { data, error: fetchError } = await authenticatedFetch(url);

      if (fetchError) throw new Error(fetchError || "Failed to fetch audit logs");
      if (!data || !data.logs || !data.pagination) {
        logger.error("Received invalid data structure for audit logs:", data);
        throw new Error("Received invalid data structure for audit logs.");
      }
      setAuditData(data as PaginatedAuditLogs);
    } catch (err: any) {
      logger.error("Error fetching audit logs:", err);
      const errorMessage = err.message || "An unknown error occurred while fetching logs.";
      setError(errorMessage);
      toast({ title: "Error Fetching Logs", description: errorMessage, variant: "destructive" });
      setAuditData(null);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, authChecked, apiBaseWithPrefix, authenticatedFetch]);

  useEffect(() => {
    if (authChecked) {
        fetchAuditLogs(currentPage);
    }
  }, [currentPage, authChecked, fetchAuditLogs]);

  const handlePrevPage = () => currentPage > 1 && setCurrentPage(prev => prev - 1);
  const handleNextPage = () => auditData && currentPage < auditData.pagination.total_pages && setCurrentPage(prev => prev + 1);

  const formatTimestamp = (isoString: string) => {
    try {
      return new Date(isoString).toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
      });
    } catch (e) { return isoString; }
  };
  
  const renderDetailsSummary = (action: string, details: AuditLogDetail): string => {
    if (!details || Object.keys(details).length === 0) return "No specific details.";
    let summaryParts: string[] = [];
    if (details.oldStatus && details.newStatus) summaryParts.push(`Status: '${details.oldStatus}' → '${details.newStatus}'`);
    switch (action.toUpperCase()) { // Normalize action for the switch
      case "CONTRACT_UPLOADED":
        if (details.filename) summaryParts.push(`File: ${details.filename.substring(0,30)}${details.filename.length > 30 ? '...' : '' }`);
        if (typeof details.page_count === 'number') summaryParts.push(`Pages: ${details.page_count}`);
        break;
      case "INDEXING_TASK_STARTED": case "SUMMARIZING_TASK_STARTED": case "PROCESSING_TASK_STARTED":
        if (details.use_local_marker !== undefined) summaryParts.push(`Local Marker: ${details.use_local_marker}`);
        if (details.num_questions_processed !== undefined) summaryParts.push(`Questions: ${details.num_questions_processed}`);
        break;
      case "DRAFT_SAVED":
        if (details.draft_qa_count !== undefined) summaryParts.push(`Draft Q&As: ${details.draft_qa_count}`);
        break;
      case "NEW_VERSION_SAVED":
        if (details.version_number !== undefined) summaryParts.push(`Version: ${details.version_number}`);
        break;
      case "CONTRACT_REJECTED":
        if (details.rejectionReason) {
          const reason = String(details.rejectionReason);
          summaryParts.push(`Reason: ${reason.substring(0, 40)}${reason.length > 40 ? '...' : ''}`);
        }
        break;
      case "WORKFLOW_ROLES_UPDATED":
        let roleChanges: string[] = [];
        if (details.new_editor_username) roleChanges.push(`Editor: ${details.new_editor_username}`);
        else if (details.new_editor_userId === null && details.old_editor_userId) roleChanges.push(`Editor Unassigned`);
        if (details.new_approver_username) roleChanges.push(`Approver: ${details.new_approver_username}`);
        else if (details.new_approver_userId === null && details.old_approver_userId) roleChanges.push(`Approver Unassigned`);
        if(roleChanges.length > 0) summaryParts.push(roleChanges.join(', '));
        break;
      case "TEAM_MEMBER_ADDED": case "TEAM_MEMBER_REMOVED":
        if (details.target_username) summaryParts.push(`User: ${details.target_username}`);
        if (details.assigned_role_in_team) summaryParts.push(`Role: ${details.assigned_role_in_team}`);
        break;
      case "QUESTION_CATEGORY_CREATED": case "QUESTION_CATEGORY_DELETED":
        if (details.category_name) summaryParts.push(`Category: ${details.category_name}`);
        if (details.question_count !== undefined) summaryParts.push(`Questions: ${details.question_count}`);
        break;
      case "QUESTION_CATEGORY_UPDATED":
        if (details.changes && Array.isArray(details.changes) && details.changes.length > 0) {
            const changedFields = details.changes.map((c: any) => c.field).join(', ');
            summaryParts.push(`Updated: ${changedFields}`);
        } else if (details.category_id) summaryParts.push(`Category ID: ${String(details.category_id).slice(-6)}...`);
        break;
      case "PRO_ACCOUNT_CREATED":
        if(details.account_name_created) summaryParts.push(`Account: ${details.account_name_created}`);
        break;
      default:
        const firstKey = Object.keys(details)[0];
        if (firstKey) {
          const firstValue = String(details[firstKey]);
          summaryParts.push(`${firstKey}: ${firstValue.substring(0, 50)}${firstValue.length > 50 ? '...' : ''}`);
        }
    }
    if (summaryParts.length === 0) return "View full details";
    return summaryParts.join('; ').substring(0, 100) + (summaryParts.join('; ').length > 100 ? '...' : '');
  };

  if (!authChecked) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-200px)]">
        <ListChecks className="h-10 w-10 text-gray-300 animate-pulse mr-3" />
        <p className="text-lg text-gray-400">Verifying authentication...</p>
      </div>
    );
  }
  
  if (isLoading && !auditData) {
    return (
      <div className="container mx-auto py-6 sm:py-8 px-2 sm:px-4 lg:px-6 animate-pulse">
        <div className="mb-6 sm:mb-8 flex items-center">
            <ListChecks className="h-6 w-6 sm:h-7 sm:w-7 mr-2.5 text-blue-600 opacity-50" />
            <Skeleton className="h-8 w-64 sm:h-9 sm:w-72 bg-gray-200 rounded-md" />
        </div>
        <div className="bg-white shadow rounded-lg border border-gray-200 p-4">
            <div className="space-y-4">
            {[...Array(Math.floor(ITEMS_PER_PAGE / 4) || 5)].map((_, i) => (
                <div key={i} className="grid grid-cols-5 gap-3 items-center">
                    {[...Array(5)].map((_c, cIdx) => <Skeleton key={cIdx} className="h-5 bg-gray-200 rounded col-span-1" />)}
                </div>
            ))}
            </div>
        </div>
      </div>
    );
  }
  
  if (error) {
    return (
        <div className="container mx-auto py-6 sm:py-8 px-2 sm:px-4 lg:px-6">
            <div className="mb-6 sm:mb-8 flex items-center"><ListChecks className="h-6 w-6 sm:h-7 sm:w-7 mr-2.5 text-blue-600" /><h1 className="text-xl sm:text-2xl font-semibold text-gray-800">System Audit Logs</h1></div>
            <div className="bg-red-50 border-l-4 border-red-600 text-red-800 p-4 sm:p-6 rounded-md shadow" role="alert">
              <div className="flex items-start"><AlertTriangle className="h-5 w-5 sm:h-6 sm:w-6 mr-2.5 sm:mr-3 flex-shrink-0 text-red-500" /><div><p className="font-semibold text-base sm:text-lg">Access Denied or Error</p><p className="text-sm mt-1">{error}</p></div></div>
            </div>
        </div>
    );
  }

  return (
    <div className="container mx-auto py-6  px-2 sm:px-4 lg:px-6 font-GullyVar">
      <div className=" flex flex-col sm:flex-row mt-12 justify-between items-center gap-3 sm:gap-4">
        <h1 className="text-4xl font-bold mb-[55px] text-gray-900">System Audit Logs</h1>
      </div>

      {(!auditData || auditData.logs.length === 0) && !isLoading ? (
        <div className="text-center py-12 sm:py-16 text-gray-500 bg-white shadow rounded-lg border border-gray-200"><ListChecks className="h-12 w-12 sm:h-16 sm:w-16 mx-auto mb-4 text-gray-300" /><p className="text-lg sm:text-xl font-medium">No Audit Logs Found</p><p className="mt-1 text-sm text-gray-400">System actions will be recorded here.</p></div>
      ) : auditData && (
        <>
          <div className="bg-white shadow rounded-lg overflow-x-auto border border-gray-200">
            <Table className="min-w-full divide-y divide-gray-200">
              <TableHeader className="bg-gray-50 dark:bg-slate-800">
                <TableRow>
                  <TableHead className="w-[210px] px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Timestamp</TableHead>
                  <TableHead className="w-[180px] px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">User</TableHead>
                  <TableHead className="w-[200px] px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Action</TableHead>
                  <TableHead className="w-[240px] px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Target</TableHead>
                  <TableHead className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="bg-white dark:bg-slate-900 divide-y divide-gray-200 dark:divide-slate-700">
                {isLoading && auditData.logs.length > 0 && 
                    <TableRow><TableCell colSpan={5} className="text-center py-6 text-gray-400 dark:text-gray-500 italic text-sm">Updating logs...</TableCell></TableRow>
                }
                {auditData.logs.map((log) => {
                  const actionStyle = getActionBadgeStyle(log.action);
                  return (
                  <TableRow key={log._id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors duration-100">
                    <TableCell className="px-4 py-3.5 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400 align-top">{formatTimestamp(log.timestamp)}</TableCell>
                    <TableCell className="px-4 py-3.5 whitespace-nowrap text-sm text-gray-600 dark:text-gray-300 align-top">
                      <div className="font-medium text-gray-800 dark:text-gray-100">{log.username || <span className="italic text-gray-400 dark:text-gray-500">System/N/A</span>}</div>
                      {log.userId && <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">ID: {log.userId.length > 8 ? log.userId.slice(0,4) + '...' + log.userId.slice(-4) : log.userId}</div>}
                    </TableCell>
                    <TableCell className="px-4 py-3.5 text-xs align-top">
                        <span 
                          className={`inline-flex items-center justify-center px-3 py-1 rounded-full text-xs font-semibold leading-tight border whitespace-nowrap ${actionStyle.bgColor} ${actionStyle.textColor} ${actionStyle.borderColor}`}
                        >
                          {log.action.replace(/_/g, ' ').toUpperCase()}
                        </span>
                    </TableCell>
                    <TableCell className="px-4 py-3.5 text-sm text-gray-600 dark:text-gray-300 align-top">
                      {log.contractName && <div className="font-medium text-gray-800 dark:text-gray-100 truncate" title={log.contractName}>{log.contractName.length > 30 ? log.contractName.substring(0,27) + "..." : log.contractName}</div>}
                      {log.contractId && <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Contract ID: {log.contractId.length > 8 ? log.contractId.slice(0,4) + '...' + log.contractId.slice(-4) : log.contractId}</div>}
                      {log.accountName && <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">Account: {log.accountName}</div>}
                      {log.accountId && !log.accountName && <div className="mt-1 text-xs text-gray-400 dark:text-gray-500">Account ID: {log.accountId.length > 8 ? log.accountId.slice(0,4) + '...' + log.accountId.slice(-4) : log.accountId}</div>}
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
          
          {auditData.pagination.total_pages > 1 && (
             <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePrevPage}
                disabled={isLoading || currentPage === 1}
                className="w-full sm:w-auto dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-700"
              >
                <ChevronLeft className="h-4 w-4 mr-1.5" />
                Previous
              </Button>
              <span className="text-sm text-gray-600 dark:text-gray-400 order-first sm:order-none">
                Page {auditData.pagination.current_page} of {auditData.pagination.total_pages}
                <span className="hidden sm:inline mx-2 text-gray-300 dark:text-gray-600 font-light">|</span>
                <span className="hidden sm:inline">Total Logs: {auditData.pagination.total_items}</span>
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleNextPage}
                disabled={isLoading || currentPage === auditData.pagination.total_pages}
                className="w-full sm:w-auto dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-700"
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1.5" />
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
              <style jsx global>{`
                @keyframes modalShowEffect { 
                  from { opacity: 0; transform: scale(0.95) translateY(10px); } 
                  to { opacity: 1; transform: scale(1) translateY(0); } 
                }
                .animate-modal-show { animation: modalShowEffect 0.2s ease-out forwards; }
              `}</style>
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