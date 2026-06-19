import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { PRODUCTS_PATH, HISTORY_PATH } from '@/lib/data-paths';

interface LocalProduct {
  id: string; name: string; cost: number; price: number;
  markup: number | null; margin: number | null;
  [key: string]: unknown;
}

interface ApplyItem {
  localId:  string;
  newCost:  number;
  newPrice: number;
}

interface HistoryEntry {
  id: string; productId: string; productName: string;
  field: string; oldValue: unknown; newValue: unknown;
  source: string; timestamp: string;
}

function round2(n: number) { return Math.round(n * 100) / 100; }

function calcMargin(cost: number, price: number) {
  if (!price || !cost) return null;
  return round2(((price - cost) / price) * 100);
}
function calcMarkup(cost: number, price: number) {
  if (!cost) return null;
  return round2(((price / cost) - 1) * 100);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { items: ApplyItem[]; source?: string };
    const { items, source = 'supplier_excel' } = body;

    if (!items?.length)
      return NextResponse.json({ ok: false, error: 'No hay items para aplicar.' }, { status: 400 });

    if (!existsSync(PRODUCTS_PATH))
      return NextResponse.json({ ok: false, error: 'products.json no encontrado' }, { status: 500 });

    const products: LocalProduct[] = JSON.parse(readFileSync(PRODUCTS_PATH, 'utf8'));
    const byId = new Map(products.map(p => [p.id, p]));

    const historyEntries: Omit<HistoryEntry, 'id' | 'timestamp'>[] = [];
    let updated = 0;
    const errors: string[] = [];

    for (const item of items) {
      const p = byId.get(item.localId);
      if (!p) { errors.push(`No encontrado: ${item.localId}`); continue; }

      const oldCost  = p.cost;
      const oldPrice = p.price;

      if (item.newCost !== oldCost) {
        historyEntries.push({ productId: p.id, productName: String(p.name), field: 'cost',
          oldValue: oldCost, newValue: item.newCost, source });
        p.cost = round2(item.newCost);
      }

      if (item.newPrice !== oldPrice) {
        historyEntries.push({ productId: p.id, productName: String(p.name), field: 'price',
          oldValue: oldPrice, newValue: item.newPrice, source });
        p.price = round2(item.newPrice);
      }

      p.margin = calcMargin(p.cost, p.price);
      p.markup = calcMarkup(p.cost, p.price);
      updated++;
    }

    writeFileSync(PRODUCTS_PATH, JSON.stringify(products, null, 2), 'utf8');

    // Append history
    if (historyEntries.length > 0) {
      let history: HistoryEntry[] = [];
      try { history = existsSync(HISTORY_PATH) ? JSON.parse(readFileSync(HISTORY_PATH, 'utf8')) : []; } catch { /* */ }
      const now = new Date().toISOString();
      for (const e of historyEntries) {
        history.unshift({ ...e, id: `h_${Date.now()}_${Math.random().toString(36).slice(2,7)}`, timestamp: now });
      }
      if (history.length > 500) history.splice(500);
      writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2), 'utf8');
    }

    return NextResponse.json({ ok: true, updated, errors, historyEntries: historyEntries.length });

  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
