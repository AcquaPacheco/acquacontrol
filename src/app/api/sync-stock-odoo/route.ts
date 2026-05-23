import { NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const SETTINGS_PATH = resolve(process.cwd(), 'src/data/settings.json');
const PRODUCTS_PATH = resolve(process.cwd(), 'src/data/products.json');

interface Settings {
  odooServerUrl: string;
  odooUsername:  string;
  odooApiKey:    string;
  [key: string]: unknown;
}

interface OdooProduct {
  id:               number;
  name:             string;
  default_code:     string | false;
  barcode:          string | false;
  qty_available:    number;
  product_tmpl_id:  [number, string];
}

interface LocalProduct {
  id:          string;
  name:        string;
  sku:         string | null;
  barcode:     string | null;
  stock:       number;
  odooId:      number | null;
  [key: string]: unknown;
}

function norm(s: string) {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

function extractDbName(url: string): string {
  // https://nombre-empresa.odoo.com → nombre-empresa
  const m = url.match(/https?:\/\/([^.]+)\.odoo\.com/);
  return m ? m[1] : '';
}

async function odooRpc(
  baseUrl: string,
  endpoint: string,
  params: Record<string, unknown>,
  cookies?: string
): Promise<{ result?: unknown; error?: { message: string; data?: { message?: string } } }> {
  const res = await fetch(`${baseUrl}${endpoint}`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookies ? { Cookie: cookies } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', id: 1, params }),
  });
  return res.json() as Promise<{ result?: unknown; error?: { message: string; data?: { message?: string } } }>;
}

export async function POST() {
  try {
    // ── 1. Leer credenciales ──
    if (!existsSync(SETTINGS_PATH)) {
      return NextResponse.json({ ok: false, error: 'settings.json no encontrado' }, { status: 500 });
    }
    const settings: Settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'));
    const { odooServerUrl, odooUsername, odooApiKey } = settings;

    if (!odooServerUrl) return NextResponse.json({ ok: false, error: 'Falta la URL del servidor Odoo en Parámetros.' }, { status: 400 });
    if (!odooUsername)  return NextResponse.json({ ok: false, error: 'Falta el usuario de Odoo (email). Configuralo en Parámetros → Conexiones.' }, { status: 400 });
    if (!odooApiKey)    return NextResponse.json({ ok: false, error: 'Falta la API Key de Odoo. Generala en Odoo → Ajustes → Técnico → Claves API.' }, { status: 400 });

    const baseUrl = odooServerUrl.replace(/\/$/, '');
    const dbName  = extractDbName(baseUrl);
    if (!dbName) return NextResponse.json({ ok: false, error: `No se pudo extraer el nombre de la base de datos de la URL: ${baseUrl}` }, { status: 400 });

    // ── 2. Autenticar en Odoo ──
    const authRes = await odooRpc(baseUrl, '/web/session/authenticate', {
      db:       dbName,
      login:    odooUsername,
      password: odooApiKey,
    });

    if (authRes.error) {
      const msg = authRes.error.data?.message ?? authRes.error.message ?? 'Error de autenticación';
      return NextResponse.json({ ok: false, error: `Odoo auth error: ${msg}` }, { status: 401 });
    }

    const authResult = authRes.result as { uid?: number; session_id?: string } | null;
    if (!authResult?.uid) {
      return NextResponse.json({ ok: false, error: 'Credenciales incorrectas o usuario sin acceso. Verificá usuario y API Key.' }, { status: 401 });
    }

    // Capturar cookies de sesión
    const sessionCookie = `session_id=${authResult.session_id ?? ''}`;

    // ── 3. Obtener productos con stock de Odoo ──
    const stockRes = await odooRpc(
      baseUrl,
      '/web/dataset/call_kw',
      {
        model:  'product.product',
        method: 'search_read',
        args:   [[['active', '=', true]]],
        kwargs: {
          fields: ['id', 'name', 'default_code', 'qty_available', 'barcode', 'product_tmpl_id'],
          limit:  3000,
        },
      },
      sessionCookie
    );

    if (stockRes.error) {
      const msg = stockRes.error.data?.message ?? stockRes.error.message ?? 'Error al obtener stock';
      return NextResponse.json({ ok: false, error: `Error obteniendo stock: ${msg}` }, { status: 500 });
    }

    const odooProducts = stockRes.result as OdooProduct[];
    if (!Array.isArray(odooProducts) || odooProducts.length === 0) {
      return NextResponse.json({ ok: false, error: 'Odoo no devolvió productos. Verificá permisos de lectura en Inventario.' }, { status: 500 });
    }

    // ── 4. Cargar products.json y construir índices ──
    if (!existsSync(PRODUCTS_PATH)) {
      return NextResponse.json({ ok: false, error: 'products.json no encontrado' }, { status: 500 });
    }
    const localProducts: LocalProduct[] = JSON.parse(readFileSync(PRODUCTS_PATH, 'utf8'));

    // Índices de búsqueda
    const byTmplId = new Map<number, LocalProduct>();    // odooId (template id) → producto
    const bySku    = new Map<string, LocalProduct>();    // sku normalizado → producto
    const byName   = new Map<string, LocalProduct>();    // nombre normalizado → producto

    for (const p of localProducts) {
      if (p.odooId) byTmplId.set(p.odooId, p);
      if (p.sku)    bySku.set(norm(p.sku), p);
      byName.set(norm(p.name), p);
    }

    // ── 5. Acumular stock por template (agrupa variantes) ──
    const tmplStock = new Map<number, number>();  // tmplId → stock total
    for (const op of odooProducts) {
      const tmplId = op.product_tmpl_id?.[0];
      if (!tmplId) continue;
      tmplStock.set(tmplId, (tmplStock.get(tmplId) ?? 0) + Math.max(0, op.qty_available ?? 0));
    }

    // ── 6. Resetear stock y matchear ──
    for (const p of localProducts) p.stock = 0;

    let matched   = 0;
    let byId      = 0;
    let bySKU     = 0;
    let byNm      = 0;
    const missed: string[] = [];

    for (const op of odooProducts) {
      const tmplId = op.product_tmpl_id?.[0];
      if (!tmplId) continue;

      const stockVal = tmplStock.get(tmplId) ?? 0;

      // Intentar match por tmpl_id → odooId (más confiable)
      let local = byTmplId.get(tmplId);

      // Fallback: SKU / default_code
      if (!local && op.default_code) {
        local = bySku.get(norm(String(op.default_code)));
        if (local) bySKU++;
      }

      // Fallback: nombre normalizado
      if (!local) {
        local = byName.get(norm(op.name));
        if (local) byNm++;
      }

      if (local) {
        // Solo actualizar si todavía es 0 (evitar doble-actualización por variantes)
        if (local.stock === 0 && stockVal > 0) {
          local.stock = Math.round(stockVal * 100) / 100;
        }
        if (byTmplId.get(tmplId) === local) byId++;
        matched++;
        // Marcar tmplId como procesado para no duplicar
        tmplStock.delete(tmplId);
      } else {
        if (!missed.includes(op.name)) missed.push(op.name);
      }
    }

    // ── 7. Guardar ──
    writeFileSync(PRODUCTS_PATH, JSON.stringify(localProducts, null, 2), 'utf8');

    const withStock = localProducts.filter(p => (p.stock ?? 0) > 0).length;

    return NextResponse.json({
      ok:      true,
      total:   odooProducts.length,
      matched,
      byId,
      bySku:   bySKU,
      byName:  byNm,
      unmatched: missed.length,
      unmatchedSample: missed.slice(0, 8),
      withStock,
      message: `${withStock} productos con stock actualizado desde Odoo.`,
    });

  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
