import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import {
  calcProfitability,
  calcIdealPrice,
  generateAlerts,
} from '@/lib/ml-lab-engine';
import { DEFAULT_ML_PARAMS } from '@/lib/ml-lab-types';
import type { MLLabProduct, MLLabState, MLProductParams } from '@/lib/ml-lab-types';
import { ML_LAB_PATH, PRODUCTS_PATH } from '@/lib/data-paths';


// ─── Tipos internos ──────────────────────────────────────────────────────────
interface SystemProduct {
  id: string;
  sku: string | null;
  barcode: string | null;
  name: string;
  cost: number;
  price: number;
  markup: number | null;
  stock: number;
  supplierName: string | null;
  category: string | null;
  image: string | null;
  odooId: number | null;
  active: boolean;
  hidden?: boolean;
}

// ─── Lectura de archivos ─────────────────────────────────────────────────────
const DEFAULT_STATE: MLLabState = {
  products: [],
  globalParams: { ...DEFAULT_ML_PARAMS },
  version: 1,
};

function readMLState(): MLLabState {
  if (!existsSync(ML_LAB_PATH)) return DEFAULT_STATE;
  try {
    const raw = JSON.parse(readFileSync(ML_LAB_PATH, 'utf8')) as MLLabState;
    return { ...DEFAULT_STATE, ...raw };
  } catch {
    return DEFAULT_STATE;
  }
}

function readSystemProducts(): SystemProduct[] {
  if (!existsSync(PRODUCTS_PATH)) return [];
  try {
    const all = JSON.parse(readFileSync(PRODUCTS_PATH, 'utf8')) as SystemProduct[];
    // Excluir productos ocultos o inactivos — no deben interferir en los cálculos
    return all.filter(p => p.active !== false && !p.hidden);
  } catch {
    return [];
  }
}

// ─── Hidratación: actualiza costos/stock desde products.json ─────────────────
/**
 * Para cada MLLabProduct, busca su correspondiente en products.json
 * y actualiza: cost, stock, markup (salvo pending), odooPrice, odooListML,
 * calc, calcIdeal y alerts — todo con los datos más frescos.
 */
function hydrateWithFreshData(
  mlProducts: MLLabProduct[],
  systemProducts: SystemProduct[],
  globalParams: MLProductParams,
): MLLabProduct[] {
  // Índices de búsqueda
  const byId      = new Map(systemProducts.map(p => [p.id,      p]));
  const bySku     = new Map(systemProducts.filter(p => p.sku).map(p => [p.sku!,     p]));
  const byBarcode = new Map(systemProducts.filter(p => p.barcode).map(p => [p.barcode!, p]));

  return mlProducts.map(mlProd => {
    // Buscar match en products.json
    const sys =
      byId.get(mlProd.id) ??
      (mlProd.sku      ? bySku.get(mlProd.sku)           : undefined) ??
      (mlProd.barcode  ? byBarcode.get(mlProd.barcode)   : undefined);

    if (!sys) return mlProd; // sin match → dejar tal cual

    // Valores frescos de Odoo
    const freshCost  = typeof sys.cost  === 'number' && sys.cost  > 0 ? sys.cost  : mlProd.cost;
    const freshStock = typeof sys.stock === 'number'                  ? sys.stock : mlProd.stock;

    // Markup: NUNCA se auto-actualiza desde products.json.
    // Solo cambia cuando el usuario sube explícitamente la lista de precios Odoo.
    const freshMarkup = mlProd.markup;

    const freshOdooPrice  = freshCost > 0 ? freshCost * (1 + freshMarkup / 100) : mlProd.odooPrice;
    const freshOdooListML = freshOdooPrice * 1.21;

    // Recalcular rentabilidad con costos frescos
    const params   = { ...globalParams, ...(mlProd.params ?? {}) };
    const mlPrice  = mlProd.mlPrice ?? freshOdooListML;

    const calc = mlPrice > 0 && freshCost > 0
      ? calcProfitability(mlPrice, freshCost, params) ?? undefined
      : undefined;

    const idealPrice = freshCost > 0
      ? calcIdealPrice(freshCost, params.idealMargin, params)
      : 0;
    const calcIdeal = idealPrice > 0 && freshCost > 0
      ? calcProfitability(idealPrice, freshCost, params) ?? undefined
      : undefined;

    const hydrated: MLLabProduct = {
      ...mlProd,
      cost:       freshCost,
      stock:      freshStock,
      markup:     freshMarkup,
      odooPrice:  freshOdooPrice,
      odooListML: freshOdooListML,
      calc,
      calcIdeal,
      updatedAt:  mlProd.updatedAt, // no pisamos updatedAt
    };

    // Regenerar alertas con los datos frescos
    hydrated.alerts = generateAlerts(hydrated, params);

    return hydrated;
  });
}

// ─── GET /api/ml-lab ─────────────────────────────────────────────────────────
/**
 * Devuelve el estado ML Lab con costos/stock/cálculos actualizados
 * en tiempo real desde products.json.
 * El Excel de ML solo hay que subirlo cuando cambien las publicaciones.
 * Los costos de Odoo se sincronizan automáticamente en cada carga.
 */
export async function GET() {
  try {
    const mlState     = readMLState();
    const sysProducts = readSystemProducts(); // ya filtra hidden/inactive

    // Set de identificadores de productos ocultos/inactivos
    // para poder excluir mlProducts que solo existen por ellos
    const allRaw = (() => {
      if (!existsSync(PRODUCTS_PATH)) return [];
      try { return JSON.parse(readFileSync(PRODUCTS_PATH, 'utf8')) as SystemProduct[]; }
      catch { return []; }
    })();
    const hiddenIds     = new Set(allRaw.filter(p => p.active === false || p.hidden).map(p => p.id));
    const hiddenSkus    = new Set(allRaw.filter(p => p.active === false || p.hidden).flatMap(p => p.sku ? [p.sku] : []));
    const hiddenBarcodes = new Set(allRaw.filter(p => p.active === false || p.hidden).flatMap(p => p.barcode ? [p.barcode] : []));

    const isHiddenProduct = (ml: MLLabProduct) =>
      hiddenIds.has(ml.id) ||
      (!!ml.sku     && hiddenSkus.has(ml.sku)) ||
      (!!ml.barcode && hiddenBarcodes.has(ml.barcode));

    // Excluir productos ocultos que no tienen publicación ML activa.
    // Si tienen mlItemId (están publicados en ML) se muestran igual — el usuario
    // necesita saberlo aunque el producto esté oculto en el sistema.
    const visibleProducts = mlState.products.filter(ml =>
      !isHiddenProduct(ml) || !!ml.mlItemId
    );

    const hydratedProducts = hydrateWithFreshData(
      visibleProducts,
      sysProducts,
      mlState.globalParams ?? DEFAULT_ML_PARAMS,
    );

    return NextResponse.json({ ...mlState, products: hydratedProducts });
  } catch (e) {
    console.error('[ml-lab GET]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// ─── POST /api/ml-lab ────────────────────────────────────────────────────────
/**
 * Persiste el estado completo en disco.
 * Se llama automáticamente 600 ms después de cualquier cambio en el store.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 });
    }
    writeFileSync(ML_LAB_PATH, JSON.stringify(body, null, 2), 'utf8');
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[ml-lab POST]', e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
