// app/teams/[teamId]/analytics/page.tsx
'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from '@/components/ui/skeleton';
import { BarChart2, Users, ArrowRight, AlertCircle, CalendarDays, TrendingUp } from 'lucide-react';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip, 
  ResponsiveContainer,
  Legend,
} from 'recharts';

import type { TeamAnalyticsSummary, DailyUsageDataPointItem } from '@/types/analytics'; 

const logger = {
    error: (...args: any[]) => console.error('[TeamAnalyticsPage]', ...args),
    warn: (...args: any[]) => console.warn('[TeamAnalyticsPage]', ...args), 
    info: (...args: any[]) => console.info('[TeamAnalyticsPage]', ...args),
};

export default function TeamAnalyticsPage() {
  const params = useParams();
  const router = useRouter();
  const teamId = params?.teamId as string;

  const { isAuthenticated, authChecked, authenticatedFetch } = useAuth();
  const apiBaseWithPrefix = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL;

  const [analyticsSummary, setAnalyticsSummary] = useState<TeamAnalyticsSummary | null>(null);
  const [teamNameForDisplay, setTeamNameForDisplay] = useState<string>('Team');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTimeFilter, setSelectedTimeFilter] = useState<'day' | 'week' | 'month'>('week');

  const fetchAnalyticsSummary = useCallback(async (currentTeamId: string, filter: string) => {
    logger.info("fetchAnalyticsSummary called with teamId:", currentTeamId, "filter:", filter);
    if (!authChecked) {
      logger.warn("fetchAnalyticsSummary: Aborting, auth not checked yet.");
      setIsLoading(true); 
      return;
    }
    if (!isAuthenticated) {
      logger.warn("fetchAnalyticsSummary: Aborting, user not authenticated.");
      setError("Authentication required to view analytics.");
      setIsLoading(false); setAnalyticsSummary(null); return;
    }
    if (!apiBaseWithPrefix) {
        logger.warn("fetchAnalyticsSummary: Aborting, apiBaseWithPrefix not set.");
        setError("Backend API URL is not configured.");
        setIsLoading(false); setAnalyticsSummary(null); return;
    }

    setIsLoading(true); setError(null);
    try {
      const url = `${apiBaseWithPrefix}/audit/analytics/teams/${currentTeamId}/summary?time_filter=${filter}`;
      logger.info("Fetching team analytics summary from URL:", url);
      const { data, error: fetchError } = await authenticatedFetch(url);

      if (fetchError) {
        if (fetchError.includes("403 Forbidden") || fetchError.includes("401 Unauthorized")) {
            toast({ title: "Access Denied", description: "You may not have permission.", variant: "destructive" });
            router.push("/dashboard"); setError("Access Denied."); return; 
        }
        throw new Error(fetchError);
      }
      if (!data) throw new Error("No data received from analytics summary API.");
      
      setAnalyticsSummary(data as TeamAnalyticsSummary); // Ensure this type includes daily_usage_trend_30_days
      if (data.team_name) setTeamNameForDisplay(data.team_name);
      else if (typeof currentTeamId === 'string') setTeamNameForDisplay(`Team ${currentTeamId.substring(0,8)}...`);

    } catch (err: any) {
      logger.error("Error fetching team analytics summary:", err);
      setError(err.message || "Could not load analytics data.");
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [authChecked, isAuthenticated, apiBaseWithPrefix, authenticatedFetch, router]);

  useEffect(() => {
    logger.info(`useEffect triggered: authChecked=${authChecked}, isAuthenticated=${isAuthenticated}, teamId=${teamId}, selectedTimeFilter=${selectedTimeFilter}`);
    if (authChecked) {
      if (isAuthenticated && teamId && typeof teamId === 'string') {
        fetchAnalyticsSummary(teamId, selectedTimeFilter);
      } else {
        setIsLoading(false);
        if (!isAuthenticated) setError("Please log in to view analytics.");
        else if (!teamId) setError("Team ID is missing. Cannot load analytics.");
      }
    }
  }, [authChecked, isAuthenticated, teamId, selectedTimeFilter, fetchAnalyticsSummary]);

  const handleTimeFilterChange = (value: string) => {
    setSelectedTimeFilter(value as 'day' | 'week' | 'month');
  };

  const formatDateRange = (start?: string, end?: string) => {
    if(!start || !end) return "N/A";
    const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
    return `${new Date(start).toLocaleDateString(undefined, options)} - ${new Date(end).toLocaleDateString(undefined, options)}`;
  };

  const formatShortDateForChart = (dateLabel: string) => { // dateLabel is "YYYY-MM-DD"
    try {
        // Split date string and pass to Date constructor to avoid timezone issues with simple new Date(string)
        const [year, month, day] = dateLabel.split('-').map(Number);
        const date = new Date(year, month - 1, day); // Month is 0-indexed
        return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch { return dateLabel; }
  };

  if (!authChecked || (isLoading && !analyticsSummary && !error)) { 
    return (
      <div className="container mx-auto py-8 px-4 sm:px-6 lg:px-8 animate-pulse">
        <div className="mb-8"><Skeleton className="h-10 w-3/4 md:w-1/2 rounded-md bg-gray-200 dark:bg-slate-700" /></div>
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          <Skeleton className="h-36 w-full rounded-lg bg-gray-200 dark:bg-slate-700" />
          <Skeleton className="h-36 w-full rounded-lg bg-gray-200 dark:bg-slate-700" />
        </div>
        <Skeleton className="h-[350px] w-full rounded-lg bg-gray-200 dark:bg-slate-700" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <div className="mb-6 sm:mb-8 flex items-center">
            <BarChart2 className="h-7 w-7 sm:h-8 sm:w-8 mr-3 text-red-500" />
            <h1 className="text-xl sm:text-2xl font-semibold text-gray-800 dark:text-gray-100">Analytics Error</h1>
        </div>
        <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-600 text-red-800 dark:text-red-300 p-4 sm:p-6 rounded-md shadow" role="alert">
          <div className="flex items-start">
            <AlertCircle className="h-5 w-5 sm:h-6 sm:w-6 mr-2.5 sm:mr-3 flex-shrink-0 text-red-500 dark:text-red-400" />
            <div>
              <p className="font-semibold text-base sm:text-lg">Could not load analytics data</p>
              <p className="text-sm mt-1">{error}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!analyticsSummary) {
    return (
      <div className="container mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <div className="mb-6 sm:mb-8 flex items-center">
            <BarChart2 className="h-7 w-7 sm:h-8 sm:w-8 mr-3 text-blue-600 dark:text-blue-400" />
            <h1 className="text-xl sm:text-2xl font-semibold text-gray-800 dark:text-gray-100">
                Analytics for {teamNameForDisplay}
            </h1>
        </div>
        <div className="text-center py-12 sm:py-16 text-gray-500 dark:text-gray-400 bg-white dark:bg-slate-800/50 shadow rounded-lg border border-gray-200 dark:border-slate-700">
          <CalendarDays className="h-12 w-12 sm:h-16 sm:w-16 mx-auto mb-4 text-gray-300 dark:text-gray-500" />
          <p className="text-lg sm:text-xl font-medium">No Analytics Data Available</p>
          <p className="mt-1 text-sm">There is no analytics data to display for the selected period or team.</p>
        </div>
      </div>
    );
  }

  // Prepare chart data - Recharts expects an array of objects
  // Backend already provides daily_usage_trend_30_days in the correct format:
  // [{ date_label: "YYYY-MM-DD", credits_used: number }, ...]
  const chartData = analyticsSummary.daily_usage_trend_30_days || [];

  return (
    <div className="container mx-auto mt-[4rem] py-6 sm:py-8 px-2 sm:px-4 lg:px-6">
      <div className="mb-6 sm:mb-8 flex flex-col md:flex-row justify-between md:items-center gap-4 border-b dark:border-slate-700 pb-4">
        <h1 className="text-xl sm:text-2xl font-semibold text-gray-800 dark:text-gray-100 flex items-center">
          <BarChart2 className="h-6 w-6 sm:h-7 sm:w-7 mr-2.5 text-blue-600 dark:text-blue-400" />
          Analytics: {analyticsSummary.team_name || teamNameForDisplay}
        </h1>
        <div className="flex items-center gap-3 w-full md:w-auto">
            <span className="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">Time Period (Cards):</span>
            <Select value={selectedTimeFilter} onValueChange={handleTimeFilterChange}>
                <SelectTrigger className="w-full md:w-[150px] bg-white dark:bg-slate-800 dark:text-gray-300 dark:border-slate-600">
                    <SelectValue placeholder="Select period" />
                </SelectTrigger>
                <SelectContent className="dark:bg-slate-800 dark:border-slate-700">
                    <SelectItem value="day" className="dark:focus:bg-slate-700">Last 24 Hrs</SelectItem>
                    <SelectItem value="week" className="dark:focus:bg-slate-700">Last 7 Days</SelectItem>
                    <SelectItem value="month" className="dark:focus:bg-slate-700">Last 30 Days</SelectItem>
                </SelectContent>
            </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 mb-8">
        {/* Credits Remaining Card */}
        <Card className="shadow-md dark:bg-slate-800 dark:border-slate-700">
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base sm:text-lg font-medium text-gray-600 dark:text-gray-300">Credits Remaining</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl sm:text-4xl font-bold text-green-600 dark:text-green-400">
              {analyticsSummary.remaining_credits}
            </p>
            <CardDescription className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Current balance for this account.
            </CardDescription>
          </CardContent>
        </Card>

        {/* Credits Used Card */}
        <Card className="shadow-md dark:bg-slate-800 dark:border-slate-700">
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base sm:text-lg font-medium text-gray-600 dark:text-gray-300">Credits Used</CardTitle>
            <CalendarDays className="h-4 w-4 text-gray-400 dark:text-gray-500"/>
          </CardHeader>
          <CardContent>
            <p className="text-3xl sm:text-4xl font-bold text-blue-600 dark:text-blue-400">
              {analyticsSummary.used_credits_in_period}
            </p>
            <CardDescription className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Period: {formatDateRange(analyticsSummary.period_start_date, analyticsSummary.period_end_date)}
            </CardDescription>
          </CardContent>
        </Card>
      </div>
      
      {/* --- Line Chart for Daily Usage Trend --- */}
      <Card className="shadow-lg dark:bg-slate-800 dark:border-slate-700">
        <CardHeader>
          <CardTitle className="text-lg sm:text-xl font-semibold text-gray-700 dark:text-gray-200 flex items-center">
            <TrendingUp className="h-5 w-5 mr-2 text-sky-500 dark:text-sky-400" />
            Daily Credit Usage Trend
          </CardTitle>
          <CardDescription className="text-xs text-gray-500 dark:text-gray-400">
            Credits used each day over the past 30 days.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-2 pr-0 sm:pr-2 md:pr-4 h-[350px]"> {/* Set explicit height for chart container */}
          {isLoading && chartData.length === 0 ? ( // Show skeleton if loading AND no chart data yet
            <Skeleton className="h-full w-full rounded-md bg-gray-200 dark:bg-slate-700" />
          ) : chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart 
                data={chartData}
                margin={{ top: 5, right: 25, left: -10, bottom: 50 }} // Adjusted margins
              >
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} className="stroke-gray-300 dark:stroke-slate-600" />
                <XAxis 
                  dataKey="date_label" 
                  tickFormatter={formatShortDateForChart} 
                  fontSize={11} // Smaller font for X-axis
                  tickLine={false}
                  axisLine={{ stroke: '#cbd5e1', strokeOpacity: 0.5 }} // Lighter axis line for dark mode: dark:stroke-slate-600
                  className="fill-gray-500 dark:fill-gray-400"
                  interval="preserveStartEnd" // Let recharts decide interval, or use a number e.g. 6 for every 7th day
                  minTickGap={30} // Minimum gap between ticks
                  angle={-35} // Angle ticks if they overlap
                  textAnchor="end" // Anchor for angled ticks
                  height={60} // Increase height for angled ticks
                />
                <YAxis 
                  fontSize={11} // Smaller font for Y-axis
                  tickLine={false} 
                  axisLine={{ stroke: '#cbd5e1', strokeOpacity: 0.5 }} // Lighter axis line for dark mode: dark:stroke-slate-600
                  className="fill-gray-500 dark:fill-gray-400"
                  allowDecimals={false}
                  width={35} // Give space for Y-axis labels
                />
                <RechartsTooltip 
                  contentStyle={{ 
                    backgroundColor: 'hsl(var(--background))', // Use theme background
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 'var(--radius)', // Use theme radius
                    boxShadow: 'var(--shadow-md)',
                    fontSize: '0.8rem',
                  }}
                  labelStyle={{ fontWeight: 'bold', color: 'hsl(var(--foreground))' }}
                  itemStyle={{ color: 'hsl(var(--primary))' }} // Use theme primary color
                  formatter={(value: number) => [`${value} credits`, "Used"]}
                  labelFormatter={(label: string) => formatShortDateForChart(label)} // Format date in tooltip label
                />
                <Legend wrapperStyle={{fontSize: "12px", paddingTop: "10px"}} verticalAlign="top" align="right" />
                <Line 
                  type="monotone" 
                  dataKey="credits_used" 
                  name="Credits Used"
                  stroke="hsl(var(--primary))" // Use theme primary color
                  strokeWidth={2} 
                  dot={{ r: 3, strokeWidth: 1, fill: 'hsl(var(--primary))' }} 
                  activeDot={{ r: 5, strokeWidth: 2, fill: 'hsl(var(--background))', stroke: 'hsl(var(--primary-hover))' }} 
                />
              </LineChart>
            </ResponsiveContainer>
          ) : ( // No data for chart after loading
            <div className="h-full flex flex-col items-center justify-center text-center text-gray-400 dark:text-gray-500">
                <BarChart2 className="h-12 w-12 text-gray-300 dark:text-gray-600 mb-3" />
                <p className="font-medium text-sm">No Daily Usage Data Available</p>
                <p className="text-xs mt-1">No credits were used in the last 30 days.</p>
            </div>
          )}
        </CardContent>
      </Card>
      {/* --- END Line Chart --- */}
      
      <div className="mt-8 text-center md:text-right">
        <Link href={teamId ? `/teams/${teamId}/analytics/members?filter=${selectedTimeFilter}` : '#'} legacyBehavior={!teamId}>
            <Button variant="default" size="lg" className="bg-slate-700 hover:bg-slate-800 text-white dark:bg-slate-600 dark:hover:bg-slate-500" disabled={!teamId}>
                View Per-Member Usage
                <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
        </Link>
      </div>
    </div>
  );
}