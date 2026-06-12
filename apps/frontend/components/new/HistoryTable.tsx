// In apps/frontend/components/new/HistoryTable.tsx

"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Skeleton } from "@/components/ui/skeleton";
import { useIntersectionObserver } from "@/hooks/useIntersectionObserver";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import {
  FileText, Clock, Search, ClipboardCheck, ChevronDown, ChevronUp,
  ArrowUpDown, ArrowUp, ArrowDown
} from "lucide-react";
import debounce from 'lodash/debounce';
import { useRouter } from 'next/navigation';

// --- INTERFACES ---
interface UserInDB {
  _id: string;
  username: string;
  email: string;
  ownedAccountId?: string | null;
}

interface WorkflowRoles {
  editorUserId: string | null;
  approverUserId: string | null;
  editor_name?: string | null;
  approver_name?: string | null;
}

interface Document {
  _id: string;
  status: string;
  contract_name: string;
  uploaded_by: string;
  uploader_name?: string | null;
  uploaded_at: string;
  page_count: number;
  ownerType: 'user' | 'team';
  ownerId: string;
  workflowRoles?: WorkflowRoles | null;
  reEditRequest?: {
    reason: string;
    denialReason?: string;
  } | null;
}

interface HistoryTableProps {
  onFetchDocuments: (
    page: number,
    perPage: number,
    search?: string,
    sortBy?: string,
    sortOrder?: 'asc' | 'desc'
  ) => Promise<any>;
  documents: Document[];
  currentUserInfo: UserInDB | null;
  isLoading: boolean;
  pagination: {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    itemsPerPage: number;
  };
  onPageChange: (page: number) => void;
  refreshDocuments: () => void;
}

// --- HELPER FUNCTIONS ---
function getHistoryStatusBadgeClass(status: string): string {
  switch (status) {
    case "Pending Re-edit Approval": return "bg-amber-50 text-amber-700 border border-amber-200";
    case "Re-edit Denied": return "bg-red-50 text-red-700 border border-red-200";
    case "Completed": return "bg-emerald-50 text-emerald-700 border border-emerald-200";
    default: return "bg-gray-100 text-gray-500 border border-gray-300";
  }
}

function getHistoryStatusIcon(status: string): React.ReactNode {
  switch (status) {
    case "Pending Re-edit Approval": return <Search className="h-3 w-3 mr-1 inline-block text-amber-700" />;
    case "Completed": return <ClipboardCheck className="h-3 w-3 mr-1 inline-block" />;
    default: return <Clock className="h-3 w-3 mr-1 inline-block" />;
  }
}

