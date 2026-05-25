import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const PRODUCTS_PATH = resolve(process.cwd(), 'src/data/products.json');
const HISTORY_PATH  = resolve(process.cwd(), 'src/data/change-history.json');

interface Product {
  id: string; active: boolean; hidden: boolean;
  cost: number; price: number; stock?: number; barcode?: string;
  notes?: string; name?: string; [key: string]: unknown;
}

interface HistoryEntry {
  id: string;
  productId: string;
  productName: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  source: string;
  timestamp: string;
}

function readProducts(): Product[] {
  if (!existsSync(PRODUCTS_PATH)) return [];
  return JSON.parse(readFileSync(PRODUCTS_PATH, 'utf8')) as Product[];
}

function readHistory(): HistoryEntry[] {
  if (!existsSync(HISTORY_PATH)) return [];
  try { return JSON.parse(readFileSync(HISTORY_PATH, 'utf8')) as HistoryEntry[]; }
  catch { return []; }
}

function appendHistory(entry: Omit<HistoryEntry, 'id' | 'timestamp'>) {
  const history = readHistory();
  const newEntry: HistoryEntry = {
    ...entry,
    id: `h_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
  };
  history.unshift(newEntry); // most recent first
  // Keep last 500 entries
  if (history.length > 500) history.splice(500);
  writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2), 'utf8');
  return newEntry;
}

/**
 * GET /api/products?showHidden=true
 * Returns all products. Hidden products excluded by default.
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const showHidden = url.searchParams.get('showHidden') === 'true';
    const products = readProducts();
    const result = showHidden ? products : products.filter(p => !p.hidden);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/**
 * PATCH /api/products
 * Body: { id: string; active?: boolean; hidden?: boolean; cost?: number; price?: number; notes?: string; source?: string }
 */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json() as {
      id: string;
      active?: boolean;
      hidden?: boolean;
      cost?: number;
      price?: number;
      notes?: string;
      supplierName?: string;
      supplierPrice?: number;
      supplierCode?: string;
      terciarizado?: boolean;
      source?: string;
    };

    const { id, source = 'manual' } = body;
    if (!id) return NextResponse.json({ ok: false, error: 'Falta id' }, { status: 400 });

    const products = readProducts();
    const idx = products.findIndex(p => p.id === id);
    if (idx === -1) return NextResponse.json({ ok: false, error: `Producto "${id}" no encontrado` }, { status: 404 });

    const current = products[idx];
    const updates: Partial<Product> = {};
    const historyEntries: ReturnType<typeof appendHistory>[] = [];

    if (typeof body.active === 'boolean' && body.active !== current.active) {
      updates.active = body.active;
    }
    if (typeof body.hidden === 'boolean' && body.hidden !== current.hidden) {
      updates.hidden = body.hidden;
    }
    if (typeof body.cost === 'number' && body.cost !== current.cost) {
      updates.cost = body.cost;
      // Recalculate margin if price exists
      if (current.price > 1 && body.cost > 0) {
        updates.margin = Math.round(((current.price - body.cost) / current.price) * 1000) / 10;
        updates.markup = Math.round(((current.price / body.cost) - 1) * 1000) / 10;
      }
    }
    if (typeof body.price === 'number' && body.price !== current.price) {
      updates.price = body.price;
      const costToUse = typeof body.cost === 'number' ? body.cost : current.cost;
      if (body.price > 1 && costToUse > 0) {
        updates.margin = Math.round(((body.price - costToUse) / body.price) * 1000) / 10;
        updates.markup = Math.round(((body.price / costToUse) - 1) * 1000) / 10;
      }
    }
    if (typeof body.notes === 'string') {
      updates.notes = body.notes;
    }
    if (typeof body.supplierName === 'string') {
      updates.supplierName = body.supplierName;
    }
    if (typeof body.supplierPrice === 'number') {
      updates.supplierPrice = body.supplierPrice;
    }
    if (typeof body.supplierCode === 'string') {
      updates.supplierCode = body.supplierCode;
    }
    if (typeof body.terciarizado === 'boolean') {
      updates.terciarizado = body.terciarizado;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ ok: true, id, message: 'Sin cambios' });
    }

    products[idx] = { ...current, ...updates };
    writeFileSync(PRODUCTS_PATH, JSON.stringify(products, null, 2), 'utf8');

    // Log history for tracked fields
    const productName = (current.name as string) || id;
    if (updates.cost !== undefined) {
      historyEntries.push(appendHistory({ productId: id, productName, field: 'cost', oldValue: current.cost, newValue: updates.cost, source }));
    }
    if (updates.price !== undefined) {
      historyEntries.push(appendHistory({ productId: id, productName, field: 'price', oldValue: current.price, newValue: updates.price, source }));
    }
    if (updates.supplierName !== undefined) {
      historyEntries.push(appendHistory({ productId: id, productName, field: 'supplierName', oldValue: current.supplierName, newValue: updates.supplierName, source }));
    }

    return NextResponse.json({ ok: true, id, updates, history: historyEntries });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

/**
 * DELETE /api/products
 * Body: { id: string }
 * Removes the product permanently from products.json.
 */
export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json() as { id: string };
    const { id } = body;
    if (!id) return NextResponse.json({ ok: false, error: 'Falta id' }, { status: 400 });

    const products = readProducts();
    const idx = products.findIndex(p => p.id === id);
    if (idx === -1) return NextResponse.json({ ok: false, error: `Producto "${id}" no encontrado` }, { status: 404 });

    const [removed] = products.splice(idx, 1);
    writeFileSync(PRODUCTS_PATH, JSON.stringify(products, null, 2), 'utf8');

    appendHistory({
      productId:   id,
      productName: (removed.name as string) || id,
      field:       'deleted',
      oldValue:    true,
      newValue:    null,
      source:      'manual',
    });

    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
