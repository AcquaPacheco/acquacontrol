import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { SETTINGS_PATH } from '@/lib/data-paths';

// ── Brief de diseño corporativo Acqua Pacheco ─────────────────────────────────
const DESIGN_BRIEF = `
Sos el diseñador gráfico de Acqua Pacheco, una distribuidora argentina de limpieza y hogar.

ESTILO VISUAL:
- Formato cuadrado 1:1 (para Instagram/WhatsApp)
- Fondo claro: blanco o gris muy suave (#F5F4F0)
- Alto contraste: negro profundo, rojo (#E53E3E) y acentos del producto
- Producto protagonista: grande, limpio, sin fondo blanco, centrado o ligeramente desplazado
- NO inventar precios ni nombres: usar EXACTAMENTE los datos que te pasan

JERARQUÍA VISUAL (de arriba a abajo):
1. BENEFICIO PRINCIPAL (headline grande, negrita, máximo 5 palabras)
2. NOMBRE DEL PRODUCTO (bold, secundario)
3. PRECIO REGULAR tachado (pequeño, gris)
4. PRECIO PROMO (enorme, dominante, negro o rojo)
5. AHORRO en rojo: "Ahorrás $X" o "X% OFF"
6. "Precio único con cualquier medio de pago" (si corresponde)

TIPOGRAFÍA:
- Fuente sans-serif bold/black
- Headline: muy grande (ocupa casi todo el ancho)
- Precio promo: enorme, negro o acento
- Subtextos: pequeños y discretos

COMPOSICIÓN:
- Producto a la derecha o centrado, texto a la izquierda o superpuesto
- Badges rojos para % OFF (círculo o rectángulo redondeado)
- Contenedores con bordes suaves y sombra leve para precio
- Barra inferior oscura con medios de pago
- Logo "ACQUA PACHECO" en el header (pequeño, discreto)
- Aire visual suficiente — no sobrecargar

RESULTADO ESPERADO:
Diseño que cualquier cliente entienda en 3 segundos. Estilo de comercio local argentino, vendedor, directo, limpio. Similar a publicidades comerciales brasileras de alto impacto.
`;

// ── Leer credenciales ─────────────────────────────────────────────────────────
function readSettings(): Record<string, string> {
  try {
    if (existsSync(SETTINGS_PATH))
      return JSON.parse(readFileSync(SETTINGS_PATH, 'utf8')) as Record<string, string>;
  } catch { /* ignorar */ }
  return {};
}

// ── Generar con Gemini (imagen inline base64) ─────────────────────────────────
async function generateWithGemini(prompt: string, apiKey: string): Promise<string | null> {
  // Intentar con gemini-2.0-flash-exp que soporta generación de imágenes
  for (const model of ['gemini-2.0-flash-exp', 'gemini-2.0-flash-preview-image-generation']) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
          }),
        }
      );
      if (!res.ok) continue;
      const data = await res.json() as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> }
        }>
      };
      const part = data.candidates?.[0]?.content?.parts
        ?.find(p => p.inlineData?.mimeType?.startsWith('image/'));
      if (part?.inlineData?.data) {
        return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
      }
    } catch { continue; }
  }
  return null;
}

// ── Generar con DALL-E 3 ──────────────────────────────────────────────────────
async function generateWithDallE(prompt: string, apiKey: string): Promise<string | null> {
  try {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method:  'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'dall-e-3', prompt, n: 1, size: '1024x1024', quality: 'standard' }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { data: { url: string }[] };
    return data.data[0]?.url ?? null;
  } catch { return null; }
}

