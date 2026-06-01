import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { SAVED_PROMOS_PATH } from '@/lib/data-paths';

export interface SavedPromoItem {
  productId:    string;
  productName:  string;
  productPrice: number;
  productCost:  number;
  productImage: string | null;
  odooId:       number | null;
  qty:          number;
  isGift:       boolean;
}

export interface SavedPromo {
  id:         string;
  savedAt:    string;
  name:       string;
  objetivo:   string;
  tipo:       string;
  param:      number;
  bg:         string;
  promoMode:  string;
  fixedPrice: number;
  promoPrice: number;
  savings:    number;
  savingsPct: number;
  margin:     number | null;
  items:      SavedPromoItem[];
}

function readPromos(): SavedPromo[] {
  if (!existsSync(SAVED_PROMOS_PATH)) return [];
  try { return JSON.parse(readFileSync(SAVED_PROMOS_PATH, 'utf8')) as SavedPromo[]; }
  catch { return []; }
}

function writePromos(promos: SavedPromo[]) {
  writeFileSync(SAVED_PROMOS_PATH, JSON.stringify(promos, null, 2), 'utf8');
}

/** GET /api/promos → lista de promos guardadas (más recientes primero) */
export async function GET() {
  try {
    const promos = readPromos();
    return NextResponse.json(promos);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/** POST /api/promos → guardar nueva promo */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Omit<SavedPromo, 'id' | 'savedAt'>;
    const promos = readPromos();

    const newPromo: SavedPromo = {
      ...body,
      id:      `promo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      savedAt: new Date().toISOString(),
    };

    // Prepend (most recent first), keep max 50
    promos.unshift(newPromo);
    if (promos.length > 50) promos.splice(50);
    writePromos(promos);

    return NextResponse.json({ ok: true, promo: newPromo });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

/** DELETE /api/promos?id=xxx → borrar promo */
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ ok: false, error: 'Missing id' }, { status: 400 });

    const promos = readPromos();
    const filtered = promos.filter(p => p.id !== id);
    writePromos(filtered);

    return NextResponse.json({ ok: true, deleted: promos.length - filtered.length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
