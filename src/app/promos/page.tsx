'use client';

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import productsData from '@/data/products.json';
import { cn } from '@/lib/utils';
import {
  Search, X, ChevronRight, ChevronLeft,
  Download, Copy, Check, Sparkles, Send,
  RotateCcw, TrendingUp, Heart, Zap, Calendar,
  Gift, Percent, ShoppingCart, Package,
  Upload, Image as ImageIcon, MessageCircle,
  Plus, Minus, Tag, Star, BookmarkPlus, BookOpen, Trash2, RefreshCw,
} from 'lucide-react';
import type { SavedPromo } from '@/app/api/promos/route';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface Product {
  id: string; sku: string | null; name: string;
  cost: number; price: number; margin: number | null;
  image: string | null; category: string | null;
  supplierName: string | null; uom: string;
  odooId?: number | null;
}

interface PromoItem { product: Product; qty: number; isGift: boolean; }

type Step      = 'objetivo' | 'tipo' | 'productos' | 'config' | 'publicar';
type Objetivo  = 'rotar' | 'ticket' | 'fidelizar' | 'liquidar' | 'evento';
type TipoPromo = '2da_unidad' | 'por_cantidad' | 'descuento' | 'combo' | 'regalo';
type BgOption  = 'blanco' | 'azul' | 'oscuro' | 'verano' | 'violeta' | 'custom';
type PromoMode = 'pct' | 'fijo'; // pct = % sobre Lista A (apila con lista); fijo = precio único sin descuento de lista

const ODOO_BASE = 'https://sistemasdehudson-acquapacheco1.odoo.com';
const todosProductos = productsData as unknown as Product[];

/** Resuelve la imagen de un producto: usa p.image o fallback a Odoo URL */
function resolveImg(p: Product): string | null {
  if (p.image) return p.image;
  if (p.odooId) return `${ODOO_BASE}/web/image/product.template/${p.odooId}/image_1920`;
  return null;
}

/**
 * Elimina el fondo blanco/casi-blanco de una imagen usando flood-fill desde
 * los bordes. Devuelve un canvas con fondo transparente.
 * threshold: cuán "blanco" tiene que ser el pixel para ser removido (0-255).
 */
function removeWhiteBg(img: HTMLImageElement, threshold = 32): HTMLCanvasElement {
  const MAX = 700; // escalar para performance
  const sc  = Math.min(1, MAX / Math.max(img.width, img.height));
  const W   = Math.max(1, Math.round(img.width  * sc));
  const H   = Math.max(1, Math.round(img.height * sc));

  const oc   = document.createElement('canvas');
  oc.width   = W; oc.height = H;
  const octx = oc.getContext('2d')!;
  octx.drawImage(img, 0, 0, W, H);

  const id = octx.getImageData(0, 0, W, H);
  const d  = id.data;

  const nearWhite = (i: number) =>
    d[i] > 255 - threshold && d[i+1] > 255 - threshold && d[i+2] > 255 - threshold;

  const vis = new Uint8Array(W * H);
  const q: number[] = [];

  const seed = (x: number, y: number) => {
    const pi = y * W + x;
    if (!vis[pi] && nearWhite(pi * 4)) { vis[pi] = 1; q.push(pi); }
  };

  // Sembrar desde todos los bordes
  for (let x = 0; x < W; x++) { seed(x, 0); seed(x, H - 1); }
  for (let y = 0; y < H; y++) { seed(0, y); seed(W - 1, y); }

  // BFS flood fill
  while (q.length) {
    const pi = q.pop()!;
    d[pi * 4 + 3] = 0; // transparente
    const x = pi % W, y = (pi / W) | 0;
    if (x > 0   && !vis[pi-1] && nearWhite((pi-1)*4)) { vis[pi-1]=1; q.push(pi-1); }
    if (x < W-1 && !vis[pi+1] && nearWhite((pi+1)*4)) { vis[pi+1]=1; q.push(pi+1); }
    if (y > 0   && !vis[pi-W] && nearWhite((pi-W)*4)) { vis[pi-W]=1; q.push(pi-W); }
    if (y < H-1 && !vis[pi+W] && nearWhite((pi+W)*4)) { vis[pi+W]=1; q.push(pi+W); }
  }

  // Suavizar bordes (feather 1px)
  for (let pi = 0; pi < W * H; pi++) {
    if (d[pi*4+3] === 0) continue;
    const x = pi % W, y = (pi / W) | 0;
    const hasTranspNbr =
      (x > 0   && d[(pi-1)*4+3] === 0) ||
      (x < W-1 && d[(pi+1)*4+3] === 0) ||
      (y > 0   && d[(pi-W)*4+3] === 0) ||
      (y < H-1 && d[(pi+W)*4+3] === 0);
    if (hasTranspNbr) d[pi*4+3] = 160; // semi-transparente en el borde
  }

  octx.putImageData(id, 0, 0);
  return oc;
}

function formatARS(n: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
}
const roundTo10 = (n: number) => Math.round(n / 10) * 10;

// ─────────────────────────────────────────────────────────────────────────────
// OBJETIVOS
// ─────────────────────────────────────────────────────────────────────────────

