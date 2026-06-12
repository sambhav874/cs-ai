"use client";

import React, { createContext, useState, useContext, ReactNode, useEffect, useCallback, useMemo } from 'react';

type AccountContextType = {
    selectedAccountId: string; // 'personal' or the string ObjectId of the selected account
    setSelectedAccount: (accountId: string) => void;
    isInitialized: boolean; // Flag to indicate when client hydration is complete
};

// Create the context with default values
const AccountContext = createContext<AccountContextType>({
    selectedAccountId: 'personal',
    setSelectedAccount: () => {},
    isInitialized: false
});

// Create the Provider component
export const AccountProvider = ({ children }: { children: ReactNode }) => {
    const [selectedAccountId, setSelectedAccountIdState] = useState<string>('personal');
    const [isInitialized, setIsInitialized] = useState<boolean>(false);

    // Load initial state from localStorage on mount (client-side only)
    useEffect(() => {
        // This runs after hydration is complete (client-side only)
        const storedAccountId = localStorage.getItem('selectedAccountId') || 'personal';
        setSelectedAccountIdState(storedAccountId);
        setIsInitialized(true); // Mark as initialized after hydration
    }, []); // Run only once on initial client mount

    // Function to update state and localStorage
    const setSelectedAccount = useCallback((accountId: string) => {
        if (typeof window !== 'undefined') { // Check if running in browser
            localStorage.setItem('selectedAccountId', accountId); // Persist selection
            setSelectedAccountIdState(accountId);
        }
    }, []);

    // The value provided to consuming components
    const value = useMemo(() => ({
        selectedAccountId,
        setSelectedAccount,
        isInitialized
    }), [selectedAccountId, setSelectedAccount, isInitialized]);

    return (
        <AccountContext.Provider value={value}>
            {children}
        </AccountContext.Provider>
    );
};

// Custom hook to easily consume the context
export const useAccountContext = () => {
    const context = useContext(AccountContext);
    if (context === undefined) {
        throw new Error('useAccountContext must be used within an AccountProvider');
    }
    return context;
};
