import { NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { SETTINGS_PATH } from '@/lib/data-paths';

type Settings = Record<string, unknown>;

function readSettings(): Settings {
  try {
    return existsSync(SETTINGS_PATH)
      ? (JSON.parse(readFileSync(SETTINGS_PATH, 'utf8')) as Settings)
      : {};
  } catch { return {}; }
}

function saveSettings(u: Settings): void {
  const c = readSettings();
  writeFileSync(SETTINGS_PATH, JSON.stringify({ ...c, ...u }, null, 2), 'utf8');
}

/** Devuelve un token válido, refrescándolo automáticamente si expiró */
async function getValidToken(): Promise<string | null> {
  const s = readSettings();
  if (!s.mlAccessToken) return null;

  // Token vigente (con 5 min de buffer)
  if (s.mlTokenExpiry && Date.now() < (s.mlTokenExpiry as number) - 300_000) {
    return s.mlAccessToken as string;
  }

  // Refrescar
  const appId     = (s.mlAppId     as string | undefined) ?? '';
  const appSecret = (s.mlAppSecret as string | undefined) ?? '';
  const refresh   = (s.mlRefreshToken as string | undefined) ?? '';
  if (!appId || !appSecret || !refresh) return null;

  const res = await fetch('https://api.mercadolibre.com/oauth/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type:    'refresh_token',
      client_id:     appId,
      client_secret: appSecret,
      refresh_token: refresh,
    }).toString(),
    cache: 'no-store',
  });

  if (!res.ok) { console.error('[ml-sync] refresh failed:', res.status); return null; }

  const d = await res.json() as { access_token: string; refresh_token: string; expires_in: number };
  saveSettings({
    mlAccessToken:  d.access_token,
    mlRefreshToken: d.refresh_token,
    mlTokenExpiry:  Date.now() + d.expires_in * 1000,
  });
  return d.access_token;
}

async function mlGet<T>(path: string, token: string): Promise<T> {
  const r = await fetch(`https://api.mercadolibre.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    cache:   'no-store',
  });
  if (!r.ok) throw new Error(`ML ${r.status}: ${path}`);
  return r.json() as Promise<T>;
}

/**
 * GET /api/ml-sync
 * Trae todas las publicaciones activas del vendedor usando el token OAuth almacenado.
 */
export async function GET() {
  const token = await getValidToken();
  if (!token) {
    return NextResponse.json(
      { ok: false, error: 'Sin sesión ML activa. Conectá tu cuenta.', needsAuth: true },
      { status: 401 },
    );
  }

  const s      = readSettings();
  const userId = s.mlUserId;
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: 'No hay usuario ML configurado.' },
      { status: 401 },
    );
  }

  try {
    // 1. Paginar IDs de publicaciones activas
    const allIds: string[] = [];
    let offset = 0;
    const LIMIT = 100;

    while (true) {
      const page = await mlGet<{ results: string[]; paging: { total: number } }>(
        `/users/${userId}/items/search?status=active&limit=${LIMIT}&offset=${offset}`,
        token,
      );
      allIds.push(...page.results);
      const total = page.paging?.total ?? 0;
      if (allIds.length >= total || page.results.length < LIMIT || allIds.length >= 500) break;
      offset += LIMIT;
    }

    if (allIds.length === 0) {
      return NextResponse.json({ ok: true, items: [], total: 0, syncedAt: new Date().toISOString() });
    }

    // 2. Multi-get de detalles en batches de 20
    const BATCH = 20;
    const ATTRS = [
      'id', 'title', 'price', 'base_price', 'condition', 'status',
      'available_quantity', 'sold_quantity', 'thumbnail', 'pictures',
      'listing_type_id', 'permalink', 'shipping', 'seller_custom_field',
      'health', 'catalog_listing', 'date_created', 'last_updated',
    ].join(',');

    const items: Record<string, unknown>[] = [];
    for (let i = 0; i < allIds.length; i += BATCH) {
      const batch = allIds.slice(i, i + BATCH);
      const batchRes = await mlGet<Array<{ code: number; body: Record<string, unknown> }>>(
        `/items?ids=${batch.join(',')}&attributes=${ATTRS}`,
        token,
      );
      for (const r of batchRes) {
        if (r.code === 200 && r.body) items.push(r.body);
      }
    }

    return NextResponse.json({
      ok:       true,
      total:    items.length,
      items,
      syncedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[ml-sync]', e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
