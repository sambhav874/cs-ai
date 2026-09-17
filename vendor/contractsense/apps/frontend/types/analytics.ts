
export interface DailyUsageDataPointItem {
  date_label: string; // "YYYY-MM-DD" from backend, will be formatted for display
  credits_used: number;
}

export interface TeamAnalyticsSummary {
  team_id: string;
  team_name?: string | null;
  remaining_credits: number;
  used_credits_in_period: number;
  time_filter: string;
  period_start_date: string; // ISO string
  period_end_date: string;   // ISO string
  daily_usage_trend_30_days: DailyUsageDataPointItem[]; // THIS IS THE NEW FIELD
}

export interface MemberCreditUsageItem { // Renamed from MemberCreditUsage to avoid conflict if also used as a model name
  member_id: string;
  member_name?: string | null;
  credits_used: number;
}

export interface TeamMemberUsageData { // Renamed from TeamMemberUsageResponse
  team_id: string;
  team_name?: string | null;
  member_usage: MemberCreditUsageItem[];
  time_filter: string;
  period_start_date: string;
  period_end_date: string;
}

// For the next page (Individual Member Log)
export interface DetailedCreditLogEntryItem { // Renamed
  timestamp: string; // ISO string
  credits_deducted: number;
  service_description?: string | null;
  contract_id?: string | null;
  contract_name?: string | null;
}

export interface PaginationInfo { // Re-using if defined globally, or define here
  total_items: number;
  total_pages: number;
  current_page: number;
  per_page: number;
}

export interface DetailedMemberLogData { // Renamed
  team_id: string;
  team_name?: string | null;
  member_id: string;
  member_name?: string | null;
  detailed_logs: DetailedCreditLogEntryItem[];
  time_filter: string;
  period_start_date: string;
  period_end_date: string;
  pagination: PaginationInfo;
}