// --- SUB-COMPONENT FOR A SINGLE ROW ---
const HistoryDocumentRow = React.memo(({
  doc,
  currentUserInfo,
  isExpanded,
  onToggleExpand,
}: {
  doc: Document;
  currentUserInfo: UserInDB | null;
  isExpanded: boolean;
  onToggleExpand: (docId: string) => void;
}) => {
  const { ref } = useIntersectionObserver({ threshold: 0.1, triggerOnce: true });
  const router = useRouter();

  const currentUserId = currentUserInfo?._id;
  const isAccountOwner = !!(currentUserInfo?.ownedAccountId && doc.ownerType === 'team' && doc.ownerId === currentUserInfo.ownedAccountId);
  const isAssignedApprover = !!(currentUserId && doc.workflowRoles?.approverUserId === currentUserId);

  const isAssignedEditor = useMemo(() => !!(currentUserId && doc.workflowRoles?.editorUserId === currentUserId), [currentUserId, doc.workflowRoles]);

  const { displayStatus, tooltipText, highlightRow } = useMemo(() => {
    if (doc.status === 'Pending Re-edit Approval') {
      // Logic for the person who needs to take action
      if (isAccountOwner || isAssignedApprover) {
        return {
          displayStatus: "Review Re-edit Request",
          // Use optional chaining (?.) to safely access the reason
          tooltipText: `Action required. Reason: "${doc.reEditRequest?.reason || 'N/A'}"`,
          highlightRow: true
        };
      }
      // Logic for everyone else
      return {
        displayStatus: "Pending Re-edit Request",
        tooltipText: `Submitted for re-edit approval. Reason: "${doc.reEditRequest?.reason || 'N/A'}"`,
        highlightRow: false
      };
    }

    // --- THIS IS THE CORRECTED LOGIC ---
    if (doc.status === 'Re-edit Denied') {
      return {
        displayStatus: "Re-edit Denied",
        // Use optional chaining (?.) to safely access the denialReason
        tooltipText: `Your request was denied. Reason: "${doc.reEditRequest?.denialReason || 'N/A'}"`,
        highlightRow: isAssignedEditor // Highlight it so the editor sees it
      };
    }

    // Default case for 'Completed'
    return {
      displayStatus: "Completed",
      tooltipText: "This contract has been completed and archived.",
      highlightRow: false
    };
  }, [doc, isAccountOwner, isAssignedApprover]);

  const actionConfig = useMemo(() => ({
    label: "View",
    icon: <FileText className="w-4 h-4 mr-2" />,
    className: "w-32 border border-gray-200 bg-white text-gray-700 hover:bg-gray-50",
    action: () => router.push(`/contracts/${doc._id}`),
    tooltip: "View contract details and history",
  }), [doc._id, router]);

  const formatDate = useCallback((dateString: string) => new Date(dateString).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC', []);
  const truncateMiddle = useCallback((str: string, maxLength: number) => !str ? "" : str.length <= maxLength ? str : `${str.slice(0, Math.floor(maxLength / 2))}...${str.slice(-Math.floor(maxLength / 2) + 3)}`, []);
  const getNameDisplay = useCallback((name: string | null | undefined, id: string | null | undefined, fallback = "N/A"): string => name || (id ? `ID: ${truncateMiddle(id, 10)}` : fallback), [truncateMiddle]);

  const isTeamDocument = doc.ownerType === 'team';

  return (
    <>
      <TableRow ref={ref as React.RefObject<HTMLTableRowElement>} className={`group transition-colors hover:bg-gray-50 ${isExpanded ? 'bg-gray-50' : ''} ${highlightRow ? 'bg-amber-50 hover:bg-amber-50/80' : ''}`}>
        <TableCell className="py-4 pl-4 pr-2 w-[40px]">
          <TooltipProvider delayDuration={100}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={() => onToggleExpand(doc._id)} aria-label={isExpanded ? 'Collapse row' : 'Expand row'} className="h-7 w-7 text-gray-500 hover:bg-gray-200">
                  {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right"><p>{isExpanded ? 'Hide Details' : 'Show Details'}</p></TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </TableCell>

        <TableCell className="py-4">
          <Link href={`/contracts/${doc._id}`} className="flex items-center gap-2 text-sm font-semibold text-gray-900 transition-colors hover:text-gray-700">
            <FileText className="w-4 h-4 text-gray-500 flex-shrink-0" />
            <span className="truncate">{truncateMiddle(doc.contract_name, 25)}</span>
          </Link>
        </TableCell>

        <TableCell className="py-4">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium capitalize ${getHistoryStatusBadgeClass(doc.status)}`}>
                  {getHistoryStatusIcon(doc.status)}
                  {displayStatus}
                </span>
              </TooltipTrigger>
              <TooltipContent><p>{tooltipText}</p></TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </TableCell>
        <TableCell className="py-4 text-sm text-slate-600">{doc.page_count || 0}</TableCell>
        <TableCell className="py-4 text-sm text-slate-600">{formatDate(doc.uploaded_at)}</TableCell>
        <TableCell className="py-4">
          <Button onClick={actionConfig.action} className={actionConfig.className}>{actionConfig.icon}{actionConfig.label}</Button>
        </TableCell>
      </TableRow>

      <AnimatePresence>
        {isExpanded && (
          <motion.tr initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }} className="border-b border-gray-200 bg-gray-50">
            <TableCell className="py-2 px-4 align-top"></TableCell>
            <TableCell colSpan={5} className="py-3 px-4 text-sm">
              <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
                <div>
                  <span className="font-medium text-gray-700">Uploader:</span>
                  <span className="ml-2 text-gray-600">{getNameDisplay(doc.uploader_name, doc.uploaded_by)}</span>
                </div>
                {isTeamDocument && (
                  <>
                    <div>
                      <span className="font-medium text-gray-700">Editor:</span>
                      <span className="ml-2 text-gray-600">{getNameDisplay(doc.workflowRoles?.editor_name, doc.workflowRoles?.editorUserId)}</span>
                    </div>
                    <div>
                      <span className="font-medium text-gray-700">Approver:</span>
                      <span className="ml-2 text-gray-600">{getNameDisplay(doc.workflowRoles?.approver_name, doc.workflowRoles?.approverUserId)}</span>
                    </div>
                  </>
                )}
              </div>
            </TableCell>
          </motion.tr>
        )}
      </AnimatePresence>
    </>
  );
});

// --- MAIN COMPONENT ---
export default function HistoryTable({
  onFetchDocuments,
  documents = [],
  currentUserInfo,
  pagination = { currentPage: 1, totalPages: 1, totalItems: 0, itemsPerPage: 10 },
  onPageChange,
  isLoading = false,
  refreshDocuments,
}: HistoryTableProps) {
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortConfig, setSortConfig] = useState({ field: 'uploaded_at', direction: 'desc' as 'asc' | 'desc' });
  const [isLoadingData, setIsLoadingData] = useState(false);

  const handleToggleExpand = useCallback((docId: string) => {
    setExpandedRowId(prevId => (prevId === docId ? null : docId));
  }, []);

  const debouncedSearch = useCallback(debounce(async (query, sort) => {
    setIsLoadingData(true);
    try {
      await onFetchDocuments(1, pagination.itemsPerPage, query, sort.field, sort.direction);
    } finally {
      setIsLoadingData(false);
    }
  }, 500), [onFetchDocuments, pagination.itemsPerPage]);

  useEffect(() => {
    debouncedSearch(searchQuery, sortConfig);
    return () => debouncedSearch.cancel();
  }, [searchQuery, sortConfig, debouncedSearch]);

  const handleSortChange = (field: string) => {
    setSortConfig(prev => ({ field, direction: prev.field === field && prev.direction === 'desc' ? 'asc' : 'desc' }));
  };

  const renderSortIndicator = (field: string) => {
    if (sortConfig.field !== field) return <ArrowUpDown className="h-3.5 w-3.5 text-gray-400 ml-1" />;
    return sortConfig.direction === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-gray-700 ml-1" /> : <ArrowDown className="h-3.5 w-3.5 text-gray-700 ml-1" />;
  };

  return (
    <>
      <div className="flex flex-col sm:flex-row gap-4 py-4 items-center justify-between">
        <div className="relative w-full sm:w-64">
          <Input id="search" placeholder="Search by name..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-8" />
          <Search className="h-4 w-4 absolute left-2.5 top-1/2 transform -translate-y-1/2 text-gray-400" />
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow className="bg-gray-50">
            <TableHead className="w-[40px] px-2"></TableHead>
            <TableHead><button onClick={() => handleSortChange('contract_name')} className="flex items-center font-semibold text-gray-700">Name {renderSortIndicator('contract_name')}</button></TableHead>
            <TableHead><span className="font-semibold text-gray-700">Status</span></TableHead>
            <TableHead><button onClick={() => handleSortChange('page_count')} className="flex items-center font-semibold text-gray-700">Pages {renderSortIndicator('page_count')}</button></TableHead>
            <TableHead><button onClick={() => handleSortChange('uploaded_at')} className="flex items-center font-semibold text-gray-700">Date Completed {renderSortIndicator('uploaded_at')}</button></TableHead>
            <TableHead><span className="font-semibold text-gray-700">Actions</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoadingData ? (
            Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}><TableCell colSpan={6}><Skeleton className="h-16 w-full" /></TableCell></TableRow>
            ))
          ) : documents.length > 0 ? (
            documents.map((doc) => (
              <HistoryDocumentRow key={doc._id} doc={doc} currentUserInfo={currentUserInfo} isExpanded={expandedRowId === doc._id} onToggleExpand={handleToggleExpand} />
            ))
          ) : (
            <TableRow><TableCell colSpan={6} className="py-12 text-center text-slate-500">No documents found in history.</TableCell></TableRow>
          )}
        </TableBody>
      </Table>

      {pagination.totalItems > 0 && (
        <div className="flex items-center justify-between border-t border-gray-100 px-4 pb-4 pt-4">
          <p className="text-sm text-slate-600">Page {pagination.currentPage} of {pagination.totalPages}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onPageChange(pagination.currentPage - 1)} disabled={pagination.currentPage <= 1}>Previous</Button>
            <Button variant="outline" size="sm" onClick={() => onPageChange(pagination.currentPage + 1)} disabled={pagination.currentPage >= pagination.totalPages}>Next</Button>
          </div>
        </div>
      )}
    </>
  );
}
