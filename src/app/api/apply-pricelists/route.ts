import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const SUPPLIER_PATH = resolve(process.cwd(), 'src/data/odoo-supplierinfo.json');
const PRODUCTS_PATH = resolve(process.cwd(), 'src/data/products.json');

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS
// ─────────────────────────────────────────────────────────────────────────────

type Decision = 'mantener' | 'aplicar_markup' | 'marcar_promo' | 'revisar';

interface ApplyItem {
  code: string;
  desc: string;
  newPrice: number;
  oldPrice: number;
  uxb: number;
  decision: Decision;
}

interface SupplierGroup {
  name: string;
  slug: string;
  count: number;
  products: Array<{
    si_id: string;
    tmpl_id: string | null;
    tmpl_name: string;
    sup_name: string | null;
    code: string;
    min_qty: number;
    price: number;
    discount: number;
    net_price: number;
  }>;
}

interface Product {
  id: string;
  sku: string | null;
  name: string;
  cost: number;
  price: number;
  margin: number | null;
  image: string | null;
  supplierName: string | null;
  supplierPrice: number | null;
  supplierCode: string | null;
  category: string | null;
  status: string;
  odooId: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// HANDLER
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      supplierName: string;
      supplierSlug: string;
      items: ApplyItem[];
      // All items in the new list (for updating supplierinfo completely)
      allNewItems?: ApplyItem[];
    };

    const { supplierName, supplierSlug, items, allNewItems } = body;

    if (!items || items.length === 0) {
      return NextResponse.json({ ok: false, error: 'No hay items para aplicar' }, { status: 400 });
    }

    // Block on Vercel (read-only filesystem)
    if (process.env.VERCEL === '1' || process.env.VERCEL_ENV) {
      return NextResponse.json(
        { ok: false, error: 'La aplicación de listas no está disponible en producción (Vercel). Usá el entorno local.', isVercel: true },
        { status: 503 },
      );
    }

    // ── Load current data ─────────────────────────────────────────────────────
    const suppliers: SupplierGroup[] = JSON.parse(readFileSync(SUPPLIER_PATH, 'utf8'));
    const products:  Product[]       = JSON.parse(readFileSync(PRODUCTS_PATH, 'utf8'));

    // Build decision map: code → ApplyItem
    const decisionMap = new Map<string, ApplyItem>();
    for (const item of items) decisionMap.set(item.code, item);

    // ── Update products.json ──────────────────────────────────────────────────
    let updatedCosts  = 0;
    let updatedPrices = 0;

    for (const prod of products) {
      if (!prod.supplierCode) continue;
      const code = prod.supplierCode.trim();
      const item = decisionMap.get(code);
      if (!item) continue;

      const decision = item.decision;
      if (decision === 'revisar' || decision === 'marcar_promo') continue;

      // Update cost in all cases where decision is apply or mantener
      const oldCost  = prod.cost;
      prod.cost      = item.newPrice;
      prod.supplierPrice = item.newPrice;
      updatedCosts++;

      if (decision === 'aplicar_markup' && oldCost > 0 && prod.price > 0) {
        // Keep the same markup % from before: markup = price / cost - 1
        const markup   = prod.price / oldCost;   // e.g., 1.63 = 63% markup
        prod.price     = parseFloat((item.newPrice * markup).toFixed(2));
        updatedPrices++;
      }
      // 'mantener': price unchanged → margin improves

      // Recalculate margin
      if (prod.cost > 0 && prod.price > 0) {
        prod.margin = parseFloat((((prod.price - prod.cost) / prod.price) * 100).toFixed(2));
      }

      // Update status
      if (prod.margin !== null && prod.margin < 35 && prod.margin >= 0) prod.status = 'critico';
      else if (prod.margin !== null && prod.margin < 0) prod.status = 'critico';
      else prod.status = 'activo';
    }

    writeFileSync(PRODUCTS_PATH, JSON.stringify(products, null, 2), 'utf8');

    // ── Update odoo-supplierinfo.json ─────────────────────────────────────────
    const sourceItems = allNewItems ?? items;
    const newGroup: SupplierGroup = {
      name:  supplierName,
      slug:  supplierSlug,
      count: sourceItems.length,
      products: sourceItems.map((item, i) => ({
        si_id:     `${supplierSlug}_${i}`,
        tmpl_id:   null,
        tmpl_name: item.desc,
        sup_name:  supplierName,
        code:      item.code,
        min_qty:   item.uxb || 1,
        price:     item.newPrice,
        discount:  0,
        net_price: item.newPrice,
      })),
    };

    const idx = suppliers.findIndex(s => s.slug === supplierSlug || s.name === supplierName);
    if (idx !== -1) suppliers[idx] = newGroup;
    else suppliers.push(newGroup);
    suppliers.sort((a, b) => b.count - a.count);

    writeFileSync(SUPPLIER_PATH, JSON.stringify(suppliers, null, 2), 'utf8');

    return NextResponse.json({
      ok: true,
      updatedCosts,
      updatedPrices,
      supplierProducts: newGroup.count,
    });

  } catch (e) {
    console.error('[apply-pricelists]', e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
