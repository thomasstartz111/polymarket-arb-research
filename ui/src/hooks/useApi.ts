import { useState, useEffect, useCallback } from 'react';

interface UseApiResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Custom hook for API calls with loading and error states
 */
export function useApi<T>(
  url: string,
  options?: RequestInit,
  immediate = true
): UseApiResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(immediate);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const result = await response.json();
      setData(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [url, options]);

  useEffect(() => {
    if (immediate) {
      fetchData();
    }
  }, [fetchData, immediate]);

  return { data, loading, error, refetch: fetchData };
}

/**
 * POST helper with automatic JSON handling
 */
export async function postApi<T>(
  url: string,
  body: Record<string, unknown>
): Promise<{ data: T | null; error: string | null }> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return { data: null, error: errorData.error || `HTTP ${response.status}` };
    }

    const data = await response.json();
    return { data, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { data: null, error: message };
  }
}
