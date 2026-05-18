import { NextRequest, NextResponse } from 'next/server';

// ─────────────────────────────────────────────────────────────────────────────
// Gemini helper — streaming via REST (sin dependencia extra)
// ─────────────────────────────────────────────────────────────────────────────
const GEMINI_MODEL = 'gemini-2.0-flash';

interface GeminiPart   { text: string }
interface GeminiContent { role: 'user' | 'model'; parts: GeminiPart[] }

async function streamGemini(
  apiKey: string,
  systemPrompt: string,
  messages: GeminiContent[],
  maxTokens = 512,
): Promise<ReadableStream<Uint8Array>> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse&key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: messages,
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 },
    }),
  });

  if (!response.ok || !response.body) {
    const err = await response.text().catch(() => response.statusText);
    throw new Error(`Gemini ${response.status}: ${err}`);
  }

  const body = response.body;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader  = body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // Procesar líneas SSE completas
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const json = line.slice(6).trim();
            if (!json || json === '[DONE]') continue;
            try {
              const parsed = JSON.parse(json) as {
                candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
              };
              const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
              if (text) controller.enqueue(new TextEncoder().encode(text));
            } catch { /* ignorar chunks incompletos */ }
          }
        }
      } finally {
        controller.close();
      }
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface CalcContext {
  price: number;
  commission: number;
  fixedFee: number;
  shippingCost: number;
  depositML: number;
  ivaDiscounted: number;
  iibbCost: number;
  netRevenue: number;
  cost: number;
  netProfit: number;
  netMargin: number;
  status: string;
}

interface ProductContext {
  name: string;
  sku?: string;
  mlItemId?: string;
  cost: number;
  mlPrice?: number;
  mlStatus?: string;
  mlSold?: number;
  mlVisits?: number;
  mlFreeShipping?: boolean;
  mlHasInstallments?: boolean;
  stock: number;
  syncStatus: string;
  markup: number;
  alerts: Array<{ message: string; type: string }>;
}

interface ParamsContext {
  commission: number;
  fixedFee: number;
  shippingCost: number;
  iibb: number;
  isRI: boolean;
  minMargin: number;
  idealMargin: number;
}

interface RequestBody {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  product: ProductContext;
  params: ParamsContext;
  calc?: CalcContext | null;
  idealPrice?: number;
  idealMarkup?: number;
  consultantScore?: number;
  consultantStrategy?: string;
  consultantStrategyLabel?: string;
}

function ars(n: number) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', maximumFractionDigits: 0,
  }).format(n);
}

