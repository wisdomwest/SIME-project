/**
 * db.ts — IndexedDB persistence for SIMElab session state.
 * All data lives in a single object store keyed by 'session'.
 * Writes are debounced to avoid thrashing on rapid state changes.
 */

const DB_NAME = 'simelab';
const DB_VERSION = 1;
const STORE_NAME = 'state';
const SAVE_KEY = 'session';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SessionState {
  graphData?: unknown;
  computedMetrics?: unknown;
  aiInsights?: unknown;
  driftData?: unknown;
  chatMessages?: unknown;
  aiAnalysisResult?: string | null;
  pythonDatasetId?: string | null;
  savedAt: number;
}

// ─── DB lifecycle ───────────────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ─── Read / Write ───────────────────────────────────────────────────────────

export async function loadSession(): Promise<SessionState | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(SAVE_KEY);
      req.onsuccess = () => {
        resolve(req.result ?? null);
      };
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  } catch (e) {
    console.warn('IndexedDB read failed:', e);
    return null;
  }
}

export async function saveSession(state: Partial<SessionState>): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      // Merge with existing data so we don't overwrite fields we aren't saving
      const getReq = store.get(SAVE_KEY);
      getReq.onsuccess = () => {
        const existing = getReq.result ?? { savedAt: 0 };
        const merged = { ...existing, ...state, savedAt: Date.now() };
        store.put(merged, SAVE_KEY);
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn('IndexedDB write failed:', e);
  }
}

export async function clearSession(): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(SAVE_KEY);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn('IndexedDB clear failed:', e);
  }
}
