import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const PRODUCTS_PATH = resolve(process.cwd(), 'src/data/products.json');

interface Product { id: string; active: boolean; [key: string]: unknown; }

function readProducts(): Product[] {
  if (!existsSync(PRODUCTS_PATH)) return [];
  return JSON.parse(readFileSync(PRODUCTS_PATH, 'utf8')) as Product[];
}

/**
 * PATCH /api/products
 * Body: { id: string; active: boolean }
 * Actualiza el campo `active` de un producto en products.json.
 */
export async function PATCH(req: NextRequest) {
  try {
    const { id, active } = await req.json() as { id: string; active: boolean };
    if (!id || typeof active !== 'boolean') {
      return NextResponse.json({ ok: false, error: 'Faltan parámetros id y active' }, { status: 400 });
    }

    const products = readProducts();
    const idx = products.findIndex(p => p.id === id);
    if (idx === -1) {
      return NextResponse.json({ ok: false, error: `Producto "${id}" no encontrado` }, { status: 404 });
    }

    products[idx] = { ...products[idx], active };
    writeFileSync(PRODUCTS_PATH, JSON.stringify(products, null, 2), 'utf8');

    return NextResponse.json({ ok: true, id, active });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
