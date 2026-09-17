export interface AuditLogDetail {
  oldStatus?: string;
  newStatus?: string;
  rejectionReason?: string;
  version_number?: number;
  filename?: string;
  file_type?: string;
  file_size?: number;
  page_count?: number;
  ownerType?: string;
  ownerId?: string; 
  team_name_created?: string; 
  target_user_id?: string; 
  target_username?: string;
  assigned_role_in_team?: string;
  changes?: Array<{ field: string; old: any; new: any; }>; 
  [key: string]: any; 
}

export interface AuditLogEntry {
  _id: string; 
  timestamp: string; 
  userId?: string | null;
  username?: string | null;
  action: string;
  contractId?: string | null;
  contractName?: string | null;
  accountId?: string | null;
  accountName?: string | null;
  details: AuditLogDetail;
}

export interface PaginationInfo {
  total_items: number;
  total_pages: number;
  current_page: number;
  per_page: number;
}

export interface PaginatedAuditLogs {
  logs: AuditLogEntry[];
  pagination: PaginationInfo;
}