function buildSystemPrompt(
  product: ProductContext,
  params: ParamsContext,
  calc: CalcContext | null | undefined,
  idealPrice: number,
  idealMarkup: number,
  score: number,
  strategy: string,
  strategyLabel: string,
): string {
  const alertsText = product.alerts.length > 0
    ? product.alerts.map(a => `- [${a.type.toUpperCase()}] ${a.message}`).join('\n')
    : 'Sin alertas críticas';

  const calcText = calc
    ? `
DESGLOSE RENTABILIDAD (precio actual ${ars(calc.price)}):
  Precio publicado (con IVA): ${ars(calc.price)}
  Comisión ML (${params.commission}%): -${ars(calc.commission)}
  Cargo fijo ML por unidad: -${ars(calc.fixedFee)}${calc.shippingCost > 0 ? `\n  Costo envío gratis: -${ars(calc.shippingCost)}` : ''}
  Depósito de ML: ${ars(calc.depositML)}${params.isRI ? `\n  IVA descontado (Resp. Inscripto): -${ars(calc.ivaDiscounted)}` : ''}
  IIBB (${params.iibb}%): -${ars(calc.iibbCost)}
  Ingreso neto limpio: ${ars(calc.netRevenue)}
  Costo del producto: -${ars(calc.cost)}
  Utilidad neta: ${ars(calc.netProfit)}
  Margen neto: ${calc.netMargin.toFixed(1)}%
  Estado: ${calc.status === 'rentable' ? 'Rentable' : calc.status === 'bajo_margen' ? 'Bajo margen' : 'PIERDE DINERO'}`
    : 'Sin datos de cálculo (falta costo o precio ML)';

  return `Sos el Consultor de MercadoLibre de Acqua, una empresa argentina que vende accesorios de piletas y tratamiento de agua.

Tu rol es ser un SOCIO DE NEGOCIO directo: ayudás al vendedor a entender sus números y tomar decisiones concretas. Sos amigable, hablás en español rioplatense (vos, che, etc.), das respuestas cortas y concretas (máximo 4 oraciones).

═══════════════════════════════════
DATOS DEL PRODUCTO
═══════════════════════════════════
Nombre: ${product.name}
SKU: ${product.sku ?? '—'}
ID MercadoLibre: ${product.mlItemId ?? 'Sin publicación'}
Costo (Odoo): ${ars(product.cost)}
Precio en ML: ${product.mlPrice ? ars(product.mlPrice) : 'Sin precio ML'}
Estado ML: ${product.mlStatus ?? '—'}
Vendidos: ${product.mlSold ?? 0}
Visitas: ${product.mlVisits ?? 0}
Stock actual: ${product.stock}
Sincronización: ${product.syncStatus}
Markup Odoo actual: ${product.markup.toFixed(1)}%
Envío gratis: ${product.mlFreeShipping ? 'Sí' : 'No'}
Cuotas sin interés: ${product.mlHasInstallments ? 'Sí' : 'No'}

═══════════════════════════════════
PARÁMETROS DE CÁLCULO
═══════════════════════════════════
Comisión ML: ${params.commission}%
Cargo fijo ML (por venta): ${ars(params.fixedFee)}
Costo envío gratis: ${ars(params.shippingCost)}
IIBB: ${params.iibb}%
Responsable Inscripto: ${params.isRI ? 'Sí (descuenta IVA del depósito)' : 'No'}
Margen mínimo aceptable: ${params.minMargin}%
Margen ideal objetivo: ${params.idealMargin}%

${calcText}

═══════════════════════════════════
PRECIO IDEAL (para ${params.idealMargin}% margen)
═══════════════════════════════════
Precio ideal: ${idealPrice > 0 ? ars(idealPrice) : '—'}
Markup Odoo necesario: ${idealMarkup > 0 ? `${idealMarkup.toFixed(1)}%` : '—'}

═══════════════════════════════════
DIAGNÓSTICO
═══════════════════════════════════
Score de salud: ${score}/100
Estrategia recomendada: ${strategyLabel}

ALERTAS ACTIVAS:
${alertsText}

═══════════════════════════════════
INSTRUCCIONES DE COMPORTAMIENTO
═══════════════════════════════════
- Hablás en español rioplatense, directo y amigable (vos, che)
- Máximo 3-4 oraciones por respuesta (a menos que te pidan un desglose detallado)
- Cuando expliques por qué un producto pierde, mostrá el desglose numérico: precio → comisión → cargo fijo → depósito → IVA → IIBB → ingreso neto → costo → utilidad
- Si el usuario cree que los datos están mal (ej: "no puede perder con ese precio"), verificá el cargo fijo — es el culpable más común
- Sugería acciones concretas con números (ej: "subí a $X con markup Y% en Odoo")
- Si falta información (costo, precio ML), decíselo claramente y cómo obtenerla
- NO uses asteriscos para negrita — escribí texto plano
- NO repitas los datos completos en cada respuesta — sé conciso`;
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
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { messages, product, params, calc, idealPrice = 0, idealMarkup = 0,
    consultantScore = 0, consultantStrategy = '', consultantStrategyLabel = '' } = body;

  const systemPrompt = buildSystemPrompt(
    product, params, calc, idealPrice, idealMarkup,
    consultantScore, consultantStrategy, consultantStrategyLabel,
  );

  // Convertir mensajes al formato Gemini (assistant → model)
  const geminiMessages: GeminiContent[] = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  try {
    const stream = await streamGemini(apiKey, systemPrompt, geminiMessages, 512);

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err) {
    console.error('[ml-consult]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
