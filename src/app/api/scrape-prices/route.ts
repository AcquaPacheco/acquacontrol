import { NextRequest, NextResponse } from 'next/server';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface ScrapedProduct {
  name: string;
  price: number;
  url:   string;
  image: string | null;
}

interface ScrapeResult {
  store:    string;
  ok:       boolean;
  products: ScrapedProduct[];
  error?:   string;
}

// ─────────────────────────────────────────────────────────────────────────────
// VTEX helper (Jumbo / Carrefour / Vital all run VTEX)
// ─────────────────────────────────────────────────────────────────────────────

async function searchVtex(
  baseUrl:   string,
  storeName: string,
  query:     string,
): Promise<ScrapeResult> {
  try {
    const q   = encodeURIComponent(query.slice(0, 60));
    const url = `${baseUrl}/api/catalog_system/pub/products/search?ft=${q}&_from=0&_to=4`;

    const res = await fetch(url, {
      headers: {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept':          'application/json, text/plain, */*',
        'Accept-Language': 'es-AR,es;q=0.9',
        'Referer':         `${baseUrl}/`,
      },
      signal: AbortSignal.timeout(9000),
    });

    if (!res.ok) {
      return { store: storeName, ok: false, products: [], error: `HTTP ${res.status}` };
    }

    const text = await res.text();
    let data: unknown;
    try { data = JSON.parse(text); } catch {
      return { store: storeName, ok: false, products: [], error: 'Respuesta no es JSON' };
    }

    if (!Array.isArray(data)) {
      return { store: storeName, ok: false, products: [], error: 'Formato inesperado' };
    }

    const products: ScrapedProduct[] = (data as Record<string, unknown>[])
      .slice(0, 5)
      .map(item => {
        const items     = (item.items as Record<string, unknown>[] | undefined) ?? [];
        const first     = items[0] ?? {};
        const sellers   = (first.sellers as Record<string, unknown>[] | undefined) ?? [];
        const offer     = (sellers[0]?.commertialOffer as Record<string, unknown> | undefined) ?? {};
        const price     = Number(offer.Price ?? offer.ListPrice ?? 0);
        const name      = String(item.productName ?? item.name ?? '');
        const rawLink   = String(item.link ?? item.linkText ?? '');
        const link      = rawLink.startsWith('http') ? rawLink : `${baseUrl}/${rawLink.replace(/^\//, '')}`;
        const images    = (first.images as Array<{ imageUrl?: string }> | undefined) ?? [];
        const image     = images[0]?.imageUrl ?? null;
        return { name, price, url: link, image };
      })
      .filter(p => p.price > 0 && p.name.trim() !== '');

    return { store: storeName, ok: true, products };
  } catch (e) {
    return { store: storeName, ok: false, products: [], error: String(e) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Store dispatchers
// ─────────────────────────────────────────────────────────────────────────────

function searchJumbo(q: string)     { return searchVtex('https://www.jumbo.com.ar',    'jumbo',     q); }
function searchCarrefour(q: string) { return searchVtex('https://www.carrefour.com.ar', 'carrefour', q); }
function searchVital(q: string)     { return searchVtex('https://www.vital.com.ar',     'vital',     q); }

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const query      = searchParams.get('q') ?? '';
    const storesStr  = searchParams.get('stores') ?? 'jumbo,carrefour,vital';

    if (!query.trim()) {
      return NextResponse.json({ ok: false, error: 'Falta parámetro q' }, { status: 400 });
    }

    const stores = storesStr.split(',').map(s => s.trim().toLowerCase());

    const tasks: Promise<ScrapeResult>[] = [];
    if (stores.includes('jumbo'))     tasks.push(searchJumbo(query));
    if (stores.includes('carrefour')) tasks.push(searchCarrefour(query));
    if (stores.includes('vital'))     tasks.push(searchVital(query));

    const results = await Promise.all(tasks);

    return NextResponse.json({ ok: true, results });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
