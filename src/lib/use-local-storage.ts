'use client';
import { useState, useEffect, useCallback } from 'react';

export function useLocalStorage<T>(key: string, initialValue: T): [T, (val: T | ((prev: T) => T)) => void, () => void] {
  const [state, setState] = useState<T>(initialValue);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const item = window.localStorage.getItem(key);
      if (item !== null) setState(JSON.parse(item));
    } catch {}
    setHydrated(true);
  }, [key]);

  const setValue = useCallback((value: T | ((prev: T) => T)) => {
    setState(prev => {
      const next = typeof value === 'function' ? (value as (p: T) => T)(prev) : value;
      try { window.localStorage.setItem(key, JSON.stringify(next)); } catch {}
      return next;
    });
  }, [key]);

  const reset = useCallback(() => {
    try { window.localStorage.removeItem(key); } catch {}
    setState(initialValue);
  }, [key, initialValue]);

  return [state, setValue, reset];
}

// Helper: save a single supplier override
export function saveSupplierOverride(id: string, data: Record<string, unknown>) {
  try {
    const existing = JSON.parse(localStorage.getItem('suppliers-overrides') || '{}');
    existing[id] = { ...(existing[id] || {}), ...data };
    localStorage.setItem('suppliers-overrides', JSON.stringify(existing));
  } catch {}
}

export function loadSupplierOverride(id: string): Record<string, unknown> {
  try {
    const all = JSON.parse(localStorage.getItem('suppliers-overrides') || '{}');
    return all[id] || {};
  } catch { return {}; }
}

export function loadAllOverrides(): Record<string, Record<string, unknown>> {
  try { return JSON.parse(localStorage.getItem('suppliers-overrides') || '{}'); }
  catch { return {}; }
}
