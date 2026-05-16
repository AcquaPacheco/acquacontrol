import { NextRequest, NextResponse } from 'next/server';

// ─── ML App Token cache (in-memory, valid 6h) ─────────────────────────────────
let _cachedToken: string | null = null;
let _tokenExpiresAt = 0;

async function getMLToken(): Promise<string | null> {
  const appId     = process.env.ML_APP_ID;
  const appSecret = process.env.ML_APP_SECRET;
  if (!appId || !appSecret) return null;

  // Return cached token if still valid (with 5min margin)
  if (_cachedToken && Date.now() < _tokenExpiresAt - 5 * 60 * 1000) {
    return _cachedToken;
  }

  try {
    const res = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: new URLSearchParams({
        grant_type:    'client_credentials',
        client_id:     appId,
        client_secret: appSecret,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { access_token: string; expires_in: number };
    _cachedToken     = data.access_token;
    _tokenExpiresAt  = Date.now() + (data.expires_in ?? 21600) * 1000;
    return _cachedToken;
  } catch {
    return null;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface MLItem {
  id: string;
  title: string;
  price: number;
  currency_id: string;
  condition: string;
  permalink: string;
  thumbnail: string;
  sold_quantity: number;
  available_quantity: number;
  shipping: { free_shipping: boolean; logistic_type?: string };
  installments?: { quantity: number; amount: number; rate: number; currency_id: string } | null;
  seller?: { id: number; nickname: string };
  tags?: string[];
}

interface MLSearchResponse {
  results: MLItem[];
  paging: { total: number; primary_results: number };
}

// ─── Clean up query for ML ────────────────────────────────────────────────────
function cleanQuery(q: string): string {
  return q
    .replace(/[""'']/g, '')      // remove curly quotes
    .replace(/[^\w\sáéíóúüñÁÉÍÓÚÜÑ-]/g, ' ')  // strip special chars except spanish
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

// ─── Route ────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const rawQ    = req.nextUrl.searchParams.get('q') ?? '';
  const q       = cleanQuery(rawQ);
  const limit   = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? '8'), 20);
  const exclude = req.nextUrl.searchParams.get('exclude') ?? '';

  if (!q || q.length < 2) {
    return NextResponse.json({ ok: false, error: 'Query too short' }, { status: 400 });
  }

  // Check credentials
  const token = await getMLToken();
  if (!token) {
    return NextResponse.json({
      ok: false,
      needsCredentials: true,
      error: 'Faltan credenciales de MercadoLibre. Configurá ML_APP_ID y ML_APP_SECRET en .env.local',
    }, { status: 401 });
  }

  try {
    const url = `https://api.mercadolibre.com/sites/MLA/search?q=${encodeURIComponent(q)}&limit=${limit}&sort=relevance`;
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
      next: { revalidate: 300 },
    });

    if (!res.ok) {
      // If token expired unexpectedly, clear cache
      if (res.status === 401) _cachedToken = null;
      return NextResponse.json(
        { ok: false, error: `ML API error: ${res.status}` },
        { status: res.status },
      );
    }

    const data = (await res.json()) as MLSearchResponse;

    // Sellers to exclude (own store — apacheco.tienda, etc.)
    const EXCLUDED_BASE = ['apacheco', 'apacheco.tienda'];
    if (exclude) EXCLUDED_BASE.push(...exclude.toLowerCase().split(','));
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

    const items = (data.results ?? [])
      .filter(item => {
        const nick = normalize(item.seller?.nickname ?? '');
        return !EXCLUDED_BASE.some(ex => nick.includes(normalize(ex)));
      })
      .map(item => ({
        id:           item.id,
        title:        item.title,
        price:        item.price,
        condition:    item.condition,
        permalink:    item.permalink,
        thumbnail:    item.thumbnail?.replace('http:', 'https:') ?? null,
        freeShipping: item.shipping?.free_shipping ?? false,
        logisticType: item.shipping?.logistic_type ?? null,
        soldQty:      item.sold_quantity ?? 0,
        stock:        item.available_quantity ?? 0,
        installments: item.installments
          ? { qty: item.installments.quantity, amount: item.installments.amount, rate: item.installments.rate }
          : null,
        seller:       item.seller?.nickname ?? null,
        tags:         item.tags ?? [],
      }));

    // Market stats
    const prices        = items.map(i => i.price).filter(p => p > 0);
    const minPrice      = prices.length ? Math.min(...prices) : 0;
    const maxPrice      = prices.length ? Math.max(...prices) : 0;
    const avgPrice      = prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0;
    const medPrice      = prices.length ? prices.slice().sort((a, b) => a - b)[Math.floor(prices.length / 2)] : 0;
    const freeShipCount = items.filter(i => i.freeShipping).length;
    const hasInstCount  = items.filter(i => i.installments && i.installments.rate === 0).length;

    return NextResponse.json({
      ok: true,
      total: data.paging?.total ?? 0,
      items,
      market: {
        minPrice, maxPrice, avgPrice, medPrice,
        freeShipPct:     items.length ? Math.round((freeShipCount / items.length) * 100) : 0,
        installmentsPct: items.length ? Math.round((hasInstCount  / items.length) * 100) : 0,
      },
    });

  } catch (e) {
    console.error('[ml-search]', e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
