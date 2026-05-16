/**
 * POST /api/ml-import
 * Reads an Odoo ML pricelist Excel from a local path (dev only),
 * parses it, matches with products.json, and returns MLLabProduct[].
 *
 * Body: { filePath: string, type: 'odoo' | 'ml' }
 */
import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { read, utils } from 'xlsx';
import { parseOdooRows, parseMLRows, matchAndBuild } from '@/lib/ml-lab-engine';
import { DEFAULT_ML_PARAMS } from '@/lib/ml-lab-types';
import type { MLLabProduct } from '@/lib/ml-lab-types';

const PRODUCTS_PATH = resolve(process.cwd(), 'src/data/products.json');

interface SystemProduct {
  id: string; sku: string | null; barcode: string | null;
  name: string; cost: number; price: number;
  supplierName: string | null; category: string | null;
  image: string | null; odooId: number | null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { filePath?: string; type?: 'odoo' | 'ml' };
    const { filePath, type = 'odoo' } = body;

    if (!filePath) {
      return NextResponse.json({ ok: false, error: 'filePath requerido' }, { status: 400 });
    }

    // Security: only allow local paths in dev
    if (process.env.VERCEL === '1' || process.env.VERCEL_ENV) {
      return NextResponse.json({ ok: false, error: 'No disponible en producción' }, { status: 503 });
    }

    const absPath = resolve(filePath);
    if (!existsSync(absPath)) {
      return NextResponse.json({ ok: false, error: `Archivo no encontrado: ${absPath}` }, { status: 404 });
    }

    // Parse Excel
    const buffer   = readFileSync(absPath);
    const workbook = read(buffer, { type: 'buffer', cellDates: true });
    const sheet    = workbook.Sheets[workbook.SheetNames[0]];
    const rows     = utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', blankrows: false });

    // Read system products
    const systemProducts: SystemProduct[] = (() => {
      try {
        const raw = JSON.parse(readFileSync(PRODUCTS_PATH, 'utf8')) as SystemProduct[];
        return raw.map(p => ({ ...p, barcode: p.barcode ?? null }));
      }
      catch { return []; }
    })();

    if (type === 'ml') {
      // Parse ML Seller Center bulk export
      const mlPubs = parseMLRows(rows);
      // Get existing Odoo rules from store (client provides them)
      return NextResponse.json({
        ok:       true,
        type:     'ml',
        count:    mlPubs.length,
        mlPubs,
        fileName: absPath.split(/[\\/]/).pop(),
      });
    }

    // Parse Odoo pricelist rules
    const odooRules = parseOdooRows(rows);
    if (odooRules.length === 0) {
      return NextResponse.json({ ok: false, error: 'No se encontraron reglas en el archivo. Verificá que sea el export de product.pricelist de Odoo.' }, { status: 400 });
    }

    // Match + build ML Lab products
    const products: MLLabProduct[] = matchAndBuild(odooRules, [], systemProducts, DEFAULT_ML_PARAMS);

    return NextResponse.json({
      ok:       true,
      type:     'odoo',
      count:    products.length,
      matched:  products.filter(p => p.cost > 0).length,
      products,
      fileName: absPath.split(/[\\/]/).pop(),
    });

  } catch (err) {
    console.error('[ml-import]', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
