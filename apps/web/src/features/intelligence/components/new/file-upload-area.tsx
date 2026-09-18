import React, { useState, useCallback, useEffect, useMemo } from "react"
import { useDropzone } from "react-dropzone"
import {
  AlertCircle,
  CheckCircle,
  FileText,
  Loader2,
  Trash2,
  UploadCloud,
  X,
  Coins,
  Save,
  Users,
} from "lucide-react"
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@cs/components/ui/dialog"

import { Button } from "@cs/components/ui/button"
import { useAccountContext } from '@cs/app/context/AccountContext'
import { toast } from "@cs/hooks/use-toast"
import { Label } from "@cs/components/ui/label"
import { apiFetch, apiUploadWithProgress } from "@cs/lib/apiClient"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@cs/components/ui/select"

type PdfJsModule = typeof import("pdfjs-v4")
let pdfjsLoader: Promise<PdfJsModule> | null = null
function loadPdfJs() {
  if (!pdfjsLoader) {
    pdfjsLoader = import("pdfjs-v4").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-v4/build/pdf.worker.min.mjs", import.meta.url).toString()
      return pdfjs
    })
  }
  return pdfjsLoader
}

interface FileWithDetails extends File {
  preview?: string
  pageCount?: number
  uploadResult?: { contractId: string; fileName: string; status: 'success' } | { fileName: string; status: 'error'; message: string }
}

interface AccountMember { id: string; name: string }

interface ContractRoles {
  editorUserId: string | null
  approverUserId: string | null
  status: 'pending' | 'saving' | 'done' | 'error'
  error?: string
  fileName?: string
}

interface FileUploadModalProps {
  isOpen: boolean
  onClose: () => void
  onUploadSuccess?: () => void
  userCredits: number
  projectId?: string | null
}

interface RoleTemplate { editorUserId: string; approverUserId: string }

type SessionStatus = "idle" | "counting_pages" | "uploading" | "assigning" | "complete_success" | "error" | "complete_with_errors"

