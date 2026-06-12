// components/new/file-upload-area.tsx
"use client"
import React, { useState, useCallback, useEffect, useMemo } from "react"
import { useDropzone } from "react-dropzone"
import {
  AlertCircle,
  CheckCircle,
  Copy,
  FileText,
  Files,
  Loader2,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  Users,
  XCircle,
} from "lucide-react"
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import { Button } from "@/components/ui/button"

import { useAccountContext } from '@/app/context/AccountContext';
import { toast } from "@/hooks/use-toast";

import { Label } from "@/components/ui/label";
import { apiFetch, apiUploadWithProgress } from "@/lib/apiClient";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type PdfJsModule = typeof import("pdfjs-dist");

let pdfjsLoader: Promise<PdfJsModule> | null = null;

function loadPdfJs() {
  if (!pdfjsLoader) {
    pdfjsLoader = import("pdfjs-dist").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url
      ).toString();
      return pdfjs;
    });
  }
  return pdfjsLoader;
}


interface FileWithDetails extends File {
  preview?: string
  pageCount?: number
  uploadResult?: { contractId: string; fileName: string; status: 'success' } | { fileName: string; status: 'error'; message: string };
}

interface AccountMember {
    id: string;
    name: string; 
}

interface FileUploadModalProps {
  isOpen: boolean
  onClose: () => void
  onUploadSuccess?: () => void
  userCredits: number
  projectId?: string | null
}

interface AssignWorkflowRolesRequest {
    editorUserId: string | null;
    approverUserId: string | null;
}

interface RoleTemplate {
  editorUserId: string;
  approverUserId: string;
}

