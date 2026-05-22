'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { MLLabState, MLLabProduct, MLProductParams, MLPublication } from './ml-lab-types';
import { DEFAULT_ML_PARAMS } from './ml-lab-types';
import { calcProfitability, calcIdealPrice, generateAlerts } from './ml-lab-engine';

const STORAGE_KEY = 'acqua_ml_lab_v1';   // localStorage (backup)
const API_PATH    = '/api/ml-lab';        // disco (fuente de verdad)

// ─── Merge helper (pure) ──────────────────────────────────────────────────────
type ImportType = 'odoo' | 'ml' | 'full';

function mergeOne(
  ex: MLLabProduct,
  np: MLLabProduct,
  importType: ImportType,
  gParams: MLProductParams,
): MLLabProduct {
  const now = new Date().toISOString();
  const params = { ...gParams, ...(ex.params ?? {}) };

  if (importType === 'odoo') {
    // Solo actualiza markup y precios Odoo; recalcula con el precio ML existente
    const freshCalc = (ex.mlPrice && ex.mlPrice > 0 && ex.cost > 0)
      ? calcProfitability(ex.mlPrice, ex.cost, params) ?? undefined
      : undefined;
    const idealPrice = ex.cost > 0 ? calcIdealPrice(ex.cost, params.idealMargin, params) : 0;
    const freshCalcIdeal = (idealPrice > 0 && ex.cost > 0)
      ? calcProfitability(idealPrice, ex.cost, params) ?? undefined
      : undefined;
    const merged: MLLabProduct = {
      ...ex,
      markup:     np.markup,
      odooPrice:  np.odooPrice,
      odooListML: np.odooListML,
      calc:       freshCalc,
      calcIdeal:  freshCalcIdeal,
      updatedAt:  now,
    };
    merged.alerts = generateAlerts(merged, gParams);
    return merged;
  }

  if (importType === 'ml') {
    // Solo actualiza campos de publicación ML; preserva markup y datos Odoo
    const merged: MLLabProduct = {
      ...ex,
      mlItemId:          np.mlItemId,
      mlTitle:           np.mlTitle,
      mlPrice:           np.mlPrice,
      mlStatus:          np.mlStatus,
      mlStock:           np.mlStock,
      mlSold:            np.mlSold,
      mlVisits:          np.mlVisits,
      mlFreeShipping:    np.mlFreeShipping,
      mlHasInstallments: np.mlHasInstallments,
      mlIsFull:          np.mlIsFull,
      mlListingType:     np.mlListingType,
      mlPermalink:       np.mlPermalink,
      mlCondition:       np.mlCondition,
      mlThumbnail:       np.mlThumbnail,
      mlFamilyId:        np.mlFamilyId,
      mlCategory:        np.mlCategory,
      mlDescription:     np.mlDescription,
      syncStatus:        np.syncStatus,
      matchConfidence:   np.matchConfidence,
      matchMethod:       np.matchMethod,
      calc:              np.calc,   // calculado con el nuevo precio ML
      updatedAt:         now,
    };
    merged.alerts = generateAlerts(merged, gParams);
    return merged;
  }

  // importType === 'full': actualiza todo, preserva overrides del usuario
  return {
    ...np,
    id:               ex.id,
    createdAt:        ex.createdAt,
    notes:            ex.notes,
    params:           ex.params,
    pendingOdooUpdate: ex.pendingOdooUpdate,
    localMarkup:      ex.localMarkup,
    updatedAt:        now,
  };
}

const DEFAULT_STATE: MLLabState = {
  products: [],
  globalParams: { ...DEFAULT_ML_PARAMS },
  version: 1,
};

