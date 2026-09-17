"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { User, Users, Briefcase } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

interface AccessibleAccountInfo {
  id: string;
  name: string;
  role: 'owner' | 'member' | 'individual';
  type: 'personal' | 'team';
}

interface AccountSwitcherProps {
  onAccountChange: (selectedAccountId: string) => void;
  initialAccountId: string;
}

export default function AccountSwitcher({ onAccountChange, initialAccountId }: AccountSwitcherProps) {
  const [accounts, setAccounts] = useState<AccessibleAccountInfo[]>([]);
  const [currentSelection, setCurrentSelection] = useState<string>(initialAccountId);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { isAuthenticated, authenticatedFetch } = useAuth();
  const apiUrl = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL;

  const fetchAccessibleAccounts = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    if (!isAuthenticated) {
      setError("Not authenticated");
      setIsLoading(false);
      return;
    }

    if (!apiUrl) {
      setError("API URL Missing");
      setIsLoading(false);
      return;
    }

    try {
      const result = await authenticatedFetch(`${apiUrl}/users/me/accounts`);
      if (result.error) throw new Error(result.error);

      const fetchedAccounts = result.data as AccessibleAccountInfo[];

      // Personal account always first, then team accounts sorted by name
      const personal = fetchedAccounts.find(acc => acc.type === 'personal');
      const teams = fetchedAccounts
        .filter(acc => acc.type === 'team')
        .sort((a, b) => a.name.localeCompare(b.name));

      const finalAccounts = personal ? [personal, ...teams] : teams;
      setAccounts(finalAccounts);

      // Prefer team account as default if user has one
      const defaultAccount = teams.length > 0 ? teams[0] : personal;
      const isValid = finalAccounts.some(acc => acc.id === initialAccountId);
      const selection = isValid
        ? initialAccountId
        : defaultAccount?.id || 'personal';
      setCurrentSelection(selection);
      onAccountChange(selection);

    } catch (err: any) {
      console.error("Error fetching accessible accounts:", err);
      setError(err.message);
      setAccounts([]);
    } finally {
      setIsLoading(false);
    }
  }, [apiUrl, initialAccountId, isAuthenticated, authenticatedFetch, onAccountChange]);

  useEffect(() => {
    if (isAuthenticated !== null) {
      fetchAccessibleAccounts();
    }
  }, [fetchAccessibleAccounts, isAuthenticated]);

  useEffect(() => {
    setCurrentSelection(initialAccountId);
  }, [initialAccountId]);

  const handleValueChange = (value: string) => {
    setCurrentSelection(value);
    onAccountChange(value);
  };

  const getIcon = (type: AccessibleAccountInfo['type'], role: AccessibleAccountInfo['role']) => {
    if (type === 'personal') return <User className="h-4 w-4 text-gray-600 flex-shrink-0" />;
    if (role === 'owner') return <Briefcase className="h-4 w-4 text-gray-700 flex-shrink-0" />;
    return <Users className="h-4 w-4 text-gray-700 flex-shrink-0" />;
  };

  if (isLoading) {
    return <Skeleton className="h-9 w-full max-w-[220px] rounded-full bg-gray-100" />;
  }

  if (error) {
    return (
      <div className="flex items-center px-3 py-1.5 text-sm text-red-600 bg-red-50 rounded-full">
        <span className="truncate">Account Error</span>
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="flex items-center px-3 py-1.5 text-sm text-gray-500 bg-gray-50 rounded-full">
        <span className="truncate">No accounts</span>
      </div>
    );
  }

  const selected = accounts.find(acc => acc.id === currentSelection) || accounts[0];

  return (
    <Select value={currentSelection} onValueChange={handleValueChange}>
      <SelectTrigger
        data-cy="account-switcher-trigger"
        className="w-full max-w-[220px] text-sm border-gray-200 rounded-full bg-white hover:bg-gray-50 transition-colors shadow-sm h-9"
      >
        <div className="flex items-center gap-2 truncate">
          <div className="p-1 rounded-full bg-gray-50 border border-gray-100">
            {getIcon(selected.type, selected.role)}
          </div>
          <span className="truncate">{selected.name}</span>
        </div>
      </SelectTrigger>
      <SelectContent className="z-[200] border-gray-200 shadow-md rounded-lg overflow-hidden min-w-[250px]">
        <div className="py-1.5 px-2 text-xs font-medium text-gray-500 bg-gray-50 border-b border-gray-200">
          Switch Account
        </div>
        <div className="py-1 max-h-64 overflow-y-auto">
          {accounts.map((account) => (
            <SelectItem
              data-cy="account-option"
              key={account.id}
              value={account.id}
              className="py-2 px-2 hover:bg-gray-50 cursor-pointer focus:bg-gray-50 focus:text-gray-900"
            >
              <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2 w-full pr-6">
                <div className="p-1 rounded-full bg-gray-50 border border-gray-100">
                  {getIcon(account.type, account.role)}
                </div>
                <div className="truncate">
                  <p className="text-sm font-medium text-gray-900 truncate">{account.name}</p>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full border bg-gray-50 text-gray-700 border-gray-200 capitalize">
                  {account.type === 'personal' ? 'personal' : account.role}
                </span>
              </div>
            </SelectItem>
          ))}
        </div>
      </SelectContent>
    </Select>
  );
}
