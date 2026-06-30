"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/hooks/use-toast";
import { AUTH_SENTINEL, apiFetch } from "@/lib/apiClient";

const AUTH_VALIDATION_CACHE_MS = 30_000;
const USER_PROFILE_CACHE_MS = 10_000;

let authValidationCache: {
  apiUrl: string;
  isValid: boolean;
  expiresAt: number;
} | null = null;

type ApiResult = { data?: any; error?: string };

const authenticatedGetCache = new Map<string, {
  result: ApiResult;
  expiresAt: number;
}>();
const authenticatedGetInFlight = new Map<string, Promise<ApiResult>>();

let authValidationInFlight: {
  apiUrl: string;
  promise: Promise<boolean>;
} | null = null;

// Create a custom authentication hook to centralize auth logic
export const useAuth = () => {
  const [token, setToken] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null); // null = still checking
  const [authChecked, setAuthChecked] = useState(false);
  const router = useRouter();
  const apiUrl = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL;

  // Function to verify token validity with the server
  const verifyToken = useCallback(async () => {
    if (!apiUrl) {
      return false;
    }

    const now = Date.now();
    if (
      authValidationCache?.apiUrl === apiUrl &&
      authValidationCache.expiresAt > now
    ) {
      return authValidationCache.isValid;
    }

    if (authValidationInFlight?.apiUrl === apiUrl) {
      return authValidationInFlight.promise;
    }

    const validationPromise = (async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        const response = await apiFetch(`${apiUrl}/users/me/`, {
          signal: controller.signal,
        });
        clearTimeout(timeout);

        return response.ok;
      } catch (err) {
        console.warn("Token verification failed (backend might be waking up):", err);
        return false;
      }
    })();

    authValidationInFlight = {
      apiUrl,
      promise: validationPromise,
    };

    try {
      const isValid = await validationPromise;
      authValidationCache = {
        apiUrl,
        isValid,
        expiresAt: Date.now() + AUTH_VALIDATION_CACHE_MS,
      };
      return isValid;
    } finally {
      if (authValidationInFlight?.promise === validationPromise) {
        authValidationInFlight = null;
      }
    }
  }, [apiUrl]);

  // Function to handle logout
  const logout = useCallback(() => {
    const performLogout = async () => {
      authValidationCache = null;
      authValidationInFlight = null;
      authenticatedGetCache.clear();
      authenticatedGetInFlight.clear();
      try {
        if (apiUrl) {
          await apiFetch(`${apiUrl}/logout/`, {
            method: "POST",
          });
        }
      } catch {
        // Local logout should still proceed if the network is unavailable.
      }
      localStorage.removeItem("token");
      setToken(null);
      setIsAuthenticated(false);
      router.push("/signin");
    };

    void performLogout();
  }, [apiUrl, router]);

  // Initialize authentication state
  useEffect(() => {
    const checkAuth = async () => {
      const isValid = await verifyToken();
      setIsAuthenticated(isValid);
      setToken(isValid ? AUTH_SENTINEL : null);
      
      if (isValid) {
        localStorage.setItem("token", AUTH_SENTINEL);
      } else {
        const legacyToken = localStorage.getItem("token");
        localStorage.removeItem("token");
        if (legacyToken) {
          toast({
            title: "Session expired",
            description: "Please sign in again",
            variant: "destructive"
          });
        }
      }

      setAuthChecked(true);
    };
    
    checkAuth();
  }, [verifyToken]);

  // Redirect if not authenticated after check
  useEffect(() => {
    if (authChecked && !isAuthenticated) {
      router.push("/signin");
    }
  }, [authChecked, isAuthenticated, router]);

  // Utility function to handle API responses with auth errors
  const handleApiResponse = useCallback(async (promise: Promise<Response>) => {
    try {
      const response = await promise;
      
      // Handle authentication errors
      if (response.status === 401 || response.status === 403) {
        logout();
        return { error: "Authentication failed" };
      }
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        return { 
          error: errorData?.detail || `Request failed with status ${response.status}`
        };
      }
      
      if (response.status === 204) {
        return { data: null };
      }

      return { data: await response.json() };
    } catch (err) {
      console.error("API request failed:", err);
      return { error: err instanceof Error ? err.message : "Unknown error occurred" };
    }
  }, [logout]);

  // Function to make authenticated API calls
  const authenticatedFetch = useCallback(async (url: string, options: RequestInit = {}) => {
    if (!token) {
      return { error: "Not authenticated" };
    }
    
    const authOptions = {
      ...options,
    };

    const method = (options.method || "GET").toUpperCase();
    const requestPath = new URL(
      url,
      typeof window !== "undefined" ? window.location.origin : "http://localhost",
    ).pathname;
    const isCacheableUserProfileRequest =
      method === "GET" &&
      !options.body &&
      /\/users\/me\/?$/.test(requestPath);

    if (isCacheableUserProfileRequest) {
      const cacheKey = `${AUTH_SENTINEL}:${url}`;
      const cached = authenticatedGetCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.result;
      }

      const inFlight = authenticatedGetInFlight.get(cacheKey);
      if (inFlight) {
        return inFlight;
      }

      const request = handleApiResponse(apiFetch(url, authOptions)).then((result) => {
        if (!result.error) {
          authenticatedGetCache.set(cacheKey, {
            result,
            expiresAt: Date.now() + USER_PROFILE_CACHE_MS,
          });
        }
        return result;
      }).finally(() => {
        authenticatedGetInFlight.delete(cacheKey);
      });

      authenticatedGetInFlight.set(cacheKey, request);
      return request;
    }
    
    return handleApiResponse(apiFetch(url, authOptions));
  }, [token, handleApiResponse]);

  return {
    token,
    isAuthenticated,
    authChecked,
    logout,
    authenticatedFetch
  };
};
