import { NextRequest, NextResponse } from 'next/server';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const PRODUCTS_PATH  = resolve(process.cwd(), 'src/data/products.json');
const SUPPLIER_PATH  = resolve(process.cwd(), 'src/data/odoo-supplierinfo.json');
const CONTACTS_PATH  = resolve(process.cwd(), 'src/data/suppliers.json');
const STOCK_PATH     = resolve(process.cwd(), 'src/data/stock.json');

function safeRead(path: string): unknown[] {
  try {
    if (!existsSync(path)) return [];
    return JSON.parse(readFileSync(path, 'utf8')) as unknown[];
  } catch { return []; }
}

/**
 * GET /api/data-management
 * Devuelve estadísticas del estado actual de los datos.
 */
export async function GET() {
  try {
    const products  = safeRead(PRODUCTS_PATH) as { cost: number; price: number; image: string | null; supplierName: string | null }[];
    const suppliers = safeRead(SUPPLIER_PATH);   // grupos de supplierinfo
    const contacts  = safeRead(CONTACTS_PATH);   // contactos res.partner

    const stats = {
      products: {
        total:        products.length,
        conCosto:     products.filter(p => p.cost > 0).length,
        conPrecio:    products.filter(p => p.price > 0).length,
        conImagen:    products.filter(p => p.image !== null).length,
        conProveedor: products.filter(p => p.supplierName !== null).length,
      },
      suppliers: {
        total:    suppliers.length,  // grupos de supplierinfo
        contacts: contacts.length,   // contactos importados
      },
    };

    return NextResponse.json({ ok: true, stats });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

/**
 * DELETE /api/data-management
 * Resetea products.json y odoo-supplierinfo.json a arrays vacíos.
 * Requiere el header X-Confirm: RESET_ALL_DATA para prevenir accidentes.
 * En Vercel (producción) el filesystem es read-only — no es posible escribir.
 */
export async function DELETE(req: NextRequest) {
  // En Vercel el sistema de archivos es de solo lectura — los datos están
  // compilados en el bundle y no se pueden reescribir en runtime.
  if (process.env.VERCEL === '1' || process.env.VERCEL_ENV) {
    return NextResponse.json(
      {
        ok: false,
        error: 'El reset no está disponible en producción (Vercel). Los datos viven en el bundle del deploy. Para resetear, modificá los archivos JSON localmente y volvé a deployar.',
        isVercel: true,
      },
      { status: 503 },
    );
  }

  const confirm = req.headers.get('X-Confirm');
  if (confirm !== 'RESET_ALL_DATA') {
    return NextResponse.json(
      { ok: false, error: 'Falta el header X-Confirm: RESET_ALL_DATA' },
      { status: 400 },
    );
  }

  try {
    writeFileSync(PRODUCTS_PATH, JSON.stringify([], null, 2), 'utf8');
    writeFileSync(SUPPLIER_PATH, JSON.stringify([], null, 2), 'utf8');
    writeFileSync(CONTACTS_PATH, JSON.stringify([], null, 2), 'utf8');
    writeFileSync(STOCK_PATH,    JSON.stringify([], null, 2), 'utf8');
    return NextResponse.json({ ok: true, message: 'Base de datos reseteada a cero.' });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

/**
 * POST /api/data-management
 * Reemplaza COMPLETAMENTE products.json con los datos enviados.
 * Lo que no viene en el payload se BORRA — no hay merge.
 *
 * Body: { products: Product[] } o { suppliers: Supplier[] } o ambos.
 */
export async function POST(req: NextRequest) {
  if (process.env.VERCEL === '1' || process.env.VERCEL_ENV) {
    return NextResponse.json(
      { ok: false, error: 'Las escrituras de datos no están disponibles en producción (Vercel). Los datos viven en el bundle del deploy.', isVercel: true },
      { status: 503 },
    );
  }
  try {
    const body = await req.json() as {
      products?: unknown[];
      suppliers?: unknown[];
    };

    if (body.products !== undefined) {
      if (!Array.isArray(body.products)) {
        return NextResponse.json({ ok: false, error: 'products debe ser un array' }, { status: 400 });
      }
      writeFileSync(PRODUCTS_PATH, JSON.stringify(body.products, null, 2), 'utf8');
    }

    if (body.suppliers !== undefined) {
      if (!Array.isArray(body.suppliers)) {
        return NextResponse.json({ ok: false, error: 'suppliers debe ser un array' }, { status: 400 });
      }
      writeFileSync(SUPPLIER_PATH, JSON.stringify(body.suppliers, null, 2), 'utf8');
    }

    return NextResponse.json({
      ok: true,
      written: {
        products: body.products?.length ?? 'no cambiado',
        suppliers: body.suppliers?.length ?? 'no cambiado',
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
