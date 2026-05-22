import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const PRODUCTS_PATH = join(process.cwd(), 'src', 'data', 'products.json');

interface PriceEntry {
  code: string;
  priceBox?: number;   // Precio Caja (Bidones: 4x5L, Masivo: x12u)
  priceUnit?: number;  // Precio Bidon / Precio Unitario
  priceLt?: number;    // Precio por Litro
}

// GET: Returns all SEIQ products grouped by category with current costs
export async function GET() {
  try {
    const products = JSON.parse(readFileSync(PRODUCTS_PATH, 'utf-8')) as Array<{
      id: string; name: string; sku: string | null; supplierName: string | null;
      supplierCode: string | null; cost: number; supplierPrice: number;
      seiqCategory?: string; hidden?: boolean; active?: boolean;
    }>;

    const seiq = products.filter(p => p.supplierName === 'SEIQ GROUP S.A.');

    const byCategory: Record<string, typeof seiq> = {};
    for (const p of seiq) {
      const cat = p.seiqCategory ?? 'Sin categoría';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(p);
    }

    return NextResponse.json({ ok: true, byCategory });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

// POST: Apply new prices for a category with a discount
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      category: string;
      discount: number;           // e.g. 30 for 30%
      priceField: 'box' | 'unit' | 'lt';  // which price column to use as base
      entries: PriceEntry[];      // list of { code, priceBox?, priceUnit?, priceLt? }
      dryRun?: boolean;
    };

    const { category, discount, priceField, entries, dryRun } = body;

    if (!category || discount == null || !priceField || !entries?.length) {
      return NextResponse.json({ ok: false, error: 'Parámetros incompletos' }, { status: 400 });
    }

    const products = JSON.parse(readFileSync(PRODUCTS_PATH, 'utf-8')) as Array<{
      id: string; name: string; sku: string | null; supplierName: string | null;
      supplierCode: string | null; cost: number; supplierPrice: number;
      seiqCategory?: string; [key: string]: unknown;
    }>;

    // Build code → entry map
    const entryMap = new Map<string, PriceEntry>();
    for (const e of entries) {
      if (e.code) entryMap.set(e.code.trim().toUpperCase(), e);
    }

    const updated: Array<{ id: string; name: string; code: string; oldCost: number; newCost: number }> = [];
    const notFound: string[] = [];

    // Match and update
    for (const p of products) {
      if (p.supplierName !== 'SEIQ GROUP S.A.') continue;
      if (p.seiqCategory !== category) continue;

      const code = (p.supplierCode ?? '').trim().toUpperCase();
      const entry = entryMap.get(code);

      if (!entry) {
        notFound.push(code || p.name);
        continue;
      }

      // Pick base price according to priceField
      let basePrice: number | undefined;
      if (priceField === 'box')  basePrice = entry.priceBox;
      if (priceField === 'unit') basePrice = entry.priceUnit;
      if (priceField === 'lt')   basePrice = entry.priceLt;

      if (!basePrice || basePrice <= 0) continue;

      const newCost = Math.round(basePrice * (1 - discount / 100) * 100) / 100;

      updated.push({
        id: p.id,
        name: p.name,
        code,
        oldCost: p.cost,
        newCost,
      });

      if (!dryRun) {
        p.cost = newCost;
        p.supplierPrice = basePrice;
      }
    }

    if (!dryRun) {
      writeFileSync(PRODUCTS_PATH, JSON.stringify(products, null, 2), 'utf-8');
    }

    return NextResponse.json({
      ok: true,
      dryRun: dryRun ?? false,
      category,
      discount,
      updated,
      notFound,
      summary: {
        matched: updated.length,
        notFound: notFound.length,
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
