import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const PRODUCTS_PATH = resolve(process.cwd(), 'src/data/products.json');

interface Product {
  id: string; name: string; sku?: string | null;
  stock?: number; barcode?: string | null;
  [key: string]: unknown;
}

interface VariantRow {
  id: string;
  name: string;
  qty: number;
  barcode: string;
  displayName: string;
}

function normalize(s: string) {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

function extractIntRef(displayName: string): string {
  const m = displayName.match(/^\[([^\]]+)\]/);
  return m ? normalize(m[1]) : '';
}

/**
 * POST /api/products/sync-stock
 * Body: { rows: VariantRow[] }
 * Matches Odoo product.product variants to products.json and updates stock + barcode.
 */
export async function POST(req: NextRequest) {
  try {
    const { rows } = await req.json() as { rows: VariantRow[] };
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ ok: false, error: 'rows vacíos' }, { status: 400 });
    }

    if (!existsSync(PRODUCTS_PATH)) {
      return NextResponse.json({ ok: false, error: 'products.json no encontrado' }, { status: 500 });
    }

    const products: Product[] = JSON.parse(readFileSync(PRODUCTS_PATH, 'utf8'));

    // Build lookup maps
    const bySku  = new Map<string, Product>();
    const byName = new Map<string, Product>();
    for (const p of products) {
      if (p.sku)  bySku.set(normalize(p.sku), p);
      byName.set(normalize(p.name), p);
    }

    // Reset all stock to 0
    for (const p of products) p.stock = 0;

    let matched = 0;
    const unmatched: string[] = [];

    for (const row of rows) {
      const intRef   = extractIntRef(row.displayName);
      const cleanName = normalize(row.name);

      let m: Product | undefined =
        (intRef && bySku.get(intRef)) ||
        byName.get(cleanName) ||
        undefined;

      // Try partial: first 25 chars of name
      if (!m && cleanName.length > 15) {
        const short = cleanName.substring(0, 25);
        for (const [k, v] of byName) {
          if (k.startsWith(short)) { m = v; break; }
        }
      }

      if (m) {
        m.stock   = Math.max(0, Number(row.qty) || 0);
        if (row.barcode) m.barcode = String(row.barcode).trim();
        matched++;
      } else {
        unmatched.push(row.name);
      }
    }

    writeFileSync(PRODUCTS_PATH, JSON.stringify(products, null, 2), 'utf8');

    return NextResponse.json({
      ok: true,
      total:     rows.length,
      matched,
      unmatched: unmatched.length,
      unmatchedNames: unmatched.slice(0, 10),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
