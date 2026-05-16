'use client';

import { useState, useEffect, useCallback } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type MLStatus = 'activo' | 'inactivo' | 'pausado' | 'candidato';

export interface MLProductConfig {
  /** product.id from products.json */
  productId: string;
  /** MercadoLibre listing ID, e.g. "MLA1234567890" */
  mlItemId?: string;
  mlStatus: MLStatus;
  /** Published price on ML (if known) */
  publishedPrice?: number;
  /** Commission % used (e.g. 11.62) */
  commission?: number;
  /** Cuotas key: '0', '3i', '6i', '9i', '12i', '3s', '6s', '9s', '12s' */
  cuotasKey?: string;
  freeShipping?: boolean;
  /** Notes / observations */
  notes?: string;
  /** ISO timestamp of last update */
  updatedAt: string;
}

const STORAGE_KEY = 'acqua_ml_products_v1';

// ─────────────────────────────────────────────────────────────────────────────
// HOOK
// ─────────────────────────────────────────────────────────────────────────────

export function useMLProducts() {
  const [configs, setConfigs] = useState<Record<string, MLProductConfig>>({});
  const [hydrated, setHydrated] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setConfigs(JSON.parse(raw) as Record<string, MLProductConfig>);
    } catch {
      // ignore parse errors
    }
    setHydrated(true);
  }, []);

  // Persist whenever configs change (after hydration)
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
    } catch {
      // storage quota exceeded or SSR
    }
  }, [configs, hydrated]);

  /** Assign or update a product's ML config */
  const setMLConfig = useCallback((productId: string, update: Partial<MLProductConfig> & { mlStatus: MLStatus }) => {
    setConfigs(prev => ({
      ...prev,
      [productId]: {
        ...prev[productId],
        productId,
        ...update,
        updatedAt: new Date().toISOString(),
      },
    }));
  }, []);

  /** Remove a product from ML tracking entirely */
  const removeMLConfig = useCallback((productId: string) => {
    setConfigs(prev => {
      const next = { ...prev };
      delete next[productId];
      return next;
    });
  }, []);

  /** Get config for a single product (undefined if not in ML) */
  const getMLConfig = useCallback((productId: string): MLProductConfig | undefined => {
    return configs[productId];
  }, [configs]);

  /** All products currently tracked in ML */
  const mlProducts = Object.values(configs);

  /** Count by status */
  const mlCounts = {
    total:     mlProducts.length,
    activo:    mlProducts.filter(c => c.mlStatus === 'activo').length,
    inactivo:  mlProducts.filter(c => c.mlStatus === 'inactivo').length,
    pausado:   mlProducts.filter(c => c.mlStatus === 'pausado').length,
    candidato: mlProducts.filter(c => c.mlStatus === 'candidato').length,
  };

  return { configs, mlProducts, mlCounts, hydrated, setMLConfig, removeMLConfig, getMLConfig };
}

// ─────────────────────────────────────────────────────────────────────────────
// DISPLAY HELPERS
// ─────────────────────────────────────────────────────────────────────────────

export const ML_STATUS_LABELS: Record<MLStatus, string> = {
  activo:    'Activo',
  inactivo:  'Inactivo',
  pausado:   'Pausado',
  candidato: 'Candidato',
};

export const ML_STATUS_COLORS: Record<MLStatus, { bg: string; text: string; border: string; dot: string }> = {
  activo:    { bg: 'bg-[#16A34A]/10', text: 'text-[#16A34A]', border: 'border-[#16A34A]/20', dot: 'bg-[#16A34A]' },
  inactivo:  { bg: 'bg-gray-100',     text: 'text-gray-500',  border: 'border-gray-200',      dot: 'bg-gray-400' },
  pausado:   { bg: 'bg-[#F97316]/10', text: 'text-[#F97316]', border: 'border-[#F97316]/20', dot: 'bg-[#F97316]' },
  candidato: { bg: 'bg-[#0784F2]/10', text: 'text-[#0784F2]', border: 'border-[#0784F2]/20', dot: 'bg-[#0784F2]' },
};
