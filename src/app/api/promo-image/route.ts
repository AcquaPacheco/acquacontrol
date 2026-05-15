import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/promo-image
 * Llama a DALL-E 3 para generar una imagen promocional basada en los datos de la promo.
 * Requiere OPENAI_API_KEY en las variables de entorno.
 */

const BG_PROMPTS: Record<string, string> = {
  blanco:  'clean white background, minimal product photography style',
  azul:    'vivid blue gradient background (#0784F2), modern retail style',
  oscuro:  'deep dark navy background (#07111F), premium luxury style',
  verano:  'warm orange to yellow gradient background, summer vibes',
  violeta: 'purple to pink gradient background, vibrant promotional style',
  custom:  'colorful professional background',
};

const TIPO_PROMPTS: Record<string, string> = {
  '2da_unidad':  'Buy 2 get one at discount, shown with two product units side by side',
  'por_cantidad': 'Bulk quantity discount promotion, multiple units displayed',
  'descuento':   'Direct discount promotion with a bold percentage badge',
  'combo':       'Combo deal bundle, products arranged together as a set',
  'regalo':      'Gift included promotion with a ribbon or gift bow visual element',
};

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'OPENAI_API_KEY no configurada. Agregala en .env.local como OPENAI_API_KEY=sk-...' },
      { status: 500 },
    );
  }

  const body = await req.json() as {
    promoName: string;
    tipo: string;
    objetivo: string;
    productos: string[];
    precio: number;
    ahorro: number;
    param: number;
    bg: string;
  };

  const { promoName, tipo, productos, precio, ahorro, param, bg } = body;

  const bgPrompt    = BG_PROMPTS[bg] ?? BG_PROMPTS.azul;
  const tipoPrompt  = TIPO_PROMPTS[tipo] ?? '';
  const prodList    = productos.slice(0, 3).join(', ');
  const ahorroLine  = ahorro > 0 ? ` Customer saves $${Math.round(ahorro).toLocaleString('es-AR')}.` : '';

  const prompt = [
    `Create a clean, editorial-style square (1:1) promotional banner for an Argentine cleaning and household products store called "Acqua Pacheco".`,
    `Visual style reference: minimal white or solid-color background, products displayed on clean white geometric pedestals/risers casting soft shadows, bold oversized typography for the offer.`,
    `Promotion: "${promoName}". ${tipoPrompt}`,
    `Featured products: ${prodList}. Show them as clean product shots arranged on white rectangular display podiums, with soft drop shadows, like a high-end retail advertisement.`,
    param > 0 ? `Feature "${param}% OFF" in very large, bold, dominant black typography (similar to editorial fashion advertising).` : '',
    `Show price $${Math.round(precio).toLocaleString('es-AR')} in a secondary accent color.${ahorroLine}`,
    `Background: ${bgPrompt}.`,
    `Layout (top to bottom): "ACQUA PACHECO" brand name in small spaced letters at top → thin horizontal rule → small pill tag with offer type → HUGE bold offer text → products on pedestals → price details → thin footer bar with contact info.`,
    `Typography must be clean sans-serif, no decorative fonts. Text in Spanish.`,
    `Quality: commercial photography aesthetic, premium retail, no people, no clutter. Square format 1:1.`,
  ].filter(Boolean).join(' ');

  try {
    const openaiRes = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model:   'dall-e-3',
        prompt,
        n:       1,
        size:    '1024x1024',
        quality: 'standard',
      }),
    });

    if (!openaiRes.ok) {
      const err = await openaiRes.json();
      return NextResponse.json({ error: err.error?.message ?? 'OpenAI error' }, { status: 500 });
    }

    const data = await openaiRes.json() as { data: { url: string }[] };
    return NextResponse.json({ url: data.data[0]?.url });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
