import { NextRequest, NextResponse } from 'next/server';

// ─────────────────────────────────────────────────────────────────────────────
// Gemini multimodal: interpreta listas de precios en cualquier formato
// ─────────────────────────────────────────────────────────────────────────────
import { GEMINI_MODEL } from '@/lib/gemini';

export interface CatalogAIItem {
  code: string;
  desc: string;
  priceUSD: number | null;
  priceARS: number | null;
  unit: string;
  category: string;
  notes: string;
}

export interface CatalogAIResult {
  ok: boolean;
  items: CatalogAIItem[];
  currency: 'USD' | 'ARS' | 'unknown';
  supplierGuess: string;
  rawSummary: string;
  error?: string;
}

async function callGemini(
  apiKey: string,
  parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }>,
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { maxOutputTokens: 8192, temperature: 0.1 },
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`Gemini ${res.status}: ${err}`);
  }

  const data = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  };
  return data.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? '';
}

const SYSTEM_PROMPT = `Sos un experto en interpretar listas de precios de proveedores argentinos de accesorios de piletas, bombas de agua, riego y filtración.

Tu tarea es extraer TODOS los productos de la lista de precios que te envío y devolver un JSON estructurado.

REGLAS IMPORTANTES:
- Extraé TODOS los productos que veas, sin excepción
- Si el precio está en USD (dólares), poné priceUSD y dejá priceARS en null
- Si el precio está en ARS (pesos), poné priceARS y dejá priceUSD en null
- Si no hay código de producto, inventá uno basado en la descripción (ej: "auto_001")
- La categoría es el encabezado de sección más cercano al producto
- Si la lista tiene múltiples monedas o hay ambigüedad, indicalo en notes
- Identificá el nombre del proveedor si aparece

Devolvé ÚNICAMENTE un JSON válido con esta estructura exacta (sin texto extra, sin markdown):
{
  "currency": "USD" | "ARS" | "unknown",
  "supplierGuess": "Nombre del proveedor si lo podés detectar",
  "rawSummary": "Resumen en 1-2 oraciones de qué contiene la lista",
  "items": [
    {
      "code": "código del producto",
      "desc": "descripción del producto",
      "priceUSD": 123.45 o null,
      "priceARS": 123456 o null,
      "unit": "U" o "MT" o "KG" etc,
      "category": "categoría o sección",
      "notes": "notas especiales si hay"
    }
  ]
}`;

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY || req.headers.get('X-Gemini-Key') || '';
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: 'Configurá tu clave Gemini en ML Lab → Parámetros globales → Clave IA.' },
      { status: 500 },
    );
  }

  try {
    const contentType = req.headers.get('content-type') ?? '';

    let parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

    if (contentType.includes('application/json')) {
      // Recibe base64 de imagen o PDF desde el cliente
      const body = await req.json() as {
        mimeType: string;
        data: string;          // base64
        fileName?: string;
      };
      parts = [
        { text: SYSTEM_PROMPT },
        {
          inlineData: {
            mimeType: body.mimeType,
            data: body.data,
          },
        },
        { text: 'Extraé todos los productos de esta lista de precios y devolvé el JSON.' },
      ];
    } else {
      return NextResponse.json({ ok: false, error: 'Content-Type debe ser application/json' }, { status: 400 });
    }

    const raw = await callGemini(apiKey, parts);

    // Limpiar respuesta: quitar markdown si Gemini lo agregó
    const jsonStr = raw
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    let parsed: CatalogAIResult;
    try {
      const obj = JSON.parse(jsonStr) as Omit<CatalogAIResult, 'ok'>;
      parsed = { ok: true, ...obj };
    } catch {
      // Si Gemini no devolvió JSON válido, intentar extraer lo que se pueda
      return NextResponse.json({
        ok: false,
        error: 'La IA no pudo interpretar el archivo como lista de precios. Intentá con otro formato o mejor calidad.',
        rawText: raw.slice(0, 500),
      } as CatalogAIResult & { rawText: string }, { status: 422 });
    }

    return NextResponse.json(parsed);

  } catch (e) {
    console.error('[catalog-ai]', e);
    return NextResponse.json({ ok: false, error: String(e) } as CatalogAIResult, { status: 500 });
  }
}
