import { NextRequest, NextResponse } from 'next/server';
import { writeFileSync, readFileSync, existsSync, appendFileSync } from 'fs';
import { ACTION_LOG_PATH, PARAMS_PATH } from '@/lib/data-paths';


// ── Defaults (espejo exacto de parametros/page.tsx) ──────────────────────────
const DEFAULT_PARAMS = {
  dolar: {
    bna: 1085.50,
    operativo: 1120.00,
    porProveedor: [
      { nombre: 'SEIQ GROUP S.A.',      tasa: 1100 },
      { nombre: 'LAMBDA CHEMICAL S.A.', tasa: 1150 },
    ],
  },
  impuestos: {
    ivaCompra: 21, ivaVenta: 21, ivaReducido: 10.5, iibb: 3.5,
  },
  pagos: [
    { id: 'credito_1c',    medio: 'Crédito — 1 cuota',           lista: 'A', recargo: 0,    activo: true },
    { id: 'credito_3c',    medio: 'Crédito — 3 cuotas',          lista: 'A', recargo: 8.0,  activo: true },
    { id: 'credito_6c',    medio: 'Crédito — 6 cuotas',          lista: 'A', recargo: 15.0, activo: true },
    { id: 'credito_12c',   medio: 'Crédito — 12 cuotas',         lista: 'A', recargo: 30.0, activo: true },
    { id: 'debito',        medio: 'Débito (Nave / Mercado Pago)', lista: 'B', recargo: 0,    activo: true },
    { id: 'transferencia', medio: 'Transferencia bancaria',       lista: 'B', recargo: 0,    activo: true },
    { id: 'qr_nave',       medio: 'QR Nave / Dinero en cuenta',  lista: 'B', recargo: 0,    activo: true },
    { id: 'mp_link',       medio: 'MercadoPago Link de pago',    lista: 'B', recargo: 0,    activo: true },
    { id: 'efectivo',      medio: 'Efectivo',                    lista: 'C', recargo: 0,    activo: true },
  ],
  listas: [
    { id: 'A',        nombre: 'Lista A',      descripcion: 'Precio público — Tarjeta de crédito (base del negocio)',         descuento: 0,   margenMin: 45, exportaOdoo: true  },
    { id: 'B',        nombre: 'Lista B',      descripcion: 'Débito / Transferencia / QR — descuento sobre Lista A',          descuento: 10,  margenMin: 38, exportaOdoo: false },
    { id: 'C',        nombre: 'Lista C',      descripcion: 'Efectivo — descuento sobre Lista A',                             descuento: 15,  margenMin: 33, exportaOdoo: false },
    { id: 'prof',     nombre: 'Profesional',  descripcion: '5% adicional sobre Lista A, B o C según cómo pague el cliente',  descuento: 5,   margenMin: 28, exportaOdoo: false, descuentoBase: 'A/B/C' },
    { id: 'cons',     nombre: 'Consorcio',    descripcion: 'Consorcios y admin. de edificios — recargo sobre Lista A',       descuento: -10, margenMin: 50, exportaOdoo: false },
    { id: 'ml',       nombre: 'MercadoLibre', descripcion: 'Precio calculado por ML Lab: Markup sobre costo + IVA 21%',     descuento: 0,   margenMin: 20, exportaOdoo: false, esMarkup: true },
    { id: 'mayorista',nombre: 'Mayorista',    descripcion: 'Sin regla fija — precio negociado por SKU',                     descuento: 25,  margenMin: 22, exportaOdoo: false },
  ],
  redondeo: {
    multiplo: 10, siempreArriba: true, maxSinRedondeo: 500, decimalesCostos: 2,
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function readParams(): typeof DEFAULT_PARAMS {
  try {
    if (!existsSync(PARAMS_PATH)) return DEFAULT_PARAMS;
    return { ...DEFAULT_PARAMS, ...JSON.parse(readFileSync(PARAMS_PATH, 'utf8')) };
  } catch {
    return DEFAULT_PARAMS;
  }
}

/** Añade una línea al log de acciones (JSONL) */
export function logAction(action: string, section: string, detail?: unknown) {
  try {
    const entry = JSON.stringify({
      ts:      new Date().toISOString(),
      action,
      section,
      ...(detail !== undefined ? { detail } : {}),
    }) + '\n';
    appendFileSync(ACTION_LOG_PATH, entry, 'utf8');
  } catch { /* no interrumpir el flujo si el log falla */ }
}

// ── GET /api/params ───────────────────────────────────────────────────────────
export async function GET() {
  return NextResponse.json(readParams());
}

// ── POST /api/params ──────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body    = await req.json() as Record<string, unknown>;
    const current = readParams();
    const updated = { ...current, ...body };
    writeFileSync(PARAMS_PATH, JSON.stringify(updated, null, 2), 'utf8');

    // Log por cada sección que vino en el body
    for (const section of Object.keys(body)) {
      logAction('params:save', section);
    }

    return NextResponse.json({ ok: true, params: updated });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
