"use client";

import { useEffect } from "react";
import axios, { AxiosHeaders } from "axios";
import { AUTH_SENTINEL, apiBaseUrl, csrfToken, isApiUrl, isUnsafeMethod } from "@/lib/apiClient";

function scrubLegacyStoredJwt() {
  try {
    const token = window.localStorage.getItem("token");
    if (token && token.split(".").length === 3) {
      window.localStorage.setItem("token", AUTH_SENTINEL);
    }
  } catch {
    // Ignore storage access failures; cookies remain the source of truth.
  }
}

export default function SecureApiProvider() {
  useEffect(() => {
    scrubLegacyStoredJwt();

    const originalFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init: RequestInit = {}) => {
      if (!isApiUrl(input)) {
        return originalFetch(input, init);
      }

      const method =
        init.method ||
        (typeof input !== "string" && !(input instanceof URL) ? input.method : "GET");
      const headers = new Headers(init.headers || (typeof input !== "string" && !(input instanceof URL) ? input.headers : undefined));
      const csrf = csrfToken();
      if (csrf && isUnsafeMethod(method)) {
        headers.set("X-CSRF-Token", csrf);
      }
      if (headers.get("Authorization")?.toLowerCase().startsWith("bearer ")) {
        headers.delete("Authorization");
      }

      return originalFetch(input, {
        ...init,
        credentials: "include",
        headers,
      });
    };

    const interceptor = axios.interceptors.request.use((config) => {
      const base = apiBaseUrl();
      const rawUrl = config.url || "";
      const isApiRequest = Boolean(base && (rawUrl.startsWith(base) || (config.baseURL || "").startsWith(base)));
      if (!isApiRequest) return config;

      config.withCredentials = true;
      const csrf = csrfToken();
      const headers = AxiosHeaders.from(config.headers);
      if (csrf && isUnsafeMethod(config.method)) {
        headers.set("X-CSRF-Token", csrf);
      }
      const authHeader = headers.get("Authorization");
      if (typeof authHeader === "string" && authHeader.toLowerCase().startsWith("bearer ")) {
        headers.delete("Authorization");
      }
      config.headers = headers;
      return config;
    });

    return () => {
      window.fetch = originalFetch;
      axios.interceptors.request.eject(interceptor);
    };
  }, []);

  return null;
}
