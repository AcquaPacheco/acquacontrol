import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const itemId = req.nextUrl.searchParams.get('id');
  if (!itemId) return NextResponse.json({ ok: false, error: 'Falta el id de publicación' }, { status: 400 });

  const id = itemId.trim().toUpperCase();

  try {
    const [itemRes, descRes] = await Promise.allSettled([
      fetch(`https://api.mercadolibre.com/items/${id}`, {
        headers: { 'Accept': 'application/json' },
        next: { revalidate: 60 },
      }),
      fetch(`https://api.mercadolibre.com/items/${id}/description`, {
        headers: { 'Accept': 'application/json' },
        next: { revalidate: 60 },
      }),
    ]);

    if (itemRes.status === 'rejected') {
      return NextResponse.json({ ok: false, error: 'Error de red al consultar MercadoLibre' }, { status: 502 });
    }

    if (!itemRes.value.ok) {
      const err = await itemRes.value.json().catch(() => ({}));
      return NextResponse.json(
        { ok: false, error: (err as { message?: string }).message ?? `ML error ${itemRes.value.status}` },
        { status: itemRes.value.status },
      );
    }

    const item = await itemRes.value.json();

    let description = '';
    if (descRes.status === 'fulfilled' && descRes.value.ok) {
      const d = await descRes.value.json().catch(() => ({}));
      description = (d as { plain_text?: string; text?: string }).plain_text
        ?? (d as { plain_text?: string; text?: string }).text
        ?? '';
    }

    return NextResponse.json({ ok: true, item, description });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
