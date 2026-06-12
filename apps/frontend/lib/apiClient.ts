"use client";

export const AUTH_SENTINEL = "cookie";
export const CSRF_COOKIE_NAME = "contractsense_csrf";

export type ApiResult<T = unknown> = {
  data?: T;
  error?: string;
  response?: Response;
};

export type UploadProgressEvent = {
  loaded: number;
  total: number;
  percent: number;
};

export function apiBaseUrl() {
  return (process.env.NEXT_PUBLIC_EXTRACTOR_API_URL || "").replace(/\/+$/, "");
}

export function isApiUrl(input: RequestInfo | URL) {
  const base = apiBaseUrl();
  if (!base) return false;
  const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  return raw.startsWith(base);
}

export function csrfToken() {
  if (typeof document === "undefined") return "";
  const match = document.cookie
    .split("; ")
    .find((part) => part.startsWith(`${CSRF_COOKIE_NAME}=`));
  return match ? decodeURIComponent(match.split("=").slice(1).join("=")) : "";
}

export function isUnsafeMethod(method?: string) {
  return ["POST", "PUT", "PATCH", "DELETE"].includes((method || "GET").toUpperCase());
}

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const method =
    init.method ||
    (typeof input !== "string" && !(input instanceof URL) ? input.method : "GET");
  const headers = new Headers(
    init.headers || (typeof input !== "string" && !(input instanceof URL) ? input.headers : undefined),
  );
  const csrf = csrfToken();
  if (csrf && isUnsafeMethod(method)) {
    headers.set("X-CSRF-Token", csrf);
  }

  const auth = headers.get("Authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    headers.delete("Authorization");
  }

  return fetch(input, {
    ...init,
    credentials: "include",
    headers,
  });
}

export async function apiJson<T = unknown>(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<ApiResult<T>> {
  try {
    const response = await apiFetch(input, init);
    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      return {
        response,
        error: errorBody?.detail || errorBody?.message || `Request failed with status ${response.status}`,
      };
    }

    if (response.status === 204 || response.headers.get("content-length") === "0") {
      return { response, data: null as T };
    }

    return { response, data: (await response.json()) as T };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unknown API error",
    };
  }
}

export async function apiDownload(input: RequestInfo | URL, init: RequestInit = {}) {
  const response = await apiFetch(input, init);
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Download failed with status ${response.status}`);
  }
  return response.blob();
}

export function apiUploadWithProgress<T = unknown>(
  url: string,
  body: FormData,
  options: {
    method?: "POST" | "PUT" | "PATCH";
    onProgress?: (event: UploadProgressEvent) => void;
  } = {},
): Promise<ApiResult<T>> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    const method = options.method || "POST";

    xhr.upload.onprogress = (event) => {
      const total = event.total || 0;
      const percent = total > 0 ? Math.round((event.loaded / total) * 100) : 0;
      options.onProgress?.({ loaded: event.loaded, total, percent });
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve({ data: JSON.parse(xhr.responseText || "null") as T });
        } catch {
          resolve({ data: null as T });
        }
        return;
      }

      try {
        const parsed = JSON.parse(xhr.responseText || "{}");
        resolve({ error: parsed.detail || parsed.message || `Upload failed with status ${xhr.status}` });
      } catch {
        resolve({ error: `Upload failed with status ${xhr.status}` });
      }
    };

    xhr.onerror = () => resolve({ error: "Network error during upload" });
    xhr.onabort = () => resolve({ error: "Upload aborted" });
    xhr.open(method, url, true);
    xhr.withCredentials = true;

    const csrf = csrfToken();
    if (csrf && isUnsafeMethod(method)) {
      xhr.setRequestHeader("X-CSRF-Token", csrf);
    }

    xhr.send(body);
  });
}
