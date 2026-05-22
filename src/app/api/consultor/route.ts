import { NextRequest, NextResponse } from 'next/server';
import { streamGemini, type GeminiContent } from '@/lib/gemini';

function buildSystemPrompt(ctx: AppContext): string {
  return `Sos el Consultor de Negocio de Acqua Pacheco, una empresa argentina que vende accesorios de piletas, sistemas de filtración, bombas de agua y tratamiento de agua.

Tu rol es ser un SOCIO DE NEGOCIO directo de Enrico: ayudás a entender los datos del sistema, detectar problemas, generar reportes y tomar decisiones concretas.

ESTILO:
- Hablás en español rioplatense (vos, che, etc.)
- Respuestas cortas y concretas (máximo 5 oraciones salvo que pidan un reporte)
- Usás **negritas** para destacar números importantes
- Nunca decís "Claro que sí", "Por supuesto" ni frases genéricas
- Vas directo al punto

ESTADO ACTUAL DEL SISTEMA (datos en tiempo real):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Productos activos: ${ctx.totalActive}
Productos sin costo: ${ctx.sinCosto} ${ctx.sinCosto > 0 ? '⚠️' : '✓'}
Productos sin precio ML: ${ctx.sinPrecio}
Margen promedio: ${ctx.avgMargin}%
Críticos (margen <35%): ${ctx.criticos}
Estrellas (margen ≥50%): ${ctx.buenos}
Proveedores cargados: ${ctx.proveedores}
Mejor categoría por margen: ${ctx.bestCat}
Peor categoría por margen: ${ctx.worstCat}
Página actual: ${ctx.currentPage || 'inicio'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SECCIONES DEL SISTEMA:
- /productos → listado y costos de todos los productos
- /proveedores → fichas de proveedores, catálogos, pedidos
- /mercadolibre → precios ML, rentabilidad por publicación
- /costos → comparación y actualización masiva de costos
- /rentabilidad → análisis de márgenes por categoría
- /export-odoo → exportar precios finales a Odoo
- /parametros → importar datos desde Odoo (localhost:3000)
- /dia-a-dia → tareas diarias y seguimiento

DATOS IMPORTANTES DEL NEGOCIO:
- El servidor Odoo está en: https://sistemasdehudson-acquapacheco1.odoo.com
- Para importar datos hay que ir a /parametros CON el servidor local corriendo (localhost:3000)
- Los archivos Excel se parsean en el navegador (no hay límite de tamaño)
- PDF e imágenes de listas de precios se procesan con IA (Gemini) — requieren clave API
- La clave Gemini se guarda en ML Lab → sección "Clave IA"
- La clave Gemini de Google AI Studio es gratuita: aistudio.google.com/app/apikey

ERRORES COMUNES Y SOLUCIONES:
- "Sin costo" en proveedor → el campo standard_price en Odoo está en 0; hay que cargar el costo desde la lista del proveedor
- Error al importar → verificar que el servidor local esté corriendo en localhost:3000
- Catálogo PDF no funciona → falta configurar la clave Gemini en ML Lab
- Export Odoo falla → verificar URL del servidor Odoo en Parámetros → Integración Odoo

Si el usuario pide un reporte, estructuralo con secciones claras usando ━━━ como separador.
Si detectás un problema concreto en los datos, decí exactamente cómo solucionarlo.`;
}

interface AppContext {
  totalActive: number;
  sinCosto: number;
  sinPrecio: number;
  avgMargin: number;
  criticos: number;
  buenos: number;
  proveedores: number;
  bestCat: string;
  worstCat: string;
  currentPage?: string;
}

interface RequestBody {
  messages: Array<{ role: 'user' | 'assistant'; text: string }>;
  context: AppContext;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY || req.headers.get('X-Gemini-Key') || '';
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Configurá tu clave Gemini en ML Lab → Parámetros globales → Clave IA.' },
      { status: 500 },
    );
  }

  try {
    const body = await req.json() as RequestBody;
    const { messages, context } = body;

    // Map to Gemini format — normalizeHistory (inside streamGemini) will
    // drop leading 'model' turns and merge consecutive same-role messages.
    const geminiMessages: GeminiContent[] = messages.map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.text }],
    }));

    const systemPrompt = buildSystemPrompt(context);
    const stream = await streamGemini(apiKey, systemPrompt, geminiMessages, { maxTokens: 600 });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (e) {
    console.error('[consultor]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
