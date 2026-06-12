// In apps/frontend/app/history/page.tsx

'use client';

import { useEffect, useState, useCallback, useRef } from "react";
import { toast } from "@/hooks/use-toast";
import { History as HistoryIcon, RefreshCw } from "lucide-react";
import { motion } from "framer-motion";
import LoadingScreen from "@/components/animation/LoadingScreen";
import { useAccountContext } from "../context/AccountContext";
import { useAuth } from "@/hooks/useAuth";
import HistoryTable from "@/components/new/HistoryTable"; // We will create this in the next phase
import { Button } from "@/components/ui/button";

// --- All of your existing interface/type definitions ---
// It's best practice to move these to a shared types file if not already done.
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
  workflowRoles?: {
    editorUserId: string | null;
    approverUserId: string | null;
    editor_name?: string | null;
    approver_name?: string | null;
  } | null;
  reEditRequest?: { // Include the new field
    requestedByUserId: string;
    reason: string;
    requestedAt: string;
    denialReason?: string;
  } | null;
}

interface UserInDB {
  _id: string;
  username: string;
  email: string;
  ownedAccountId?: string | null;
  teamIds?: string[];
}

interface PaginatedResponse {
  documents: Document[];
  pagination: {
    total: number;
    pages: number;
    current_page: number;
    per_page: number;
  };
}

export default function HistoryPage() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [currentUserInfo, setCurrentUserInfo] = useState<UserInDB | null>(null);
  const [pagination, setPagination] = useState({
    currentPage: 1,
    totalPages: 1,
    totalItems: 0,
    itemsPerPage: 10
  });

  const { selectedAccountId } = useAccountContext();
  const apiUrl = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL;
  const { isAuthenticated, authChecked, authenticatedFetch, logout } = useAuth();

  const handleSessionTimeout = useCallback(() => {
    toast({ title: "Session expired", description: "Please sign in again.", variant: "destructive" });
    logout();
  }, [logout]);

  const handleApiError = useCallback((error: string) => {
    if (error.includes("Authentication failed") || error.includes("401")) {
      handleSessionTimeout();
      return true;
    }
    return false;
  }, [handleSessionTimeout]);

  const fetchCurrentUser = useCallback(async () => {
    // This function is identical to your dashboard version
    if (!isAuthenticated) return;
    try {
      const { data, error } = await authenticatedFetch(`${apiUrl}/users/me/`);
      if (error) { if (handleApiError(error)) return; throw new Error(error); }
      setCurrentUserInfo(data as UserInDB);
    } catch (err) { console.error('Failed to fetch current user:', err); }
  }, [apiUrl, isAuthenticated, authenticatedFetch, handleApiError]);

  // --- THE KEY DIFFERENCE IS THIS FUNCTION ---
  const fetchHistoryDocuments = useCallback(async (
    page: number = 1,
    perPage: number = pagination.itemsPerPage,
    search?: string,
    sortBy?: string,
    sortOrder: 'asc' | 'desc' = 'desc'
  ) => {
    if (!isAuthenticated) return;

    setIsRefreshing(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        per_page: perPage.toString(),
        // IMPORTANT: We filter for the new statuses here
        status: "Completed,Pending Re-edit Approval, Re-edit Denied",
        ...(search && { search }),
        ...(sortBy && { sort_by: sortBy }),
        ...(sortOrder && { sort_order: sortOrder }),
        ...(selectedAccountId && { context_id: selectedAccountId })
      });

      const { data, error } = await authenticatedFetch(`${apiUrl}/documents/?${params.toString()}`);
      if (error) { if (handleApiError(error)) return; throw new Error(error); }

      setDocuments(data.documents || []);
      setPagination(data.pagination);
    } catch (err) {
      toast({ title: "Error", description: "Failed to load history.", variant: "destructive" });
    } finally {
      setIsRefreshing(false);
    }
  }, [isAuthenticated, pagination.itemsPerPage, selectedAccountId, authenticatedFetch, handleApiError, apiUrl]);

  const handleManualRefresh = useCallback(() => {
    fetchHistoryDocuments(pagination.currentPage);
  }, [fetchHistoryDocuments, pagination.currentPage]);

  const handlePageChange = useCallback((page: number) => {
    fetchHistoryDocuments(page);
  }, [fetchHistoryDocuments]);

  useEffect(() => {
    if (authChecked && isAuthenticated) {
      Promise.all([
        fetchCurrentUser(),
        fetchHistoryDocuments()
      ]).finally(() => setIsInitialLoading(false));
    } else if (authChecked) {
      setIsInitialLoading(false);
    }
  }, [authChecked, isAuthenticated, fetchCurrentUser, fetchHistoryDocuments]);

  // Refetch when account context changes
  useEffect(() => {
    if (isAuthenticated) {
      fetchHistoryDocuments();
    }
  }, [selectedAccountId, isAuthenticated, fetchHistoryDocuments]);


  if (isInitialLoading) {
    return <LoadingScreen message="Loading contract history..." />;
  }

  return (
    <div className="relative min-h-screen bg-white pt-20 font-InterVar text-gray-900">
      <main>
        <div className="flex flex-col gap-4 border-b border-gray-200 px-4 py-5 md:flex-row md:items-center md:justify-between md:px-10">
          <div>
            <h1 className="font-serif text-3xl font-light text-gray-900">Contract History</h1>
            <p className="mt-1 text-sm text-gray-500">Completed contracts and re-edit request history.</p>
          </div>
          <Button
            onClick={handleManualRefresh}
            variant="outline"
            size="sm"
            className="h-9 gap-2"
            disabled={isRefreshing}
          >
            {isRefreshing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span>Refresh</span>
          </Button>
        </div>

        <div className="px-4 py-6 md:px-10">
        <motion.div
          className="rounded-md border border-gray-200 bg-white"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <div className='px-4 sm:px-5 md:px-6'>
            <div className="overflow-x-auto">
              <div className="min-w-[600px] sm:min-w-0">
                <HistoryTable
                  documents={documents}
                  onFetchDocuments={fetchHistoryDocuments}
                  currentUserInfo={currentUserInfo}
                  pagination={pagination}
                  onPageChange={handlePageChange}
                  isLoading={isRefreshing}
                  refreshDocuments={handleManualRefresh}
                />
              </div>
            </div>
          </div>
        </motion.div>
        </div>
      </main>
    </div>
  );
}
