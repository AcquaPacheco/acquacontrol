import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// ─── Leer credenciales ML desde settings.json (prioridad) o .env (fallback) ──
const SETTINGS_PATH = resolve(process.cwd(), 'src/data/settings.json');

function readMLCredentials(): { appId: string; appSecret: string; site: string } {
  try {
    if (existsSync(SETTINGS_PATH)) {
      const s = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8')) as {
        mlAppId?: string; mlAppSecret?: string; mlSite?: string;
      };
      if (s.mlAppId && s.mlAppSecret) {
        return { appId: s.mlAppId, appSecret: s.mlAppSecret, site: s.mlSite ?? 'MLA' };
      }
    }
  } catch { /* ignorar */ }
  return {
    appId:     process.env.ML_APP_ID     ?? '',
    appSecret: process.env.ML_APP_SECRET ?? '',
    site:      process.env.ML_SITE       ?? 'MLA',
  };
}

// ─── Token cache (in-memory, se renueva automáticamente) ─────────────────────
let cachedToken: { token: string; expiresAt: number; site: string } | null = null;

async function getAccessToken(): Promise<{ token: string; site: string } | null> {
  const { appId, appSecret, site } = readMLCredentials();
  if (!appId || !appSecret) return null;

  // Token válido todavía (buffer 5 min)
  if (cachedToken && Date.now() < cachedToken.expiresAt - 300_000) {
    return { token: cachedToken.token, site: cachedToken.site };
  }

  try {
    const res = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type:    'client_credentials',
        client_id:     appId,
        client_secret: appSecret,
      }).toString(),
      cache: 'no-store',
    });

    if (!res.ok) {
      console.error('[ml-token] OAuth error:', res.status, await res.text());
      return null;
    }

    const data = await res.json() as { access_token: string; expires_in: number };
    cachedToken = {
      token:     data.access_token,
      site,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
    return { token: cachedToken.token, site };
  } catch (e) {
    console.error('[ml-token] OAuth fetch failed:', e);
    return null;
  }
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
      return NextResponse.json({ ok: false, error: 'credentials' }, { status: 401 });
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
      cachedToken = null;
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