export function useMLLabStore() {
  const [state,    setState]   = useState<MLLabState>(DEFAULT_STATE);
  const [hydrated, setHydrated] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Carga inicial desde disco (API) ──────────────────────────────────────
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(API_PATH);
        if (res.ok) {
          const data = await res.json() as MLLabState;
          if (data && typeof data === 'object') {
            setState({ ...DEFAULT_STATE, ...data });
            setHydrated(true);
            return;
          }
        }
      } catch { /* red no disponible → fallback localStorage */ }

      // Fallback: localStorage
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as MLLabState;
          setState({ ...DEFAULT_STATE, ...parsed });
        }
      } catch { /* ignorar */ }
      setHydrated(true);
    }
    load();
  }, []);

  // ── Persistencia en cada cambio (después de hidratar) ────────────────────
  useEffect(() => {
    if (!hydrated) return;

    // 1. localStorage inmediato (backup rápido)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* cuota */ }

    // 2. Disco — debounced 600 ms para no spamear el API con cada keystroke
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch(API_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state),
      }).catch(() => { /* ignorar errores de red */ });
    }, 600);

    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [state, hydrated]);

  // ── Acciones ──────────────────────────────────────────────────────────────

  /** Reemplaza todos los productos (después de importar) */
  const setProducts = useCallback((products: MLLabProduct[], meta?: {
    odooFileName?: string;
    mlFileName?: string;
    orphanPubs?: MLPublication[];
  }) => {
    setState(prev => ({
      ...prev,
      products,
      orphanPubs:   meta?.orphanPubs  !== undefined ? meta.orphanPubs : prev.orphanPubs,
      lastImportAt: new Date().toISOString(),
      odooFileName: meta?.odooFileName ?? prev.odooFileName,
      mlFileName:   meta?.mlFileName   ?? prev.mlFileName,
    }));
  }, []);

  /**
   * Hace MERGE de productos importados en el estado existente.
   * - Productos que ya existen → se actualizan (solo los campos del importType)
   * - Productos nuevos → se agregan
   * - Productos existentes NO en el import → se conservan intactos
   *
   * importType:
   *   'odoo'  → solo actualiza markup + precios Odoo
   *   'ml'    → solo actualiza campos de publicación ML
   *   'full'  → actualiza todo, preserva notas/params/overrides del usuario
   */
  const mergeProducts = useCallback((
    incoming: MLLabProduct[],
    meta?: {
      odooFileName?: string;
      mlFileName?: string;
      orphanPubs?: MLPublication[];
      importType?: ImportType;
    },
  ) => {
    setState(prev => {
      const importType = meta?.importType ?? 'full';
      const existing   = prev.products;
      const gParams    = prev.globalParams;

      // Mapas de búsqueda para productos existentes
      const bySku     = new Map(existing.filter(p => p.sku)     .map(p => [p.sku!.toLowerCase(),  p]));
      const byBarcode = new Map(existing.filter(p => p.barcode) .map(p => [p.barcode!,            p]));
      const byOdooId  = new Map(existing.filter(p => p.odooId)  .map(p => [p.odooId!,             p]));
      const byMlItem  = new Map(existing.filter(p => p.mlItemId).map(p => [p.mlItemId!,           p]));

      // Para cada producto entrante, busca su contraparte existente
      const handledExistingIds = new Set<string>();   // existing.id que se actualizaron
      const newProducts:        MLLabProduct[] = [];  // productos que no están en existing

      const updates = new Map<string, MLLabProduct>(); // existing.id → merged product

      for (const np of incoming) {
        const ex =
          (np.sku      ? bySku.get(np.sku.toLowerCase()) : undefined) ??
          (np.barcode  ? byBarcode.get(np.barcode)        : undefined) ??
          (np.odooId   ? byOdooId.get(np.odooId)          : undefined) ??
          (np.mlItemId ? byMlItem.get(np.mlItemId)        : undefined);

        if (ex) {
          handledExistingIds.add(ex.id);
          updates.set(ex.id, mergeOne(ex, np, importType, gParams));
        } else {
          newProducts.push(np);
        }
      }

      // Resultado: productos existentes (actualizados si aplica) + nuevos al final
      const result: MLLabProduct[] = [
        ...existing.map(ex => updates.get(ex.id) ?? ex),
        ...newProducts,
      ];

      return {
        ...prev,
        products:     result,
        orphanPubs:   meta?.orphanPubs  !== undefined ? meta.orphanPubs : prev.orphanPubs,
        lastImportAt: new Date().toISOString(),
        odooFileName: meta?.odooFileName ?? prev.odooFileName,
        mlFileName:   meta?.mlFileName   ?? prev.mlFileName,
      };
    });
  }, []);

  /** Actualiza un producto (ej: params override, notas) */
  const updateProduct = useCallback((id: string, updates: Partial<MLLabProduct>) => {
    setState(prev => ({
      ...prev,
      products: prev.products.map(p =>
        p.id === id ? { ...p, ...updates, updatedAt: new Date().toISOString() } : p
      ),
    }));
  }, []);

  /** Actualiza parámetros globales */
  const setGlobalParams = useCallback((params: Partial<MLProductParams>) => {
    setState(prev => ({
      ...prev,
      globalParams: { ...prev.globalParams, ...params },
    }));
  }, []);

  /** Limpia todos los datos */
  const clearAll = useCallback(() => {
    setState(DEFAULT_STATE);
  }, []);

  // ── Stats calculadas ──────────────────────────────────────────────────────
  const stats = {
    total:          state.products.length,
    sincronizados:  state.products.filter(p => p.syncStatus === 'sincronizado').length,
    sinPublicacion: state.products.filter(p => p.syncStatus === 'sin_publicacion').length,
    bajoMargen:     state.products.filter(p => p.calc?.status === 'bajo_margen').length,
    pierde:         state.products.filter(p => p.calc?.status === 'pierde').length,
    rentables:      state.products.filter(p => p.calc?.status === 'rentable').length,
    sinCosto:       state.products.filter(p => !p.cost || p.cost === 0).length,
    conStock:       state.products.filter(p => p.stock > 0).length,
    activas:        state.products.filter(p => p.mlStatus === 'active' || p.mlStatus === 'activo').length,
    conVentas:      state.products.filter(p => (p.mlSold ?? 0) > 0).length,
    matchDudoso:    state.products.filter(p => p.syncStatus === 'match_dudoso').length,
    pendienteOdoo:  state.products.filter(p => p.pendingOdooUpdate).length,
    inactivas:      state.products.filter(p => p.mlStatus === 'inactive').length,
  };

  return {
    ...state,
    hydrated,
    stats,
    setProducts,
    mergeProducts,
    updateProduct,
    setGlobalParams,
    clearAll,
  };
}