export function FileUploadModal({
  isOpen,
  onClose,
  onUploadSuccess,
  userCredits,
  projectId,
}: FileUploadModalProps) {
  const [files, setFiles] = useState<FileWithDetails[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState<{ [key: string]: number }>({})
  const [sessionStatus, setSessionStatus] = useState<"idle" | "counting_pages" | "uploading" | "awaiting_assignment" | "complete_success" |"error" |"complete_with_errors">("idle")
  const [totalPages, setTotalPages] = useState(0)
  const [accountMembers, setAccountMembers] = useState<AccountMember[]>([]);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [memberFetchError, setMemberFetchError] = useState<string | null>(null);
  const [roleAssignments, setRoleAssignments] = useState<Record<string, {
      fileName: string;
      editorUserId: string | null;
      approverUserId: string | null;
      assignmentApiStatus: 'idle' | 'loading' | 'success' | 'error';
      assignmentApiError: string | null;
  }>>({});
  const [bulkEditorUserId, setBulkEditorUserId] = useState<string | null>(null);
  const [bulkApproverUserId, setBulkApproverUserId] = useState<string | null>(null);
  const [savedRoleTemplate, setSavedRoleTemplate] = useState<RoleTemplate | null>(null);

  const { selectedAccountId } = useAccountContext();
  const apiUrl = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL;
  const roleTemplateStorageKey = useMemo(
    () => selectedAccountId && selectedAccountId !== 'personal'
      ? `contract-upload-role-template:${selectedAccountId}`
      : null,
    [selectedAccountId]
  );
  
  useEffect(() => { 
    setTotalPages(files.reduce((sum, file) => sum + (file.pageCount || 1), 0)) 
  }, [files]);

  useEffect(() => { 
    return () => { 
      files.forEach(file => { 
        if (file.preview) URL.revokeObjectURL(file.preview) 
      }) 
    } 
  }, [files]);

  useEffect(() => {
    if (!isOpen) {
      setFiles([]); 
      setError(null); 
      setUploadProgress({}); 
      setSessionStatus("idle");
      setTotalPages(0); 
      setUploading(false); 
      setAccountMembers([]);
      setIsLoadingMembers(false); 
      setMemberFetchError(null); 
      setRoleAssignments({});
      setBulkEditorUserId(null);
      setBulkApproverUserId(null);
      setSavedRoleTemplate(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !roleTemplateStorageKey) {
      setSavedRoleTemplate(null);
      return;
    }

    try {
      const storedTemplate = localStorage.getItem(roleTemplateStorageKey);
      if (!storedTemplate) {
        setSavedRoleTemplate(null);
        return;
      }

      const parsed = JSON.parse(storedTemplate) as RoleTemplate;
      if (parsed?.editorUserId && parsed?.approverUserId) {
        setSavedRoleTemplate(parsed);
      } else {
        setSavedRoleTemplate(null);
      }
    } catch {
      setSavedRoleTemplate(null);
    }
  }, [isOpen, roleTemplateStorageKey]);

  useEffect(() => {
    const fetchMembers = async () => {
      if (!isOpen || selectedAccountId === 'personal' || !apiUrl) {
        if (selectedAccountId === 'personal') { 
          setAccountMembers([]); 
          setMemberFetchError(null); 
        }
        return;
      }
      if (isLoadingMembers) return;

      setIsLoadingMembers(true); 
      setMemberFetchError(null); 
      setAccountMembers([]);
      try {
        const response = await apiFetch(`${apiUrl}/teams/${selectedAccountId}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || `Failed to fetch members (${response.status})`);
        if (data && Array.isArray(data.members)) {
          const formattedMembers = data.members.map((m: any) => ({
            id: m.userId,
            name: m.username || m.email || m.userId
          })).sort((a: AccountMember, b: AccountMember) => a.name.localeCompare(b.name));
          setAccountMembers(formattedMembers);
        } else { 
          throw new Error("Invalid member data format"); 
        }
      } catch (err: any) {
        setMemberFetchError(err.message || "Could not load members."); 
        setAccountMembers([]);
        toast({ title: "Error Loading Members", description: err.message, variant: "destructive" });
        console.error("Error fetching account members:", err);
      } finally {
        setIsLoadingMembers(false);
      }
    };
    fetchMembers();
  }, [isOpen, selectedAccountId, apiUrl]);

  useEffect(() => {
    if (
      !isOpen ||
      !savedRoleTemplate ||
      accountMembers.length === 0 ||
      bulkEditorUserId ||
      bulkApproverUserId
    ) {
      return;
    }

    const editorExists = accountMembers.some(member => member.id === savedRoleTemplate.editorUserId);
    const approverExists = accountMembers.some(member => member.id === savedRoleTemplate.approverUserId);

    if (editorExists && approverExists) {
      setBulkEditorUserId(savedRoleTemplate.editorUserId);
      setBulkApproverUserId(savedRoleTemplate.approverUserId);
    }
  }, [isOpen, savedRoleTemplate, accountMembers, bulkEditorUserId, bulkApproverUserId]);

  const isProAccountContext = selectedAccountId !== 'personal';

  const roleAssignmentEntries = useMemo(
    () => Object.entries(roleAssignments),
    [roleAssignments]
  );

  const assignmentStats = useMemo(() => {
    const total = roleAssignmentEntries.length;
    const completed = roleAssignmentEntries.filter(
      ([, assignment]) => assignment.assignmentApiStatus === 'success'
    ).length;
    const loading = roleAssignmentEntries.filter(
      ([, assignment]) => assignment.assignmentApiStatus === 'loading'
    ).length;
    const errored = roleAssignmentEntries.filter(
      ([, assignment]) => assignment.assignmentApiStatus === 'error'
    ).length;
    const readyToSave = roleAssignmentEntries.filter(
      ([, assignment]) =>
        assignment.assignmentApiStatus !== 'success' &&
        !!assignment.editorUserId &&
        !!assignment.approverUserId
    ).length;

    return { total, completed, loading, errored, readyToSave };
  }, [roleAssignmentEntries]);

  const uploadedCount = useMemo(
    () => files.filter(file => file.uploadResult?.status === 'success').length,
    [files]
  );

  const failedUploadCount = useMemo(
    () => files.filter(file => file.uploadResult?.status === 'error').length,
    [files]
  );

  const allAssignmentsSuccessfulOrNotNeeded = useMemo(() => {
    if (!isProAccountContext) return true;
    if (roleAssignmentEntries.length === 0) return sessionStatus === 'complete_success';
    return roleAssignmentEntries.every(([, assignment]) => assignment.assignmentApiStatus === 'success');
  }, [isProAccountContext, sessionStatus, roleAssignmentEntries]);

  const updateRoleAssignment = useCallback((
    contractId: string,
    field: 'editorUserId' | 'approverUserId',
    userId: string | null
  ) => {
    setRoleAssignments(prev => {
      const current = prev[contractId];
      if (!current) return prev;

      return {
        ...prev,
        [contractId]: {
          ...current,
          [field]: userId,
          assignmentApiStatus: current.assignmentApiStatus === 'loading' ? 'loading' : 'idle',
          assignmentApiError: null,
        },
      };
    });
  }, []);

  const applyRoleTemplateToAll = useCallback(() => {
    if (!bulkEditorUserId || !bulkApproverUserId) {
      toast({
        title: "Choose both roles",
        description: "Select a default editor and approver before applying the template.",
        variant: "destructive",
      });
      return;
    }

    setRoleAssignments(prev => {
      const entries = Object.entries(prev);
      if (entries.length === 0) return prev;

      return entries.reduce<typeof prev>((next, [contractId, assignment]) => {
        next[contractId] = {
          ...assignment,
          editorUserId: bulkEditorUserId,
          approverUserId: bulkApproverUserId,
          assignmentApiStatus: assignment.assignmentApiStatus === 'loading' ? 'loading' : 'idle',
          assignmentApiError: null,
        };
      return next;
      }, {});
    });

    const template = { editorUserId: bulkEditorUserId, approverUserId: bulkApproverUserId };
    setSavedRoleTemplate(template);
    if (roleTemplateStorageKey) {
      localStorage.setItem(roleTemplateStorageKey, JSON.stringify(template));
    }

    toast({
      title: "Role template applied",
      description: `Copied roles to ${assignmentStats.total} uploaded contract${assignmentStats.total === 1 ? "" : "s"} and saved this default.`,
    });
  }, [bulkEditorUserId, bulkApproverUserId, assignmentStats.total, roleTemplateStorageKey]);

  const countPdfPages = useCallback(async (file: File): Promise<number> => {
    if (!file.type.includes('pdf')) return 1;
    try {
      const pdfjs = await loadPdfJs();
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjs.getDocument(arrayBuffer).promise;
      return pdf.numPages;
    } catch (error) {
      console.error('Error counting PDF pages:', error);
      toast({ 
        title: "Warning", 
        description: `Could not count pages for ${file.name}. Assuming 1 page.`, 
        variant: "default" 
      });
      return 1;
    }
  }, []);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0 || uploading || sessionStatus !== 'idle') return;
    setError(null); 
    setSessionStatus("counting_pages");
    toast({
      title:"Processing files...", 
      description: "Counting pages..."
    });
    
    const filesWithDetails: FileWithDetails[] = [];
    const currentFileNames = new Set(files.map(f => f.name));

    for (const file of acceptedFiles) {
      if (currentFileNames.has(file.name)) continue;

      const pageCount = await countPdfPages(file);
      filesWithDetails.push(Object.assign(file, {
        preview: URL.createObjectURL(file),
        pageCount
      }));
    }

    setFiles(prev => [...prev, ...filesWithDetails]);
    setSessionStatus("idle");

    if(filesWithDetails.length !== acceptedFiles.length) {
      toast({ 
        title: "Duplicate Files Skipped", 
        description: "Some selected files were already in the list.", 
        variant: "default" 
      });
    }
  }, [uploading, countPdfPages, files, sessionStatus]);

  const handleUpload = useCallback(async () => {
    if (files.length === 0 || !apiUrl) return;

    setUploading(true); 
    setSessionStatus("uploading"); 
    setError(null);
    const initialProgress = files.reduce((acc, file) => ({ ...acc, [file.name]: 0 }), {});
    setUploadProgress(initialProgress);
    setRoleAssignments({});

    const uploadPromises = files.map(file => {
      return new Promise<{ fileName: string; success: boolean; data?: any; error?: string }>((resolve) => {
        const currentFileName = file.name;
        setUploadProgress(prev => ({ ...prev, [currentFileName]: 0 }));

        try {
          const formData = new FormData();
          formData.append("file", file);
          formData.append("page_count", (file.pageCount || 1).toString());

          let uploadUrl = `${apiUrl}/upload/`;
          const params = new URLSearchParams();
          if (selectedAccountId && selectedAccountId !== 'personal') {
              params.set("owner_team_id", selectedAccountId);
          }
          if (projectId) {
              params.set("project_id", projectId);
          }
          const query = params.toString();
          if (query) {
              uploadUrl += `?${query}`;
          }

          apiUploadWithProgress(uploadUrl, formData, {
            onProgress: ({ percent }) => {
              setUploadProgress(prev => ({ ...prev, [currentFileName]: percent }));
            },
          }).then((result) => {
            setUploadProgress(prev => ({ ...prev, [currentFileName]: result.error ? -1 : 100 }));
            resolve({
              fileName: currentFileName,
              success: !result.error,
              data: result.data,
              error: result.error,
            });
          });
        } catch (fileError: any) {
          console.error(`Error preparing upload for ${currentFileName}:`, fileError);
          setUploadProgress(prev => ({ ...prev, [currentFileName]: -1 }));
          resolve({ 
            fileName: currentFileName, 
            success: false, 
            error: fileError.message || 'Preparation failed' 
          });
        }
      });
    });

    try {
      const results = await Promise.all(uploadPromises);
      const successfulUploads = results.filter(r => r.success && r.data?.contract_id);
      const failedUploads = results.filter(r => !r.success || !r.data?.contract_id);
      const defaultEditorUserId = bulkEditorUserId ?? savedRoleTemplate?.editorUserId ?? null;
      const defaultApproverUserId = bulkApproverUserId ?? savedRoleTemplate?.approverUserId ?? null;

      const finalAssignments: typeof roleAssignments = {};
      const finalFiles: FileWithDetails[] = files.map(f => {
        const result = results.find(r => r.fileName === f.name);
        if (!result) return { 
          ...f,
          uploadResult: {
            fileName: f.name,
            status: 'error',
            message: 'Upload result missing'
          }
        };

        if(result.success && result.data?.contract_id) {
          const contractId = result.data.contract_id;
          finalAssignments[contractId] = {
            fileName: result.fileName,
            editorUserId: defaultEditorUserId,
            approverUserId: defaultApproverUserId,
            assignmentApiStatus: 'idle',
            assignmentApiError: null
          };
          return {
            ...f,
            uploadResult: {
              contractId: contractId,
              fileName: f.name,
              status: 'success'
            }
          };
        } else {
          return {
            ...f,
            uploadResult: {
              fileName: f.name,
              status: 'error',
              message: result.error || 'Upload failed'
            }
          };
        }
      });

      setFiles(finalFiles);
      setRoleAssignments(finalAssignments);

      if (failedUploads.length > 0) {
        const errorMessages = failedUploads.map(f => `${f.fileName}: ${f.error}`).join('; ');
        setError(`Some uploads failed. ${successfulUploads.length > 0 ? 'You can assign roles for successful ones.' : ''}`);
        setSessionStatus("complete_with_errors");
        toast({
          title: "Some Uploads Failed",
          description: "Check file list for details.",
          variant: "destructive"
        });
      } else {
        setSessionStatus(selectedAccountId !== 'personal' ? "awaiting_assignment" : "complete_success");
        toast({
          title:"Upload Complete",
          description: selectedAccountId !== 'personal' ?
            `Ready to assign roles for ${successfulUploads.length} file(s).` :
            `${successfulUploads.length} file(s) processed.`
        });
        if (selectedAccountId === 'personal' && onUploadSuccess) onUploadSuccess();
      }

    } catch (err) {
      console.error("Upload process error:", err);
      setError("An unexpected error occurred during the upload process.");
      setSessionStatus("error");
      toast({
        title: "Upload Failed",
        variant: "destructive"
      });
    } finally {
      setUploading(false);

    }
  }, [files, apiUrl, selectedAccountId, projectId, onUploadSuccess, bulkEditorUserId, bulkApproverUserId, savedRoleTemplate]);

  const removeFile = (fileName: string) => {
    setFiles(prev => prev.filter(file => file.name !== fileName));
    setUploadProgress(prev => {
      const n = {...prev};
      delete n[fileName];
      return n;
    });
    const fileToRemove = files.find(f => f.name === fileName);
    const contractIdToRemove = fileToRemove?.uploadResult?.status === 'success' ?
      fileToRemove.uploadResult.contractId :
      undefined;
    if (contractIdToRemove) {
      setRoleAssignments(prev => {
        const n = {...prev};
        delete n[contractIdToRemove];
        return n;
      });
    }
  };

 const handleClose = () => {
    if (uploading && !window.confirm("Uploads are in progress. Are you sure you want to cancel?")) {
      return;
    }

    const isSuccess = sessionStatus === 'complete_success' ||
      (isProAccountContext && allAssignmentsSuccessfulOrNotNeeded);

    if (isSuccess && onUploadSuccess) {
      onUploadSuccess();
    }

    onClose();
  };

  const handleAssignRoles = useCallback(async (contractId: string, options?: { quiet?: boolean }) => {
    const assignment = roleAssignments[contractId];
    if (!assignment || !apiUrl) {
      if (!options?.quiet) {
        toast({
          title: "Error",
          description: "Cannot assign roles. Missing data.",
          variant: "destructive"
        });
      }
      return false;
    }
    if (!assignment.editorUserId || !assignment.approverUserId) {
      if (!options?.quiet) {
        toast({
          title: "Selection Required",
          description: "Please select both editor and approver.",
          variant: "destructive"
        });
      }
      return false;
    }

    setRoleAssignments(prev => ({
      ...prev,
      [contractId]: {
        ...prev[contractId],
        assignmentApiStatus: 'loading',
        assignmentApiError: null
      }
    }));

    try {
      const payload: AssignWorkflowRolesRequest = {
        editorUserId: assignment.editorUserId,
        approverUserId: assignment.approverUserId
      };
      const response = await apiFetch(`${apiUrl}/contracts/${contractId}/roles`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.detail || `Failed (${response.status})`);

      setRoleAssignments(prev => ({
        ...prev,
        [contractId]: {
          ...prev[contractId],
          assignmentApiStatus: 'success'
        }
      }));
      if (!options?.quiet) {
        toast({
          title: "Roles assigned",
          description: `Workflow roles updated for ${assignment.fileName}`
        });
      }
      return true;
    } catch (err: any) {
      setRoleAssignments(prev => ({
        ...prev,
        [contractId]: {
          ...prev[contractId],
          assignmentApiStatus: 'error',
          assignmentApiError: err.message
        }
      }));
      if (!options?.quiet) {
        toast({
          title: "Assignment failed",
          description: err.message,
          variant: "destructive"
        });
      }
      console.error(`Error assigning roles for ${contractId}:`, err);
      return false;
    }
  }, [roleAssignments, apiUrl]);

  const handleAssignAllRoles = useCallback(async () => {
    const pendingEntries = Object.entries(roleAssignments).filter(
      ([, assignment]) => assignment.assignmentApiStatus !== 'success'
    );
    const incompleteEntries = pendingEntries.filter(
      ([, assignment]) => !assignment.editorUserId || !assignment.approverUserId
    );

    if (pendingEntries.length === 0) return;

    if (incompleteEntries.length > 0) {
      toast({
        title: "Roles missing",
        description: `Select editor and approver for ${incompleteEntries.length} contract${incompleteEntries.length === 1 ? "" : "s"} before saving.`,
        variant: "destructive",
      });
      return;
    }

    let successCount = 0;
    for (const [contractId] of pendingEntries) {
      const succeeded = await handleAssignRoles(contractId, { quiet: true });
      if (succeeded) successCount += 1;
    }

    if (successCount > 0 && bulkEditorUserId && bulkApproverUserId) {
      const template = { editorUserId: bulkEditorUserId, approverUserId: bulkApproverUserId };
      setSavedRoleTemplate(template);
      if (roleTemplateStorageKey) {
        localStorage.setItem(roleTemplateStorageKey, JSON.stringify(template));
      }
    }

    toast({
      title: successCount === pendingEntries.length ? "Roles assigned" : "Some roles need attention",
      description: `${successCount} of ${pendingEntries.length} contract${pendingEntries.length === 1 ? "" : "s"} updated.`,
      variant: successCount === pendingEntries.length ? "default" : "destructive",
    });
  }, [roleAssignments, handleAssignRoles, bulkEditorUserId, bulkApproverUserId, roleTemplateStorageKey]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop, 
    multiple: true, 
    accept: { 
      'application/pdf': ['.pdf'], 
    }, 
    maxSize: 50 * 1024 * 1024, 
    disabled: uploading || 
      sessionStatus === 'awaiting_assignment' || 
      sessionStatus === 'complete_success' || 
      sessionStatus === 'complete_with_errors' 
  });

  const canUpload = files.length > 0 && !uploading && sessionStatus === 'idle';
  const showRoleAssignmentPanel = !uploading &&
    isProAccountContext &&
    (sessionStatus === 'awaiting_assignment' || sessionStatus === 'complete_with_errors') &&
    roleAssignmentEntries.length > 0;
  const showPreUploadRoleDefaults = !uploading &&
    isProAccountContext &&
    !showRoleAssignmentPanel &&
    (sessionStatus === 'idle' || sessionStatus === 'counting_pages') &&
    accountMembers.length > 0;
  const canApplyRoleTemplate = !!bulkEditorUserId &&
    !!bulkApproverUserId &&
    roleAssignmentEntries.length > 0 &&
    assignmentStats.loading === 0;
  const canSaveAllRoles = assignmentStats.readyToSave > 0 && assignmentStats.loading === 0;
  const savedTemplateLabel = useMemo(() => {
    if (!savedRoleTemplate || accountMembers.length === 0) return null;
    const editorName = accountMembers.find(member => member.id === savedRoleTemplate.editorUserId)?.name;
    const approverName = accountMembers.find(member => member.id === savedRoleTemplate.approverUserId)?.name;
    if (!editorName || !approverName) return null;
    return `${editorName} -> ${approverName}`;
  }, [savedRoleTemplate, accountMembers]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent className="flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-[760px] flex-col gap-0 overflow-hidden border-gray-200 bg-white p-0 shadow-2xl sm:max-h-[86vh] sm:rounded-2xl">
        <div className="flex-none border-b border-gray-100 px-4 py-3.5 sm:px-5">
          <div className="flex flex-col gap-3 pr-8 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-8 w-8 flex-none items-center justify-center rounded-full border border-gray-200 bg-white text-gray-900 shadow-sm">
                <Sparkles className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-sm font-semibold leading-5 text-gray-800">
                  Upload documents
                </DialogTitle>
                <DialogDescription className="mt-0.5 max-w-xl text-xs leading-5 text-gray-500">
                  {showRoleAssignmentPanel
                    ? "Set workflow roles for the uploaded contracts."
                    : "Add PDFs and keep role defaults ready for this batch."}
                </DialogDescription>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="inline-flex h-7 items-center rounded-full border border-gray-200 bg-white px-2.5 font-medium text-gray-700 shadow-sm">
                {userCredits ?? 'N/A'} credits
              </span>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] leading-5 text-gray-500">
            <span className="inline-flex items-center gap-1.5">
              <Files className="h-3.5 w-3.5" />
              {files.length} file{files.length === 1 ? "" : "s"}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              {files.length > 0 ? totalPages : 0} page{totalPages === 1 ? "" : "s"}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <UploadCloud className="h-3.5 w-3.5" />
              {files.length > 0 ? `${uploadedCount}/${files.length}` : "0"} uploaded
            </span>
            {isProAccountContext && (
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5" />
                {showRoleAssignmentPanel ? `${assignmentStats.completed}/${assignmentStats.total} roles saved` : "roles after upload"}
              </span>
            )}
          </div>
        </div>

        <div className="flex-grow space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
          {showPreUploadRoleDefaults && (
            <div className="rounded-2xl border border-gray-200 bg-white px-3 py-3 shadow-sm">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-gray-400">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Default roles
                  </div>
                  <p className="mt-1 text-xs leading-5 text-gray-500">
                    These roles will be applied to every contract in this upload.
                  </p>
                  {savedTemplateLabel && (
                    <p className="mt-1 text-[10px] leading-4 text-gray-400">
                      Last used: {savedTemplateLabel}
                    </p>
                  )}
                </div>
                <div className="grid min-w-0 flex-[1.4] grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="pre-upload-editor" className="text-[10px] font-medium uppercase tracking-[0.08em] text-gray-400">
                      Editor
                    </Label>
                    <Select
                      value={bulkEditorUserId ?? "none"}
                      onValueChange={(value) => setBulkEditorUserId(value === "none" ? null : value)}
                    >
                      <SelectTrigger id="pre-upload-editor" className="h-8 rounded-full border-gray-200 bg-gray-50 px-3 text-xs text-gray-700 shadow-none">
                        <SelectValue placeholder="Choose editor" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {accountMembers.map(member => (
                          <SelectItem key={member.id} value={member.id}>
                            {member.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="pre-upload-approver" className="text-[10px] font-medium uppercase tracking-[0.08em] text-gray-400">
                      Approver
                    </Label>
                    <Select
                      value={bulkApproverUserId ?? "none"}
                      onValueChange={(value) => setBulkApproverUserId(value === "none" ? null : value)}
                    >
                      <SelectTrigger id="pre-upload-approver" className="h-8 rounded-full border-gray-200 bg-gray-50 px-3 text-xs text-gray-700 shadow-none">
                        <SelectValue placeholder="Choose approver" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {accountMembers.map(member => (
                          <SelectItem key={member.id} value={member.id}>
                            {member.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </div>
          )}

          {(sessionStatus === 'idle' || sessionStatus === 'counting_pages') && (
            <div
              {...getRootProps()}
              data-cy="file-dropzone"
              className={`rounded-2xl border p-3 shadow-sm transition-colors duration-200 ease-in-out
                ${isDragActive ? "border-gray-900 bg-gray-50 ring-2 ring-gray-100" : "border-gray-300 bg-white hover:border-gray-400"}
                ${uploading ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
              <input {...getInputProps()} />
              <div className="flex flex-col items-center justify-center gap-3 rounded-xl bg-gray-50 px-4 py-6 text-center sm:flex-row sm:justify-start sm:text-left">
                <div className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 shadow-sm">
                  <UploadCloud className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold leading-6 text-gray-900">
                    {isDragActive ? "Drop PDFs to add them" : "Drag PDFs here or browse"}
                  </p>
                  <p className="text-xs leading-5 text-gray-500">
                    PDF files up to 50 MB. Page counts are checked before upload.
                  </p>
                </div>
                <span className="pointer-events-none inline-flex h-8 items-center justify-center rounded-full border border-gray-200 bg-white px-3 text-xs font-medium text-gray-600 shadow-sm">
                  Browse
                </span>
              </div>
            </div>
          )}

          {error && (sessionStatus === 'error' || sessionStatus === 'complete_with_errors') && !uploading && (
            <div className="flex items-start rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">
              <AlertCircle className="h-5 w-5 mt-0.5 mr-2 flex-shrink-0" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {files.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-gray-400">
                  <Files className="h-3.5 w-3.5" />
                  <h3>
                    Files
                  </h3>
                </div>
                <div className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">
                  {failedUploadCount > 0 ? `${failedUploadCount} failed` : `${files.length} selected`}
                </div>
              </div>

              <div className="divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white shadow-sm">
                {files.map((file) => {
                  const progress = uploadProgress[file.name];
                  const fileUploadResult = file.uploadResult;
                  const hasUploadError = fileUploadResult?.status === 'error';
                  const contractId = fileUploadResult?.status === 'success' ? fileUploadResult.contractId : undefined;
                  const assignment = contractId ? roleAssignments[contractId] : undefined;
                  const isUploaded = fileUploadResult?.status === 'success';
                  const isComplete = isUploaded && (!assignment || assignment.assignmentApiStatus === 'success' || !isProAccountContext);

                  return (
                    <div
                      key={`${file.name}-${file.size}-${file.lastModified}`}
                      className="px-3 py-2.5 transition-colors duration-150"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center space-x-3 min-w-0 flex-1">
                          <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border ${
                            hasUploadError
                              ? 'border-red-200 bg-red-50'
                              : isComplete
                                ? 'border-green-200 bg-green-50'
                                : 'border-gray-200 bg-gray-50'
                          }`}>
                            <FileText className={`h-5 w-5 ${
                              hasUploadError
                                ? 'text-red-500'
                                : isComplete
                                  ? 'text-green-600'
                                  : 'text-gray-500'
                            }`} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium leading-6 text-gray-900" title={file.name}>
                              {file.name}
                            </p>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] leading-4 text-gray-500">
                              <span>{file.pageCount || '?'} page(s)</span>
                              {fileUploadResult?.status === 'success' && <span>Uploaded</span>}
                              {assignment?.assignmentApiStatus === 'success' && <span>Roles assigned</span>}
                            </div>
                          </div>
                        </div>
                        <div className="flex-shrink-0">
                          {sessionStatus === 'uploading' && progress < 100 && progress >= 0 && (
                            <span className="text-xs font-medium text-gray-700">{progress}%</span>
                          )}
                          {sessionStatus !== 'uploading' && fileUploadResult?.status === 'success' && (
                            <CheckCircle className="h-5 w-5 text-green-500" />
                          )}
                          {hasUploadError && <XCircle className="h-5 w-5 text-red-500" />}
                          {!uploading && 
                            sessionStatus !== 'awaiting_assignment' && 
                            sessionStatus !== 'complete_success' && 
                            sessionStatus !== 'complete_with_errors' && (
                            <button 
                              onClick={(e) => {
                                e.stopPropagation(); 
                                removeFile(file.name);
                              }} 
                              className="text-gray-400 hover:text-red-500 transition-colors" 
                              title="Remove file"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                      {sessionStatus === 'uploading' && progress >= 0 && !hasUploadError && (
                        <div className="mt-2">
                          <Progress value={progress} className="h-1.5" />
                        </div>
                      )}
                      {hasUploadError && (
                        <p className="mt-1 text-xs text-red-600">
                          Upload failed: {fileUploadResult.message}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {showRoleAssignmentPanel && (
            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-gray-100 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 shadow-sm">
                    <Users className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold leading-5 text-gray-800">Workflow roles</h3>
                    <p className="text-xs leading-5 text-gray-500">
                      {assignmentStats.completed} of {assignmentStats.total} contract{assignmentStats.total === 1 ? "" : "s"} assigned
                    </p>
                  </div>
                </div>
                <div className="inline-flex w-fit items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">
                  {assignmentStats.errored > 0
                    ? `${assignmentStats.errored} need retry`
                    : assignmentStats.completed === assignmentStats.total
                      ? "Ready"
                      : "Roles required"}
                </div>
              </div>

              <div>
                {isLoadingMembers && (
                  <div className="flex items-center px-4 py-5 text-sm text-gray-600">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Loading team members...
                  </div>
                )}

                {memberFetchError && !isLoadingMembers && (
                  <div className="m-4 flex items-start rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    <AlertCircle className="mr-2 mt-0.5 h-4 w-4 flex-shrink-0" />
                    <span>{memberFetchError}</span>
                  </div>
                )}

                {!isLoadingMembers && !memberFetchError && accountMembers.length === 0 && (
                  <div className="px-4 py-5 text-sm text-gray-600">
                    No team members are available for role assignment.
                  </div>
                )}

                {!isLoadingMembers && !memberFetchError && accountMembers.length > 0 && (
                  <>
                    <div className="border-b border-gray-100 px-3 py-3">
                      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] lg:items-end">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-gray-400">
                            <Copy className="h-3.5 w-3.5" />
                            <div>Default roles</div>
                          </div>
                          <p className="mt-1 text-xs leading-5 text-gray-500">
                            Set once, apply across this batch, and reuse next time.
                          </p>
                          {savedTemplateLabel && (
                            <p className="mt-1 text-[10px] leading-4 text-gray-400">
                              Last default: {savedTemplateLabel}
                            </p>
                          )}
                        </div>
                        <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
                          <div className="space-y-1">
                            <Label htmlFor="bulk-editor" className="text-[10px] font-medium uppercase tracking-[0.08em] text-gray-400">
                              Editor
                            </Label>
                            <Select
                              value={bulkEditorUserId ?? "none"}
                              onValueChange={(value) => setBulkEditorUserId(value === "none" ? null : value)}
                              disabled={assignmentStats.loading > 0}
                            >
                              <SelectTrigger id="bulk-editor" className="h-8 rounded-full border-gray-200 bg-gray-50 px-3 text-xs text-gray-700 shadow-none">
                                <SelectValue placeholder="Select editor" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">None</SelectItem>
                                {accountMembers.map(member => (
                                  <SelectItem key={member.id} value={member.id}>
                                    {member.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor="bulk-approver" className="text-[10px] font-medium uppercase tracking-[0.08em] text-gray-400">
                              Approver
                            </Label>
                            <Select
                              value={bulkApproverUserId ?? "none"}
                              onValueChange={(value) => setBulkApproverUserId(value === "none" ? null : value)}
                              disabled={assignmentStats.loading > 0}
                            >
                              <SelectTrigger id="bulk-approver" className="h-8 rounded-full border-gray-200 bg-gray-50 px-3 text-xs text-gray-700 shadow-none">
                                <SelectValue placeholder="Select approver" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">None</SelectItem>
                                {accountMembers.map(member => (
                                  <SelectItem key={member.id} value={member.id}>
                                    {member.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-8 rounded-full border-gray-200 bg-white px-3 text-xs text-gray-600 shadow-none hover:bg-gray-50"
                          onClick={applyRoleTemplateToAll}
                          disabled={!canApplyRoleTemplate}
                        >
                          <Copy className="mr-1.5 h-3.5 w-3.5" />
                          Apply to all
                        </Button>
                      </div>
                    </div>

                    <div className="divide-y divide-gray-100">
                      {roleAssignmentEntries.map(([contractId, assignment], index) => {
                        const rolesSelected = !!assignment.editorUserId && !!assignment.approverUserId;
                        const isRowLoading = assignment.assignmentApiStatus === 'loading';
                        const isRowComplete = assignment.assignmentApiStatus === 'success';
                        const isRowDisabled = isRowLoading || isRowComplete;

                        return (
                          <div
                            key={contractId}
                            className={`px-4 py-3 ${
                              assignment.assignmentApiStatus === 'error'
                                ? 'bg-red-50/60'
                                : isRowComplete
                                  ? 'bg-green-50/40'
                                  : 'bg-white'
                            }`}
                          >
                            <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="flex h-5 min-w-5 flex-none items-center justify-center rounded-full bg-gray-100 px-1.5 text-[10px] font-semibold text-gray-500">
                                    {index + 1}
                                  </span>
                                  <p className="truncate text-sm font-medium leading-6 text-gray-900" title={assignment.fileName}>
                                    {assignment.fileName}
                                  </p>
                                </div>
                                <p className="text-[10px] leading-4 text-gray-500">
                                  {isRowComplete ? "Roles saved" : rolesSelected ? "Ready to save" : "Choose editor and approver"}
                                </p>
                              </div>

                              <div className="space-y-1">
                                <Label htmlFor={`editor-${contractId}`} className="text-[10px] font-medium uppercase tracking-[0.08em] text-gray-400">
                                  Editor
                                </Label>
                                <Select
                                  value={assignment.editorUserId ?? "none"}
                                  onValueChange={(value) => updateRoleAssignment(contractId, 'editorUserId', value === 'none' ? null : value)}
                                  disabled={isRowDisabled}
                                >
                                  <SelectTrigger
                                    data-cy="editor-select-trigger"
                                    id={`editor-${contractId}`}
                                    className="h-8 rounded-full border-gray-200 bg-white px-3 text-xs text-gray-700 shadow-none"
                                  >
                                    <SelectValue placeholder="Select editor" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">None</SelectItem>
                                    {accountMembers.map(member => (
                                      <SelectItem key={member.id} value={member.id}>
                                        {member.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>

                              <div className="space-y-1">
                                <Label htmlFor={`approver-${contractId}`} className="text-[10px] font-medium uppercase tracking-[0.08em] text-gray-400">
                                  Approver
                                </Label>
                                <Select
                                  value={assignment.approverUserId ?? "none"}
                                  onValueChange={(value) => updateRoleAssignment(contractId, 'approverUserId', value === 'none' ? null : value)}
                                  disabled={isRowDisabled}
                                >
                                  <SelectTrigger
                                    data-cy="approver-select-trigger"
                                    id={`approver-${contractId}`}
                                    className="h-8 rounded-full border-gray-200 bg-white px-3 text-xs text-gray-700 shadow-none"
                                  >
                                    <SelectValue placeholder="Select approver" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">None</SelectItem>
                                    {accountMembers.map(member => (
                                      <SelectItem key={member.id} value={member.id}>
                                        {member.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>

                              <Button
                                data-cy="assign-roles-button"
                                type="button"
                                size="sm"
                                variant={isRowComplete ? "outline" : "default"}
                                className={isRowComplete ? "h-8 rounded-full border-gray-200 bg-white px-3 text-xs text-gray-600 shadow-none" : "h-8 rounded-[10px] bg-gradient-to-b from-neutral-700 to-black px-3 text-xs text-white hover:from-neutral-800 hover:to-black"}
                                onClick={() => handleAssignRoles(contractId)}
                                disabled={isRowDisabled || !rolesSelected}
                                title={rolesSelected ? "Save selected roles" : "Select both roles first"}
                              >
                                {isRowLoading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                                {isRowComplete && <CheckCircle className="mr-1.5 h-3.5 w-3.5 text-green-600" />}
                                {assignment.assignmentApiStatus === 'error' && <XCircle className="mr-1.5 h-3.5 w-3.5 text-red-500" />}
                                {isRowComplete ? "Saved" : isRowLoading ? "Saving" : assignment.assignmentApiStatus === 'error' ? "Retry" : "Save"}
                              </Button>
                            </div>

                            {assignment.assignmentApiStatus === 'error' && assignment.assignmentApiError && (
                              <p className="mt-2 text-xs text-red-600">
                                {assignment.assignmentApiError}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="mt-auto flex flex-none flex-col gap-3 border-t border-gray-100 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="text-[11px] leading-4 text-gray-500">
            {uploading
              ? "Uploading files..."
              : showRoleAssignmentPanel
                ? `${assignmentStats.completed}/${assignmentStats.total} workflow assignments saved`
                : files.length > 0
                  ? `${files.length} file${files.length === 1 ? "" : "s"} ready`
                  : "PDF uploads only"}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              onClick={handleClose}
              data-cy="modal-done-button"
              className="h-8 rounded-full border-gray-200 px-3 text-xs text-gray-600 shadow-none hover:bg-gray-50"
            >
              {(sessionStatus === 'complete_success' || (isProAccountContext && allAssignmentsSuccessfulOrNotNeeded)) ? 'Done' : 'Cancel'}
            </Button>
            {(sessionStatus === 'idle' || sessionStatus === 'counting_pages') && (
              <Button
                onClick={handleUpload}
                data-cy="modal-upload-button"
                disabled={!canUpload}
                className="h-8 min-w-[120px] rounded-[10px] bg-gradient-to-b from-neutral-700 to-black px-3 text-xs text-white hover:from-neutral-800 hover:to-black"
              >
                {uploading ? (
                  <span className="flex items-center justify-center">
                    <Loader2 className="-ml-1 mr-1.5 h-3.5 w-3.5 animate-spin text-white" />
                    Uploading
                  </span>
                ) : sessionStatus === 'counting_pages' ? (
                  "Checking pages"
                ) : (
                  `Upload ${files.length} file${files.length === 1 ? "" : "s"}`
                )}
              </Button>
            )}
            {showRoleAssignmentPanel && (
              <Button
                type="button"
                onClick={handleAssignAllRoles}
                disabled={!canSaveAllRoles}
                className="h-8 min-w-[120px] rounded-[10px] bg-gradient-to-b from-neutral-700 to-black px-3 text-xs text-white hover:from-neutral-800 hover:to-black"
              >
                {assignmentStats.loading > 0 ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Saving roles
                  </>
                ) : (
                  <>
                    <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
                    Save all roles
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default FileUploadModal;
