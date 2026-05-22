import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const SUPPLIERS_PATH = resolve(process.cwd(), 'src/data/suppliers.json');
const PRODUCTS_PATH  = resolve(process.cwd(), 'src/data/products.json');

interface Supplier { id: string; name: string; active?: boolean; [key: string]: unknown; }
interface Product  { id: string; supplierName?: string | null; active?: boolean; [key: string]: unknown; }

function readSuppliers(): Supplier[] {
  if (!existsSync(SUPPLIERS_PATH)) return [];
  return JSON.parse(readFileSync(SUPPLIERS_PATH, 'utf8')) as Supplier[];
}

function readProducts(): Product[] {
  if (!existsSync(PRODUCTS_PATH)) return [];
  return JSON.parse(readFileSync(PRODUCTS_PATH, 'utf8')) as Product[];
}

/**
 * GET /api/suppliers
 * Returns suppliers.json (with active field) live.
 */
export async function GET() {
  try {
    return NextResponse.json(readSuppliers());
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/**
 * PATCH /api/suppliers
 * Body: { supplierName: string; active: boolean }
 * 1. Marks the supplier as active/inactive in suppliers.json
 * 2. Bulk-sets all products with that supplierName to active/inactive in products.json
 * Returns count of affected products.
 */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json() as { supplierName: string; active: boolean };
    const { supplierName, active } = body;

    if (!supplierName || typeof active !== 'boolean') {
      return NextResponse.json({ ok: false, error: 'Faltan campos: supplierName, active' }, { status: 400 });
    }

    // 1. Update supplier active flag in suppliers.json
    const suppliers = readSuppliers();
    const supIdx = suppliers.findIndex(s => s.name === supplierName);
    if (supIdx !== -1) {
      suppliers[supIdx] = { ...suppliers[supIdx], active };
      writeFileSync(SUPPLIERS_PATH, JSON.stringify(suppliers, null, 2), 'utf8');
    }

    // 2. Bulk-update products with this supplierName
    const products = readProducts();
    let affected = 0;
    for (const p of products) {
      if (p.supplierName === supplierName) {
        p.active = active;
        affected++;
      }
    }
    writeFileSync(PRODUCTS_PATH, JSON.stringify(products, null, 2), 'utf8');

    return NextResponse.json({ ok: true, supplierName, active, affected });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
