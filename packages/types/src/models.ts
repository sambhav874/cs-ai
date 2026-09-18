import {
  ContractStatus,
  ContractType,
  RequestStatus,
  ApprovalStatus,
  SignatureStatus,
  ObligationStatus,
  ObligationType,
  SystemRole,
  AuditAction,
  UserStatus,
  PermissionAction,
  PermissionResource,
  PermissionScope,
} from './enums'

export interface Organization {
  id: string
  name: string
  slug: string
  subscriptionTier: 'FREE' | 'PRO' | 'ENTERPRISE'
  brandColor?: string
  logoUrl?: string
  settings: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface User {
  id: string
  orgId: string
  email: string
  name: string
  avatarUrl?: string
  roles: SystemRole[]
  status: UserStatus
  preferences: Record<string, unknown>
  lastActiveAt?: string
  createdAt: string
  updatedAt: string
}

export interface Permission {
  action: PermissionAction | '*'
  resource: PermissionResource | '*'
  scope: PermissionScope
}

export interface Role {
  id: string
  orgId?: string
  name: string
  description?: string
  permissions: Permission[]
  isSystem: boolean
  createdAt: string
  updatedAt: string
}

export interface AuthTokens {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

export interface Contract {
  id: string
  orgId: string
  title: string
  type: ContractType
  status: ContractStatus
  counterpartyId?: string
  counterpartyName?: string
  value?: number
  currency?: string
  effectiveDate?: string
  expiryDate?: string
  ownerId: string
  currentVersionId?: string
  riskScore?: number
  riskFactors: string[]
  overallConfidence?: number
  summary?: string
  keyTerms: Record<string, unknown>
  fieldConfidence: Record<string, unknown>
  analysisStatus: string
  analysisError?: string
  tags: string[]
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface ContractClause {
  id: string
  clauseType: string
  content: string
  interpretation?: string
  riskRating?: string   // "favorable" | "unfavorable" | "neutral" | "unusual"
  sectionRef?: string
  sortOrder: number
}

export interface ContractVersion {
  id: string
  contractId: string
  versionNumber: number
  htmlContent: string
  plainText: string
  s3Key?: string
  createdById: string
  changeNote?: string
  createdAt: string
}

export interface ContractRequest {
  id: string
  orgId: string
  title: string
  type: ContractType
  status: RequestStatus
  requestedById: string
  assignedToId?: string
  counterpartyName?: string
  description: string
  estimatedValue?: number
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface ApprovalInstance {
  id: string
  contractId: string
  workflowDefinitionId: string
  status: ApprovalStatus
  currentStepIndex: number
  steps: ApprovalStep[]
  createdAt: string
  updatedAt: string
}

export interface ApprovalStep {
  id: string
  approvalInstanceId: string
  approverId: string
  approverName: string
  status: ApprovalStatus
  decision?: string
  comment?: string
  decidedAt?: string
}

export interface SignatureRequest {
  id: string
  contractId: string
  status: SignatureStatus
  signers: Signer[]
  dueDate?: string
  createdById: string
  createdAt: string
  updatedAt: string
}

export interface Signer {
  id: string
  signatureRequestId: string
  name: string
  email: string
  order: number
  signed: boolean
  signedAt?: string
  token: string
}

export interface Obligation {
  id: string
  contractId: string
  title: string
  description: string
  type: ObligationType
  status: ObligationStatus
  dueDate?: string
  responsiblePartyId?: string
  responsiblePartyName?: string
  evidenceUrl?: string
  completedAt?: string
  createdAt: string
  updatedAt: string
}

export interface AuditEvent {
  id: string
  orgId: string
  userId?: string
  action: AuditAction
  resourceType: string
  resourceId: string
  metadata: Record<string, unknown>
  ipAddress?: string
  userAgent?: string
  createdAt: string
}

export interface PaginatedResponse<T> {
  data: T[]
  cursor?: string
  hasMore: boolean
  total?: number
}

export interface ApiError {
  type: string
  title: string
  status: number
  detail: string
  instance?: string
}
