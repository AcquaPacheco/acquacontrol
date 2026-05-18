import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// Persistencia de catálogos de proveedores en src/data/catalogs/<slug>.json
// ─────────────────────────────────────────────────────────────────────────────

const CATALOGS_DIR = resolve(process.cwd(), 'src/data/catalogs');

function safePath(slug: string) {
  // Sanitize slug: only alphanumeric, hyphens, underscores
  const safe = slug.replace(/[^a-z0-9_-]/gi, '-').toLowerCase().slice(0, 80);
  return resolve(CATALOGS_DIR, `${safe}.json`);
}

export interface CatalogItem {
  code: string;
  desc: string;
  priceUSD: number | null;
  priceARS: number | null;
  unit: string;
  category: string;
  notes: string;
  source?: string;
  sheet?: string;
}

export interface SavedCatalog {
  supplierSlug: string;
  supplierName: string;
  savedAt: string;
  currency: 'USD' | 'ARS' | 'unknown';
  usdRate: number;
  items: CatalogItem[];
}

/**
 * GET /api/supplier-catalog?slug=<supplierSlug>
 * Returns saved catalog for a supplier, or null if not found.
 */
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug') || '';
  if (!slug) return NextResponse.json(null);

  const path = safePath(slug);
  if (!existsSync(path)) return NextResponse.json(null);

  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as SavedCatalog;
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(null);
  }
}

/**
 * POST /api/supplier-catalog
 * Body: SavedCatalog
 * Saves or updates the catalog for a supplier.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as SavedCatalog;
    if (!body.supplierSlug) {
      return NextResponse.json({ ok: false, error: 'Falta supplierSlug' }, { status: 400 });
    }

    const path = safePath(body.supplierSlug);

    // Ensure directory exists
    if (!existsSync(CATALOGS_DIR)) mkdirSync(CATALOGS_DIR, { recursive: true });
    const dirPath = dirname(path);
    if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true });

    const catalog: SavedCatalog = {
      ...body,
      savedAt: new Date().toISOString(),
    };

    writeFileSync(path, JSON.stringify(catalog, null, 2), 'utf8');
    return NextResponse.json({ ok: true, savedAt: catalog.savedAt, count: catalog.items.length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