// ── Main handler ──────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json() as {
    promoName:  string;
    tipo:       string;
    objetivo:   string;
    productos:  string[];
    precio:     number;
    ahorro:     number;
    savingsPct: number;
    param:      number;
    bg:         string;
    qty?:       number;
  };

  const { promoName, tipo, productos, precio, ahorro, savingsPct, param, qty = 1 } = body;
  const settings = readSettings();
  const geminiKey = settings.geminiKey || process.env.GEMINI_API_KEY || '';
  const openaiKey = process.env.OPENAI_API_KEY || '';

  if (!geminiKey && !openaiKey) {
    return NextResponse.json(
      { error: 'Configurá la Gemini API Key en Parámetros → Integraciones' },
      { status: 500 },
    );
  }

  // ── Armar el prompt de diseño específico ──────────────────────────────────
  const ars = (n: number) =>
    new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);

  const precioRegular = ahorro > 0 ? precio + ahorro : null;
  const perUnit = qty > 1 ? Math.round(precio / qty) : null;

  const tipoLabel =
    tipo === '2da_unidad'    ? `2da unidad al ${param}% OFF`
    : tipo === 'por_cantidad'  ? `${param}% OFF por cantidad`
    : tipo === 'descuento'     ? `${param}% de descuento`
    : tipo === 'combo'         ? 'combo precio especial'
    : tipo === 'regalo'        ? 'con regalo incluido'
    : 'oferta especial';

  const headline =
    tipo === '2da_unidad'    ? `LLEVÁ 2, LA 2DA AL ${param}% OFF`
    : tipo === 'por_cantidad'  ? `${param}% OFF COMPRANDO LA CANTIDAD`
    : tipo === 'descuento'     ? `${param}% DE DESCUENTO`
    : tipo === 'combo'         ? `COMBO: ${(promoName || productos[0] || '').toUpperCase().slice(0, 30)}`
    : tipo === 'regalo'        ? `CON TU COMPRA, ¡UN REGALO!`
    : (promoName || 'OFERTA ESPECIAL').toUpperCase();

  const prompt = `
${DESIGN_BRIEF}

---
DATOS EXACTOS DE LA PROMO (NO INVENTAR NADA):

TÍTULO PRINCIPAL: "${headline}"
TIPO DE PROMO: ${tipoLabel}
PRODUCTO(S): ${productos.slice(0, 3).join(' + ')}
${precioRegular ? `PRECIO REGULAR: ${ars(precioRegular)} (tachado, secundario)` : ''}
PRECIO PROMO: ${ars(precio)} (grande, dominante)
${ahorro > 0 ? `AHORRO: ${ars(ahorro)} (${Math.round(savingsPct)}% OFF — destacado en rojo)` : ''}
${perUnit ? `PRECIO POR UNIDAD: ${ars(perUnit)} c/u` : ''}
${qty > 1 ? `CANTIDAD: ${qty} unidades` : ''}
MEDIO DE PAGO: Precio único con cualquier medio de pago (VISA, Mastercard, Débito, Transferencia, Efectivo)

INSTRUCCIONES ADICIONALES:
- El producto debe aparecer grande y limpio, sin fondo blanco (recortado)
- Usar exactamente estos precios y nombres, no inventar nada
- Diseño en español argentino, comercial, directo
- El precio promo debe ser visualmente dominante
- Incluir el badge de ahorro en rojo
- Footer con "ACQUA PACHECO" y medios de pago
- NO agregar texto genérico tipo "gran oferta" — usar los datos exactos provistos
`;

  // Intentar Gemini primero (ya configurado), después DALL-E como fallback
  let result: string | null = null;

  if (geminiKey) {
    result = await generateWithGemini(prompt, geminiKey);
  }

  if (!result && openaiKey) {
    result = await generateWithDallE(prompt, openaiKey);
  }

  if (!result) {
    return NextResponse.json(
      { error: 'No se pudo generar la imagen. Verificá la Gemini API Key en Parámetros.' },
      { status: 500 },
    );
  }

  // Si es URL (DALL-E), devolver como url. Si es data URL (Gemini), devolver como dataUrl.
  if (result.startsWith('data:')) {
    return NextResponse.json({ dataUrl: result });
  }
  return NextResponse.json({ url: result });
}