export function FileUploadModal({ isOpen, onClose, onUploadSuccess, userCredits, projectId }: FileUploadModalProps) {
  const [files, setFiles] = useState<FileWithDetails[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({})
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>("idle")
  const [totalPages, setTotalPages] = useState(0)
  const [accountMembers, setAccountMembers] = useState<AccountMember[]>([])
  const [isLoadingMembers, setIsLoadingMembers] = useState(false)
  const [bulkEditorUserId, setBulkEditorUserId] = useState<string | null>(null)
  const [bulkApproverUserId, setBulkApproverUserId] = useState<string | null>(null)
  const [savedRoleTemplate, setSavedRoleTemplate] = useState<RoleTemplate | null>(null)
  const [contractRoles, setContractRoles] = useState<Record<string, ContractRoles>>({})
  const [showRolePanel, setShowRolePanel] = useState(false)
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null)
  const [roleValidationMessage, setRoleValidationMessage] = useState<string | null>(null)

  const { selectedAccountId } = useAccountContext()
  const apiUrl = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL
  const isProAccount = selectedAccountId !== 'personal'

  const roleTemplateKey = useMemo(
    () => isProAccount ? `contract-upload-role-template:${selectedAccountId}` : null,
    [selectedAccountId, isProAccount]
  )

  useEffect(() => {
    if (!isOpen) {
      setFiles([]); setError(null); setUploadProgress({}); setSessionStatus("idle")
      setTotalPages(0); setUploading(false); setAccountMembers([]); setIsLoadingMembers(false)
      setBulkEditorUserId(null); setBulkApproverUserId(null); setSavedRoleTemplate(null)
      setContractRoles({}); setShowRolePanel(false); setOpenDropdownId(null)
      setRoleValidationMessage(null)
    }
  }, [isOpen])

  useEffect(() => { setTotalPages(files.reduce((s, f) => s + (f.pageCount || 1), 0)) }, [files])
  useEffect(() => { return () => { files.forEach(f => { if (f.preview) URL.revokeObjectURL(f.preview) }) } }, [files])

  useEffect(() => {
    if (!isOpen || !roleTemplateKey) { setSavedRoleTemplate(null); return }
    try {
      const stored = localStorage.getItem(roleTemplateKey)
      if (stored) {
        const p = JSON.parse(stored) as RoleTemplate
        if (p?.editorUserId && p?.approverUserId) setSavedRoleTemplate(p)
      }
    } catch { setSavedRoleTemplate(null) }
  }, [isOpen, roleTemplateKey])

  useEffect(() => {
    if (!isOpen || !isProAccount || !apiUrl) return
    let cancelled = false
    setIsLoadingMembers(true)
    apiFetch(`${apiUrl}/teams/${selectedAccountId}`)
      .then(r => r.json())
      .then(d => { if (!cancelled && d?.members) setAccountMembers(d.members.map((m: any) => ({ id: m.userId, name: m.username || m.email || m.userId })).sort((a: AccountMember, b: AccountMember) => a.name.localeCompare(b.name))) })
      .catch(() => { if (!cancelled) setAccountMembers([]) })
      .finally(() => { if (!cancelled) setIsLoadingMembers(false) })
    return () => { cancelled = true }
  }, [isOpen, selectedAccountId, apiUrl, isProAccount])

  useEffect(() => {
    if (!savedRoleTemplate || accountMembers.length === 0 || bulkEditorUserId || bulkApproverUserId) return
    if (accountMembers.some(m => m.id === savedRoleTemplate.editorUserId) && accountMembers.some(m => m.id === savedRoleTemplate.approverUserId)) {
      setBulkEditorUserId(savedRoleTemplate.editorUserId)
      setBulkApproverUserId(savedRoleTemplate.approverUserId)
    }
  }, [savedRoleTemplate, accountMembers, bulkEditorUserId, bulkApproverUserId])

  const countPdfPages = useCallback(async (file: File): Promise<number> => {
    if (!file.type.includes('pdf')) return 1
    try { const pdfjs = await loadPdfJs(); return (await pdfjs.getDocument(await file.arrayBuffer()).promise).numPages } catch { return 1 }
  }, [])

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0 || uploading || sessionStatus !== 'idle') return
    setError(null); setSessionStatus("counting_pages")
    const existing = new Set(files.map(f => f.name))
    const newFiles: FileWithDetails[] = []
    for (const file of acceptedFiles) {
      if (existing.has(file.name)) continue
      newFiles.push(Object.assign(file, { preview: URL.createObjectURL(file), pageCount: await countPdfPages(file) }))
    }
    setFiles(prev => [...prev, ...newFiles]); setSessionStatus("idle")
    if (newFiles.length !== acceptedFiles.length) toast({ title: "Duplicates skipped" })
  }, [uploading, sessionStatus, files, countPdfPages])

  const removeFile = (name: string) => {
    setFiles(prev => prev.filter(f => f.name !== name))
    setUploadProgress(prev => { const n = { ...prev }; delete n[name]; return n })
  }

  const handleUpload = useCallback(async () => {
    if (files.length === 0 || !apiUrl) return
    setUploading(true); setSessionStatus("uploading"); setError(null)
    setUploadProgress(files.reduce((a, f) => ({ ...a, [f.name]: 0 }), {}))

    const results = await Promise.all(files.map(file => {
      return new Promise<{ fileName: string; ok: boolean; data?: any; err?: string }>(resolve => {
        const fd = new FormData(); fd.append("file", file); fd.append("page_count", String(file.pageCount || 1))
        let url = `${apiUrl}/upload/`
        const p = new URLSearchParams()
        if (selectedAccountId && selectedAccountId !== 'personal') p.set("owner_team_id", selectedAccountId)
        if (projectId) p.set("project_id", projectId)
        const q = p.toString(); if (q) url += `?${q}`
        apiUploadWithProgress(url, fd, { onProgress: ({ percent }) => setUploadProgress(prev => ({ ...prev, [file.name]: percent })) })
          .then(r => { setUploadProgress(prev => ({ ...prev, [file.name]: r.error ? -1 : 100 })); resolve({ fileName: file.name, ok: !r.error, data: r.data, err: r.error }) })
      })
    }))

    const success = results.filter(r => r.ok && r.data?.contract_id)
    const failed = results.filter(r => !r.ok || !r.data?.contract_id)

    setFiles(prev => prev.map(f => {
      const r = results.find(x => x.fileName === f.name)
      if (!r) return f
      return r.ok && r.data?.contract_id
        ? { ...f, uploadResult: { contractId: r.data.contract_id, fileName: f.name, status: 'success' as const } }
        : { ...f, uploadResult: { fileName: f.name, status: 'error' as const, message: r.err || 'Failed' } }
    }))

    if (failed.length > 0) {
      setError(`${failed.length} file(s) failed.`); setSessionStatus("complete_with_errors")
      toast({ title: "Some uploads failed", variant: "destructive" }); setUploading(false); return
    }

    if (!isProAccount) {
      setSessionStatus("complete_success"); toast({ title: "Done", description: `${success.length} uploaded.` })
      if (onUploadSuccess) onUploadSuccess(); setUploading(false); return
    }

    // Pro account: initialize per-contract roles with bulk defaults, show role panel
    const defaultEditor = bulkEditorUserId ?? savedRoleTemplate?.editorUserId ?? null
    const defaultApprover = bulkApproverUserId ?? savedRoleTemplate?.approverUserId ?? null
    const roles: Record<string, ContractRoles> = {}
    for (const r of success) {
      roles[r.data.contract_id] = { editorUserId: defaultEditor, approverUserId: defaultApprover, status: 'pending', fileName: r.fileName }
    }
    setContractRoles(roles)
    setSessionStatus("assigning"); setShowRolePanel(true)
    toast({ title: "Uploaded", description: `Set roles for ${success.length} contract(s).` })
    setUploading(false)
  }, [files, apiUrl, selectedAccountId, projectId, isProAccount, bulkEditorUserId, bulkApproverUserId, savedRoleTemplate, onUploadSuccess])

  const updateContractRole = (contractId: string, field: 'editorUserId' | 'approverUserId', value: string | null) => {
    setRoleValidationMessage(null)
    setContractRoles(prev => ({
      ...prev,
      [contractId]: { ...prev[contractId], [field]: value, status: 'pending', error: undefined }
    }))
  }

  const applyBulkToAll = () => {
    if (!bulkEditorUserId || !bulkApproverUserId) {
      const message = "Select both an editor and an approver before applying roles."
      setRoleValidationMessage(message)
      toast({ title: "Select both roles first", description: message, variant: "destructive" }); return
    }
    setRoleValidationMessage(null)
    setContractRoles(prev => {
      const next = { ...prev }
      for (const id of Object.keys(next)) {
        next[id] = { ...next[id], editorUserId: bulkEditorUserId, approverUserId: bulkApproverUserId, status: 'pending', error: undefined }
      }
      return next
    })
    toast({ title: "Applied to all contracts" })
  }

  const saveAllRoles = useCallback(async () => {
    const entries = Object.entries(contractRoles).filter(([, r]) => r.status !== 'done')
    const incomplete = entries.filter(([, r]) => !r.editorUserId || !r.approverUserId)
    if (entries.length === 0) {
      const message = "There are no contracts waiting for role assignment."
      setRoleValidationMessage(message)
      toast({ title: "Nothing to save", description: message, variant: "destructive" })
      return
    }
    // A blank role is no longer a mistake: the contract inherits its project's
    // editor or approver. Only worth saying so, in case the project has none.
    if (incomplete.length > 0) {
      setRoleValidationMessage(
        `${incomplete.length} contract${incomplete.length === 1 ? "" : "s"} left a role blank — those inherit the project's roles.`,
      )
    } else {
      setRoleValidationMessage(null)
    }

    let ok = 0
    for (const [cid, roles] of entries) {
      if (!roles.editorUserId && !roles.approverUserId) {
        // Nothing to assign — the project's roles apply as they are.
        setContractRoles(prev => ({ ...prev, [cid]: { ...prev[cid], status: 'done' } }))
        ok++
        continue
      }
      setContractRoles(prev => ({ ...prev, [cid]: { ...prev[cid], status: 'saving' } }))
      try {
        const res = await apiFetch(`${apiUrl}/contracts/${cid}/roles`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ editorUserId: roles.editorUserId, approverUserId: roles.approverUserId })
        })
        if (!res.ok) {
          const detail = await res.json().catch(() => ({}))
          throw new Error(detail.detail || `Failed (${res.status})`)
        }
        setContractRoles(prev => ({ ...prev, [cid]: { ...prev[cid], status: 'done' } }))
        ok++
      } catch (e: any) {
        setContractRoles(prev => ({ ...prev, [cid]: { ...prev[cid], status: 'error', error: e.message } }))
      }
    }

    if (bulkEditorUserId && bulkApproverUserId && roleTemplateKey) {
      localStorage.setItem(roleTemplateKey, JSON.stringify({ editorUserId: bulkEditorUserId, approverUserId: bulkApproverUserId }))
    }

    const total = entries.length
    if (ok === total) {
      setSessionStatus("complete_success"); setShowRolePanel(false)
      toast({ title: "All roles assigned" })
      if (onUploadSuccess) onUploadSuccess()
    } else {
      toast({ title: `${ok}/${total} saved`, description: "Some failed — retry below.", variant: "destructive" })
    }
  }, [contractRoles, apiUrl, bulkEditorUserId, bulkApproverUserId, roleTemplateKey, onUploadSuccess])

  const handleClose = () => {
    if (uploading && !window.confirm("Uploads in progress. Cancel?")) return
    if ((sessionStatus === 'complete_success' || sessionStatus === 'complete_with_errors') && onUploadSuccess) onUploadSuccess()
    onClose()
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, multiple: true, accept: { 'application/pdf': ['.pdf'] }, maxSize: 50 * 1024 * 1024,
    disabled: uploading || sessionStatus === 'assigning' || sessionStatus === 'complete_success'
  })

  const insufficientCredits = files.length > 0 && totalPages > userCredits
  const canUpload = files.length > 0 && !uploading && sessionStatus === 'idle' && !insufficientCredits
  const isDone = sessionStatus === 'complete_success' || sessionStatus === 'complete_with_errors'
  const uploadedCount = files.filter(f => f.uploadResult?.status === 'success').length
  const allRolesDone = Object.values(contractRoles).every(r => r.status === 'done')
  const anySaving = Object.values(contractRoles).some(r => r.status === 'saving')
  const contractEntries = Object.entries(contractRoles)

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose() }}>
      <DialogContent className="flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-[600px] flex-col gap-0 overflow-hidden border-0 bg-card p-0 shadow-e3 sm:rounded-lg">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-surface-100 px-5 py-4">
          <div>
            <DialogTitle className="text-base font-semibold text-fg-950">Upload contracts</DialogTitle>
            <DialogDescription className="mt-0.5 text-xs text-fg-500">
              {sessionStatus === 'assigning' ? 'Assign workflow roles' : isDone ? `${uploadedCount} uploaded` : uploading ? 'Uploading...' : 'PDF files up to 50 MB'}
            </DialogDescription>
          </div>
          <div className="flex items-center gap-3 pr-8">
            <div className="flex items-center gap-1.5 rounded-full bg-surface-100/80 px-2.5 py-1 text-[11px] font-semibold text-fg-700">
              <Coins className="h-3.5 w-3.5 text-fg-400" />
              <span>{userCredits} credits</span>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">

          {/* === IDLE / COUNTING / UPLOADING: Dropzone + bulk roles === */}
          {(sessionStatus === 'idle' || sessionStatus === 'counting_pages' || sessionStatus === 'uploading') && (
            <>
              {/* Bulk role defaults */}
              {isProAccount && isLoadingMembers && (
                <div className="mb-4 rounded-lg border border-surface-100 bg-surface-50 p-3 animate-pulse">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="h-3.5 w-40 rounded bg-surface-200" />
                    <div className="h-3 w-28 rounded bg-surface-200" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="mb-1 h-2.5 w-12 rounded bg-surface-200" />
                      <div className="h-8 rounded-lg bg-surface-200" />
                    </div>
                    <div>
                      <div className="mb-1 h-2.5 w-14 rounded bg-surface-200" />
                      <div className="h-8 rounded-lg bg-surface-200" />
                    </div>
                  </div>
                </div>
              )}
              {isProAccount && !isLoadingMembers && accountMembers.length > 0 && (
                <div className="mb-4 rounded-lg border border-surface-100 bg-surface-50 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5 text-fg-500" />
                      <span className="text-xs font-medium text-fg-700">Default roles for this batch</span>
                    </div>
                    <span className="text-[10px] text-fg-400">Optional — otherwise the project&apos;s roles apply</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-fg-400">Editor</Label>
                      <Select value={bulkEditorUserId ?? "none"} onValueChange={v => setBulkEditorUserId(v === "none" ? null : v)} open={openDropdownId === 'bulk-editor-pre'} onOpenChange={o => setOpenDropdownId(o ? 'bulk-editor-pre' : null)}>
                        <SelectTrigger className="h-8 rounded-lg border-surface-200 bg-card text-xs"><SelectValue placeholder="Select" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {accountMembers.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-fg-400">Approver</Label>
                      <Select value={bulkApproverUserId ?? "none"} onValueChange={v => setBulkApproverUserId(v === "none" ? null : v)} open={openDropdownId === 'bulk-approver-pre'} onOpenChange={o => setOpenDropdownId(o ? 'bulk-approver-pre' : null)}>
                        <SelectTrigger className="h-8 rounded-lg border-surface-200 bg-card text-xs"><SelectValue placeholder="Select" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {accountMembers.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              )}

              {/* Dropzone */}
              {!uploading ? (
                <div
                  {...getRootProps()}
                  className={`cursor-pointer rounded-lg border-2 border-dashed transition-colors ${isDragActive ? "border-primary-700 bg-primary-700/5" : "border-surface-200 hover:border-fg-400"}`}
                >
                  <input {...getInputProps()} />
                  <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-100">
                      <UploadCloud className="h-5 w-5 text-fg-700" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-fg-950">{isDragActive ? "Drop files here" : "Drag & drop PDFs here"}</p>
                      <p className="mt-0.5 text-xs text-fg-500">or click to browse</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 rounded-lg border border-primary-700/20 bg-primary-700/5 px-4 py-3">
                  <Loader2 className="h-4 w-4 animate-spin text-primary-700" />
                  <span className="text-sm font-medium text-primary-700">Uploading {files.length} contract{files.length !== 1 ? 's' : ''}…</span>
                </div>
              )}
            </>
          )}

          {/* === CREDIT WARNING === */}
          {insufficientCredits && !uploading && sessionStatus === 'idle' && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-attention-200 bg-attention-50 p-3 text-xs text-attention-700">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span>Not enough credits — you need {totalPages} but have {userCredits}. Remove some files or upgrade your plan.</span>
            </div>
          )}

          {/* === ERROR === */}
          {error && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-risk-200 bg-risk-50 p-3 text-xs text-risk-700">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" /><span>{error}</span>
            </div>
          )}

          {/* === FILE LIST (All states except assigning/done) === */}
          {files.length > 0 && sessionStatus !== 'assigning' && sessionStatus !== 'complete_success' && (
            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold text-fg-950">Selected contracts</span>
                <span className="text-xs text-fg-400">{files.length} file{files.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="space-y-2">
              {files.map((file) => {
                const progress = uploadProgress[file.name]
                const result = file.uploadResult
                const isComplete = result?.status === 'success'
                const hasError = result?.status === 'error' || progress < 0
                const isUploading = uploading && !isComplete && !hasError
                return (
                  <div key={`${file.name}-${file.size}`} className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 shadow-e1 ${hasError ? "border-risk-200 bg-risk-50" : isComplete ? "border-success-200 bg-success-50" : "border-surface-200 bg-card"}`}>
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${hasError ? "bg-risk-100 text-risk-600" : isComplete ? "bg-success-100 text-success-700" : "bg-primary-700/10 text-primary-700"}`}>
                        {isComplete ? <CheckCircle className="h-5 w-5" /> : hasError ? <X className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-fg-950">{file.name}</p>
                        <div className="flex items-center gap-2 mt-0.5 text-xs text-fg-500">
                          <span>{(file.size / 1024 / 1024).toFixed(2)} MB</span>
                          {file.pageCount && (
                             <>
                               <span>•</span>
                               <span>{file.pageCount} page{file.pageCount !== 1 ? 's' : ''}</span>
                             </>
                          )}

                          {hasError && result?.status === 'error' && (
                             <>
                               <span>•</span>
                               <span className="text-risk-600 truncate">{result.message}</span>
                             </>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      {isUploading ? (
                        <Loader2 className="h-5 w-5 animate-spin text-primary-700" />
                      ) : (sessionStatus === 'idle' || sessionStatus === 'counting_pages') ? (
                        <Button variant="ghost" size="icon" onClick={() => removeFile(file.name)} className="h-8 w-8 text-fg-400 hover:text-risk-600 hover:bg-risk-50">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      ) : isComplete ? (
                        <CheckCircle className="h-5 w-5 text-success-500" />
                      ) : null}
                    </div>
                  </div>
                )
              })}
              </div>
            </div>
          )}

          {/* === ROLE ASSIGNMENT PANEL (pro, after upload) === */}
          {sessionStatus === 'assigning' && showRolePanel && contractEntries.length > 0 && (
            <div className="mt-3 space-y-5">
              {/* Success Banner */}
              <div className="flex items-center gap-4 rounded-lg border border-success-200 bg-success-50 p-4">
                 <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-success-100">
                    <CheckCircle className="h-6 w-6 text-success-700" />
                 </div>
                 <div>
                    <h3 className="text-sm font-semibold text-success-800">Upload Complete</h3>
                    <p className="text-xs text-success-700">Successfully uploaded {uploadedCount} contract{uploadedCount !== 1 ? 's' : ''}. Assign roles below, or leave them blank to use the project&apos;s.</p>
                 </div>
              </div>

              {/* Bulk apply bar */}
              {accountMembers.length > 0 && (
                <div>
                  <Label className="mb-2 block text-sm font-semibold text-fg-950">Assign roles to all contracts</Label>
                  <div className="flex flex-col gap-3 rounded-lg border border-surface-200 bg-card p-4 shadow-e1 sm:flex-row sm:items-end">
                    <div className="grid min-w-0 flex-1 grid-cols-2 gap-3">
                      <div>
                        <Label className="mb-1.5 block text-[11px] font-medium text-fg-500">Editor</Label>
                        <Select value={bulkEditorUserId ?? "none"} onValueChange={v => setBulkEditorUserId(v === "none" ? null : v)} open={openDropdownId === 'bulk-editor'} onOpenChange={o => setOpenDropdownId(o ? 'bulk-editor' : null)}>
                          <SelectTrigger className="h-9 rounded-md border-surface-200 bg-card text-xs"><SelectValue placeholder="Select Editor" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">None</SelectItem>
                            {accountMembers.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="mb-1.5 block text-[11px] font-medium text-fg-500">Approver</Label>
                        <Select value={bulkApproverUserId ?? "none"} onValueChange={v => setBulkApproverUserId(v === "none" ? null : v)} open={openDropdownId === 'bulk-approver'} onOpenChange={o => setOpenDropdownId(o ? 'bulk-approver' : null)}>
                          <SelectTrigger className="h-9 rounded-md border-surface-200 bg-card text-xs"><SelectValue placeholder="Select Approver" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">None</SelectItem>
                            {accountMembers.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <Button variant="outline" onClick={applyBulkToAll} className="h-9 flex-shrink-0 rounded-md border-surface-200 px-4 text-xs font-medium hover:border-primary-700 hover:text-primary-700">
                      Apply to all
                    </Button>
                  </div>
                </div>
              )}

              {/* Per-contract rows */}
              <div>
                <Label className="mb-2 block text-sm font-semibold text-fg-950">Or assign individually</Label>
                <div className="divide-y divide-surface-100 rounded-lg border border-surface-200 overflow-hidden shadow-e1">
                  {contractEntries.map(([cid, roles]) => {
                    const isDone = roles.status === 'done'
                    const isSaving = roles.status === 'saving'
                    const hasError = roles.status === 'error'
                    return (
                      <div key={cid} className={`p-4 ${hasError ? 'bg-risk-50/50' : isDone ? 'bg-success-50/30' : 'bg-card'}`}>
                        <div className="mb-3 flex items-center gap-2">
                          <FileText className="h-4 w-4 text-primary-700 flex-shrink-0" />
                          <span className="truncate text-sm font-medium text-fg-950">{roles.fileName || cid}</span>
                          {isDone && <CheckCircle className="h-4 w-4 flex-shrink-0 text-success-500 ml-auto" />}
                          {hasError && <span className="text-xs text-risk-600 ml-auto">{roles.error}</span>}
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label className="mb-1 block text-[11px] font-medium text-fg-500">Editor</Label>
                            <Select
                              value={roles.editorUserId ?? "none"}
                              onValueChange={v => updateContractRole(cid, 'editorUserId', v === "none" ? null : v)}
                              disabled={isSaving || isDone}
                              open={openDropdownId === `${cid}-editor`}
                              onOpenChange={o => setOpenDropdownId(o ? `${cid}-editor` : null)}
                            >
                              <SelectTrigger className="h-8 rounded-md border-surface-200 bg-card text-xs"><SelectValue placeholder="Select editor" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">None</SelectItem>
                                {accountMembers.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="mb-1 block text-[11px] font-medium text-fg-500">Approver</Label>
                            <Select
                              value={roles.approverUserId ?? "none"}
                              onValueChange={v => updateContractRole(cid, 'approverUserId', v === "none" ? null : v)}
                              disabled={isSaving || isDone}
                              open={openDropdownId === `${cid}-approver`}
                              onOpenChange={o => setOpenDropdownId(o ? `${cid}-approver` : null)}
                            >
                              <SelectTrigger className="h-8 rounded-md border-surface-200 bg-card text-xs"><SelectValue placeholder="Select approver" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">None</SelectItem>
                                {accountMembers.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
              {roleValidationMessage && (
                <div role="alert" className="mt-3 flex items-start gap-2 rounded-lg border border-attention-200 bg-attention-50 p-3 text-xs text-attention-700">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                  <span>{roleValidationMessage}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-surface-100 px-5 py-3">
          <span className="text-xs text-fg-500">
            {files.length > 0 ? `${files.length} file${files.length === 1 ? '' : 's'}${isDone ? ` · ${uploadedCount} uploaded` : ''}` : 'PDF only · Max 50 MB'}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleClose} className="h-8 rounded-lg border-surface-200 px-3 text-xs">
              {isDone ? 'Done' : 'Cancel'}
            </Button>
            {(sessionStatus === 'idle' || sessionStatus === 'counting_pages') && (
              <Button onClick={handleUpload} disabled={!canUpload} className="h-8 rounded-md bg-primary-solid px-4 text-xs text-white hover:bg-primary-solid-hover/90">
                Upload
              </Button>
            )}
            {sessionStatus === 'assigning' && (
              <Button onClick={saveAllRoles} disabled={anySaving || allRolesDone} className="h-8 rounded-md bg-primary-solid px-4 text-xs text-white hover:bg-primary-solid-hover/90">
                {anySaving ? <span className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving</span> : <span className="flex items-center gap-1.5"><Save className="h-3.5 w-3.5" />Save all roles</span>}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default FileUploadModal
