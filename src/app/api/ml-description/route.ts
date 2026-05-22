import { NextRequest, NextResponse } from 'next/server';
import { streamGemini } from '@/lib/gemini';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface CompetitorItem {
  title: string;
  price: number;
  freeShipping: boolean;
  soldQty: number;
  seller: string | null;
}

interface RequestBody {
  productName: string;
  sku?: string;
  category?: string;
  cost: number;
  mlPrice?: number;
  mlTitle?: string;
  mlCondition?: string;
  mlFreeShipping?: boolean;
  mlHasInstallments?: boolean;
  competitors?: CompetitorItem[];
  recommendedPrice?: number;
  currentDescription?: string;  // descripción actual en ML (para mejorar en lugar de generar desde cero)
}

// ─────────────────────────────────────────────────────────────────────────────
// Route handler
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY || req.headers.get('X-Gemini-Key') || '';
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Configurá tu clave de IA Gemini en ML Lab → Parámetros globales → Clave IA.' },
      { status: 500 },
    );
  }

  let body: RequestBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const {
    productName, sku, category, mlPrice, mlTitle,
    mlCondition, mlFreeShipping, mlHasInstallments,
    competitors = [], recommendedPrice, currentDescription,
  } = body;

  const ars = (n: number) =>
    new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);

  const competitorText = competitors.length > 0
    ? competitors.slice(0, 5).map(c =>
        `- "${c.title}" → ${ars(c.price)} ${c.freeShipping ? '(envío gratis)' : ''} | ${c.soldQty} vendidos | ${c.seller ?? '?'}`
      ).join('\n')
    : 'Sin datos de competencia disponibles.';

  const systemPrompt = `Sos un experto en publicaciones de MercadoLibre Argentina, especializado en accesorios de piletas, bombas de agua y filtración.

════════════════════════════════════════
POLÍTICAS OFICIALES DE MERCADOLIBRE (Argentina)
════════════════════════════════════════

TÍTULO (máximo 60 caracteres):
✓ Incluir: nombre del producto + marca + modelo/medida + característica diferencial
✓ Usar palabras que los compradores buscan (no el nombre técnico de catálogo)
✓ Primera palabra = la más importante para el ranking de búsqueda de ML
✗ PROHIBIDO: precio en el título, descuentos ("oferta", "rebaja", "2x1")
✗ PROHIBIDO: la palabra "envío gratis" en el título
✗ PROHIBIDO: nombre del vendedor ni datos de contacto
✗ PROHIBIDO: condición del producto ("nuevo", "usado") — va en campo aparte
✗ PROHIBIDO: puntuación excesiva (!!! ??? ---) y TODAS MAYÚSCULAS
✗ PROHIBIDO: repetir palabras en el mismo título
✗ PROHIBIDO: artículos al inicio (el, la, los, las, un, una)

DESCRIPCIÓN (hasta 50.000 chars, recomendado 300-800 chars):
✓ Características técnicas claras (material, medidas, compatibilidades)
✓ Beneficios concretos del producto
✓ Cómo instalarlo o usarlo si aplica
✓ Garantía del fabricante si tiene
✓ Condiciones de compatibilidad (marca de pileta, tipo de bomba, etc.)
✗ PROHIBIDO: teléfonos, emails, WhatsApp, Instagram, Facebook, sitios web
✗ PROHIBIDO: redirigir a comprar fuera de ML
✗ PROHIBIDO: precios diferentes al publicado o descuentos por pago en efectivo
✗ PROHIBIDO: información de stock no disponible ("si te quedaste sin stock, consultame")
✗ PROHIBIDO: insultar a la competencia ni hacer comparaciones negativas
✗ PROHIBIDO: promesas exageradas sin sustento ("el mejor del mercado")

PALABRAS CLAVE (SEO interno de ML):
- ML rankea por: título + atributos + categoría + historial de ventas
- El algoritmo de ML pesa más las primeras palabras del título
- Usar variaciones naturales que los compradores buscan
- Incluir sinónimos: "barrefondo" = "limpiafondo", "cepillo de fondo", etc.

ATRIBUTOS:
- Completar TODOS los atributos del producto mejora el ranking en ML
- Marca, modelo, material, dimensiones son los más importantes para accesorios de piletas

════════════════════════════════════════
TU TAREA
════════════════════════════════════════
Generá una publicación optimizada respetando ESTRICTAMENTE todas las políticas anteriores.

FORMATO DE RESPUESTA (respetá exactamente esta estructura, sin asteriscos ni markdown):

TÍTULO SUGERIDO:
[título de máximo 60 caracteres, sin artículos al inicio]

TÍTULO ALTERNATIVO:
[otra versión del título, diferente enfoque]

PALABRAS CLAVE:
[6-10 términos de búsqueda separados por coma, en minúscula, que los compradores usan]

DESCRIPCIÓN:
[descripción de 3-4 párrafos breves o bullets. Clara, técnica, sin datos de contacto ni links]

ATRIBUTOS A COMPLETAR EN ML:
[lista de atributos relevantes que debés completar en el formulario de ML]

TIPS ESPECÍFICOS PARA ESTA PUBLICACIÓN:
[2-3 recomendaciones concretas basadas en la competencia y las políticas de ML]`;

  const currentDescSection = currentDescription
    ? `\nDESCRIPCIÓN ACTUAL EN ML (MEJORAR — conservá los datos concretos de Acqua Pacheco, eliminá el texto genérico de presentación "Hola somos ACQUA PACHECO…", optimizá SEO y estructura según las políticas):
${currentDescription.slice(0, 2000)}${currentDescription.length > 2000 ? '\n[...recortado para brevedad...]' : ''}\n`
    : '';

  const userMessage = `PRODUCTO A PUBLICAR:
Nombre actual: ${productName}
SKU: ${sku ?? '—'}
Categoría: ${category ?? 'Accesorios de piletas'}
Precio actual ML: ${mlPrice ? ars(mlPrice) : 'Sin publicación'}
Precio recomendado: ${recommendedPrice ? ars(recommendedPrice) : '—'}
Título actual en ML: ${mlTitle ?? 'Sin título aún'}
Condición: ${mlCondition ?? 'nuevo'}
Envío gratis activo: ${mlFreeShipping ? 'Sí' : 'No'}
Cuotas sin interés: ${mlHasInstallments ? 'Sí' : 'No'}
${currentDescSection}
COMPETENCIA EN ML (ya filtré mi propia tienda):
${competitorText}

${currentDescription
  ? 'MEJORÁ la descripción actual: eliminá el texto de presentación genérico, conservá toda la info técnica real, optimizá SEO según políticas ML Argentina.'
  : 'Generá la publicación siguiendo estrictamente las políticas de ML Argentina.'}`;

  try {
    const stream = await streamGemini(
      apiKey, systemPrompt,
      [{ role: 'user', parts: [{ text: userMessage }] }],
      { maxTokens: currentDescription ? 1500 : 1000 },
    );

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err) {
    console.error('[ml-description]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
