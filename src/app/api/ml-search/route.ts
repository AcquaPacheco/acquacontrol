import { NextRequest, NextResponse } from 'next/server';

// ─── ML public API — no auth required for search ─────────────────────────────
// https://api.mercadolibre.com/sites/MLA/search?q=...

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

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') ?? '';
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? '10'), 20);

  if (!q || q.trim().length < 2) {
    return NextResponse.json({ ok: false, error: 'Query too short' }, { status: 400 });
  }

  try {
    const url = `https://api.mercadolibre.com/sites/MLA/search?q=${encodeURIComponent(q)}&limit=${limit}&sort=relevance&condition=new`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'AcquaControlOS/1.0' },
      next: { revalidate: 300 }, // cache 5 min
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `ML API error: ${res.status}` },
        { status: res.status },
      );
    }

    const data = (await res.json()) as MLSearchResponse;

    // Simplify + enrich the response
    const items = (data.results ?? []).map(item => ({
      id:            item.id,
      title:         item.title,
      price:         item.price,
      condition:     item.condition,
      permalink:     item.permalink,
      thumbnail:     item.thumbnail?.replace('http:', 'https:') ?? null,
      freeShipping:  item.shipping?.free_shipping ?? false,
      logisticType:  item.shipping?.logistic_type ?? null,
      soldQty:       item.sold_quantity ?? 0,
      stock:         item.available_quantity ?? 0,
      installments:  item.installments
        ? { qty: item.installments.quantity, amount: item.installments.amount, rate: item.installments.rate }
        : null,
      seller:        item.seller?.nickname ?? null,
      tags:          item.tags ?? [],
    }));

    // Compute market stats
    const prices = items.map(i => i.price).filter(p => p > 0);
    const minPrice  = prices.length ? Math.min(...prices) : 0;
    const maxPrice  = prices.length ? Math.max(...prices) : 0;
    const avgPrice  = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
    const medPrice  = prices.length
      ? prices.slice().sort((a, b) => a - b)[Math.floor(prices.length / 2)]
      : 0;
    const freeShipCount = items.filter(i => i.freeShipping).length;
    const hasInstCount  = items.filter(i => i.installments && i.installments.rate === 0).length;

    return NextResponse.json({
      ok: true,
      total: data.paging?.total ?? 0,
      items,
      market: {
        minPrice, maxPrice, avgPrice: Math.round(avgPrice), medPrice,
        freeShipPct: items.length ? Math.round((freeShipCount / items.length) * 100) : 0,
        installmentsPct: items.length ? Math.round((hasInstCount / items.length) * 100) : 0,
      },
    });

  } catch (e) {
    console.error('[ml-search]', e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
