'use client';
import { useState, useEffect } from 'react';

export interface AppSettings {
  odooServerUrl: string;
}

const DEFAULT: AppSettings = { odooServerUrl: '' };

/**
 * Hook para leer/escribir la configuración global de la app (settings.json).
 * Se sincroniza con /api/settings en cada mount.
 */
export function useSettings(): {
  settings: AppSettings;
  loading: boolean;
  save: (patch: Partial<AppSettings>) => Promise<void>;
} {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then((data: AppSettings) => { setSettings(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const save = async (patch: Partial<AppSettings>) => {
    const updated = { ...settings, ...patch };
    setSettings(updated);
    await fetch('/api/settings', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(patch),
    });
  };

  return { settings, loading, save };
}

/**
 * Construye la URL de imagen de Odoo para un producto o contacto.
 * Retorna null si no hay odooId o si el servidor no está configurado.
 */
export function buildOdooImageUrl(
  odooId:    number | null | undefined,
  model:     'product.template' | 'res.partner',
  serverUrl: string,
): string | null {
  if (!odooId || !serverUrl) return null;
  const base = serverUrl.replace(/\/$/, ''); // quitar trailing slash
  return `${base}/web/image/${model}/${odooId}/image_1920`;
}

/**
 * Extrae el ID numérico de Odoo desde un external ID como
 * "__export__.product_template_1513_3ed5c773" → 1513
 * "__export__.res_partner_838_c94aefaf"       → 838
 */
export function extractOdooId(externalId: string | null | undefined): number | null {
  if (!externalId) return null;
  // Busca el último bloque de dígitos antes del hash final
  const match = externalId.match(/_(\d+)_[a-f0-9]+$/);
  return match ? parseInt(match[1], 10) : null;
}
