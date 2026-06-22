import { useEffect, useState, useCallback } from 'react';
import { getHealth } from '../services/pythonApi';

export type BackendStatus = 'loading' | 'up' | 'down';

export interface BackendState {
  status: BackendStatus;
  loadedDatasets: string[];
  error?: string;
  refresh: () => Promise<void>;
}

export function usePythonBackend(): BackendState {
  const [status, setStatus] = useState<BackendStatus>('loading');
  const [loadedDatasets, setLoadedDatasets] = useState<string[]>([]);
  const [error, setError] = useState<string | undefined>();

  const probe = useCallback(async (isInitial = false) => {
    if (isInitial) setStatus('loading');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000); // 4 s hard timeout
    try {
      const h = await getHealth(controller.signal);
      clearTimeout(timeout);
      setLoadedDatasets(h.loaded_datasets);
      setStatus('up');
      setError(undefined);
    } catch (e) {
      clearTimeout(timeout);
      const msg = e instanceof Error ? e.message : 'Backend unreachable';
      setStatus((prev) => (prev === 'up' ? prev : 'down'));
      setError(msg);
    }
  }, []);

  useEffect(() => {
    probe(true);
    // Poll every 5s — when backend is slow to start, this picks it up fast
    const id = setInterval(() => probe(), 5000);
    return () => clearInterval(id);
  }, [probe]);

  return { status, loadedDatasets, error, refresh: () => probe(true) };
}
