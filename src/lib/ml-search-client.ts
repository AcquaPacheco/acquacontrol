'use client';

/**
 * ML Search — el browser hace el request directo a ML (evita bloqueo server-side).
 * El servidor solo provee el token via /api/ml-search?mode=token
 */

export interface MLSearchItem {
  id:           string;
  title:        string;
  price:        number;
  condition:    string;
  permalink:    string;
  thumbnail:    string | null;
  freeShipping: boolean;
  soldQty:      number;
  stock:        number;
  seller:       string | null;
  installments: { qty: number; amount: number; rate: number } | null;
}

export interface MLSearchResult {
  ok:     true;
  total:  number;
  items:  MLSearchItem[];
  market: {
    minPrice:        number;
    maxPrice:        number;
    avgPrice:        number;
    medPrice:        number;
    freeShipPct:     number;
    installmentsPct: number;
  };
}

export interface MLSearchError {
  ok:    false;
  error: string;
}

const EXCLUDED_SELLERS = ['apacheco', 'acquapacheco'];
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export async function mlSearch(
  query:   string,
  limit  = 8,
  exclude = '',
): Promise<MLSearchResult | MLSearchError> {
  // 1. Pedir token al servidor
  let token = '';
  let site  = 'MLA';
  try {
    const tr = await fetch(`/api/ml-search?mode=token&q=${encodeURIComponent(query)}&limit=${limit}`);
    const td = await tr.json() as { ok: boolean; token?: string; site?: string; error?: string };
    if (!td.ok) return { ok: false, error: td.error ?? 'credentials' };
    token = td.token ?? '';
    site  = td.site  ?? 'MLA';
  } catch (e) {
    return { ok: false, error: String(e) };
  }

  if (!token) return { ok: false, error: 'credentials' };

  // 2. Llamar ML directo desde el browser
  const q = query.replace(/[""'']/g, '').replace(/[^\w\sáéíóúüñÁÉÍÓÚÜÑ-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  try {
    const res = await fetch(
      `https://api.mercadolibre.com/sites/${site}/search?q=${encodeURIComponent(q)}&limit=${Math.min(limit, 20)}&sort=relevance`,
      { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } },
    );

    if (!res.ok) {
      return { ok: false, error: `ML ${res.status}` };
    }

    const data = await res.json() as {
      results: Array<{
        id: string; title: string; price: number; condition: string; permalink: string;
        thumbnail: string; sold_quantity: number; available_quantity: number;
        shipping: { free_shipping: boolean };
        installments?: { quantity: number; amount: number; rate: number } | null;
        seller?: { nickname: string };
      }>;
      paging: { total: number };
    };

    const excludedBase = [...EXCLUDED_SELLERS];
    if (exclude) excludedBase.push(...exclude.toLowerCase().split(','));

    const items: MLSearchItem[] = (data.results ?? [])
      .filter(item => !excludedBase.some(ex => normalize(item.seller?.nickname ?? '').includes(normalize(ex))))
      .map(item => ({
        id:           item.id,
        title:        item.title,
        price:        item.price,
        condition:    item.condition,
        permalink:    item.permalink,
        thumbnail:    item.thumbnail?.replace('http:', 'https:') ?? null,
        freeShipping: item.shipping?.free_shipping ?? false,
        soldQty:      item.sold_quantity ?? 0,
        stock:        item.available_quantity ?? 0,
        seller:       item.seller?.nickname ?? null,
        installments: item.installments
          ? { qty: item.installments.quantity, amount: item.installments.amount, rate: item.installments.rate }
          : null,
      }));

    const prices    = items.map(i => i.price).filter(p => p > 0);
    const minPrice  = prices.length ? Math.min(...prices) : 0;
    const maxPrice  = prices.length ? Math.max(...prices) : 0;
    const avgPrice  = prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0;
    const medPrice  = prices.length ? prices.slice().sort((a, b) => a - b)[Math.floor(prices.length / 2)] : 0;
    const freeCount = items.filter(i => i.freeShipping).length;
    const instCount = items.filter(i => i.installments && i.installments.rate === 0).length;

    return {
      ok: true,
      total: data.paging?.total ?? 0,
      items,
      market: {
        minPrice, maxPrice, avgPrice, medPrice,
        freeShipPct:     items.length ? Math.round(freeCount / items.length * 100) : 0,
        installmentsPct: items.length ? Math.round(instCount  / items.length * 100) : 0,
      },
    };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
