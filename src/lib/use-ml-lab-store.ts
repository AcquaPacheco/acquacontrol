'use client';

import { useState, useEffect, useCallback } from 'react';
import type { MLLabState, MLLabProduct, MLProductParams } from './ml-lab-types';
import { DEFAULT_ML_PARAMS } from './ml-lab-types';

const STORAGE_KEY = 'acqua_ml_lab_v1';

const DEFAULT_STATE: MLLabState = {
  products: [],
  globalParams: { ...DEFAULT_ML_PARAMS },
  version: 1,
};

export function useMLLabStore() {
  const [state, setState] = useState<MLLabState>(DEFAULT_STATE);
  const [hydrated, setHydrated] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as MLLabState;
        setState({ ...DEFAULT_STATE, ...parsed });
      }
    } catch {
      // ignore
    }
    setHydrated(true);
  }, []);

  // Persist on every change (after hydration)
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // quota exceeded
    }
  }, [state, hydrated]);

  /** Replace all products (after import) */
  const setProducts = useCallback((products: MLLabProduct[], meta?: {
    odooFileName?: string;
    mlFileName?: string;
  }) => {
    setState(prev => ({
      ...prev,
      products,
      lastImportAt: new Date().toISOString(),
      odooFileName: meta?.odooFileName ?? prev.odooFileName,
      mlFileName:   meta?.mlFileName   ?? prev.mlFileName,
    }));
  }, []);

  /** Update a single product (e.g. params override, notes) */
  const updateProduct = useCallback((id: string, updates: Partial<MLLabProduct>) => {
    setState(prev => ({
      ...prev,
      products: prev.products.map(p =>
        p.id === id ? { ...p, ...updates, updatedAt: new Date().toISOString() } : p
      ),
    }));
  }, []);

  /** Update global params */
  const setGlobalParams = useCallback((params: Partial<MLProductParams>) => {
    setState(prev => ({
      ...prev,
      globalParams: { ...prev.globalParams, ...params },
    }));
  }, []);

  /** Clear all data */
  const clearAll = useCallback(() => {
    setState(DEFAULT_STATE);
  }, []);

  // ── Computed stats ─────────────────────────────────────────────────
  const stats = {
    total:        state.products.length,
    sincronizados: state.products.filter(p => p.syncStatus === 'sincronizado').length,
    sinPublicacion: state.products.filter(p => p.syncStatus === 'sin_publicacion').length,
    bajoMargen:   state.products.filter(p => p.calc?.status === 'bajo_margen').length,
    pierde:       state.products.filter(p => p.calc?.status === 'pierde').length,
    rentables:    state.products.filter(p => p.calc?.status === 'rentable').length,
    sinCosto:     state.products.filter(p => !p.cost || p.cost === 0).length,
    conStock:     state.products.filter(p => p.stock > 0).length,
    activas:      state.products.filter(p => p.mlStatus === 'active' || p.mlStatus === 'activo').length,
    conVentas:    state.products.filter(p => (p.mlSold ?? 0) > 0).length,
    matchDudoso:  state.products.filter(p => p.syncStatus === 'match_dudoso').length,
  };

  return {
    ...state,
    hydrated,
    stats,
    setProducts,
    updateProduct,
    setGlobalParams,
    clearAll,
  };
}
