import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { SETTINGS_PATH } from '@/lib/data-paths';

// ─── Leer settings ────────────────────────────────────────────────────────────

function readSettings(): Record<string, string | number | null> {
  try {
    if (existsSync(SETTINGS_PATH))
      return JSON.parse(readFileSync(SETTINGS_PATH, 'utf8')) as Record<string, string | number | null>;
  } catch { /* ignorar */ }
  return {};
}

function saveSettings(updates: Record<string, string | number | null>) {
  try {
    const current = readSettings();
    writeFileSync(SETTINGS_PATH, JSON.stringify({ ...current, ...updates }, null, 2), 'utf8');
  } catch { /* ignorar */ }
}

// ─── Token — prioridad: user OAuth > client_credentials ──────────────────────
async function getAccessToken(): Promise<{ token: string; site: string } | null> {
  const s    = readSettings();
  const site = (s.mlSite as string | undefined) ?? process.env.ML_SITE ?? 'MLA';

  // 1. User token (authorization_code flow) — el que ML acepta para catalog search
  if (s.mlAccessToken) {
    const expiry = typeof s.mlTokenExpiry === 'number' ? s.mlTokenExpiry : 0;

    // Token válido todavía (buffer 5 min)
    if (Date.now() < expiry - 300_000) {
      return { token: s.mlAccessToken as string, site };
    }

    // Intentar renovar con refresh_token
    if (s.mlRefreshToken) {
      const appId     = (s.mlAppId     as string | undefined) ?? process.env.ML_APP_ID     ?? '';
      const appSecret = (s.mlAppSecret as string | undefined) ?? process.env.ML_APP_SECRET ?? '';
      try {
        const res = await fetch('https://api.mercadolibre.com/oauth/token', {
          method:  'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body:    new URLSearchParams({
            grant_type:    'refresh_token',
            client_id:     appId,
            client_secret: appSecret,
            refresh_token: s.mlRefreshToken as string,
          }).toString(),
          cache: 'no-store',
        });
        if (res.ok) {
          const tok = await res.json() as { access_token: string; refresh_token: string; expires_in: number };
          saveSettings({
            mlAccessToken:  tok.access_token,
            mlRefreshToken: tok.refresh_token,
            mlTokenExpiry:  Date.now() + tok.expires_in * 1000,
          });
          return { token: tok.access_token, site };
        }
      } catch { /* si falla el refresh, seguir */ }
    }
  }

  // 2. Sin cuenta conectada → no hay token válido para búsqueda
  return null;
}

// ─── GET /api/ml-search?q=... → devuelve token + site para que el browser llame ML directo ──
// ML bloquea requests server-side (anti-scraping). El browser los hace sin restricción.
export async function GET(req: NextRequest) {
  const rawQ    = req.nextUrl.searchParams.get('q') ?? '';
  const limit   = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? '8'), 20);
  const mode    = req.nextUrl.searchParams.get('mode') ?? 'token'; // 'token' | 'direct'

  // ── Modo token: el browser pide el token y llama ML directo ──────────────
  if (mode === 'token') {
    const auth = await getAccessToken();
    if (!auth) {
      // Sin cuenta conectada — devolvemos site para que el browser intente sin auth
      return NextResponse.json({ ok: false, error: 'not_connected', site: 'MLA' }, { status: 401 });
    }
    return NextResponse.json({
      ok:    true,
      token: auth.token,
      site:  auth.site,
      q:     rawQ,
      limit,
    });
  }

  // ── Modo direct: intenta hacer el search server-side (fallback) ───────────
  if (!rawQ || rawQ.length < 2) {
    return NextResponse.json({ ok: false, error: 'Query too short' }, { status: 400 });
  }

  const auth = await getAccessToken();
  if (!auth) {
    return NextResponse.json({ ok: false, error: 'credentials' }, { status: 401 });
  }

  try {
    const q = rawQ.replace(/[""'']/g, '').replace(/[^\w\sáéíóúüñÁÉÍÓÚÜÑ-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
    const url = `https://api.mercadolibre.com/sites/${auth.site}/search?q=${encodeURIComponent(q)}&limit=${limit}&sort=relevance`;
    const res = await fetch(url, {
      headers: {
        Accept:        'application/json',
        Authorization: `Bearer ${auth.token}`,
        'User-Agent':  'Mozilla/5.0 (compatible; AcquaControlOS/1.0)',
      },
      cache: 'no-store',
    });

    if (res.status === 401 || res.status === 403) {
      const errBody = await res.text();
      console.error('[ml-search] ML search error', res.status, errBody);
      return NextResponse.json({ ok: false, error: 'credentials' }, { status: 401 });
    }

    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `ML API error: ${res.status}` }, { status: res.status });
    }

    const data = await res.json() as {
      results: Array<{
        id: string; title: string; price: number; condition: string; permalink: string;
        thumbnail: string; sold_quantity: number; available_quantity: number;
        shipping: { free_shipping: boolean; logistic_type?: string };
        installments?: { quantity: number; amount: number; rate: number } | null;
        seller?: { nickname: string };
        tags?: string[];
      }>;
      paging: { total: number };
    };

    const EXCLUDED = ['apacheco', 'acquapacheco'];
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const items = (data.results ?? [])
      .filter(item => !EXCLUDED.some(ex => normalize(item.seller?.nickname ?? '').includes(normalize(ex))))
      .map(item => ({
        id: item.id, title: item.title, price: item.price,
        condition: item.condition, permalink: item.permalink,
        thumbnail: item.thumbnail?.replace('http:', 'https:') ?? null,
        freeShipping: item.shipping?.free_shipping ?? false,
        soldQty: item.sold_quantity ?? 0,
        seller: item.seller?.nickname ?? null,
      }));

    return NextResponse.json({ ok: true, total: data.paging?.total ?? 0, items });
  } catch (e) {
    console.error('[ml-search]', e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
