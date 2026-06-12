"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { toast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { User, Users, Briefcase, ChevronDown } from "lucide-react";
import { useAuth } from "@/hooks/useAuth"; // Import the custom auth hook

// Interface for the data structure returned by GET /users/me/accounts
interface AccessibleAccountInfo {
  id: string; // Account ID string (or 'personal')
  name: string; // Display name (e.g., "Your Personal Account", "UserX's Account")
  role: 'owner' | 'member' | 'individual'; // User's role in this context
}

// Props for the component
interface AccountSwitcherProps {
  // Callback to notify parent (Header) when selection changes
  onAccountChange: (selectedAccountId: string) => void;
  // The currently selected account ID, managed by the parent (Header) via context
  initialAccountId: string;
}

export default function AccountSwitcher({ onAccountChange, initialAccountId }: AccountSwitcherProps) {
  const [accounts, setAccounts] = useState<AccessibleAccountInfo[]>([]);
  const [currentSelection, setCurrentSelection] = useState<string>(initialAccountId);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Use the custom auth hook
  const { isAuthenticated, authenticatedFetch } = useAuth();
  
  const apiUrl = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL;

  // Fetch the list of accounts the user can access
  const fetchAccessibleAccounts = useCallback(async () => {
    console.log("AccountSwitcher: Fetching accessible accounts...");
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
{/*
    try {
      // Using the authenticatedFetch from our custom hook
      const result = await authenticatedFetch(`${apiUrl}/users/me/accounts`);
      
      if (result.error) {
        throw new Error(result.error);
      }

      // Process successful response
      const fetchedAccounts = result.data as AccessibleAccountInfo[];
      
      let personalAccount = fetchedAccounts.find(acc => acc.id === 'personal');
      if (!personalAccount) {
        personalAccount = { id: 'personal', name: 'Your Personal Account', role: 'individual' };
      }
      const otherAccounts = fetchedAccounts.filter(acc => acc.id !== 'personal');

      // Ensure Personal is first, then sort others alphabetically
      const sortedOtherAccounts = otherAccounts.sort((a, b) => a.name.localeCompare(b.name));

      setAccounts([personalAccount, ...sortedOtherAccounts]);
      console.log("AccountSwitcher: Accounts loaded:", [personalAccount, ...sortedOtherAccounts]);

      // Set internal state based on the initial prop value
      setCurrentSelection(initialAccountId);

    } catch (err: any) {
      console.error("Error fetching accessible accounts:", err);
      setError(err.message);
      // Provide a default state even on error
      setAccounts([{ id: 'personal', name: 'Your Personal Account', role: 'individual' }]);
      setCurrentSelection('personal'); // Default to personal on error
    } finally {
      setIsLoading(false);
    }
  }, [apiUrl, initialAccountId, isAuthenticated, authenticatedFetch]);

  
  */}
  try {
    const result = await authenticatedFetch(`${apiUrl}/users/me/accounts`);
    if (result.error) throw new Error(result.error);

    const fetchedAccounts = result.data as AccessibleAccountInfo[];
    
    // Check if user has any team accounts (pro accounts)
    const teamAccounts = fetchedAccounts.filter(acc => 
      acc.role === 'owner' || acc.role === 'member'
    );
    
    const personalAccount = fetchedAccounts.find(acc => acc.id === 'personal');
      const finalAccounts = teamAccounts.length > 0
        ? teamAccounts.sort((a, b) => a.name.localeCompare(b.name))
        : personalAccount 
          ? [personalAccount] 
          : [];

      setAccounts(finalAccounts);

      // Ensure selection is valid
      const isValidSelection = finalAccounts.some(acc => acc.id === initialAccountId);
      const newSelection = isValidSelection ? initialAccountId : finalAccounts[0]?.id || 'personal';
      
      setCurrentSelection(newSelection);
      onAccountChange(newSelection);

    } catch (err: any) {
      console.error("Error fetching accessible accounts:", err);
      setError(err.message);
      setAccounts([]);
    } finally {
      setIsLoading(false);
    }
}, [apiUrl, initialAccountId, isAuthenticated, authenticatedFetch, onAccountChange]);

// Fetch accounts when the component mounts and auth state is confirmed
useEffect(() => {
  if (isAuthenticated !== null) { // Only fetch when auth check is complete
    fetchAccessibleAccounts();
  }
}, [fetchAccessibleAccounts, isAuthenticated]);

// Effect to sync internal state if the prop from context changes externally
useEffect(() => {
  console.log("AccountSwitcher: Prop initialAccountId changed to:", initialAccountId);
  setCurrentSelection(initialAccountId);
}, [initialAccountId]);

// Handler for when the user selects a different value in the dropdown
const handleValueChange = (value: string) => {
  console.log("AccountSwitcher: handleValueChange:", value);
  setCurrentSelection(value);
  onAccountChange(value);
};
    

  // Helper to get the right icon based on role
  const getIcon = (role: AccessibleAccountInfo['role']) => {
    switch(role) {
      case 'owner': return <Briefcase className="h-4 w-4 text-gray-700 flex-shrink-0" />;
      case 'member': return <Users className="h-4 w-4 text-gray-700 flex-shrink-0" />;
      case 'individual':
      default: return <User className="h-4 w-4 text-gray-600 flex-shrink-0" />;
    }
  }

  // Helper to get role badge style
  const getRoleBadgeStyle = (role: AccessibleAccountInfo['role']) => {
    switch(role) {
      case 'owner': return "bg-gray-900 text-white border-gray-900";
      case 'member': return "bg-gray-100 text-gray-700 border-gray-200";
      case 'individual':
      default: return "bg-gray-50 text-gray-700 border-gray-200";
    }
  }

  // --- Render Logic ---

  // Loading State
  if (isLoading) {
    return <Skeleton className="h-9 w-40 md:w-52 rounded-full bg-gray-100" />;
  }

  // Error State
  if (error && accounts.length <= 1) {
    return (
      <div className="flex items-center px-3 py-1.5 text-sm text-red-600 bg-red-50 rounded-full">
        <span className="truncate">Account Error</span>
      </div>
    );
  }

  {/*
    if (accounts.length <= 1 && !error) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-50 border border-gray-200 rounded-full shadow-sm">
        <span className="truncate">Personal Account</span>
      </div>
    );
  }
    */}
  

  // Find the currently selected account object for display in the trigger
  const selectedAccountObject = accounts.find(acc => acc.id === currentSelection) || accounts[0];

  // Render the Select dropdown
  return (
    <Select 
      value={currentSelection} 
      onValueChange={handleValueChange}
      disabled={accounts.length === 0 }
    >
      <SelectTrigger 
      data-cy="account-switcher-trigger"
      className="w-40 md:w-52 text-sm border-gray-200 rounded-full bg-white hover:bg-gray-50 transition-colors shadow-sm h-9 pr-3 focus:ring-gray-400 focus:ring-offset-2">

        <div className="flex items-center gap-2 truncate">
          {selectedAccountObject ? (
            <>
              <div className="p-1 rounded-full bg-gray-50 border border-gray-100">
                {getIcon(selectedAccountObject.role)}
              </div>
              <span className="truncate">{selectedAccountObject.name}</span>
            </>
          ) : (
            <span className="text-gray-400">Select account</span>
          )}
        </div>

      </SelectTrigger>
      {accounts.length>0 && (
        <SelectContent className="border-gray-200 shadow-md rounded-lg overflow-hidden min-w-[250px]">
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
                  {getIcon(account.role)}
                </div>
                <div className="truncate">
                  <p className="text-sm font-medium text-gray-900 truncate">{account.name}</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full border ${getRoleBadgeStyle(account.role)} capitalize`}>
                  {account.role}
                </span>
              </div>
            </SelectItem>
          ))}
        </div>
      </SelectContent>
      )}  
    </Select>
  );
}