const OBJETIVOS = [
  { key: 'rotar'     as Objetivo, icon: RotateCcw,  label: 'Rotar stock',    color: 'bg-blue-50 border-blue-200',    text: 'text-blue-700',    dot: 'bg-blue-500',    desc: 'Acelerá la salida de productos con baja rotación. Volumen alto, márgenes razonables.', tipos: ['2da_unidad','por_cantidad','descuento'] as TipoPromo[] },
  { key: 'ticket'    as Objetivo, icon: TrendingUp, label: 'Subir ticket',   color: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', dot: 'bg-emerald-500', desc: 'Llevá al cliente a gastar más. Combos, cantidades y complementos.', tipos: ['combo','por_cantidad','regalo'] as TipoPromo[] },
  { key: 'fidelizar' as Objetivo, icon: Heart,      label: 'Fidelizar',      color: 'bg-pink-50 border-pink-200',    text: 'text-pink-700',    dot: 'bg-pink-500',    desc: 'Premiá a los que vuelven. Precio especial para clientes frecuentes.', tipos: ['descuento','combo','regalo'] as TipoPromo[] },
  { key: 'liquidar'  as Objetivo, icon: Zap,        label: 'Liquidar',       color: 'bg-orange-50 border-orange-200', text: 'text-orange-700',  dot: 'bg-orange-500',  desc: 'Salida rápida con precio agresivo. Vencimientos, descontinuados, sobrestock.', tipos: ['descuento','2da_unidad','por_cantidad'] as TipoPromo[] },
  { key: 'evento'    as Objetivo, icon: Calendar,   label: 'Evento / fecha', color: 'bg-purple-50 border-purple-200', text: 'text-purple-700',  dot: 'bg-purple-500',  desc: 'Navidad, día del niño, verano. Aprovechá el contexto para crear urgencia.', tipos: ['combo','descuento','regalo','2da_unidad'] as TipoPromo[] },
];

const TIPOS_INFO: Record<TipoPromo, { icon: React.ElementType; label: string; desc: string; ejemplo: string }> = {
  '2da_unidad':  { icon: Tag,          label: '2da unidad %',       desc: 'El cliente lleva 2 y la segunda tiene descuento. Ideal para consumibles.',       ejemplo: 'Ej: Lleva 2 Detergente y la 2da al 50% → cliente ahorra 25%' },
  'por_cantidad': { icon: ShoppingCart, label: 'Por cantidad',       desc: 'A mayor cantidad, mayor descuento. Funciona para papel, bolsas, insumos.',       ejemplo: 'Ej: Bolsas x6 $490, x12 $440/u, x24 $380/u' },
  'descuento':   { icon: Percent,       label: 'Descuento directo',  desc: 'Porcentaje o monto fijo de descuento. Simple, visible, impulsa decisión rápida.', ejemplo: 'Ej: 20% OFF en toda la línea de limpieza' },
  'combo':       { icon: Package,       label: 'Combo precio único', desc: 'Varios productos juntos a un precio especial. Subís ticket y mostrás valor.',    ejemplo: 'Ej: Kit Pileta Verano $22.990 (valor separado $27.170)' },
  'regalo':      { icon: Gift,          label: 'Regalo incluido',    desc: 'Al comprar X, regalás Y. Percepción de valor altísima con costo controlado.',    ejemplo: 'Ej: Llevá el Sahumerio pack y te regalo 1 ambientador' },
};

const BG_OPTIONS: { key: BgOption; label: string; preview: string }[] = [
  { key: 'blanco',  label: 'Blanco limpio',  preview: 'bg-white border-gray-200' },
  { key: 'azul',    label: 'ACQUA Azul',     preview: 'bg-[#0784F2]' },
  { key: 'oscuro',  label: 'ACQUA Oscuro',   preview: 'bg-[#07111F]' },
  { key: 'verano',  label: 'Verano',         preview: 'bg-gradient-to-br from-orange-400 to-yellow-300' },
  { key: 'violeta', label: 'Violeta',        preview: 'bg-gradient-to-br from-purple-600 to-pink-500' },
  { key: 'custom',  label: 'Subir fondo',    preview: 'bg-gray-100 border-dashed border-gray-300' },
];

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function calcPromo(items: PromoItem[], tipo: TipoPromo, param: number) {
  const mainItems = items.filter(i => !i.isGift);
  const totalCost  = mainItems.reduce((a, i) => a + i.product.cost * i.qty, 0);
  const totalPrice = mainItems.reduce((a, i) => a + i.product.price * i.qty, 0);

  let promoPrice = totalPrice;
  let desc = '';

  if (tipo === '2da_unidad') {
    // param = % de la 2da unidad (ej: 50 = 50% de dcto en la 2da)
    const byTwo = mainItems.reduce((a, i) => {
      const pairs = Math.floor(i.qty / 2);
      const rest  = i.qty % 2;
      return a + i.product.price * rest + i.product.price * pairs + i.product.price * pairs * (1 - param / 100);
    }, 0);
    promoPrice = roundTo10(byTwo);
    desc = `2da unidad al ${param}% de descuento`;
  } else if (tipo === 'por_cantidad') {
    // param = % de dcto por llevarse la cantidad indicada
    promoPrice = roundTo10(totalPrice * (1 - param / 100));
    desc = `${param}% OFF por cantidad`;
  } else if (tipo === 'descuento') {
    promoPrice = roundTo10(totalPrice * (1 - param / 100));
    desc = `${param}% de descuento`;
  } else if (tipo === 'combo') {
    // param = precio combo manual o 0 para calcular
    promoPrice = param > 0 ? param : roundTo10(totalPrice * 0.88);
    desc = `Combo precio especial`;
  } else if (tipo === 'regalo') {
    promoPrice = totalPrice; // gratis es el costo del regalo
    desc = `Incluye regalo`;
  }

  const margin = totalCost > 0 ? ((promoPrice - totalCost) / promoPrice * 100) : null;
  const savings = totalPrice - promoPrice;
  const savingsPct = totalPrice > 0 ? (savings / totalPrice * 100) : 0;

  return { promoPrice, totalCost, totalPrice, margin, savings, savingsPct, desc };
}

function socionRecomendacion(items: PromoItem[], tipo: TipoPromo, objetivo: Objetivo): string {
  const avgMargin = items.filter(i => i.product.margin !== null && !i.isGift)
    .reduce((a, i, _, arr) => a + (i.product.margin! / arr.length), 0);
  const totalItems = items.filter(i => !i.isGift).length;

  if (objetivo === 'rotar' && tipo === '2da_unidad')
    return `Con la 2da unidad al 50%, el cliente percibe que ahorra mucho y vos mantenés margen en la primera. Ideal para ${items[0]?.product.name || 'este producto'} si tenés stock acumulado.`;
  if (objetivo === 'ticket' && tipo === 'combo' && totalItems > 1)
    return `Combo bien armado. ${totalItems} productos juntos generan percepción de valor. Asegurate que el precio combo no baje del ${Math.round(avgMargin - 8)}% de margen — ese es tu piso.`;
  if (objetivo === 'liquidar' && tipo === 'descuento')
    return `Para liquidar, el descuento tiene que ser visible (mínimo 20%). Con margen actual de ${Math.round(avgMargin)}% tenés espacio. Evitá bajar del 30% de margen neto.`;
  if (objetivo === 'evento')
    return `Las promos de evento funcionan mejor con urgencia visible: "hasta el X de Y" en el mensaje. Ponele fecha límite y publicalo en WhatsApp Business el mismo día que lo activás.`;
  if (tipo === 'regalo')
    return `El regalo tiene que ser algo que el cliente valore pero con costo bajo para vos. El impacto en redes y WhatsApp es muy alto — "comprás X y te llevás Y de regalo" convierte muy bien.`;

  return `Margen promedio de los productos seleccionados: ${Math.round(avgMargin)}%. Revisá que la promo no baje del 30% de margen para que sea rentable.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function StepBar({ step }: { step: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: 'objetivo',  label: 'Objetivo'  },
    { key: 'tipo',      label: 'Tipo'      },
    { key: 'productos', label: 'Productos' },
    { key: 'config',    label: 'Configurar'},
    { key: 'publicar',  label: 'Publicar'  },
  ];
  const idx = steps.findIndex(s => s.key === step);
  return (
    <div className="flex items-center gap-0">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center">
          <div className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all',
            i < idx  ? 'bg-[#16A34A]/10 text-[#16A34A]' :
            i === idx ? 'bg-[#07111F] text-white' :
                        'bg-gray-100 text-gray-400',
          )}>
            <span className={cn(
              'w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black',
              i < idx  ? 'bg-[#16A34A] text-white' :
              i === idx ? 'bg-white text-[#07111F]' :
                          'bg-gray-300 text-white',
            )}>{i < idx ? '✓' : i + 1}</span>
            {s.label}
          </div>
          {i < steps.length - 1 && (
            <div className={cn('w-6 h-px mx-0.5', i < idx ? 'bg-[#16A34A]/40' : 'bg-gray-200')} />
          )}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CANVAS GENERATOR
// ─────────────────────────────────────────────────────────────────────────────

function usePromoCanvas(
  items: PromoItem[],
  bg: BgOption,
  customBg: string | null,
  promoName: string,
  promoPrice: number,
  savings: number,
  savingsPct: number,
  tipo: TipoPromo,
  step: Step,
  param: number,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const S = 1080;
    canvas.width  = S;
    canvas.height = S;

    // ── Palette ──────────────────────────────────────────────────────────────
    type Pal = { bgFill:string; panelFill:string; ink:string; sub:string; acc:string; accInk:string };
    const PALS: Record<BgOption,Pal> = {
      blanco:  { bgFill:'#F5F4F0', panelFill:'#07111F',            ink:'#07111F', sub:'#6B7280',              acc:'#0784F2', accInk:'#FFFFFF' },
      azul:    { bgFill:'#0784F2', panelFill:'#04276e',            ink:'#FFFFFF', sub:'rgba(255,255,255,.65)', acc:'#FFE600', accInk:'#07111F' },
      oscuro:  { bgFill:'#07111F', panelFill:'#0d1e33',            ink:'#FFFFFF', sub:'rgba(255,255,255,.55)', acc:'#0784F2', accInk:'#FFFFFF' },
      verano:  { bgFill:'#F97316', panelFill:'#07111F',            ink:'#FFFFFF', sub:'rgba(255,255,255,.72)', acc:'#FFE600', accInk:'#07111F' },
      violeta: { bgFill:'#6D28D9', panelFill:'#2D1058',            ink:'#FFFFFF', sub:'rgba(255,255,255,.65)', acc:'#FBBF24', accInk:'#07111F' },
      custom:  { bgFill:'#07111F', panelFill:'rgba(0,0,0,.82)',    ink:'#FFFFFF', sub:'rgba(255,255,255,.65)', acc:'#0784F2', accInk:'#FFFFFF' },
    };
    const { bgFill, panelFill, ink, sub: inkSub, acc: accent, accInk } = PALS[bg] ?? PALS.blanco;
    const isLight = bg === 'blanco';

    // ── Layout constants ──────────────────────────────────────────────────────
    const HDR  = 90;
    const FTR  = 72;
    const CTOP = HDR;
    const CBOT = S - FTR;

    const mainItems = items.filter(i => !i.isGift);
    const giftItems = items.filter(i =>  i.isGift);
    const count = mainItems.length;

    // ── Image loader con remoción de fondo blanco ─────────────────────────────
    // Devuelve CanvasImageSource (canvas con bg removido, o imagen original si CORS falla)
    const loadImg = (src: string | null, cb: (img: CanvasImageSource | null) => void) => {
      if (!src) { cb(null); return; }
      const isData = src.startsWith('data:');
      const img = new Image();
      if (!isData) img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          cb(removeWhiteBg(img)); // CORS OK → removemos fondo
        } catch {
          cb(img); // CORS tainted → sin remoción, igual se muestra
        }
      };
      img.onerror = () => {
        if (!isData) {
          // Retry sin CORS (canvas tainted, sin bg removal)
          const img2 = new Image();
          img2.onload  = () => cb(img2);
          img2.onerror = () => cb(null);
          img2.src = src;
        } else cb(null);
      };
      img.src = src;
    };

    // ── Text wrap helper ──────────────────────────────────────────────────────
    const wrapLines = (text: string, maxW: number, maxL = 3): string[] => {
      const words = text.split(' ');
      const lines: string[] = [];
      let cur = '';
      for (const w of words) {
        const test = cur ? cur + ' ' + w : w;
        if (cur && ctx.measureText(test).width > maxW) {
          lines.push(cur); cur = w;
          if (lines.length >= maxL) { lines[lines.length - 1] += '…'; return lines; }
        } else cur = test;
      }
      if (cur) lines.push(cur);
      return lines.slice(0, maxL);
    };
    const fillLines = (lines: string[], cx: number, y: number, lh: number) =>
      lines.forEach((l, i) => ctx.fillText(l, cx, y + i * lh));

    // ── Background ────────────────────────────────────────────────────────────
    const paintBg = (then: () => void) => {
      if (bg === 'custom' && customBg) {
        const bi = new Image();
        bi.onload  = () => { ctx.drawImage(bi, 0, 0, S, S); then(); };
        bi.onerror = () => { ctx.fillStyle = bgFill; ctx.fillRect(0, 0, S, S); then(); };
        bi.src = customBg; return;
      }
      if (bg === 'verano') {
        const g = ctx.createLinearGradient(0, S, S, 0);
        g.addColorStop(0, '#F97316'); g.addColorStop(1, '#FBBF24');
        ctx.fillStyle = g;
      } else if (bg === 'violeta') {
        const g = ctx.createLinearGradient(0, 0, S, S);
        g.addColorStop(0, '#7C3AED'); g.addColorStop(1, '#4F46E5');
        ctx.fillStyle = g;
      } else {
        ctx.fillStyle = bgFill;
      }
      ctx.fillRect(0, 0, S, S);
      then();
    };

    // ── Header ────────────────────────────────────────────────────────────────
    const drawHeader = () => {
      ctx.fillStyle = isLight ? 'rgba(0,0,0,0.025)' : 'rgba(255,255,255,0.05)';
      ctx.fillRect(0, 0, S, HDR);

      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.22)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 3;
      ctx.fillStyle = accent;
      ctx.beginPath(); ctx.roundRect(38, 15, 62, 62, 14); ctx.fill();
      ctx.restore();
      ctx.fillStyle = accInk; ctx.font = 'bold 27px Arial, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('AP', 69, 55);

      ctx.textAlign = 'left';
      ctx.fillStyle = ink;  ctx.font = '800 30px Arial, sans-serif'; ctx.fillText('ACQUA', 118, 47);
      ctx.fillStyle = inkSub; ctx.font = '500 15px Arial, sans-serif';
      ctx.fillText('PACHECO  ·  Limpieza y Hogar', 119, 70);

      // Promo pill top-right
      const pLabel = tipo === '2da_unidad' ? '2DA UNIDAD'
        : tipo === 'por_cantidad' ? `${param}% OFF CANTIDAD`
        : tipo === 'descuento'    ? `${param}% DE DESCUENTO`
        : tipo === 'combo'        ? 'COMBO ESPECIAL'
        : tipo === 'regalo'       ? '+ REGALO INCLUIDO'
        : 'OFERTA ESPECIAL';
      ctx.font = 'bold 18px Arial, sans-serif';
      const pw = ctx.measureText(pLabel).width + 44;
      const ph = 42; const px = S - 38 - pw; const py = (HDR - ph) / 2;
      ctx.fillStyle = accent;
      ctx.beginPath(); ctx.roundRect(px, py, pw, ph, ph / 2); ctx.fill();
      ctx.fillStyle = accInk; ctx.textAlign = 'center';
      ctx.fillText(pLabel, px + pw / 2, py + ph / 2 + 6.5);

      ctx.strokeStyle = isLight ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.10)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(38, HDR - 1); ctx.lineTo(S - 38, HDR - 1); ctx.stroke();
    };

    // ── Footer ────────────────────────────────────────────────────────────────
    const drawFooter = () => {
      ctx.fillStyle = isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.06)';
      ctx.fillRect(0, CBOT, S, FTR);
      ctx.fillStyle = inkSub; ctx.font = '500 17px Arial, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Acqua Pacheco  ·  @acquapacheco  ·  acquapacheco.com.ar', S / 2, CBOT + 42);
    };

    paintBg(() => {
      drawHeader();

      // ════════════════════════════════════════════════════════════════════════
      // SINGLE PRODUCT — Split + price breakdown below
      // ════════════════════════════════════════════════════════════════════════
      if (count <= 1) {
        const qty = mainItems[0]?.qty ?? 1;

        // Layout zones
        const PANEL_BOT  = 740;   // where the split panel ends
        const PRICE_TOP  = PANEL_BOT + 8;
        const PRICE_H    = 195;   // 3-column price section
        const PAY_TOP    = PRICE_TOP + PRICE_H;
        const PAY_H      = CBOT - PAY_TOP;

        const SPLIT = 580;
        const SLOPE = 78;

        // Right accent panel (only reaches PANEL_BOT)
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 44; ctx.shadowOffsetX = -10;
        ctx.fillStyle = panelFill;
        ctx.beginPath();
        ctx.moveTo(SPLIT - SLOPE / 2, CTOP);
        ctx.lineTo(SPLIT + SLOPE / 2, PANEL_BOT);
        ctx.lineTo(S, PANEL_BOT);
        ctx.lineTo(S, CTOP);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        // ── RIGHT PANEL TEXT ──────────────────────────────────────────────
        const RPX = SPLIT + 55;
        const RPW = S - RPX - 36;
        const RCX = RPX + RPW / 2;

        // Product name (top of panel, prominent)
        if (mainItems[0]) {
          ctx.fillStyle = inkSub; ctx.font = '700 24px Arial, sans-serif'; ctx.textAlign = 'center';
          fillLines(wrapLines(mainItems[0].product.name.toUpperCase(), RPW - 8, 2), RCX, CTOP + 50, 30);
        }

        // Offer headline (% / 2DA UNIDAD / etc.)
        let h1 = '', h2 = ''; let s1 = 110, s2 = 90;
        if      (tipo === '2da_unidad')    { h1 = '2DA';        h2 = 'UNIDAD OFF';   s1 = 86;  s2 = 72; }
        else if (tipo === 'por_cantidad')  { h1 = `${param}%`;  h2 = 'OFF';          s1 = 130; s2 = 110; }
        else if (tipo === 'descuento')     { h1 = `${param}%`;  h2 = 'DESCUENTO';    s1 = 130; s2 = 68; }
        else if (tipo === 'combo')         { h1 = promoName?.toUpperCase().slice(0,10) || 'COMBO'; h2 = '¡ESPECIAL!'; s1 = 72; s2 = 60; }
        else if (tipo === 'regalo')        { h1 = '+¡UN';       h2 = 'REGALO!';      s1 = 86;  s2 = 88; }

        const H1Y = CTOP + 110;
        ctx.textAlign = 'center';
        ctx.fillStyle = ink;    ctx.font = `900 ${s1}px Arial Black, Impact, sans-serif`;
        ctx.fillText(h1, RCX, H1Y + s1 * 0.86);
        ctx.fillStyle = accent; ctx.font = `900 ${s2}px Arial Black, Impact, sans-serif`;
        ctx.fillText(h2, RCX, H1Y + s1 + s2 * 0.86 + 8);

        // Urgency line (for por_cantidad / 2da_unidad)
        if (tipo === 'por_cantidad' || tipo === '2da_unidad') {
          const urgY = H1Y + s1 + s2 + 52;
          ctx.fillStyle = inkSub; ctx.font = '600 20px Arial, sans-serif'; ctx.textAlign = 'center';
          ctx.fillText('¡MÁS CANTIDAD, MÁS AHORRO!', RCX, urgY);
        }

        // % OFF circle badge at the split junction (mid-height of panel)
        if (savings > 0 && savingsPct > 0) {
          const bX = SPLIT + 12, bY = CTOP + (PANEL_BOT - CTOP) * 0.72;
          ctx.save();
          ctx.shadowColor = 'rgba(0,0,0,0.40)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 6;
          ctx.fillStyle = '#E53E3E';
          ctx.beginPath(); ctx.arc(bX, bY, 66, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
          ctx.fillStyle = '#FFFFFF'; ctx.textAlign = 'center';
          ctx.font = '900 36px Arial Black, sans-serif';
          ctx.fillText(`${Math.round(savingsPct)}%`, bX, bY - 4);
          ctx.font = '800 22px Arial, sans-serif';
          ctx.fillText('OFF', bX, bY + 24);
        }

        // ── 3-COLUMN PRICE SECTION ────────────────────────────────────────
        // Full-width dark band
        ctx.fillStyle = panelFill;
        ctx.fillRect(0, PRICE_TOP, S, PRICE_H);

        const col = S / 3;
        const priceInk    = isLight ? '#FFFFFF' : '#FFFFFF';
        const priceSubInk = 'rgba(255,255,255,0.55)';
        const colCenters  = [col * 0.5, col * 1.5, col * 2.5];

        // Column dividers
        ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1;
        [col, col * 2].forEach(x => {
          ctx.beginPath(); ctx.moveTo(x, PRICE_TOP + 20); ctx.lineTo(x, PRICE_TOP + PRICE_H - 20); ctx.stroke();
        });

        // Col 1: PRECIO REGULAR
        ctx.textAlign = 'center';
        ctx.fillStyle = priceSubInk; ctx.font = '700 16px Arial, sans-serif';
        ctx.fillText('PRECIO REGULAR', colCenters[0], PRICE_TOP + 36);
        if (savings > 0) {
          const regPrice = formatARS(promoPrice + savings);
          ctx.fillStyle = priceSubInk; ctx.font = '600 28px Arial, sans-serif';
          ctx.fillText(regPrice, colCenters[0], PRICE_TOP + 76);
          // Strikethrough
          const rw = ctx.measureText(regPrice).width;
          ctx.strokeStyle = priceSubInk; ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(colCenters[0] - rw/2, PRICE_TOP + 63);
          ctx.lineTo(colCenters[0] + rw/2, PRICE_TOP + 63);
          ctx.stroke();
        } else {
          ctx.fillStyle = priceInk; ctx.font = '600 28px Arial, sans-serif';
          ctx.fillText(formatARS(promoPrice), colCenters[0], PRICE_TOP + 76);
        }
        ctx.fillStyle = priceSubInk; ctx.font = '500 14px Arial, sans-serif';
        ctx.fillText('precio de lista', colCenters[0], PRICE_TOP + 100);

        // Col 2: AHORRAS (only if savings > 0)
        if (savings > 0) {
          ctx.fillStyle = '#FCD34D'; ctx.font = '800 16px Arial, sans-serif';
          ctx.fillText('AHORRAS', colCenters[1], PRICE_TOP + 36);
          ctx.fillStyle = '#FCD34D'; ctx.font = `900 ${savings >= 10000 ? 44 : 52}px Arial Black, sans-serif`;
          ctx.fillText(formatARS(savings), colCenters[1], PRICE_TOP + 90);
          ctx.fillStyle = priceSubInk; ctx.font = '500 14px Arial, sans-serif';
          ctx.fillText(`${Math.round(savingsPct)}% de descuento`, colCenters[1], PRICE_TOP + 116);
        } else {
          ctx.fillStyle = priceSubInk; ctx.font = '700 16px Arial, sans-serif';
          ctx.fillText('PRECIO ÚNICO', colCenters[1], PRICE_TOP + 36);
          ctx.fillStyle = priceInk; ctx.font = '600 20px Arial, sans-serif';
          ctx.fillText('Cualquier medio', colCenters[1], PRICE_TOP + 72);
          ctx.fillText('de pago', colCenters[1], PRICE_TOP + 98);
        }

        // Col 3: PRECIO PROMO
        ctx.fillStyle = accent; ctx.font = '800 16px Arial, sans-serif';
        ctx.fillText('PRECIO PROMO', colCenters[2], PRICE_TOP + 36);
        ctx.fillStyle = accent; ctx.font = `900 ${promoPrice >= 100000 ? 40 : promoPrice >= 10000 ? 48 : 54}px Arial Black, sans-serif`;
        ctx.fillText(formatARS(promoPrice), colCenters[2], PRICE_TOP + 92);
        if (qty > 1) {
          const perUnit = Math.round(promoPrice / qty);
          ctx.fillStyle = priceInk; ctx.font = '700 18px Arial, sans-serif';
          ctx.fillText(`${formatARS(perUnit)} c/u`, colCenters[2], PRICE_TOP + 120);
        }

        // ── PAYMENT BAR ───────────────────────────────────────────────────
        ctx.fillStyle = isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.06)';
        ctx.fillRect(0, PAY_TOP, S, PAY_H);
        ctx.fillStyle = inkSub; ctx.font = '600 16px Arial, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('PRECIO ÚNICO  ·  MERCADO PAGO  ·  VISA  ·  MASTERCARD  ·  DÉBITO  ·  EFECTIVO', S/2, PAY_TOP + PAY_H/2 + 6);

        // ── PRODUCT HERO IMAGE(S) ─────────────────────────────────────────
        // Drawn LAST so they overlap the panel and price section
        const imgSlot = { x: 14, y: CTOP + 4, w: SPLIT + 50, h: PANEL_BOT - CTOP };
        const drawHero = (img: CanvasImageSource | null) => {
          if (img) {
            const iw = (img as HTMLImageElement).naturalWidth  || (img as HTMLCanvasElement).width  || 1;
            const ih = (img as HTMLImageElement).naturalHeight || (img as HTMLCanvasElement).height || 1;

            if (qty >= 2) {
              // Show 2 overlapping instances (back then front)
              const sc2 = Math.min(imgSlot.w / iw, imgSlot.h / ih) * 0.70;
              const dw = iw * sc2, dh = ih * sc2;
              const cx = imgSlot.x + imgSlot.w / 2;
              const cy = imgSlot.y + imgSlot.h / 2 + 10;

              // Back unit (left, slightly up)
              ctx.save();
              ctx.shadowColor = 'rgba(0,0,0,0.30)'; ctx.shadowBlur = 30;
              ctx.shadowOffsetX = 6; ctx.shadowOffsetY = 14;
              ctx.globalAlpha = 0.92;
              ctx.drawImage(img, cx - dw * 0.68, cy - dh / 2, dw, dh);
              ctx.restore();

              // Front unit (right, slightly forward)
              ctx.save();
              ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 44;
              ctx.shadowOffsetX = 18; ctx.shadowOffsetY = 24;
              ctx.drawImage(img, cx - dw * 0.32, cy - dh / 2 + 18, dw, dh);
              ctx.restore();
            } else {
              // Single unit, large hero
              const sc2 = Math.min(imgSlot.w / iw, imgSlot.h / ih) * 0.86;
              const dw = iw * sc2, dh = ih * sc2;
              const dx = imgSlot.x + (imgSlot.w - dw) / 2;
              const dy = imgSlot.y + (imgSlot.h - dh) / 2;
              ctx.save();
              ctx.shadowColor = 'rgba(0,0,0,0.42)'; ctx.shadowBlur = 55;
              ctx.shadowOffsetX = 16; ctx.shadowOffsetY = 24;
              ctx.drawImage(img, dx, dy, dw, dh);
              ctx.restore();
            }
          } else {
            ctx.fillStyle = isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.07)';
            ctx.beginPath();
            ctx.roundRect(imgSlot.x + 50, imgSlot.y + 50, imgSlot.w - 100, imgSlot.h - 100, 28);
            ctx.fill();
            if (mainItems[0]) {
              ctx.fillStyle = inkSub; ctx.font = '700 26px Arial, sans-serif'; ctx.textAlign = 'center';
              fillLines(wrapLines(mainItems[0].product.name, imgSlot.w - 120, 3),
                imgSlot.x + imgSlot.w / 2, imgSlot.y + imgSlot.h / 2 - 20, 36);
            }
          }
          drawFooter();
        };

        loadImg(mainItems[0] ? resolveImg(mainItems[0].product) : null,
          (img) => drawHero(img));

      // ════════════════════════════════════════════════════════════════════════
      // MULTI-PRODUCT (2-4) — Grid + price banner
      // ════════════════════════════════════════════════════════════════════════
      } else {
        const PAD = 44, GAP = 18;
        const GRID_TOP = CTOP + 18;
        const GRID_BOT = CBOT - 205;
        const GH = GRID_BOT - GRID_TOP;
        const totW = S - PAD * 2;

        type Rect = { x:number; y:number; w:number; h:number };
        const slots: Rect[] = [];
        if (count === 2) {
          const w = (totW - GAP) / 2;
          slots.push({ x: PAD, y: GRID_TOP, w, h: GH });
          slots.push({ x: PAD + w + GAP, y: GRID_TOP, w, h: GH });
        } else if (count === 3) {
          const w = (totW - GAP * 2) / 3;
          [0, 1, 2].forEach(k => slots.push({ x: PAD + k * (w + GAP), y: GRID_TOP, w, h: GH }));
        } else {
          const w = (totW - GAP) / 2, h = (GH - GAP) / 2;
          [[0,0],[1,0],[0,1],[1,1]].forEach(([xi,yi]) =>
            slots.push({ x: PAD + xi*(w+GAP), y: GRID_TOP + yi*(h+GAP), w, h }));
        }

        // Price banner at bottom
        const BNR_Y = GRID_BOT + 10;
        const BNR_H = CBOT - BNR_Y - 8;
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.32)'; ctx.shadowBlur = 28; ctx.shadowOffsetY = 8;
        ctx.fillStyle = panelFill;
        ctx.beginPath(); ctx.roundRect(PAD, BNR_Y, S - PAD * 2, BNR_H, 24); ctx.fill();
        ctx.restore();

        if (savings > 0) {
          const bef = `Antes: ${formatARS(promoPrice + savings)}`;
          ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.font = '500 22px Arial, sans-serif'; ctx.textAlign = 'center';
          ctx.fillText(bef, S/2 - 70, BNR_Y + 36);
          const bw2 = ctx.measureText(bef).width;
          ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(S/2 - 70 - bw2/2, BNR_Y + 26); ctx.lineTo(S/2 - 70 + bw2/2, BNR_Y + 26);
          ctx.stroke();
        }
        const bPrSz = savings > 0 ? 76 : 84;
        ctx.fillStyle = accent;
        ctx.font = `900 ${bPrSz}px Arial Black, Impact, sans-serif`; ctx.textAlign = 'center';
        ctx.fillText(formatARS(promoPrice), savings > 0 ? S/2 - 52 : S/2, BNR_Y + (savings > 0 ? 100 : 78));

        if (savings > 0 && savingsPct > 0) {
          const scX = S - PAD - 58, scY = BNR_Y + BNR_H / 2;
          ctx.save();
          ctx.shadowColor = 'rgba(0,0,0,0.28)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 4;
          ctx.fillStyle = '#E53E3E';
          ctx.beginPath(); ctx.arc(scX, scY, 54, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
          ctx.fillStyle = '#FFFFFF'; ctx.textAlign = 'center';
          ctx.font = '900 28px Arial Black, sans-serif';
          ctx.fillText(`${Math.round(savingsPct)}%`, scX, scY - 4);
          ctx.font = '800 18px Arial, sans-serif';
          ctx.fillText('OFF', scX, scY + 18);
        }

        if (giftItems.length > 0) {
          ctx.fillStyle = '#16A34A'; ctx.font = 'bold 18px Arial, sans-serif'; ctx.textAlign = 'center';
          ctx.fillText(`🎁 + ${giftItems[0].product.name.slice(0, 28)}`, S/2, BNR_Y - 14);
        }

        // Draw products integrados (sin card, fondo transparente, juntos)
        let loaded = 0;
        const onLoadDone = () => { loaded++; if (loaded >= mainItems.length) drawFooter(); };
        if (mainItems.length === 0) { drawFooter(); return; }

        mainItems.forEach((item, i) => {
          const slot = slots[i];
          if (!slot) return;

          // Product name label (debajo del slot)
          ctx.fillStyle = inkSub; ctx.textAlign = 'center';
          ctx.font = `700 ${count > 2 ? 15 : 19}px Arial, sans-serif`;
          const sn = item.product.name.length > 24 ? item.product.name.slice(0,22)+'…' : item.product.name;
          ctx.fillText(sn, slot.x + slot.w/2, slot.y + slot.h - 8);

          loadImg(resolveImg(item.product), (img) => {
            if (img) {
              const iw = (img as HTMLImageElement).naturalWidth  || (img as HTMLCanvasElement).width  || 1;
              const ih = (img as HTMLImageElement).naturalHeight || (img as HTMLCanvasElement).height || 1;
              const mW = slot.w - 10, mH = slot.h - 38;
              const sc2 = Math.min(mW / iw, mH / ih);
              const dw = iw * sc2, dh = ih * sc2;
              const dx = slot.x + (slot.w - dw)/2;
              const dy = slot.y + (mH - dh)/2 + 4;

              // Sombra suave debajo del producto
              ctx.save();
              const sg = ctx.createRadialGradient(
                dx + dw/2, dy + dh, 0,
                dx + dw/2, dy + dh, dw * 0.45
              );
              sg.addColorStop(0, 'rgba(0,0,0,0.28)');
              sg.addColorStop(1, 'rgba(0,0,0,0)');
              ctx.fillStyle = sg;
              ctx.beginPath();
              ctx.ellipse(dx + dw/2, dy + dh, dw * 0.45, 16, 0, 0, Math.PI * 2);
              ctx.fill();
              ctx.restore();

              ctx.save();
              ctx.shadowColor = 'rgba(0,0,0,0.20)';
              ctx.shadowBlur = 20; ctx.shadowOffsetY = 10;
              ctx.drawImage(img, dx, dy, dw, dh);
              ctx.restore();

              if (item.qty > 1) {
                ctx.fillStyle = accent;
                ctx.beginPath(); ctx.arc(dx + dw - 4, dy + 18, 22, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = accInk; ctx.font = 'bold 14px Arial, sans-serif'; ctx.textAlign = 'center';
                ctx.fillText(`×${item.qty}`, dx + dw - 4, dy + 24);
              }
            } else {
              // Placeholder sin card
              ctx.fillStyle = inkSub; ctx.font = `500 ${count > 2 ? 13 : 16}px Arial, sans-serif`;
              ctx.textAlign = 'center';
              ctx.fillText(item.product.name.slice(0, 20), slot.x + slot.w/2, slot.y + slot.h/2);
            }
            onLoadDone();
          });
        });
      }
    });
  }, [items, bg, customBg, promoName, promoPrice, savings, savingsPct, tipo, step, param]);

  useEffect(() => { redraw(); }, [redraw]);

  return canvasRef;
}

// ─────────────────────────────────────────────────────────────────────────────
// PAYMENT BREAKDOWN TABLE DATA
// listaOff = descuento de lista sobre Lista A (qué % más barato que tarjeta)
// comision = comisión que cobra el procesador al comercio
// ─────────────────────────────────────────────────────────────────────────────

const PAYMENT_ROWS = [
  { key: 'efectivo',  label: 'Efectivo',          listaOff: 0.15, comision: 0.000 },
  { key: 'transf',    label: 'Transferencia',      listaOff: 0.10, comision: 0.000 },
  { key: 'debito_qr', label: 'Débito / QR',        listaOff: 0.10, comision: 0.015 },
  { key: 'tarj_1c',   label: 'Tarjeta 1 cuota',    listaOff: 0.00, comision: 0.025 },
  { key: 'tarj_3c',   label: 'Tarjeta 3 cuotas',   listaOff: 0.00, comision: 0.095 },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// CONSULTOR DE PROMOS (chat inline contextual)
// ─────────────────────────────────────────────────────────────────────────────

interface ConsultorMsg { role: 'user' | 'assistant'; text: string; }

function getPromoChips(step: Step, calc: ReturnType<typeof calcPromo> | null, items: PromoItem[]): string[] {
  const mainItems = items.filter(i => !i.isGift);
  if (step === 'objetivo')  return ['¿Qué objetivo me conviene?', '¿Cuándo uso Liquidar?', 'Quiero subir el ticket'];
  if (step === 'tipo')      return ['¿Qué tipo elijo?', 'Diferencia combo vs descuento', '¿Cuándo regalar?'];
  if (step === 'productos') return ['¿Qué productos combinar?', '¿Cuántos poner?', 'Mis productos tienen bajo margen'];
  if (step === 'config') {
    const chips = ['¿Es rentable este precio?', '¿Puedo bajar más el descuento?'];
    if (calc && calc.margin !== null && calc.margin < 35) chips.unshift('⚠️ Margen bajo — ¿qué hago?');
    if (mainItems.length === 1) chips.push('¿Qué complemento agrego?');
    return chips;
  }
  if (step === 'publicar')  return ['¿Cómo comunico la promo?', '¿ML o WhatsApp primero?', '¿Cuándo publicar?'];
  return ['Estado de la promo', '¿Qué hago ahora?'];
}

function buildPromoResponse(msg: string, step: Step, objetivo: Objetivo | null, tipo: TipoPromo | null, items: PromoItem[], calc: ReturnType<typeof calcPromo> | null, param: number): string {
  const mainItems = items.filter(i => !i.isGift);
  const avgMargin = mainItems.length > 0
    ? mainItems.reduce((a, i) => a + (i.product.margin ?? 0), 0) / mainItems.length : 0;
  const m = msg.toLowerCase();

  // Rentabilidad / precio
  if (m.includes('rentable') || m.includes('precio') || m.includes('margen bajo')) {
    if (!calc) return 'Todavía no hay productos configurados. Agregá productos primero.';
    if (calc.margin === null) return 'Algunos productos no tienen costo cargado — cargalos en la sección Costos para calcular el margen real.';
    if (calc.margin >= 45) return `✅ Excelente — ${Math.round(calc.margin)}% de margen. Muy saludable. Tenés espacio para ofrecer cuotas sin que impacte mucho el neto.`;
    if (calc.margin >= 35) return `✅ ${Math.round(calc.margin)}% de margen — bien. Para subirlo, reducí el descuento 5 puntos o sacá el producto con menor margen del combo.`;
    if (calc.margin >= 25) {
      const piso = formatARS(Math.round(calc.totalCost / 0.65));
      return `⚠️ ${Math.round(calc.margin)}% — ajustado. Funciona si el objetivo es rotar, pero no bajes más. Precio mínimo para 35% de margen: ${piso}.`;
    }
    const piso = formatARS(Math.round(calc.totalCost / 0.65));
    return `🚨 ${Math.round(calc.margin)}% — crítico. Estás casi al costo. Subí el precio promo o quitá el producto con menor margen. Precio mínimo rentable (35%): ${piso}.`;
  }

  // Descuento máximo
  if (m.includes('bajar') || m.includes('descuento')) {
    if (!calc || calc.margin === null) return 'Necesito ver los costos para darte el número exacto.';
    const maxDisc = Math.max(0, Math.round((1 - (calc.totalCost / 0.65) / calc.totalPrice) * 100));
    return `Con tus costos, el máximo descuento para mantener 35% de margen es ${maxDisc}% OFF (precio mínimo: ${formatARS(Math.round(calc.totalCost / 0.65))}). Ahora tenés ${param}% — ${param <= maxDisc ? `todavía tenés ${maxDisc - param} puntos de margen para jugar` : 'ya pasaste el límite, subí el precio'}.`;
  }

  // Complemento / combinar
  if (m.includes('combinar') || m.includes('complemento') || m.includes('complementar') || m.includes('agreg')) {
    if (mainItems.length === 0) return 'Primero elegí los productos principales y te ayudo a pensar qué complementarles.';
    const cats = [...new Set(mainItems.map(i => i.product.category?.split(' / ')[0]).filter(Boolean))];
    return `Tenés productos de: ${cats.join(', ')}.\n\nPara un combo que venda bien: producto principal + complemento de uso frecuente (consumible) + opcional algo aspiracional.\n\nEl precio combo ideal es 10-15% menos que la suma individual — suficiente para que se note sin destruir margen.`;
  }

  // Cuántos productos
  if (m.includes('cuántos') || m.includes('cuantos')) {
    return `Para combos que convierten:\n• 2 productos — fácil de entender, alta conversión\n• 3 productos — percepción de valor máxima (el "kit")\n• 4+ solo funciona en kits temáticos (Kit Pileta, Kit Limpieza)\n\nMás de 4 complica la comunicación. Si querés muchos, agrupalos bajo un nombre de kit.`;
  }

  // Qué objetivo
  if (m.includes('objetivo') || m.includes('conviene')) {
    return `Depende de tu situación:\n• Rotar → tenés stock acumulado específico\n• Ticket → venta promedio baja, querés probar combos\n• Fidelizar → clientes frecuentes que merecen precio especial\n• Liquidar → vencimientos o descontinuados\n• Evento → fecha especial próxima (verano, día de X)\n\n¿Cuál de estas situaciones te aplica ahora?`;
  }

  // Liquidar
  if (m.includes('liquidar')) {
    return `Liquidar = salida rápida y agresiva:\n• Descuento visible (mínimo 20% OFF)\n• Mensaje de urgencia ("últimas unidades", "solo por hoy")\n• WhatsApp Business + stories Instagram\n\nCuidado: si bajás muy seguido, el cliente aprende a esperar promos. Usalo con moderación.`;
  }

  // Tipo de promo
  if (m.includes('tipo') || m.includes('combo') || m.includes('diferencia')) {
    return `Combo vs descuento:\n• Descuento directo — simple, impulsa decisión rápida, fácil de comunicar\n• Combo — subís el ticket, mostrás valor, asociás productos\n\nRegla práctica: si tenés 1 producto → descuento. Si tenés 2+ → combo. Si querés probar sin perder margen → 2da unidad al 50%.`;
  }

  // Comunicar / publicar
  if (m.includes('comunic') || m.includes('publicar') || m.includes('cuándo') || m.includes('cuando')) {
    if (objetivo === 'liquidar' || objetivo === 'rotar')
      return `Para rotar/liquidar:\n• Lunes o martes al mediodía → mejor apertura en WhatsApp\n• Story primero (24h), luego mensaje a lista de difusión\n• Poné fecha límite aunque sea 5 días — crea urgencia real\n• Precio tachado visible es clave`;
    return `Para comunicar bien:\n• WhatsApp Business primero — mayor conversión\n• Instagram Stories con la imagen descargada + sticker de precio\n• ML si el margen aguanta comisión (≥40%)\n\nUsá el mensaje generado en el paso "Publicar" — está listo para copiar y pegar.`;
  }

  // ML
  if (m.includes('ml') || m.includes('mercadolibre')) {
    return `Para ML:\n• Precio promo como precio final de la publicación\n• Combo → publicación nueva con nombre del kit\n• Activá envío gratis solo si tenés ≥40% de margen (absorbe el costo)\n• ML cobra 13-17% en Gold — eso reduce tu margen efectivo, tenelo en cuenta`;
  }

  // Regalo
  if (m.includes('regalo') || m.includes('regalar')) {
    const gifts = items.filter(i => i.isGift);
    if (gifts.length > 0)
      return `El regalo elegido (${gifts.map(g => g.product.name.slice(0, 30)).join(', ')}) tiene costo ${formatARS(gifts.reduce((a, g) => a + g.product.cost, 0))}. Si ese costo te baja ≥5 puntos de margen, reconsideralo. Si está bien, es una excelente percepción de valor.`;
    return `El regalo tiene que ser algo que el cliente QUIERA pero con costo bajo para vos. Ideas: ambientador, muestra, accesorio de bajo costo. Evitá regalar el producto principal a la mitad de precio — perdés margen sin generar fidelidad.`;
  }

  // Ticket
  if (m.includes('ticket')) {
    return `Para subir el ticket:\n• Combo de 2-3 productos: el cliente ya decidió comprar, ofrecele algo más\n• "Si llevás también el X, el combo te sale $Y" — el upsell funciona\n• Precio combo tiene que ser ≤15% menos que la suma individual\n\nEl ticket promedio sube más con combos bien nombrados que con descuentos directos.`;
  }

  // Default según step
  if (step === 'config' && calc) {
    return `Tu promo actual: ${mainItems.length} producto${mainItems.length !== 1 ? 's' : ''}, margen ${calc.margin !== null ? Math.round(calc.margin) + '%' : 'sin datos'}, precio ${formatARS(calc.promoPrice)}. Promedio de margen de los productos: ${Math.round(avgMargin)}%. ¿Qué querés ajustar?`;
  }

  return `Estoy acá para ayudarte a construir la promo ideal. Preguntame sobre el precio, los productos, la estrategia de comunicación o si conviene bajar el descuento.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────

export default function PromosPage() {
  const [step,      setStep]      = useState<Step>('objetivo');
  const [objetivo,  setObjetivo]  = useState<Objetivo | null>(null);
  const [tipo,      setTipo]      = useState<TipoPromo | null>(null);
  const [items,     setItems]     = useState<PromoItem[]>([]);
  const [search,    setSearch]    = useState('');
  const [param,     setParam]     = useState(50);      // discount % or combo price
  const [promoName,  setPromoName]  = useState('');
  const [bg,         setBg]         = useState<BgOption>('azul');
  const [customBg,   setCustomBg]   = useState<string | null>(null);
  const [copied,     setCopied]     = useState(false);
  const [promoMode,  setPromoMode]  = useState<PromoMode>('pct');
  const [fixedPrice, setFixedPrice] = useState<number>(0);
  const [aiImgUrl,     setAiImgUrl]     = useState<string | null>(null);
  const [aiLoading,    setAiLoading]    = useState(false);
  const [savedPromos,  setSavedPromos]  = useState<SavedPromo[]>([]);
  const [showSaved,    setShowSaved]    = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [savedToast,   setSavedToast]   = useState<string | null>(null);

  // Consultor de promos
  const [consultorOpen, setConsultorOpen] = useState(false);
  const [consultorMsgs, setConsultorMsgs] = useState<ConsultorMsg[]>([
    { role: 'assistant', text: 'Hola Enrico 👋 Soy tu asesor de promos. Preguntame sobre precio, estrategia, qué productos combinar o si el margen es correcto.' }
  ]);
  const [consultorInput, setConsultorInput] = useState('');
  const consultorBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    consultorBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [consultorMsgs]);

  const fileRef      = useRef<HTMLInputElement>(null);
  const customFileRef = useRef<HTMLInputElement>(null);

  // Derived calculations
  const calc = useMemo(() => {
    if (!tipo || items.length === 0) return null;
    return calcPromo(items, tipo, param);
  }, [items, tipo, param]);

  const recomen = useMemo(() => {
    if (!tipo || !objetivo || items.length === 0) return '';
    return socionRecomendacion(items, tipo, objetivo);
  }, [items, tipo, objetivo]);

  // Cuántos combos puedo armar con el stock actual de cada componente
  const combosDisponibles = useMemo(() => {
    if (tipo !== 'combo') return null;
    const mainItems = items.filter(i => !i.isGift);
    if (mainItems.length === 0) return null;
    let min = Infinity;
    for (const item of mainItems) {
      const prod = todosProductos.find(p => p.id === item.product.id);
      const stock = (prod as { stock?: number })?.stock ?? 0;
      min = Math.min(min, Math.floor(stock / item.qty));
    }
    return min === Infinity ? 0 : min;
  }, [tipo, items]);

  // Canvas
  const canvasRef = usePromoCanvas(
    items, bg, customBg,
    promoName,
    calc?.promoPrice  ?? 0,
    calc?.savings     ?? 0,
    calc?.savingsPct  ?? 0,
    tipo ?? 'combo',
    step,
    param,
  );

  const objInfo  = OBJETIVOS.find(o => o.key === objetivo);
  const tiposDisp = objInfo?.tipos ?? (Object.keys(TIPOS_INFO) as TipoPromo[]);

  // Product search
  const resultados = useMemo(() => {
    if (!search || search.length < 2) return [];
    const q = search.toLowerCase();
    return todosProductos.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.sku || '').toLowerCase().includes(q) ||
      (p.supplierName || '').toLowerCase().includes(q)
    ).slice(0, 20);
  }, [search]);

  const toggleProduct = (p: Product, isGift = false) => {
    setItems(prev => {
      const exists = prev.find(i => i.product.id === p.id);
      if (exists) return prev.filter(i => i.product.id !== p.id);
      return [...prev, { product: p, qty: 1, isGift }];
    });
  };

  const updateQty = (id: string, delta: number) => {
    setItems(prev => prev.map(i =>
      i.product.id === id ? { ...i, qty: Math.max(1, i.qty + delta) } : i
    ));
  };

  const buildWAMsg = () => {
    if (!calc || !tipo) return '';
    const name   = promoName || 'PROMO ESPECIAL';
    // ✔️ checklist para productos, negrita en qty
    const prods  = items.filter(i => !i.isGift)
      .map(i => `✔️ ${i.product.name}${i.qty > 1 ? ` *(x${i.qty})*` : ''}`).join('\n');
    const gifts  = items.filter(i => i.isGift)
      .map(i => `🎁 *DE REGALO: ${i.product.name}*`).join('\n');
    const footer = `\n📍 *Acqua Pacheco*\n📲 Consultá disponibilidad y medios de pago`;

    if (tipo === '2da_unidad') return (
`🏷️ *${name}*

*¡2DA UNIDAD AL ${param}% OFF!*
Llevá 2 y la segunda tiene *${param}% de descuento*.

${prods}

~${formatARS(calc.totalPrice)}~ → *${formatARS(calc.promoPrice)}*
✅ *Ahorrás ${formatARS(calc.savings)} por par*${footer}`
    );

    if (tipo === 'por_cantidad') return (
`📦 *${name}*

*¡${param}% OFF llevando la cantidad!*
Cuanto más llevás, más ahorrás.

${prods}

~${formatARS(calc.totalPrice)}~ → *${formatARS(calc.promoPrice)}*
✅ *Ahorrás ${formatARS(calc.savings)} (${Math.round(calc.savingsPct)}% OFF)*${footer}`
    );

    if (tipo === 'descuento') return (
`🔥 *${name}*

*¡${param}% OFF — TIEMPO LIMITADO!*

${prods}

~${formatARS(calc.totalPrice)}~ → *${formatARS(calc.promoPrice)}*
✅ *Ahorrás ${formatARS(calc.savings)}*${footer}`
    );

    if (tipo === 'combo') return (
`📦 *${name}*

${prods}

~${formatARS(calc.totalPrice)}~ → *💥 ${formatARS(calc.promoPrice)}*
🤑 *¡Ahorrás ${formatARS(calc.savings)} llevándolo junto!*${footer}`
    );

    if (tipo === 'regalo') return (
`🎁 *${name}*

*¡Con tu compra llevás un regalo incluido!*

${prods}
${gifts ? '\n' + gifts + '\n' : ''}
💰 *${formatARS(calc.promoPrice)}*${footer}`
    );

    return (
`🔥 *${name}*\n\n${prods}\n\n~${formatARS(calc.totalPrice)}~ → *${formatARS(calc.promoPrice)}*\n✅ *Ahorrás ${formatARS(calc.savings)}*${footer}`
    );
  };

  const copyWA = () => {
    const msg = buildWAMsg();
    if (!msg) return;
    navigator.clipboard?.writeText(msg);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const sendConsultor = (text: string) => {
    if (!text.trim()) return;
    const reply = buildPromoResponse(text, step, objetivo, tipo, items, calc, param);
    setConsultorMsgs(prev => [...prev, { role: 'user', text }, { role: 'assistant', text: reply }]);
    setConsultorInput('');
  };

  const generateAiImage = async () => {
    if (!calc || !tipo) return;
    setAiLoading(true);
    setAiImgUrl(null);
    try {
      const mainItems = items.filter(i => !i.isGift);
      const res = await fetch('/api/promo-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          promoName:  promoName || 'PROMO ESPECIAL',
          tipo,
          objetivo,
          productos:  mainItems.map(i => `${i.qty > 1 ? i.qty + 'x ' : ''}${i.product.name}`).slice(0, 4),
          precio:     calc.promoPrice,
          ahorro:     calc.savings,
          savingsPct: calc.savingsPct,
          param,
          bg,
          qty:        mainItems.reduce((a, i) => a + i.qty, 0),
        }),
      });
      const data = await res.json() as { url?: string; dataUrl?: string; error?: string };
      const imgSrc = data.dataUrl ?? data.url ?? null;
      if (imgSrc) setAiImgUrl(imgSrc);
      else setSavedToast(`❌ ${data.error ?? 'No se pudo generar la imagen'}`);
    } catch (e) {
      console.error('generateAiImage failed:', e);
      setSavedToast('❌ Error al generar imagen');
    } finally {
      setAiLoading(false);
    }
  };

  // ── Load saved promos on mount ─────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/promos').then(r => r.json()).then((d: SavedPromo[]) => setSavedPromos(d)).catch(() => {});
  }, []);

  // ── Save current promo ────────────────────────────────────────────────────
  const handleSavePromo = async () => {
    if (!tipo || !objetivo || !calc) return;
    setSaving(true);
    try {
      const body = {
        name:      promoName || `Promo ${tipo} ${new Date().toLocaleDateString('es-AR')}`,
        objetivo,
        tipo,
        param,
        bg,
        promoMode,
        fixedPrice,
        promoPrice: calc.promoPrice,
        savings:    calc.savings,
        savingsPct: calc.savingsPct,
        margin:     calc.margin,
        items: items.map(i => ({
          productId:    i.product.id,
          productName:  i.product.name,
          productPrice: i.product.price,
          productCost:  i.product.cost,
          productImage: i.product.image ?? null,
          odooId:       i.product.odooId ?? null,
          qty:          i.qty,
          isGift:       i.isGift,
        })),
      };
      const res  = await fetch('/api/promos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json() as { ok: boolean; promo?: SavedPromo };
      if (data.ok && data.promo) {
        setSavedPromos(prev => [data.promo!, ...prev]);
        setSavedToast('✅ Promo guardada');
        setTimeout(() => setSavedToast(null), 2500);
      }
    } catch { setSavedToast('❌ Error al guardar'); setTimeout(() => setSavedToast(null), 2500); }
    finally  { setSaving(false); }
  };

  // ── Load a saved promo into state ─────────────────────────────────────────
  const handleLoadPromo = (p: SavedPromo) => {
    setObjetivo(p.objetivo as Objetivo);
    setTipo(p.tipo as TipoPromo);
    setParam(p.param);
    setBg(p.bg as BgOption);
    setPromoMode(p.promoMode as PromoMode);
    setFixedPrice(p.fixedPrice);
    setPromoName(p.name);
    setItems(p.items.map(i => ({
      qty:     i.qty,
      isGift:  i.isGift,
      product: {
        id:       i.productId,
        sku:      null,
        name:     i.productName,
        cost:     i.productCost,
        price:    i.productPrice,
        margin:   i.productCost > 0 ? Math.round((i.productPrice - i.productCost) / i.productPrice * 100) : null,
        image:    i.productImage,
        category: null,
        supplierName: null,
        uom:      'unidad',
        odooId:   i.odooId,
      },
    })));
    setStep('publicar');
    setShowSaved(false);
  };

  // ── Delete a saved promo ──────────────────────────────────────────────────
  const handleDeletePromo = async (id: string) => {
    await fetch(`/api/promos?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    setSavedPromos(prev => prev.filter(p => p.id !== id));
  };

  const downloadCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(promoName || 'promo').replace(/\s+/g, '-').toLowerCase()}.png`;
    a.click();
  };

  const handleCustomBg = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { setCustomBg(ev.target?.result as string); };
    reader.readAsDataURL(file);
  };

  const canNext = (
    (step === 'objetivo'  && objetivo !== null) ||
    (step === 'tipo'      && tipo !== null) ||
    (step === 'productos' && items.filter(i => !i.isGift).length > 0) ||
    (step === 'config'    && calc !== null) ||
    step === 'publicar'
  );

  const STEPS: Step[] = ['objetivo','tipo','productos','config','publicar'];
  const stepIdx = STEPS.indexOf(step);
  const goNext = () => { if (stepIdx < STEPS.length - 1) setStep(STEPS[stepIdx + 1]); };
  const goPrev = () => { if (stepIdx > 0) setStep(STEPS[stepIdx - 1]); };

  // ── Render ─────────────────────────────────────────────────────────────────

  const chips = getPromoChips(step, calc, items);

  return (
    <div className="min-h-screen bg-[#F4F7FA]">

      {/* Header */}
      <div className="bg-[#07111F] border-b border-white/10 px-5 lg:px-8 xl:px-12 py-5">
        <div className="max-w-[1680px] mx-auto flex items-center justify-between gap-4">
          <div>
            <p className="text-white/40 text-[11px] font-semibold uppercase tracking-widest mb-1">Centro de promociones</p>
            <h1 className="text-white font-bold text-2xl">Promos</h1>
            <p className="text-white/40 text-sm mt-0.5">Armá combos, calculá rentabilidad y publicá en minutos</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Promos guardadas */}
            <button
              onClick={() => setShowSaved(v => !v)}
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-xl text-[12px] font-semibold border transition-all',
                showSaved
                  ? 'bg-[#16A34A] border-[#16A34A] text-white'
                  : 'bg-white/10 border-white/20 text-white/80 hover:bg-white/20',
              )}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Guardadas</span>
              {savedPromos.length > 0 && (
                <span className="bg-white/20 rounded-full text-[10px] px-1.5 py-0.5 font-bold">
                  {savedPromos.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setConsultorOpen(v => !v)}
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-xl text-[12px] font-semibold border transition-all',
                consultorOpen
                  ? 'bg-[#0784F2] border-[#0784F2] text-white'
                  : 'bg-white/10 border-white/20 text-white/80 hover:bg-white/20',
              )}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Asesor</span>
              {consultorMsgs.length > 1 && (
                <span className="bg-white/20 rounded-full text-[10px] px-1.5 py-0.5 font-bold">
                  {Math.floor((consultorMsgs.length - 1) / 2)}
                </span>
              )}
            </button>
            <StepBar step={step} />
          </div>
        </div>
      </div>

      {/* ── Promos guardadas panel ── */}
      {showSaved && (
        <div className="bg-[#07111F]/95 border-b border-white/10 px-5 lg:px-8 xl:px-12 py-4">
          <div className="max-w-[1680px] mx-auto">
            <p className="text-white/50 text-[11px] font-semibold uppercase tracking-widest mb-3">
              Promos guardadas ({savedPromos.length})
            </p>
            {savedPromos.length === 0 ? (
              <p className="text-white/40 text-sm">No hay promos guardadas todavía.</p>
            ) : (
              <div className="flex gap-3 overflow-x-auto pb-1">
                {savedPromos.map(p => (
                  <div key={p.id} className="flex-shrink-0 w-60 bg-white/8 border border-white/10 rounded-xl p-3">
                    <p className="text-white font-semibold text-[13px] line-clamp-1">{p.name}</p>
                    <p className="text-white/50 text-[11px] mt-0.5 mb-2">
                      {p.tipo} · {new Date(p.savedAt).toLocaleDateString('es-AR')}
                    </p>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[#0784F2] font-bold text-[14px]">
                        {new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(p.promoPrice)}
                      </span>
                      {p.margin !== null && (
                        <span className={cn('text-[11px] font-bold px-1.5 py-0.5 rounded',
                          p.margin >= 40 ? 'bg-[#16A34A]/20 text-[#16A34A]' :
                          p.margin >= 30 ? 'bg-[#F97316]/20 text-[#F97316]' :
                          'bg-[#EF4444]/20 text-[#EF4444]'
                        )}>
                          {Math.round(p.margin)}% mg
                        </span>
                      )}
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => handleLoadPromo(p)}
                        className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-[#0784F2] text-white rounded-lg text-[11px] font-semibold hover:opacity-90"
                      >
                        <RefreshCw className="w-3 h-3" /> Cargar
                      </button>
                      <button
                        onClick={() => handleDeletePromo(p.id)}
                        className="p-1.5 bg-white/10 text-white/50 rounded-lg hover:bg-[#EF4444]/20 hover:text-[#EF4444] transition-colors"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Consultor panel (slide-in desde arriba) ── */}
      {consultorOpen && (
        <div className="bg-[#07111F]/95 border-b border-white/10 px-5 lg:px-8 xl:px-12 py-4">
          <div className="max-w-[1680px] mx-auto">
            <div className="flex gap-4 flex-col lg:flex-row lg:items-end">
              {/* Messages */}
              <div className="flex-1 space-y-2 max-h-[220px] overflow-y-auto pr-1">
                {consultorMsgs.map((m, i) => (
                  <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                    {m.role === 'assistant' && (
                      <div className="w-5 h-5 rounded-full bg-[#0784F2]/20 border border-[#0784F2]/40 flex items-center justify-center shrink-0 mr-1.5 mt-0.5">
                        <Sparkles className="w-2.5 h-2.5 text-[#0784F2]" />
                      </div>
                    )}
                    <div className={cn(
                      'max-w-[80%] rounded-xl px-3 py-2 text-[12px] leading-relaxed',
                      m.role === 'user'
                        ? 'bg-[#0784F2] text-white rounded-br-sm'
                        : 'bg-white/10 text-white/90 rounded-bl-sm',
                    )}>
                      {m.text.split('\n').map((line, j) => (
                        <p key={j} className={line.startsWith('•') ? 'ml-2' : ''}>{line.replace(/\*\*(.*?)\*\*/g, '$1')}</p>
                      ))}
                    </div>
                  </div>
                ))}
                <div ref={consultorBottomRef} />
              </div>

              {/* Input + chips */}
              <div className="lg:w-[340px] shrink-0 space-y-2">
                {/* Quick chips */}
                <div className="flex flex-wrap gap-1.5">
                  {chips.map(c => (
                    <button
                      key={c}
                      onClick={() => sendConsultor(c)}
                      className="px-2.5 py-1 bg-white/10 hover:bg-[#0784F2]/30 border border-white/20 rounded-full text-[11px] text-white/80 font-medium transition-colors"
                    >
                      {c}
                    </button>
                  ))}
                </div>
                {/* Free text input */}
                <div className="flex items-center gap-2 bg-white/10 border border-white/20 rounded-xl px-3 py-2 focus-within:border-[#0784F2]/60 transition-colors">
                  <input
                    type="text"
                    value={consultorInput}
                    onChange={e => setConsultorInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && sendConsultor(consultorInput)}
                    placeholder="Preguntá algo sobre la promo..."
                    className="flex-1 bg-transparent text-[12px] text-white placeholder-white/30 focus:outline-none"
                  />
                  <button
                    onClick={() => sendConsultor(consultorInput)}
                    disabled={!consultorInput.trim()}
                    className="w-6 h-6 flex items-center justify-center rounded-lg bg-[#0784F2] disabled:opacity-30 hover:bg-[#0067d5] transition-colors shrink-0"
                  >
                    <Send className="w-3 h-3 text-white" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-[1680px] mx-auto px-5 lg:px-8 xl:px-12 py-6">

        {/* ── STEP 1: OBJETIVO ──────────────────────────────────────────────── */}
        {step === 'objetivo' && (
          <div>
            <div className="mb-6">
              <h2 className="text-xl font-bold text-gray-900">¿Qué querés lograr con esta promo?</h2>
              <p className="text-gray-500 text-sm mt-1">El objetivo define qué tipos de promo te van a funcionar mejor.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
              {OBJETIVOS.map(o => {
                const Icon = o.icon;
                const sel  = objetivo === o.key;
                // Extract base color for selected state gradients
                const gradients: Record<string, string> = {
                  'bg-blue-50 border-blue-200':    'from-blue-600 to-blue-500',
                  'bg-emerald-50 border-emerald-200': 'from-emerald-600 to-emerald-500',
                  'bg-pink-50 border-pink-200':    'from-pink-600 to-pink-500',
                  'bg-orange-50 border-orange-200': 'from-orange-600 to-orange-500',
                  'bg-purple-50 border-purple-200': 'from-purple-600 to-purple-500',
                };
                const iconBgs: Record<string, string> = {
                  'bg-blue-50 border-blue-200':    'bg-blue-100',
                  'bg-emerald-50 border-emerald-200': 'bg-emerald-100',
                  'bg-pink-50 border-pink-200':    'bg-pink-100',
                  'bg-orange-50 border-orange-200': 'bg-orange-100',
                  'bg-purple-50 border-purple-200': 'bg-purple-100',
                };
                const grad   = gradients[o.color] ?? 'from-gray-700 to-gray-600';
                const iconBg = iconBgs[o.color]   ?? 'bg-gray-100';
                return (
                  <button
                    key={o.key}
                    onClick={() => setObjetivo(o.key)}
                    className={cn(
                      'relative text-left rounded-2xl border-2 transition-all overflow-hidden group',
                      sel
                        ? 'border-transparent shadow-xl shadow-black/10 scale-[1.02]'
                        : 'bg-white border-gray-100 hover:border-gray-200 hover:shadow-md hover:scale-[1.01]',
                    )}
                  >
                    {/* Selected: gradient background */}
                    {sel && (
                      <div className={cn('absolute inset-0 bg-gradient-to-br', grad)} />
                    )}

                    <div className="relative z-10 p-5 flex flex-col h-full min-h-[200px]">
                      {/* Icon block */}
                      <div className={cn(
                        'w-12 h-12 rounded-2xl flex items-center justify-center mb-4 transition-all',
                        sel ? 'bg-white/20' : iconBg,
                      )}>
                        <Icon className={cn('w-6 h-6 transition-colors', sel ? 'text-white' : o.text)} />
                      </div>

                      {/* Label */}
                      <div className={cn(
                        'font-black text-[16px] mb-2 leading-tight',
                        sel ? 'text-white' : 'text-gray-900',
                      )}>
                        {o.label}
                      </div>

                      {/* Description */}
                      <p className={cn(
                        'text-[12px] leading-relaxed flex-1',
                        sel ? 'text-white/80' : 'text-gray-500',
                      )}>
                        {o.desc}
                      </p>

                      {/* Bottom: selected checkmark OR tipos count */}
                      <div className="mt-4">
                        {sel ? (
                          <div className="flex items-center gap-1.5 text-[11px] font-bold text-white/90">
                            <div className="w-4 h-4 rounded-full bg-white/25 flex items-center justify-center">
                              <Check className="w-2.5 h-2.5 text-white" />
                            </div>
                            Seleccionado
                          </div>
                        ) : (
                          <div className={cn('text-[10px] font-semibold uppercase tracking-wider', o.text, 'opacity-70')}>
                            {o.tipos.length} tipos disponibles →
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── STEP 2: TIPO ──────────────────────────────────────────────────── */}
        {step === 'tipo' && (
          <div>
            <div className="mb-6 flex items-center gap-3">
              {objInfo && (
                <span className={cn('px-3 py-1.5 rounded-full text-[12px] font-semibold border', objInfo.color, objInfo.text)}>
                  {objInfo.label}
                </span>
              )}
              <div>
                <h2 className="text-xl font-bold text-gray-900">¿Cómo vas a estructurar la promo?</h2>
                <p className="text-gray-500 text-sm">Elegí la mecánica que mejor encaja con tu objetivo.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {tiposDisp.map(t => {
                const info = TIPOS_INFO[t];
                const Icon = info.icon;
                const sel  = tipo === t;
                return (
                  <button
                    key={t}
                    onClick={() => setTipo(t)}
                    className={cn(
                      'text-left p-5 rounded-2xl border-2 transition-all hover:shadow-md bg-white',
                      sel ? 'border-[#0784F2] shadow-md ring-2 ring-[#0784F2]/10' : 'border-gray-100 hover:border-gray-200',
                    )}
                  >
                    <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center mb-3', sel ? 'bg-[#0784F2]/10' : 'bg-gray-100')}>
                      <Icon className={cn('w-5 h-5', sel ? 'text-[#0784F2]' : 'text-gray-400')} />
                    </div>
                    <div className={cn('font-bold text-[15px] mb-1.5', sel ? 'text-[#0784F2]' : 'text-gray-800')}>
                      {info.label}
                    </div>
                    <p className="text-[12px] text-gray-500 leading-relaxed mb-3">{info.desc}</p>
                    <div className="bg-gray-50 rounded-lg px-3 py-2 text-[11px] text-gray-500 italic">
                      {info.ejemplo}
                    </div>
                    {sel && (
                      <div className="mt-3 flex items-center gap-1 text-[11px] font-semibold text-[#0784F2]">
                        <Check className="w-3 h-3" /> Seleccionado
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── STEP 3: PRODUCTOS ─────────────────────────────────────────────── */}
        {step === 'productos' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Buscador */}
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-1">Agregá los productos</h2>
              <p className="text-sm text-gray-500 mb-4">
                Buscá por nombre, SKU o proveedor. Podés mezclar cualquier combinación.
              </p>

              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Buscar producto…"
                  className="w-full pl-9 pr-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0784F2]/30 focus:border-[#0784F2]"
                  autoFocus
                />
              </div>

              <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                {resultados.length === 0 && search.length >= 2 && (
                  <div className="text-center py-8 text-gray-400 text-sm">Sin resultados para &ldquo;{search}&rdquo;</div>
                )}
                {resultados.length === 0 && search.length < 2 && (
                  <div className="text-center py-12 text-gray-400">
                    <Search className="w-8 h-8 mx-auto mb-2" />
                    <p className="text-sm">Escribí al menos 2 caracteres</p>
                  </div>
                )}
                {resultados.map(p => {
                  const sel = items.some(i => i.product.id === p.id && !i.isGift);
                  const gft = items.some(i => i.product.id === p.id && i.isGift);
                  return (
                    <div
                      key={p.id}
                      className={cn(
                        'flex items-center gap-3 p-3 rounded-xl border transition-all',
                        sel ? 'bg-[#0784F2]/5 border-[#0784F2]/30' :
                        gft ? 'bg-[#16A34A]/5 border-[#16A34A]/30' :
                        'bg-white border-gray-100 hover:border-gray-200',
                      )}
                    >
                      {/* Foto */}
                      <div className="w-10 h-10 rounded-lg border border-gray-100 bg-gray-50 flex items-center justify-center shrink-0 overflow-hidden">
                        {resolveImg(p)
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={resolveImg(p)!} alt={p.name} className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display='none'; }} />
                          : <ImageIcon className="w-4 h-4 text-gray-400" />}
                      </div>
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-semibold text-gray-800 leading-tight line-clamp-1">{p.name}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          {p.supplierName || '—'} · {p.price > 1 ? formatARS(p.price) : 'Sin precio'}
                          {p.margin !== null && ` · ${p.margin}% mg`}
                        </p>
                      </div>
                      {/* Actions */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        {tipo === 'regalo' && !sel && (
                          <button
                            onClick={() => toggleProduct(p, true)}
                            className={cn(
                              'px-2 py-1 rounded-lg text-[10px] font-semibold transition-colors',
                              gft ? 'bg-[#16A34A] text-white' : 'bg-[#16A34A]/10 text-[#16A34A] hover:bg-[#16A34A]/20',
                            )}
                          >
                            {gft ? '✓ Regalo' : '🎁 Regalo'}
                          </button>
                        )}
                        <button
                          onClick={() => toggleProduct(p, false)}
                          className={cn(
                            'px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-colors',
                            sel ? 'bg-[#0784F2] text-white' : 'bg-[#0784F2]/10 text-[#0784F2] hover:bg-[#0784F2]/20',
                          )}
                        >
                          {sel ? '✓ Agregado' : '+ Agregar'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Seleccionados */}
            <div>
              <h3 className="text-[13px] font-bold text-gray-700 mb-3 flex items-center gap-2">
                <Package className="w-4 h-4" />
                Productos de la promo
                {items.length > 0 && (
                  <span className="ml-auto text-[11px] bg-[#0784F2]/10 text-[#0784F2] px-2 py-0.5 rounded-full font-semibold">
                    {items.filter(i => !i.isGift).length} productos
                    {items.filter(i => i.isGift).length > 0 && ` + ${items.filter(i => i.isGift).length} regalo`}
                  </span>
                )}
              </h3>

              {items.length === 0 ? (
                <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-12 text-center">
                  <Package className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-400">Buscá y agregá productos a la izquierda</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {items.map(item => (
                    <div
                      key={item.product.id}
                      className={cn(
                        'flex items-center gap-3 p-3 rounded-xl border',
                        item.isGift ? 'bg-[#16A34A]/5 border-[#16A34A]/20' : 'bg-white border-gray-100',
                      )}
                    >
                      {/* Foto */}
                      <div className="w-10 h-10 rounded-lg border border-gray-100 bg-gray-50 overflow-hidden shrink-0 flex items-center justify-center">
                        {resolveImg(item.product)
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={resolveImg(item.product)!} alt={item.product.name} className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display='none'; }} />
                          : <ImageIcon className="w-4 h-4 text-gray-400" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-semibold text-gray-800 line-clamp-1">{item.product.name}</p>
                        <p className="text-[10px] text-gray-400">
                          {item.isGift ? '🎁 Regalo' : formatARS(item.product.price)}
                          {!item.isGift && item.product.margin !== null && ` · ${item.product.margin}% mg`}
                        </p>
                      </div>
                      {!item.isGift && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => updateQty(item.product.id, -1)} className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200"><Minus className="w-3 h-3" /></button>
                          <span className="text-[13px] font-bold text-gray-700 w-5 text-center">{item.qty}</span>
                          <button onClick={() => updateQty(item.product.id, +1)} className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200"><Plus className="w-3 h-3" /></button>
                        </div>
                      )}
                      <button onClick={() => toggleProduct(item.product, item.isGift)} className="text-gray-400 hover:text-red-400 transition-colors ml-1">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Mini Socio */}
              {items.filter(i => !i.isGift).length > 0 && tipo && objetivo && (
                <div className="mt-4 bg-[#0784F2]/5 border border-[#0784F2]/15 rounded-xl p-4">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Sparkles className="w-3.5 h-3.5 text-[#0784F2]" />
                    <span className="text-[11px] font-bold text-[#0784F2] uppercase tracking-wide">Socio Acqua</span>
                  </div>
                  <p className="text-[12px] text-gray-700 leading-relaxed">{recomen}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── STEP 4: CONFIGURAR ────────────────────────────────────────────── */}
        {step === 'config' && calc && tipo && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-1">Configurá la promo</h2>
              <p className="text-sm text-gray-500 mb-6">Ajustá el descuento y revisá que los números cierren.</p>

              {/* Param slider */}
              {tipo !== 'regalo' && (
                <div className="bg-white rounded-2xl border border-gray-100 p-5 mb-4 shadow-sm">
                  <label className="text-[12px] font-bold text-gray-600 uppercase tracking-wide block mb-4">
                    {tipo === 'combo' ? 'Precio combo ($)' : 'Descuento (%)'}
                  </label>

                  {tipo === 'combo' ? (
                    <div className="flex items-center gap-3">
                      <span className="text-gray-400 font-mono text-sm">$</span>
                      <input
                        type="number"
                        value={param > 0 ? param : roundTo10(calc.totalPrice * 0.88)}
                        onChange={e => setParam(parseFloat(e.target.value) || 0)}
                        step={10}
                        className="flex-1 px-3 py-2 text-xl font-bold border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0784F2]/30"
                      />
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-3xl font-black text-[#07111F]">{param}%</span>
                        <div className="flex gap-2">
                          {[10, 15, 20, 25, 30, 50].map(v => (
                            <button key={v} onClick={() => setParam(v)}
                              className={cn('px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors',
                                param === v ? 'bg-[#07111F] text-white border-[#07111F]' : 'bg-gray-50 text-gray-500 border-gray-200 hover:border-gray-300'
                              )}>{v}%</button>
                          ))}
                        </div>
                      </div>
                      <input type="range" min={5} max={70} value={param} onChange={e => setParam(Number(e.target.value))}
                        className="w-full accent-[#0784F2]" />
                    </div>
                  )}
                </div>
              )}

              {/* Results cards */}
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Precio original', value: formatARS(calc.totalPrice), sub: 'Sin promo', color: 'text-gray-400', bg: 'bg-gray-50' },
                  { label: 'Precio promo',    value: formatARS(calc.promoPrice), sub: calc.desc, color: 'text-[#0784F2]', bg: 'bg-[#0784F2]/5' },
                  { label: 'Costo total',     value: formatARS(calc.totalCost),  sub: 'Neto sin IVA', color: 'text-gray-600', bg: 'bg-gray-50' },
                  { label: 'El cliente ahorra', value: formatARS(calc.savings),  sub: `${Math.round(calc.savingsPct)}% OFF`, color: 'text-[#16A34A]', bg: 'bg-[#16A34A]/5' },
                ].map(c => (
                  <div key={c.label} className={cn('rounded-xl p-4 border border-transparent', c.bg)}>
                    <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-1">{c.label}</p>
                    <p className={cn('text-[20px] font-black', c.color)}>{c.value}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{c.sub}</p>
                  </div>
                ))}
              </div>

              {/* Margin indicator */}
              <div className={cn(
                'mt-4 rounded-xl p-4 border',
                calc.margin === null ? 'bg-gray-50 border-gray-100' :
                calc.margin >= 40 ? 'bg-[#16A34A]/5 border-[#16A34A]/20' :
                calc.margin >= 30 ? 'bg-[#F97316]/5 border-[#F97316]/20' :
                'bg-[#EF4444]/5 border-[#EF4444]/20'
              )}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Margen de la promo</p>
                    <p className={cn(
                      'text-[28px] font-black mt-0.5',
                      calc.margin === null ? 'text-gray-400' :
                      calc.margin >= 40 ? 'text-[#16A34A]' :
                      calc.margin >= 30 ? 'text-[#F97316]' : 'text-[#EF4444]'
                    )}>
                      {calc.margin !== null ? `${Math.round(calc.margin)}%` : '—'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] text-gray-500">
                      {calc.margin === null ? 'Falta costo' :
                       calc.margin >= 40 ? '✅ Rentable' :
                       calc.margin >= 30 ? '⚠️ Ajustado' : '🚨 Crítico'}
                    </p>
                    {calc.margin !== null && calc.margin < 30 && (
                      <p className="text-[10px] text-[#EF4444] mt-1">Subí el precio o reducí el descuento</p>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Por unidad (por_cantidad / 2da_unidad) ── */}
              {(tipo === 'por_cantidad' || tipo === '2da_unidad') && (() => {
                const mainItems = items.filter(i => !i.isGift);
                const totalQty  = mainItems.reduce((a, i) => a + i.qty, 0);
                if (totalQty < 2) return null;
                const pricePerUnit  = calc.promoPrice / totalQty;
                const costPerUnit   = calc.totalCost  / totalQty;
                const profitPerUnit = pricePerUnit - costPerUnit;
                const marginPerUnit = pricePerUnit > 0 ? (profitPerUnit / pricePerUnit) * 100 : 0;
                const okColor = marginPerUnit >= 40 ? '#16A34A' : marginPerUnit >= 30 ? '#F97316' : '#EF4444';
                return (
                  <div className="mt-4 rounded-xl border-2 p-4" style={{ borderColor: okColor + '40', background: okColor + '08' }}>
                    <p className="text-[10px] font-black uppercase tracking-widest mb-3" style={{ color: okColor }}>
                      📦 Por unidad · {totalQty} {totalQty === 2 ? 'unidades' : `unidades`}
                    </p>
                    <div className="grid grid-cols-4 gap-2">
                      {[
                        { label: 'Precio c/u',  value: formatARS(Math.round(pricePerUnit)),  bold: true,  color: '#0784F2' },
                        { label: 'Costo c/u',   value: formatARS(Math.round(costPerUnit)),   bold: false, color: '#6B7280' },
                        { label: 'Ganancia c/u',value: formatARS(Math.round(profitPerUnit)), bold: false, color: profitPerUnit >= 0 ? '#16A34A' : '#EF4444' },
                        { label: 'Margen c/u',  value: `${Math.round(marginPerUnit)}%`,      bold: true,  color: okColor },
                      ].map(c => (
                        <div key={c.label} className="text-center">
                          <p className="text-[9px] text-gray-400 font-semibold uppercase tracking-wide mb-0.5">{c.label}</p>
                          <p className="text-[15px] font-black leading-tight" style={{ color: c.color }}>{c.value}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* ── Stock de combos disponibles ── */}
              {tipo === 'combo' && combosDisponibles !== null && (
                <div className={cn(
                  'mt-4 rounded-xl p-4 border',
                  combosDisponibles === 0 ? 'bg-[#EF4444]/5 border-[#EF4444]/20' :
                  combosDisponibles < 5  ? 'bg-[#F97316]/5 border-[#F97316]/20' :
                  'bg-[#16A34A]/5 border-[#16A34A]/20'
                )}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Combos armables con stock actual</p>
                      <p className={cn('text-[36px] font-black mt-0.5',
                        combosDisponibles === 0 ? 'text-[#EF4444]' :
                        combosDisponibles < 5  ? 'text-[#F97316]' : 'text-[#16A34A]'
                      )}>
                        {combosDisponibles} combo{combosDisponibles !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <div className="text-right text-[11px] text-gray-500 space-y-0.5">
                      {items.filter(i => !i.isGift).map(item => {
                        const prod = todosProductos.find(p => p.id === item.product.id);
                        const stock = (prod as { stock?: number })?.stock ?? 0;
                        return (
                          <p key={item.product.id}>
                            {item.product.name.slice(0, 22)}: <span className="font-bold">{stock} u.</span> → {Math.floor(stock / item.qty)} combos
                          </p>
                        );
                      })}
                    </div>
                  </div>
                  {combosDisponibles === 0 && (
                    <p className="text-[11px] text-[#EF4444] mt-2">Sin stock suficiente para armar ningún combo. Verificá el inventario.</p>
                  )}
                </div>
              )}

              {/* Modo de precio */}
              <div className="mt-4 bg-white rounded-xl border border-gray-100 p-4">
                <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-3">Modo de precio</p>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <button
                    onClick={() => setPromoMode('pct')}
                    className={cn(
                      'p-3 rounded-xl border-2 text-left transition-all',
                      promoMode === 'pct' ? 'border-[#0784F2] bg-[#0784F2]/5' : 'border-gray-100 hover:border-gray-200 bg-gray-50',
                    )}
                  >
                    <p className={cn('text-[12px] font-bold leading-tight', promoMode === 'pct' ? 'text-[#0784F2]' : 'text-gray-700')}>
                      % sobre Lista A
                    </p>
                    <p className="text-[10px] text-gray-400 mt-0.5 leading-snug">El descuento de lista aplica encima del precio promo</p>
                  </button>
                  <button
                    onClick={() => { setPromoMode('fijo'); setFixedPrice(prev => prev || roundTo10(calc?.promoPrice ?? 0)); }}
                    className={cn(
                      'p-3 rounded-xl border-2 text-left transition-all',
                      promoMode === 'fijo' ? 'border-[#07111F] bg-gray-50' : 'border-gray-100 hover:border-gray-200 bg-gray-50',
                    )}
                  >
                    <p className={cn('text-[12px] font-bold leading-tight', promoMode === 'fijo' ? 'text-[#07111F]' : 'text-gray-700')}>
                      Precio fijo único
                    </p>
                    <p className="text-[10px] text-gray-400 mt-0.5 leading-snug">Un precio para todos los medios, sin descuentos extra</p>
                  </button>
                </div>

                {promoMode === 'fijo' && (
                  <div className="mb-3">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wide block mb-1.5">Precio fijo de promo</label>
                    <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
                      <span className="text-gray-400 font-mono text-sm">$</span>
                      <input
                        type="number"
                        value={fixedPrice || roundTo10(calc?.promoPrice ?? 0)}
                        onChange={e => setFixedPrice(parseFloat(e.target.value) || 0)}
                        step={10}
                        className="flex-1 bg-transparent text-xl font-bold text-gray-900 focus:outline-none"
                      />
                    </div>
                  </div>
                )}

                {promoMode === 'pct' && calc && (
                  <div className="bg-[#F97316]/8 border border-[#F97316]/25 rounded-lg px-3 py-2">
                    <p className="text-[11px] text-[#F97316] font-semibold leading-snug">
                      ⚠️ Efectivo: {param}% promo + 15% lista = <strong>{(100 - ((1 - param/100) * 0.85) * 100).toFixed(1)}% OFF real</strong> sobre Lista A
                    </p>
                  </div>
                )}
              </div>

              {/* Utilidad por forma de pago */}
              <div className="mt-4 bg-white rounded-xl border border-gray-100 p-4">
                <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-3">Utilidad por forma de pago</p>
                <div>
                  <div className="grid grid-cols-4 gap-1 pb-2 border-b border-gray-100 mb-1">
                    <span className="text-[10px] text-gray-400 font-bold">Medio</span>
                    <span className="text-[10px] text-gray-400 font-bold text-right">Precio</span>
                    <span className="text-[10px] text-gray-400 font-bold text-right">Comis.</span>
                    <span className="text-[10px] text-gray-400 font-bold text-right">Margen</span>
                  </div>
                  {PAYMENT_ROWS.map(row => {
                    const cost   = calc?.totalCost ?? 0;
                    const listaA = calc?.promoPrice ?? 0;
                    const precio = promoMode === 'fijo'
                      ? (fixedPrice || roundTo10(listaA))
                      : roundTo10(listaA * (1 - row.listaOff));
                    const neto   = precio * (1 - row.comision);
                    const margen = cost > 0 && neto > 0 ? ((neto - cost) / neto * 100) : null;
                    const mc     = margen === null ? 'text-gray-400'
                                 : margen >= 40    ? 'text-[#16A34A]'
                                 : margen >= 30    ? 'text-[#F97316]'
                                 :                   'text-[#EF4444]';
                    return (
                      <div key={row.key} className="grid grid-cols-4 gap-1 py-1.5 border-b border-gray-50 last:border-0">
                        <span className="text-[11px] text-gray-700 font-medium truncate">{row.label}</span>
                        <span className="text-[11px] text-gray-700 text-right font-mono">{formatARS(precio)}</span>
                        <span className="text-[11px] text-gray-400 text-right">{(row.comision * 100).toFixed(1)}%</span>
                        <span className={cn('text-[12px] font-black text-right', mc)}>
                          {margen !== null ? `${Math.round(margen)}%` : '—'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Socio Acqua análisis */}
            <div>
              <div className="bg-[#07111F] rounded-2xl p-6 text-white mb-4">
                <div className="flex items-center gap-2 mb-4">
                  <Sparkles className="w-4 h-4 text-[#0784F2]" />
                  <span className="text-[12px] font-bold text-[#0784F2] uppercase tracking-wide">Análisis Socio Acqua</span>
                </div>
                <p className="text-[14px] leading-relaxed text-white/85 mb-5">{recomen}</p>

                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Precio de venta',    value: formatARS(calc.promoPrice) },
                    { label: 'Tu ganancia',         value: formatARS(calc.promoPrice - calc.totalCost) },
                    { label: 'Ahorro del cliente',  value: formatARS(calc.savings) },
                    { label: 'Margen promo',        value: calc.margin !== null ? `${Math.round(calc.margin)}%` : '—' },
                  ].map(s => (
                    <div key={s.label} className="bg-white/5 rounded-xl px-3 py-2.5">
                      <p className="text-[10px] text-white/40 mb-0.5">{s.label}</p>
                      <p className="text-[16px] font-black text-white">{s.value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Productos resumen */}
              <div className="bg-white rounded-2xl border border-gray-100 p-4">
                <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-3">Productos en la promo</p>
                <div className="space-y-2">
                  {items.map(item => (
                    <div key={item.product.id} className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-gray-50 border border-gray-100 overflow-hidden shrink-0 flex items-center justify-center">
                        {resolveImg(item.product)
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={resolveImg(item.product)!} alt={item.product.name} className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display='none'; }} />
                          : <ImageIcon className="w-3 h-3 text-gray-400" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-medium text-gray-700 line-clamp-1">{item.product.name}</p>
                      </div>
                      <span className="text-[10px] text-gray-400 shrink-0">
                        {item.isGift ? '🎁' : `x${item.qty} · ${formatARS(item.product.price * item.qty)}`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 5: PUBLICAR ──────────────────────────────────────────────── */}
        {step === 'publicar' && calc && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* Canvas preview */}
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-1">Imagen de la promo</h2>
              <p className="text-sm text-gray-500 mb-4">Elegí el fondo, poné el nombre y descargá.</p>

              {/* Nombre editable */}
              <div className="mb-4">
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide block mb-1.5">
                  Nombre de la promo
                </label>
                <input
                  type="text"
                  value={promoName}
                  onChange={e => setPromoName(e.target.value)}
                  placeholder="Ej: Kit Pileta Verano, Promo Limpieza..."
                  className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-[#0784F2]/30 focus:border-[#0784F2]"
                />
              </div>

              {/* BG selector */}
              <div className="mb-4">
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide block mb-2">
                  Fondo de la imagen
                </label>
                <div className="flex flex-wrap gap-2">
                  {BG_OPTIONS.map(opt => (
                    <button
                      key={opt.key}
                      onClick={() => {
                        if (opt.key === 'custom') { customFileRef.current?.click(); }
                        else { setBg(opt.key); }
                      }}
                      className={cn(
                        'flex items-center gap-2 px-3 py-2 rounded-xl border-2 text-[11px] font-semibold transition-all',
                        bg === opt.key ? 'border-[#07111F] shadow-sm' : 'border-transparent bg-white hover:border-gray-200',
                      )}
                    >
                      <div className={cn('w-5 h-5 rounded-md border border-gray-200', opt.preview)} />
                      {opt.label}
                    </button>
                  ))}
                  <input
                    ref={customFileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={e => { handleCustomBg(e); setBg('custom'); }}
                  />
                </div>
              </div>

              {/* Canvas */}
              <div className="relative rounded-2xl overflow-hidden border border-gray-200 shadow-sm aspect-square bg-gray-100">
                <canvas
                  ref={canvasRef}
                  className="w-full h-full object-cover"
                  style={{ imageRendering: 'auto' }}
                />
              </div>

              {/* Guardar promo */}
              <button
                onClick={handleSavePromo}
                disabled={saving || !calc}
                className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 bg-[#16A34A] text-white rounded-xl font-semibold text-[13px] hover:opacity-90 disabled:opacity-40 transition-opacity"
              >
                {saving
                  ? <><RefreshCw className="w-4 h-4 animate-spin" /> Guardando…</>
                  : <><BookmarkPlus className="w-4 h-4" /> Guardar promo</>}
              </button>

              <div className="mt-3 flex gap-2">
                <button
                  onClick={downloadCanvas}
                  className="flex-1 flex items-center justify-center gap-2 py-3 bg-[#07111F] text-white rounded-xl font-semibold text-[13px] hover:bg-[#0d1f3c] transition-colors"
                >
                  <Download className="w-4 h-4" />
                  Descargar PNG
                </button>
                <button
                  onClick={generateAiImage}
                  disabled={aiLoading}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-[13px] transition-colors border-2',
                    aiLoading
                      ? 'border-[#7C3AED] bg-[#7C3AED]/5 text-[#7C3AED] cursor-wait'
                      : 'border-[#7C3AED] text-[#7C3AED] hover:bg-[#7C3AED]/5',
                  )}
                >
                  {aiLoading
                    ? <><span className="animate-spin inline-block w-4 h-4 border-2 border-[#7C3AED] border-t-transparent rounded-full" /> Generando...</>
                    : <><Sparkles className="w-4 h-4" /> Generar con IA</>}
                </button>
              </div>

              {/* AI image result */}
              {aiImgUrl && (
                <div className="mt-3">
                  <p className="text-[10px] font-bold text-[#7C3AED] uppercase tracking-wide mb-2">✨ Imagen generada por IA</p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={aiImgUrl} alt="Promo IA" className="w-full rounded-2xl border border-[#7C3AED]/20 shadow-sm" />
                  <a
                    href={aiImgUrl}
                    download={`${(promoName || 'promo').replace(/\s+/g, '-').toLowerCase()}-ia.png`}
                    className="mt-2 w-full flex items-center justify-center gap-2 py-2.5 bg-[#7C3AED] text-white rounded-xl font-semibold text-[12px] hover:bg-[#6D28D9] transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Descargar imagen IA
                  </a>
                </div>
              )}
            </div>

            {/* WhatsApp */}
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-1">Mensaje WhatsApp</h2>
              <p className="text-sm text-gray-500 mb-4">
                Copiá el texto y pegalo en WhatsApp Business.
              </p>

              {/* Preview mensaje */}
              <div className="bg-[#075E54] rounded-2xl p-5 mb-4">
                <div className="bg-[#DCF8C6] rounded-xl rounded-tl-none p-4 shadow-sm max-w-[320px]">
                  <div className="text-[13px] text-gray-800 leading-relaxed whitespace-pre-wrap font-[system-ui]">
                    {buildWAMsg()}
                  </div>
                  <div className="text-right text-[10px] text-gray-400 mt-1">10:30 ✓✓</div>
                </div>
              </div>

              <button
                onClick={copyWA}
                className={cn(
                  'w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-[13px] transition-all',
                  copied
                    ? 'bg-[#16A34A] text-white'
                    : 'bg-[#25D366] text-white hover:bg-[#22C35E]',
                )}
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Copiado al portapapeles ✓' : 'Copiar mensaje para WhatsApp Business'}
              </button>

              {/* Resumen final */}
              <div className="mt-5 bg-white rounded-2xl border border-gray-100 p-5">
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-4">Resumen de la promo</p>
                <div className="space-y-2.5">
                  <div className="flex justify-between text-[13px]">
                    <span className="text-gray-500">Objetivo</span>
                    <span className="font-semibold text-gray-800">{OBJETIVOS.find(o => o.key === objetivo)?.label}</span>
                  </div>
                  <div className="flex justify-between text-[13px]">
                    <span className="text-gray-500">Mecánica</span>
                    <span className="font-semibold text-gray-800">{tipo ? TIPOS_INFO[tipo].label : '—'}</span>
                  </div>
                  <div className="flex justify-between text-[13px]">
                    <span className="text-gray-500">Productos</span>
                    <span className="font-semibold text-gray-800">{items.filter(i => !i.isGift).length}</span>
                  </div>
                  <div className="flex justify-between text-[13px] pt-2 border-t border-gray-50">
                    <span className="text-gray-500">Precio promo</span>
                    <span className="font-black text-[#0784F2] text-[15px]">{formatARS(calc.promoPrice)}</span>
                  </div>
                  <div className="flex justify-between text-[13px]">
                    <span className="text-gray-500">Tu margen</span>
                    <span className={cn('font-black text-[15px]',
                      calc.margin === null ? 'text-gray-400' :
                      calc.margin >= 40 ? 'text-[#16A34A]' :
                      calc.margin >= 30 ? 'text-[#F97316]' : 'text-[#EF4444]'
                    )}>
                      {calc.margin !== null ? `${Math.round(calc.margin)}%` : '—'}
                    </span>
                  </div>
                </div>

                <div className="mt-4 p-4 bg-[#0784F2]/5 border border-[#0784F2]/20 rounded-xl">
                  <p className="text-[11px] text-gray-600 mb-1">
                    <span className="font-bold text-[#0784F2]">📦 Combo armable:</span>{' '}
                    {combosDisponibles !== null
                      ? <span className="font-bold">{combosDisponibles} combo{combosDisponibles !== 1 ? 's' : ''} con el stock actual</span>
                      : 'Verificar stock en productos'}
                  </p>
                  <p className="text-[11px] text-gray-500 mb-3">
                    Componentes: {items.filter(i => !i.isGift).map(i => `${i.qty}× ${i.product.name}`).join(' + ')} · Lista A: <span className="font-bold">{formatARS(calc.promoPrice)}</span>
                  </p>
                  <button
                    onClick={async () => {
                      if (!promoName) {
                        setSavedToast('⚠️ Ponele un nombre a la promo primero');
                        setTimeout(() => setSavedToast(null), 2500);
                        return;
                      }
                      const comboId = `combo_${Date.now()}`;
                      const margin  = calc.totalCost > 0
                        ? Math.round((calc.promoPrice - calc.totalCost) / calc.promoPrice * 100 * 10) / 10
                        : null;
                      const body = {
                        id:           comboId,
                        name:         promoName,
                        cost:         Math.round(calc.totalCost * 100) / 100,
                        price:        calc.promoPrice,
                        margin,
                        category:     'Combos',
                        active:       true,
                        hidden:       false,
                        stock:        combosDisponibles ?? 0,
                        type:         'combo',
                        sku:          null,
                        barcode:      null,
                        image:        null,
                        supplierName: 'Armado interno',
                        components:   items.filter(i => !i.isGift).map(i => ({
                          productId:   i.product.id,
                          productName: i.product.name,
                          qty:         i.qty,
                        })),
                        source: 'combo-promo',
                      };
                      try {
                        const res  = await fetch('/api/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
                        const data = await res.json() as { ok: boolean; error?: string };
                        if (data.ok) {
                          setSavedToast(`✅ "${promoName}" agregado a Productos — categoría Combos`);
                        } else {
                          setSavedToast(`❌ ${data.error ?? 'Error al crear producto'}`);
                        }
                      } catch (e) {
                        setSavedToast(`❌ Error: ${String(e)}`);
                      }
                      setTimeout(() => setSavedToast(null), 3500);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0784F2] text-white rounded-lg text-[11px] font-semibold hover:opacity-90 transition-opacity"
                  >
                    <Package className="w-3 h-3" /> Agregar a Productos como COMBO
                  </button>
                  <p className="text-[10px] text-gray-400 mt-2">
                    Después desde Productos → Odoo podés sincronizarlo con el botón Sync.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="mt-8 flex items-center justify-between">
          <button
            onClick={goPrev}
            disabled={stepIdx === 0}
            className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 rounded-xl text-[13px] font-semibold text-gray-600 hover:bg-white disabled:opacity-30 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" /> Anterior
          </button>

          {stepIdx < STEPS.length - 1 && (
            <button
              onClick={goNext}
              disabled={!canNext}
              className="flex items-center gap-2 px-6 py-2.5 bg-[#07111F] text-white rounded-xl text-[13px] font-semibold hover:bg-[#0d1f3c] disabled:opacity-30 transition-colors"
            >
              Siguiente <ChevronRight className="w-4 h-4" />
            </button>
          )}

          {stepIdx === STEPS.length - 1 && (
            <button
              onClick={() => {
                setStep('objetivo'); setObjetivo(null); setTipo(null);
                setItems([]); setParam(50); setPromoName(''); setBg('azul');
              }}
              className="flex items-center gap-2 px-6 py-2.5 bg-[#16A34A] text-white rounded-xl text-[13px] font-semibold hover:opacity-90 transition-opacity"
            >
              <Star className="w-4 h-4" /> Nueva promo
            </button>
          )}
        </div>

      </div>

      {/* Toast: guardar / Odoo */}
      {savedToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 bg-[#07111F] text-white text-[13px] font-semibold rounded-2xl shadow-2xl flex items-center gap-2.5 whitespace-nowrap">
          {savedToast}
          <button onClick={() => setSavedToast(null)} className="ml-2 opacity-50 hover:opacity-100">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
