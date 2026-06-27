"use client"
import React, { useState, useCallback, useEffect, useMemo } from "react"
import { useDropzone } from "react-dropzone"
import {
  AlertCircle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  FileText,
  Loader2,
  ShieldCheck,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import { Button } from "@/components/ui/button"
import { useAccountContext } from '@/app/context/AccountContext'
import { toast } from "@/hooks/use-toast"
import { Label } from "@/components/ui/label"
import { apiFetch, apiUploadWithProgress } from "@/lib/apiClient"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type PdfJsModule = typeof import("pdfjs-dist")
let pdfjsLoader: Promise<PdfJsModule> | null = null
function loadPdfJs() {
  if (!pdfjsLoader) {
    pdfjsLoader = import("pdfjs-dist").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString()
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
      setContractRoles({}); setShowRolePanel(false)
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
      roles[r.data.contract_id] = { editorUserId: defaultEditor, approverUserId: defaultApprover, status: 'pending' }
    }
    setContractRoles(roles)
    setSessionStatus("assigning"); setShowRolePanel(true)
    toast({ title: "Uploaded", description: `Set roles for ${success.length} contract(s).` })
    setUploading(false)
  }, [files, apiUrl, selectedAccountId, projectId, isProAccount, bulkEditorUserId, bulkApproverUserId, savedRoleTemplate, onUploadSuccess])

  const updateContractRole = (contractId: string, field: 'editorUserId' | 'approverUserId', value: string | null) => {
    setContractRoles(prev => ({
      ...prev,
      [contractId]: { ...prev[contractId], [field]: value, status: 'pending', error: undefined }
    }))
  }

  const applyBulkToAll = () => {
    if (!bulkEditorUserId || !bulkApproverUserId) {
      toast({ title: "Select both roles first", variant: "destructive" }); return
    }
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
    if (incomplete.length > 0) {
      toast({ title: "Roles missing", description: `Select editor and approver for ${incomplete.length} contract(s).`, variant: "destructive" })
      return
    }

    let ok = 0
    for (const [cid, roles] of entries) {
      setContractRoles(prev => ({ ...prev, [cid]: { ...prev[cid], status: 'saving' } }))
      try {
        const res = await apiFetch(`${apiUrl}/contracts/${cid}/roles`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ editorUserId: roles.editorUserId, approverUserId: roles.approverUserId })
        })
        if (!res.ok) throw new Error('Failed')
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

  const canUpload = files.length > 0 && !uploading && sessionStatus === 'idle'
  const isDone = sessionStatus === 'complete_success' || sessionStatus === 'complete_with_errors'
  const uploadedCount = files.filter(f => f.uploadResult?.status === 'success').length
  const allRolesDone = Object.values(contractRoles).every(r => r.status === 'done')
  const anySaving = Object.values(contractRoles).some(r => r.status === 'saving')
  const contractEntries = Object.entries(contractRoles)

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose() }}>
      <DialogContent className="flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-[600px] flex-col gap-0 overflow-hidden border-0 bg-white p-0 shadow-2xl sm:rounded-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Upload contracts</h2>
            <p className="mt-0.5 text-xs text-gray-500">
              {sessionStatus === 'assigning' ? 'Assign workflow roles' : isDone ? `${uploadedCount} uploaded` : uploading ? 'Uploading...' : 'PDF files up to 50 MB'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-gray-500">{userCredits} credits</span>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">

          {/* === IDLE / COUNTING: Dropzone + bulk roles === */}
          {(sessionStatus === 'idle' || sessionStatus === 'counting_pages') && (
            <>
              {/* Bulk role defaults */}
              {isProAccount && accountMembers.length > 0 && (
                <div className="mb-4 rounded-xl border border-gray-100 bg-gray-50 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <ShieldCheck className="h-3.5 w-3.5 text-gray-500" />
                      <span className="text-xs font-medium text-gray-700">Default roles for this batch</span>
                    </div>
                    <span className="text-[10px] text-gray-400">Applied to all contracts</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-gray-400">Editor</Label>
                      <Select value={bulkEditorUserId ?? "none"} onValueChange={v => setBulkEditorUserId(v === "none" ? null : v)}>
                        <SelectTrigger className="h-8 rounded-lg border-gray-200 bg-white text-xs"><SelectValue placeholder="Select" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {accountMembers.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-gray-400">Approver</Label>
                      <Select value={bulkApproverUserId ?? "none"} onValueChange={v => setBulkApproverUserId(v === "none" ? null : v)}>
                        <SelectTrigger className="h-8 rounded-lg border-gray-200 bg-white text-xs"><SelectValue placeholder="Select" /></SelectTrigger>
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
              <div
                {...getRootProps()}
                className={`cursor-pointer rounded-xl border-2 border-dashed transition-colors ${isDragActive ? "border-gray-900 bg-gray-50" : "border-gray-200 hover:border-gray-400"} ${uploading ? "pointer-events-none opacity-50" : ""}`}
              >
                <input {...getInputProps()} />
                <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
                    <UploadCloud className="h-5 w-5 text-gray-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{isDragActive ? "Drop files here" : "Drag & drop PDFs here"}</p>
                    <p className="mt-0.5 text-xs text-gray-500">or click to browse</p>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* === ERROR === */}
          {error && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" /><span>{error}</span>
            </div>
          )}

          {/* === FILE LIST (uploading or after) === */}
          {files.length > 0 && sessionStatus !== 'idle' && sessionStatus !== 'counting_pages' && (
            <div className="space-y-1.5">
              {files.map((file) => {
                const progress = uploadProgress[file.name]
                const result = file.uploadResult
                const hasError = result?.status === 'error' || progress < 0
                const isComplete = result?.status === 'success'
                return (
                  <div key={`${file.name}-${file.size}`} className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${hasError ? "border-red-200 bg-red-50" : isComplete ? "border-green-100 bg-green-50/50" : "border-gray-100 bg-white"}`}>
                    <div className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md ${hasError ? "bg-red-100" : isComplete ? "bg-green-100" : "bg-gray-100"}`}>
                      {isComplete ? <CheckCircle className="h-3.5 w-3.5 text-green-600" /> : hasError ? <X className="h-3.5 w-3.5 text-red-500" /> : <FileText className="h-3.5 w-3.5 text-gray-500" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-gray-900">{file.name}</p>
                      {uploading && progress >= 0 && progress < 100 && <Progress value={progress} className="mt-1 h-1" />}
                      {hasError && result?.status === 'error' && <p className="text-[10px] text-red-500">{result.message}</p>}
                    </div>
                    {uploading && progress >= 0 && progress < 100 && <span className="text-[10px] font-medium text-gray-500">{progress}%</span>}
                  </div>
                )
              })}
            </div>
          )}

          {/* === ROLE ASSIGNMENT PANEL (pro, after upload) === */}
          {sessionStatus === 'assigning' && showRolePanel && contractEntries.length > 0 && (
            <div className="mt-3 space-y-3">
              {/* Bulk apply bar */}
              {accountMembers.length > 0 && (
                <div className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 p-2.5">
                  <div className="grid min-w-0 flex-1 grid-cols-2 gap-2">
                    <Select value={bulkEditorUserId ?? "none"} onValueChange={v => setBulkEditorUserId(v === "none" ? null : v)}>
                      <SelectTrigger className="h-7 rounded-md border-gray-200 bg-white text-[11px]"><SelectValue placeholder="Editor" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {accountMembers.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={bulkApproverUserId ?? "none"} onValueChange={v => setBulkApproverUserId(v === "none" ? null : v)}>
                      <SelectTrigger className="h-7 rounded-md border-gray-200 bg-white text-[11px]"><SelectValue placeholder="Approver" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {accountMembers.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button variant="outline" size="sm" onClick={applyBulkToAll} className="h-7 flex-shrink-0 rounded-md border-gray-200 px-2 text-[11px]">
                    Apply all
                  </Button>
                </div>
              )}

              {/* Per-contract rows */}
              <div className="divide-y divide-gray-100 rounded-lg border border-gray-100">
                {contractEntries.map(([cid, roles]) => {
                  const file = files.find(f => f.uploadResult?.status === 'success' && f.uploadResult.contractId === cid)
                  const isDone = roles.status === 'done'
                  const isSaving = roles.status === 'saving'
                  const hasError = roles.status === 'error'
                  return (
                    <div key={cid} className={`px-3 py-2.5 ${hasError ? 'bg-red-50/50' : isDone ? 'bg-green-50/30' : 'bg-white'}`}>
                      <div className="mb-1.5 flex items-center gap-2">
                        <span className="truncate text-xs font-medium text-gray-800">{file?.name || cid}</span>
                        {isDone && <CheckCircle className="h-3 w-3 flex-shrink-0 text-green-500" />}
                        {hasError && <span className="text-[10px] text-red-500">{roles.error}</span>}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Select
                          value={roles.editorUserId ?? "none"}
                          onValueChange={v => updateContractRole(cid, 'editorUserId', v === "none" ? null : v)}
                          disabled={isSaving || isDone}
                        >
                          <SelectTrigger className="h-7 rounded-md border-gray-200 bg-white text-[11px]"><SelectValue placeholder="Editor" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">None</SelectItem>
                            {accountMembers.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Select
                          value={roles.approverUserId ?? "none"}
                          onValueChange={v => updateContractRole(cid, 'approverUserId', v === "none" ? null : v)}
                          disabled={isSaving || isDone}
                        >
                          <SelectTrigger className="h-7 rounded-md border-gray-200 bg-white text-[11px]"><SelectValue placeholder="Approver" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">None</SelectItem>
                            {accountMembers.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3">
          <span className="text-xs text-gray-500">
            {files.length > 0 ? `${files.length} file${files.length === 1 ? '' : 's'}${isDone ? ` · ${uploadedCount} uploaded` : ''}` : 'PDF only · Max 50 MB'}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleClose} className="h-8 rounded-lg border-gray-200 px-3 text-xs">
              {isDone ? 'Done' : 'Cancel'}
            </Button>
            {(sessionStatus === 'idle' || sessionStatus === 'counting_pages') && (
              <Button onClick={handleUpload} disabled={!canUpload} className="h-8 rounded-lg bg-gray-900 px-4 text-xs text-white hover:bg-cs-primary/90">
                {uploading ? <span className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" />Uploading</span> : `Upload ${files.length || ''}`}
              </Button>
            )}
            {sessionStatus === 'assigning' && (
              <Button onClick={saveAllRoles} disabled={anySaving || allRolesDone} className="h-8 rounded-lg bg-gray-900 px-4 text-xs text-white hover:bg-cs-primary/90">
                {anySaving ? <span className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving</span> : <span className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" />Save all roles</span>}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default FileUploadModal
