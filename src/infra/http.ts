import { setTimeout as sleep } from "node:timers/promises";

export interface HttpRequestOptions {
  headers?: Record<string, string>;
  retries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
}

export async function fetchJson<T>(url: string, options: HttpRequestOptions = {}): Promise<T> {
  const response = await fetchWithRetry(url, options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return (await response.json()) as T;
}

export async function fetchWithRetry(url: string, options: HttpRequestOptions = {}): Promise<Response> {
  const retries = options.retries ?? 2;
  const retryDelayMs = options.retryDelayMs ?? 500;

  let lastError: unknown;
  for (let i = 0; i <= retries; i += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": "plugin-ctl/0.1",
          accept: "application/json",
          ...options.headers,
        },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (response.status >= 500 && i < retries) {
        await sleep(retryDelayMs * (i + 1));
        continue;
      }
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error;
      if (i < retries) {
        await sleep(retryDelayMs * (i + 1));
        continue;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Failed to fetch ${url}`);
}
