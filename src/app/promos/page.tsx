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
  Plus, Minus, Tag, Star,
} from 'lucide-react';

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
    const ctxRaw = canvas.getContext('2d');
    if (!ctxRaw) return;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const ctx = ctxRaw!;

    const SIZE = 1080;
    canvas.width = SIZE;
    canvas.height = SIZE;

    // ── Palette ──────────────────────────────────────────────────────────────
    const isLight  = bg === 'blanco';
    const isDark   = bg === 'oscuro';
    const isColour = !isLight; // coloured or dark bg
    const ink      = isLight ? '#07111F' : '#FFFFFF';
    const inkSub   = isLight ? '#6B7280' : 'rgba(255,255,255,0.55)';
    const accent   = isLight ? '#0784F2' : (isDark ? '#fbbf24' : '#FFFFFF');

    // ── Background ───────────────────────────────────────────────────────────
    const paintBg = (then: () => void) => {
      if (bg === 'custom' && customBg) {
        const bi = new Image();
        bi.onload = () => { ctx.drawImage(bi, 0, 0, SIZE, SIZE); then(); };
        bi.onerror = then;
        bi.src = customBg;
        return;
      }
      if (bg === 'blanco') {
        ctx.fillStyle = '#F5F5F3';
      } else if (bg === 'azul') {
        ctx.fillStyle = '#0784F2';
      } else if (bg === 'oscuro') {
        ctx.fillStyle = '#07111F';
      } else if (bg === 'verano') {
        const g = ctx.createLinearGradient(0, SIZE, SIZE, 0);
        g.addColorStop(0,'#F97316'); g.addColorStop(1,'#FBBF24');
        ctx.fillStyle = g;
      } else if (bg === 'violeta') {
        const g = ctx.createLinearGradient(0, 0, SIZE, SIZE);
        g.addColorStop(0,'#7C3AED'); g.addColorStop(1,'#EC4899');
        ctx.fillStyle = g;
      } else { ctx.fillStyle = '#F5F5F3'; }
      ctx.fillRect(0, 0, SIZE, SIZE);
      then();
    };

    paintBg(() => {
      ctx.textAlign = 'center';

      // ── 0. Decorative circles (ACQUA branding) ───────────────────────────
      const decoCircles: [number, number, number, number][] = [
        [-100, -100, 280, isLight ? 0.07 : 0.09],
        [SIZE + 110, SIZE * 0.17, 310, isLight ? 0.05 : 0.07],
        [SIZE * 0.12, SIZE + 110, 270, isLight ? 0.05 : 0.07],
        [SIZE * 0.85, SIZE * 0.52, 180, isLight ? 0.04 : 0.05],
      ];
      decoCircles.forEach(([cx2, cy2, r, a]) => {
        ctx.save(); ctx.globalAlpha = a;
        ctx.fillStyle = isLight ? '#0784F2' : '#FFFFFF';
        ctx.beginPath(); ctx.arc(cx2, cy2, r, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      });

      // Sparkle stars
      const sparkles: [number, number, number][] = [
        [148, 180, 10], [956, 144, 9], [66, 458, 8],
        [1014, 554, 10], [198, 928, 9], [882, 874, 8],
      ];
      sparkles.forEach(([sx, sy, sr]) => {
        ctx.save(); ctx.globalAlpha = 0.24;
        ctx.fillStyle = isLight ? '#0784F2' : '#FFFFFF';
        ctx.beginPath();
        for (let k = 0; k < 8; k++) {
          const ang = k * Math.PI / 4 - Math.PI / 8;
          const rad = k % 2 === 0 ? sr : sr * 0.38;
          const spx = sx + Math.cos(ang) * rad;
          const spy = sy + Math.sin(ang) * rad;
          k === 0 ? ctx.moveTo(spx, spy) : ctx.lineTo(spx, spy);
        }
        ctx.closePath(); ctx.fill(); ctx.restore();
      });

      // ── 1. Brand header ──────────────────────────────────────────────────
      ctx.fillStyle = isLight ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.07)';
      ctx.fillRect(0, 0, SIZE, 94);

      // Icon box
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.18)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
      ctx.fillStyle = accent;
      ctx.beginPath(); ctx.roundRect(42, 17, 60, 60, 14); ctx.fill();
      ctx.restore();
      ctx.fillStyle = isLight ? '#FFFFFF' : '#07111F';
      ctx.font = 'bold 26px system-ui'; ctx.textAlign = 'center';
      ctx.fillText('AP', 72, 55);

      // Brand text
      ctx.textAlign = 'left';
      ctx.fillStyle = ink; ctx.font = '800 28px system-ui';
      ctx.fillText('ACQUA', 118, 44);
      ctx.fillStyle = inkSub; ctx.font = '500 15px system-ui';
      ctx.fillText('PACHECO  ·  Limpieza y Hogar', 120, 67);

      // Divider
      ctx.strokeStyle = isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(42, 93); ctx.lineTo(SIZE - 42, 93); ctx.stroke();

      // ── 2. Offer pill ────────────────────────────────────────────────────
      ctx.textAlign = 'center';
      const pillLabel =
        tipo === '2da_unidad'   ? '2DA UNIDAD'
        : tipo === 'por_cantidad' ? 'OFERTA POR CANTIDAD'
        : tipo === 'descuento'    ? 'DESCUENTO ESPECIAL'
        : tipo === 'combo'        ? 'COMBO PRECIO ÚNICO'
        : tipo === 'regalo'       ? 'REGALO INCLUIDO'
        :                           'OFERTA ESPECIAL';

      ctx.font = 'bold 17px system-ui';
      const pillW = ctx.measureText(pillLabel).width + 58;
      const pillH = 42; const pillX = SIZE / 2 - pillW / 2; const pillY = 108;
      ctx.fillStyle = isLight ? '#0784F2' : 'rgba(255,255,255,0.20)';
      ctx.beginPath(); ctx.roundRect(pillX, pillY, pillW, pillH, pillH / 2); ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(pillLabel, SIZE / 2, pillY + 28.5);

      // ── 3. Offer headline — bold, legible, no editorial spacing ──────────
      const mainItems = items.filter(i => !i.isGift);
      const giftItems = items.filter(i =>  i.isGift);

      let offerL1 = '', offerL2 = '', hSz = 82;
      if (tipo === '2da_unidad') {
        offerL1 = `¡2DA UNIDAD`; offerL2 = `AL ${param}% OFF!`; hSz = 82;
      } else if (tipo === 'por_cantidad') {
        offerL1 = `¡${param}% OFF`; offerL2 = `POR CANTIDAD!`; hSz = 82;
      } else if (tipo === 'descuento') {
        offerL1 = `¡${param}%`; offerL2 = `DE DESCUENTO!`; hSz = 96;
      } else if (tipo === 'combo') {
        offerL1 = promoName ? promoName.toUpperCase() : 'COMBO'; offerL2 = '¡PRECIO ESPECIAL!'; hSz = 68;
      } else if (tipo === 'regalo') {
        offerL1 = '¡CON TU COMPRA'; offerL2 = 'UN REGALO!'; hSz = 76;
      }

      const hBase = pillY + pillH + 16;

      ctx.save();
      ctx.shadowColor = isDark ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.10)';
      ctx.shadowBlur = 10; ctx.shadowOffsetY = 4;
      ctx.fillStyle = ink; ctx.font = `900 ${hSz}px system-ui`;
      ctx.fillText(offerL1, SIZE / 2, hBase + hSz * 0.90);
      ctx.restore();

      ctx.fillStyle = accent; ctx.font = `900 ${hSz}px system-ui`;
      ctx.fillText(offerL2, SIZE / 2, hBase + hSz * 1.96);

      // ── 4. Products — big, centered, with elliptical shadow ──────────────
      const PROD_TOP = hBase + hSz * 2.14 + 22;
      const PROD_BOT = 742;
      const PROD_H   = Math.max(PROD_BOT - PROD_TOP, 160);
      const count    = mainItems.length;
      const PAD      = 46; const gap = 22;
      const totW     = SIZE - PAD * 2;

      type Rect = { x: number; y: number; w: number; h: number };
      const slots: Rect[] = [];
      if (count === 1) {
        const w = totW * 0.62;
        slots.push({ x: SIZE / 2 - w / 2, y: PROD_TOP, w, h: PROD_H });
      } else if (count === 2) {
        const w = (totW - gap) / 2;
        slots.push({ x: PAD,           y: PROD_TOP, w, h: PROD_H });
        slots.push({ x: PAD + w + gap, y: PROD_TOP, w, h: PROD_H });
      } else if (count === 3) {
        const w = (totW - gap * 2) / 3;
        [0, 1, 2].forEach(k => slots.push({ x: PAD + k * (w + gap), y: PROD_TOP, w, h: PROD_H }));
      } else {
        const w = (totW - gap) / 2, h = (PROD_H - gap) / 2;
        [[0,0],[1,0],[0,1],[1,1]].forEach(([xi, yi]) =>
          slots.push({ x: PAD + xi * (w + gap), y: PROD_TOP + yi * (h + gap), w, h }));
      }

      // Elliptical shadow under each product (stage effect)
      const drawStage = (slot: Rect) => {
        const ex = slot.x + slot.w / 2, ey = slot.y + slot.h;
        ctx.save();
        const sg = ctx.createRadialGradient(ex, ey, 0, ex, ey, slot.w * 0.44);
        sg.addColorStop(0, 'rgba(0,0,0,0.28)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = sg;
        ctx.beginPath(); ctx.ellipse(ex, ey, slot.w * 0.44, 18, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      };

      const drawPName = (slot: Rect, name: string) => {
        ctx.fillStyle = inkSub; ctx.textAlign = 'center';
        ctx.font = `600 ${count > 2 ? 14 : 17}px system-ui`;
        const s = name.length > 28 ? name.substring(0, 26) + '…' : name;
        ctx.fillText(s, slot.x + slot.w / 2, slot.y + slot.h + 30);
      };

      let loaded = 0;
      const onLoad = () => { loaded++; if (loaded >= mainItems.length) drawBottom(); };
      if (mainItems.length === 0) { drawBottom(); return; }

      mainItems.forEach((item, i) => {
        const slot = slots[i];
        if (!slot) return;
        drawStage(slot);
        const imgMaxH = slot.h - 18, imgMaxW = slot.w - 14;
        if (item.product.image) {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            const scale = Math.min(imgMaxW / img.width, imgMaxH / img.height);
            const dw = img.width * scale, dh = img.height * scale;
            const dx = slot.x + (slot.w - dw) / 2;
            const dy = slot.y + (imgMaxH - dh) / 2 + 6;
            ctx.drawImage(img, dx, dy, dw, dh);
            if (item.qty > 1) {
              ctx.fillStyle = accent;
              ctx.beginPath(); ctx.arc(dx + dw + 16, dy, 22, 0, Math.PI * 2); ctx.fill();
              ctx.fillStyle = isLight ? '#FFF' : '#07111F';
              ctx.font = 'bold 16px system-ui'; ctx.textAlign = 'center';
              ctx.fillText(`×${item.qty}`, dx + dw + 16, dy + 5.5);
            }
            drawPName(slot, item.product.name); onLoad();
          };
          img.onerror = () => { drawPName(slot, item.product.name); onLoad(); };
          img.src = item.product.image;
        } else {
          ctx.fillStyle = isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.10)';
          ctx.beginPath(); ctx.roundRect(slot.x + 22, slot.y + 8, slot.w - 44, imgMaxH - 8, 16); ctx.fill();
          ctx.fillStyle = inkSub; ctx.font = `500 ${count > 2 ? 13 : 16}px system-ui`; ctx.textAlign = 'center';
          const s2 = item.product.name.length > 22 ? item.product.name.substring(0, 20) + '…' : item.product.name;
          ctx.fillText(s2, slot.x + slot.w / 2, slot.y + imgMaxH / 2 + 8);
          drawPName(slot, item.product.name); onLoad();
        }
        if (giftItems.length > 0 && i === mainItems.length - 1) {
          ctx.fillStyle = '#16A34A'; ctx.font = 'bold 16px system-ui'; ctx.textAlign = 'center';
          ctx.fillText(`🎁 + ${giftItems[0].product.name.substring(0, 24)}`, SIZE / 2, slot.y + slot.h + 56);
        }
      });

      // ── 5. Price badge + footer ───────────────────────────────────────────
      function drawBottom() {
        ctx.textAlign = 'center';

        // Promo name above badge (if set, non-combo)
        const showName = promoName && tipo !== 'combo';
        if (showName) {
          ctx.fillStyle = ink; ctx.font = 'bold 26px system-ui';
          ctx.fillText(promoName.toUpperCase(), SIZE / 2, 776);
        }

        const BY  = showName ? 796 : 782;
        const bW  = SIZE - 88;
        const bH  = savings > 0 ? 164 : 130;
        const bX  = SIZE / 2 - bW / 2;

        // Badge with shadow
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.28)'; ctx.shadowBlur = 32; ctx.shadowOffsetY = 12;
        ctx.fillStyle = isLight ? '#07111F' : (isDark ? '#fbbf24' : 'rgba(255,255,255,0.22)');
        ctx.beginPath(); ctx.roundRect(bX, BY, bW, bH, 30); ctx.fill();
        ctx.restore();

        const priceC  = isLight ? '#FFFFFF' : (isDark ? '#07111F' : '#07111F');
        const priceSubC = isLight
          ? 'rgba(255,255,255,0.55)'
          : isDark ? 'rgba(7,17,31,0.50)' : 'rgba(0,0,0,0.38)';

        // "Precio regular $X" with strikethrough
        if (savings > 0) {
          const totalPriceLabel = `Precio regular: ${formatARS(promoPrice + savings)}`;
          ctx.fillStyle = priceSubC; ctx.font = '500 23px system-ui'; ctx.textAlign = 'center';
          ctx.fillText(totalPriceLabel, SIZE / 2 - 32, BY + 40);
          const tlw = ctx.measureText(totalPriceLabel).width;
          ctx.strokeStyle = priceSubC; ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(SIZE / 2 - 32 - tlw / 2, BY + 33);
          ctx.lineTo(SIZE / 2 - 32 + tlw / 2, BY + 33);
          ctx.stroke();
        }

        // Main price — big and clear
        const pY = savings > 0 ? BY + bH - 30 : BY + bH - 28;
        const xOffset = savings > 0 ? -32 : 0;
        ctx.fillStyle = priceC; ctx.font = '900 84px system-ui'; ctx.textAlign = 'center';
        ctx.fillText(formatARS(promoPrice), SIZE / 2 + xOffset, pY);

        // Savings circle badge (right side)
        if (savings > 0) {
          const scX = bX + bW - 44, scY = BY + bH / 2;
          ctx.save();
          ctx.shadowColor = 'rgba(0,0,0,0.20)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 4;
          ctx.fillStyle = '#16A34A';
          ctx.beginPath(); ctx.arc(scX, scY, 46, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
          ctx.fillStyle = '#FFFFFF'; ctx.font = 'bold 22px system-ui'; ctx.textAlign = 'center';
          ctx.fillText(`${Math.round(savingsPct)}%`, scX, scY - 5);
          ctx.font = '700 14px system-ui';
          ctx.fillText('OFF', scX, scY + 16);
        }

        // Footer strip
        ctx.fillStyle = isLight ? 'rgba(0,0,0,0.045)' : 'rgba(255,255,255,0.07)';
        ctx.fillRect(0, SIZE - 70, SIZE, 70);
        ctx.fillStyle = inkSub; ctx.font = '17px system-ui'; ctx.textAlign = 'center';
        ctx.fillText('Acqua Pacheco  ·  @acquapacheco  ·  acquapacheco.com.ar', SIZE / 2, SIZE - 26);
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
  const [aiImgUrl,   setAiImgUrl]   = useState<string | null>(null);
  const [aiLoading,  setAiLoading]  = useState(false);

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
      const res = await fetch('/api/promo-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          promoName:  promoName || 'PROMO ESPECIAL',
          tipo,
          objetivo,
          productos:  items.filter(i => !i.isGift).map(i => i.product.name).slice(0, 4),
          precio:     calc.promoPrice,
          ahorro:     calc.savings,
          param,
          bg,
        }),
      });
      const data = await res.json();
      if (data.url) setAiImgUrl(data.url);
      else console.error('AI image error:', data.error);
    } catch (e) {
      console.error('generateAiImage failed:', e);
    } finally {
      setAiLoading(false);
    }
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
              {OBJETIVOS.map(o => {
                const Icon = o.icon;
                const sel  = objetivo === o.key;
                return (
                  <button
                    key={o.key}
                    onClick={() => setObjetivo(o.key)}
                    className={cn(
                      'text-left p-5 rounded-2xl border-2 transition-all hover:shadow-md',
                      sel
                        ? `${o.color} border-current shadow-md`
                        : 'bg-white border-gray-100 hover:border-gray-200',
                    )}
                  >
                    <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center mb-3', sel ? 'bg-white/60' : 'bg-gray-100')}>
                      <Icon className={cn('w-5 h-5', sel ? o.text : 'text-gray-400')} />
                    </div>
                    <div className={cn('font-bold text-[15px] mb-2', sel ? o.text : 'text-gray-800')}>
                      {o.label}
                    </div>
                    <p className={cn('text-[12px] leading-relaxed', sel ? o.text + ' opacity-80' : 'text-gray-500')}>
                      {o.desc}
                    </p>
                    {sel && (
                      <div className={cn('mt-3 flex items-center gap-1 text-[11px] font-semibold', o.text)}>
                        <Check className="w-3 h-3" /> Seleccionado
                      </div>
                    )}
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

                <div className="mt-4 p-3 bg-[#F97316]/5 border border-[#F97316]/15 rounded-xl">
                  <p className="text-[11px] text-gray-600">
                    <span className="font-bold text-[#F97316]">📋 Siguiente paso:</span> Copiá el combo en Odoo manualmente.
                    El precio de Lista A para este combo es <span className="font-bold">{formatARS(calc.promoPrice)}</span>.
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
    </div>
  );
}
