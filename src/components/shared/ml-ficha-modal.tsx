'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  X, ExternalLink, Truck, CreditCard,
  Star, ChevronDown, ChevronUp,
  Image as ImageIcon, RefreshCw,
  CheckCircle2, XCircle, AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MLPicture {
  id: string;
  url: string;
  secure_url?: string;
}

interface MLShipping {
  free_shipping: boolean;
  mode: string;
  local_pick_up?: boolean;
}

interface MLInstallments {
  quantity: number;
  amount: number;
  rate: number;
  currency_id: string;
}

interface MLAttribute {
  id: string;
  name: string;
  value_name: string | null;
}

export interface MLItem {
  id: string;
  title: string;
  price: number;
  original_price?: number;
  currency_id: string;
  sold_quantity: number;
  available_quantity: number;
  condition: string;
  listing_type_id: string;
  status: string;
  permalink: string;
  thumbnail: string;
  pictures: MLPicture[];
  shipping: MLShipping;
  installments?: MLInstallments;
  attributes: MLAttribute[];
  health?: number;
  tags?: string[];
}

// ─── Score system ─────────────────────────────────────────────────────────────

interface ScoreCheck {
  key: string;
  label: string;
  pts: number;
  maxPts: number;
  value: string;
  ok: boolean;
  warn: boolean;
  tip: string;
}

function calcScore(item: MLItem, description: string): { score: number; checks: ScoreCheck[] } {
  const checks: ScoreCheck[] = [];
  let total = 0;

  // Photos — 20 pts
  const photoCount = item.pictures?.length ?? 0;
  const photoPts = photoCount >= 6 ? 20 : photoCount >= 3 ? 12 : photoCount >= 1 ? 6 : 0;
  checks.push({
    key: 'photos', label: 'Fotos', pts: photoPts, maxPts: 20,
    value: `${photoCount} foto${photoCount !== 1 ? 's' : ''}`,
    ok: photoCount >= 6, warn: photoCount >= 3 && photoCount < 6,
    tip: photoCount >= 6
      ? '✓ Excelente cantidad de fotos'
      : `Agregá ${6 - photoCount} foto${6 - photoCount !== 1 ? 's' : ''} más — ML recomienda 6+`,
  });
  total += photoPts;

  // Title — 15 pts
  const titleLen = item.title?.length ?? 0;
  const titlePts = titleLen >= 60 && titleLen <= 90 ? 15 : titleLen >= 40 ? 9 : titleLen >= 20 ? 4 : 0;
  checks.push({
    key: 'title', label: 'Título', pts: titlePts, maxPts: 15,
    value: `${titleLen} caracteres`,
    ok: titleLen >= 60 && titleLen <= 90,
    warn: titleLen >= 40 && titleLen < 60,
    tip: titleLen >= 60 && titleLen <= 90
      ? '✓ Longitud ideal (60–90 caracteres)'
      : titleLen > 90
      ? 'El título es demasiado largo — acortalo a 60–90 caracteres'
      : 'Expandí el título a 60–90 caracteres con palabras clave relevantes',
  });
  total += titlePts;

  // Description — 15 pts
  const descLen = description?.length ?? 0;
  const descPts = descLen >= 300 ? 15 : descLen >= 100 ? 8 : descLen > 0 ? 3 : 0;
  checks.push({
    key: 'desc', label: 'Descripción', pts: descPts, maxPts: 15,
    value: descLen > 0 ? `${descLen} caracteres` : 'Sin descripción',
    ok: descLen >= 300, warn: descLen >= 100 && descLen < 300,
    tip: descLen >= 300
      ? '✓ Descripción completa y detallada'
      : 'Escribí 300+ caracteres con beneficios, usos y características técnicas',
  });
  total += descPts;

  // Free shipping — 20 pts (el factor #1 en ML)
  const freeShip = item.shipping?.free_shipping ?? false;
  const shipPts = freeShip ? 20 : 0;
  checks.push({
    key: 'shipping', label: 'Envío gratis', pts: shipPts, maxPts: 20,
    value: freeShip ? 'Activado' : 'No activo',
    ok: freeShip, warn: false,
    tip: freeShip
      ? '✓ Envío gratis activo — máxima visibilidad y conversión'
      : '⚡ CRÍTICO: El envío gratis es el factor #1 de conversión — puede triplicar las ventas',
  });
  total += shipPts;

  // Installments — 10 pts
  const hasInstallments = (item.installments?.quantity ?? 0) > 1;
  const installPts = hasInstallments ? 10 : 0;
  checks.push({
    key: 'installments', label: 'Cuotas', pts: installPts, maxPts: 10,
    value: hasInstallments ? `${item.installments!.quantity} cuotas` : 'Sin cuotas',
    ok: hasInstallments, warn: false,
    tip: hasInstallments
      ? `✓ ${item.installments!.quantity} cuotas disponibles`
      : 'Activar cuotas sin interés aumenta la conversión en productos de ticket alto',
  });
  total += installPts;

  // Attributes — 10 pts
  const filledAttrs = item.attributes?.filter(a => a.value_name).length ?? 0;
  const attrPts = filledAttrs >= 5 ? 10 : filledAttrs >= 2 ? 5 : 0;
  checks.push({
    key: 'attrs', label: 'Especificaciones', pts: attrPts, maxPts: 10,
    value: `${filledAttrs} completadas`,
    ok: filledAttrs >= 5, warn: filledAttrs >= 2 && filledAttrs < 5,
    tip: filledAttrs >= 5
      ? '✓ Especificaciones técnicas completas'
      : 'Completá las especificaciones — facilitan la búsqueda y la decisión de compra',
  });
  total += attrPts;

  // Status — 5 pts
  const isActive = item.status === 'active';
  const statusPts = isActive ? 5 : 0;
  checks.push({
    key: 'status', label: 'Estado activa', pts: statusPts, maxPts: 5,
    value: isActive ? 'Activa' : item.status === 'paused' ? 'Pausada' : item.status === 'closed' ? 'Finalizada' : item.status,
    ok: isActive, warn: item.status === 'paused',
    tip: isActive
      ? '✓ Publicación activa y visible en ML'
      : 'La publicación no está activa — no aparece en las búsquedas de compradores',
  });
  total += statusPts;

  // Stock — 5 pts
  const qty = item.available_quantity ?? 0;
  const stockPts = qty > 0 ? 5 : 0;
  checks.push({
    key: 'stock', label: 'Stock cargado', pts: stockPts, maxPts: 5,
    value: qty > 0 ? `${qty} unidades` : 'Sin stock',
    ok: qty > 0, warn: qty > 0 && qty <= 3,
    tip: qty > 0
      ? (qty <= 3 ? `⚠ Solo ${qty} unidades — reponer pronto` : `✓ ${qty} unidades disponibles`)
      : 'Sin stock — la publicación no se muestra a los compradores',
  });
  total += stockPts;

  return { score: total, checks };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtARS(n: number) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', maximumFractionDigits: 0,
  }).format(n);
}

const LISTING_TYPE_LABELS: Record<string, string> = {
  gold_special: 'Clásica',
  gold_pro:     'Premium',
  gold:         'Gold',
  silver:       'Silver',
  bronze:       'Bronze',
  free:         'Gratuita',
};

const STATUS_LABELS: Record<string, string> = {
  active:           'Activa',
  paused:           'Pausada',
  closed:           'Finalizada',
  under_review:     'En revisión',
  payment_required: 'Pago pendiente',
  inactive:         'Inactiva',
};

// ─── Score Ring SVG ───────────────────────────────────────────────────────────

function ScoreRing({ score }: { score: number }) {
  const R = 44;
  const C = 2 * Math.PI * R;
  const offset = C * (1 - score / 100);
  const color =
    score >= 90 ? '#16A34A' :
    score >= 70 ? '#FACC15' :
    score >= 40 ? '#F97316' : '#EF4444';
  const textColor =
    score >= 90 ? 'text-[#16A34A]' :
    score >= 70 ? 'text-[#FACC15]' :
    score >= 40 ? 'text-[#F97316]' : 'text-[#EF4444]';

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width="120" height="120" viewBox="0 0 100 100" className="-rotate-90">
        <circle cx="50" cy="50" r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" />
        <circle
          cx="50" cy="50" r={R} fill="none"
          stroke={color} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(0.4,0,0.2,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn('text-4xl font-black tabular-nums leading-none', textColor)}>{score}</span>
        <span className="text-[11px] font-semibold text-white/40 mt-0.5">/ 100</span>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function MLFichaModal({
  itemId,
  productName,
  localPrice,
  onClose,
}: {
  itemId: string;
  productName: string;
  localPrice?: number;
  onClose: () => void;
}) {
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [item,      setItem]      = useState<MLItem | null>(null);
  const [desc,      setDesc]      = useState('');
  const [photoIdx,  setPhotoIdx]  = useState(0);
  const [showDesc,  setShowDesc]  = useState(false);
  const [showAttrs, setShowAttrs] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch(`/api/ml-item?id=${encodeURIComponent(itemId)}`);
      const data = await res.json() as { ok: boolean; item?: MLItem; description?: string; error?: string };
      if (!data.ok || !data.item) {
        setError(data.error ?? 'No se pudo cargar la publicación');
        return;
      }
      setItem(data.item);
      setDesc(data.description ?? '');
      setPhotoIdx(0);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const { score, checks } = item ? calcScore(item, desc) : { score: 0, checks: [] };
  const scoreLabel =
    score >= 90 ? 'Publicación excelente 🎉' :
    score >= 70 ? 'Buena publicación ↗' :
    score >= 40 ? 'Necesita mejoras ⚠' :
    'Publicación incompleta ✗';

  const criticalMissing = checks.filter(c => !c.ok && c.maxPts >= 10);
  const warnItems       = checks.filter(c => c.warn && !criticalMissing.includes(c));

  const photos     = item?.pictures ?? [];
  const mainPhoto  = photos.length > 0
    ? (photos[photoIdx]?.url ?? photos[0].url).replace(/-[A-Z]\.(jpg|png|webp)/i, '-D.$1')
    : null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-5"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      <div
        className="relative w-full max-w-[1100px] max-h-[calc(100vh-32px)] bg-white rounded-[24px] shadow-2xl flex flex-col overflow-hidden z-10"
        onClick={e => e.stopPropagation()}
      >

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-gray-100 shrink-0 bg-white">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 bg-[#FFE600] rounded-xl flex items-center justify-center shrink-0">
              <span className="text-[10px] font-black text-[#07111F]">ML</span>
            </div>
            <div className="min-w-0">
              <p className="text-[9px] font-black text-gray-400 uppercase tracking-[0.14em] mb-px">
                Ficha MercadoLibre · {itemId}
              </p>
              <p className="text-[13px] font-bold text-gray-900 line-clamp-1">
                {item?.title ?? productName}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={fetchData}
              title="Recargar datos de ML"
              className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
            </button>
            {item?.permalink && (
              <a
                href={item.permalink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold text-[#07111F] bg-[#FFE600] rounded-lg hover:opacity-80 transition-opacity"
              >
                <ExternalLink className="w-3 h-3" />
                Ver en ML
              </a>
            )}
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Body ────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto bg-[#F8F9FB]">

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center h-64 gap-3">
              <RefreshCw className="w-5 h-5 animate-spin text-[#FFE600]" />
              <p className="text-[13px] text-gray-500">Cargando publicación desde MercadoLibre…</p>
            </div>
          )}

          {/* Error */}
          {!loading && error && (
            <div className="flex flex-col items-center justify-center h-64 gap-3 p-6">
              <div className="w-12 h-12 bg-[#EF4444]/10 rounded-2xl flex items-center justify-center">
                <XCircle className="w-6 h-6 text-[#EF4444]" />
              </div>
              <p className="text-[13px] font-semibold text-gray-700 text-center">{error}</p>
              <p className="text-[11px] text-gray-400 text-center">
                Verificá que el ID de publicación sea correcto y que la publicación esté activa.
              </p>
              <button
                onClick={fetchData}
                className="px-5 py-2.5 bg-[#FFE600] text-[#07111F] text-[12px] font-bold rounded-xl hover:opacity-80 transition-opacity"
              >
                Reintentar
              </button>
            </div>
          )}

          {/* Content */}
          {!loading && item && (
            <div className="p-4 sm:p-5 space-y-4">

              {/* ── Grid: Photos + Score ─────────────────────────────── */}
              <div className="grid grid-cols-1 md:grid-cols-[1fr_320px] gap-4">

                {/* ── Left: Photos + Metrics ── */}
                <div className="space-y-3">

                  {/* Main photo */}
                  <div className="relative aspect-[4/3] bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
                    {mainPhoto ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={mainPhoto}
                        alt={item.title}
                        className="w-full h-full object-contain p-4"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                        <ImageIcon className="w-12 h-12 text-gray-300" />
                        <span className="text-[11px] text-gray-400">Sin fotos</span>
                      </div>
                    )}

                    {/* Photo counter */}
                    <div className="absolute bottom-3 right-3 px-2 py-1 bg-black/50 text-white text-[10px] font-bold rounded-md backdrop-blur-sm">
                      {photoIdx + 1} / {Math.max(photos.length, 1)}
                    </div>

                    {/* Status badge */}
                    <div className={cn(
                      'absolute top-3 left-3 px-2.5 py-1 rounded-full text-[10px] font-bold shadow-sm',
                      item.status === 'active'  ? 'bg-[#16A34A] text-white'  :
                      item.status === 'paused'  ? 'bg-[#F97316] text-white'  :
                      item.status === 'closed'  ? 'bg-gray-600 text-white'   :
                                                   'bg-gray-400 text-white',
                    )}>
                      {STATUS_LABELS[item.status] ?? item.status}
                    </div>
                  </div>

                  {/* Thumbnails */}
                  {photos.length > 1 ? (
                    <div className="flex gap-2 flex-wrap">
                      {photos.slice(0, 10).map((pic, i) => (
                        <button
                          key={pic.id}
                          onClick={() => setPhotoIdx(i)}
                          className={cn(
                            'w-14 h-14 rounded-xl border-2 overflow-hidden bg-white shrink-0 transition-all',
                            photoIdx === i
                              ? 'border-[#FFE600] shadow-md ring-2 ring-[#FFE600]/30 scale-105'
                              : 'border-gray-200 hover:border-gray-400',
                          )}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={pic.url.replace(/-[A-Z]\.(jpg|png|webp)/i, '-I.$1')}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        </button>
                      ))}
                      {photos.length > 10 && (
                        <div className="w-14 h-14 rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center shrink-0 bg-gray-50">
                          <span className="text-[9px] font-bold text-gray-400">+{photos.length - 10}</span>
                        </div>
                      )}
                    </div>
                  ) : photos.length === 0 && (
                    <div className="flex items-center gap-2 px-3 py-2.5 bg-[#EF4444]/8 border border-[#EF4444]/20 rounded-xl">
                      <AlertCircle className="w-4 h-4 text-[#EF4444] shrink-0" />
                      <p className="text-[11px] text-[#EF4444] font-semibold">
                        Sin fotos — agregá al menos 6 fotos de alta calidad (800×800px mínimo)
                      </p>
                    </div>
                  )}

                  {/* Metrics: price / sold / stock */}
                  <div className="grid grid-cols-3 gap-2.5">
                    {/* Price */}
                    <div className="bg-white rounded-xl px-3 py-3 border border-gray-200 shadow-sm text-center">
                      <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-1">Precio</p>
                      <p className="text-[15px] font-black text-gray-900 tabular-nums leading-none">
                        {fmtARS(item.price)}
                      </p>
                      {localPrice && localPrice > 1 && (
                        <p className={cn(
                          'text-[9px] font-semibold mt-1',
                          item.price >= localPrice ? 'text-[#16A34A]' : 'text-[#F97316]',
                        )}>
                          {item.price >= localPrice ? '↑' : '↓'} local {fmtARS(localPrice)}
                        </p>
                      )}
                    </div>

                    {/* Sold */}
                    <div className="bg-white rounded-xl px-3 py-3 border border-gray-200 shadow-sm text-center">
                      <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-1">Vendidos</p>
                      <p className="text-[15px] font-black text-[#16A34A] tabular-nums leading-none">
                        {item.sold_quantity.toLocaleString('es-AR')}
                      </p>
                      <p className="text-[9px] text-gray-400 mt-1">unidades</p>
                    </div>

                    {/* Available */}
                    <div className={cn(
                      'rounded-xl px-3 py-3 border shadow-sm text-center',
                      item.available_quantity === 0
                        ? 'bg-[#EF4444]/8 border-[#EF4444]/20'
                        : item.available_quantity <= 3
                        ? 'bg-[#F97316]/8 border-[#F97316]/20'
                        : 'bg-white border-gray-200',
                    )}>
                      <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-1">Stock</p>
                      <p className={cn(
                        'text-[15px] font-black tabular-nums leading-none',
                        item.available_quantity === 0 ? 'text-[#EF4444]' :
                        item.available_quantity <= 3  ? 'text-[#F97316]' : 'text-gray-900',
                      )}>
                        {item.available_quantity}
                      </p>
                      <p className="text-[9px] text-gray-400 mt-1">disponibles</p>
                    </div>
                  </div>

                  {/* Tags: listing type / condition / shipping / installments */}
                  <div className="flex flex-wrap gap-2">
                    <span className={cn(
                      'px-2.5 py-1.5 rounded-lg text-[11px] font-bold',
                      ['gold_special', 'gold_pro'].includes(item.listing_type_id)
                        ? 'bg-[#FFE600] text-[#07111F]'
                        : 'bg-gray-100 text-gray-600',
                    )}>
                      {LISTING_TYPE_LABELS[item.listing_type_id] ?? item.listing_type_id}
                    </span>

                    <span className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-gray-100 text-gray-600">
                      {item.condition === 'new' ? '🆕 Nuevo' : '🔄 Usado'}
                    </span>

                    <span className={cn(
                      'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold',
                      item.shipping.free_shipping
                        ? 'bg-[#16A34A]/10 text-[#16A34A] border border-[#16A34A]/20'
                        : 'bg-gray-100 text-gray-500 border border-gray-200',
                    )}>
                      <Truck className="w-3 h-3" />
                      {item.shipping.free_shipping ? 'Envío gratis' : 'Envío con cargo'}
                    </span>

                    {item.installments && item.installments.quantity > 1 && (
                      <span className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-[#0784F2]/10 text-[#0784F2] border border-[#0784F2]/20">
                        <CreditCard className="w-3 h-3" />
                        {item.installments.quantity}×{fmtARS(item.installments.amount)}
                        {item.installments.rate === 0 && (
                          <span className="text-[9px] bg-[#0784F2] text-white px-1 py-px rounded font-black ml-0.5">
                            sin interés
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                </div>

                {/* ── Right: Score + Checklist ── */}
                <div className="space-y-3">

                  {/* Score card */}
                  <div className="bg-[#07111F] rounded-2xl p-5 text-center shadow-lg">
                    <p className="text-[9px] font-black text-white/40 uppercase tracking-[0.14em] mb-4">
                      Completitud de publicación
                    </p>
                    <ScoreRing score={score} />
                    <p className={cn(
                      'text-[13px] font-bold mt-3',
                      score >= 90 ? 'text-[#16A34A]' :
                      score >= 70 ? 'text-[#FACC15]' :
                      score >= 40 ? 'text-[#F97316]' : 'text-[#EF4444]',
                    )}>
                      {scoreLabel}
                    </p>
                    <p className="text-[10px] text-white/30 mt-1">
                      {100 - score} puntos disponibles para crecer
                    </p>
                  </div>

                  {/* Checklist */}
                  <div className="space-y-1.5">
                    {checks.map(c => (
                      <div
                        key={c.key}
                        className={cn(
                          'flex items-center gap-2.5 px-3 py-2.5 rounded-xl border bg-white shadow-sm',
                          c.ok
                            ? 'border-[#16A34A]/20'
                            : c.warn
                            ? 'border-[#F97316]/20'
                            : 'border-[#EF4444]/20',
                        )}
                      >
                        {/* Icon */}
                        <div className="shrink-0">
                          {c.ok
                            ? <CheckCircle2 className="w-4 h-4 text-[#16A34A]" />
                            : c.warn
                            ? <AlertCircle  className="w-4 h-4 text-[#F97316]" />
                            : <XCircle      className="w-4 h-4 text-[#EF4444]" />}
                        </div>

                        {/* Labels */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1 mb-px">
                            <span className={cn(
                              'text-[11px] font-bold leading-none',
                              c.ok ? 'text-[#16A34A]' : c.warn ? 'text-[#F97316]' : 'text-[#EF4444]',
                            )}>
                              {c.label}
                            </span>
                            <span className={cn(
                              'text-[10px] font-black tabular-nums shrink-0',
                              c.ok ? 'text-[#16A34A]' : 'text-gray-400',
                            )}>
                              {c.pts}/{c.maxPts}
                            </span>
                          </div>
                          <p className={cn(
                            'text-[10px] leading-tight truncate',
                            c.ok ? 'text-[#16A34A]/60' : 'text-gray-400',
                          )}>
                            {c.value}
                          </p>
                        </div>

                        {/* Mini bar */}
                        <div className="w-10 h-1.5 bg-gray-100 rounded-full overflow-hidden shrink-0">
                          <div
                            className={cn(
                              'h-full rounded-full',
                              c.ok ? 'bg-[#16A34A]' : c.warn ? 'bg-[#F97316]' : 'bg-[#EF4444]',
                            )}
                            style={{ width: `${(c.pts / c.maxPts) * 100}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* ── "Mejorá ahora" dark panel ─────────────────────────── */}
              {(criticalMissing.length > 0 || warnItems.length > 0) && (
                <div className="bg-[#07111F] rounded-2xl p-5 shadow-lg">
                  <div className="flex items-center gap-2.5 mb-4">
                    <div className="w-7 h-7 bg-[#FFE600] rounded-xl flex items-center justify-center shrink-0">
                      <Star className="w-4 h-4 text-[#07111F]" />
                    </div>
                    <p className="text-[11px] font-black text-white uppercase tracking-wider">
                      Mejorá ahora — mayor impacto primero
                    </p>
                  </div>

                  <div className="space-y-3">
                    {[...criticalMissing, ...warnItems].map(c => (
                      <div key={c.key} className="flex items-start gap-3">
                        <div className={cn(
                          'w-2 h-2 rounded-full mt-1.5 shrink-0',
                          c.maxPts >= 15 ? 'bg-[#EF4444]' :
                          c.maxPts >= 10 ? 'bg-[#F97316]' : 'bg-[#FACC15]',
                        )} />
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-bold text-white leading-tight">{c.label}</p>
                          <p className="text-[11px] text-white/50 leading-relaxed mt-0.5">{c.tip}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <span className="text-[11px] font-black text-[#FFE600]">
                            +{c.maxPts - c.pts}
                          </span>
                          <span className="text-[9px] text-white/30 ml-0.5">pts</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Description accordion ─────────────────────────────── */}
              <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
                <button
                  onClick={() => setShowDesc(v => !v)}
                  className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-[11px] font-bold text-gray-700 uppercase tracking-wide">
                      Descripción
                    </span>
                    <span className={cn(
                      'text-[10px] font-semibold px-2 py-0.5 rounded-full',
                      desc.length >= 300 ? 'bg-[#16A34A]/10 text-[#16A34A]' :
                      desc.length >= 100 ? 'bg-[#F97316]/10 text-[#F97316]' :
                                           'bg-[#EF4444]/10 text-[#EF4444]',
                    )}>
                      {desc.length > 0 ? `${desc.length} caracteres` : 'Sin descripción'}
                    </span>
                  </div>
                  {showDesc
                    ? <ChevronUp   className="w-4 h-4 text-gray-400" />
                    : <ChevronDown className="w-4 h-4 text-gray-400" />}
                </button>

                {showDesc && (
                  <div className="px-4 pb-4 border-t border-gray-100">
                    {desc ? (
                      <p className="text-[12px] text-gray-600 leading-relaxed whitespace-pre-wrap pt-3">
                        {desc.slice(0, 2000)}{desc.length > 2000 && '…'}
                      </p>
                    ) : (
                      <p className="text-[12px] text-gray-400 italic pt-3">
                        Sin descripción. Agregá una descripción de 300+ caracteres para mejorar el posicionamiento
                        en las búsquedas de ML.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* ── Attributes accordion ──────────────────────────────── */}
              {item.attributes && item.attributes.length > 0 && (
                <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
                  <button
                    onClick={() => setShowAttrs(v => !v)}
                    className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="text-[11px] font-bold text-gray-700 uppercase tracking-wide">
                        Especificaciones técnicas
                      </span>
                      <span className={cn(
                        'text-[10px] font-semibold',
                        filledAttrsCount(item) >= 5 ? 'text-[#16A34A]' : 'text-[#F97316]',
                      )}>
                        {filledAttrsCount(item)}/{item.attributes.length} completas
                      </span>
                    </div>
                    {showAttrs
                      ? <ChevronUp   className="w-4 h-4 text-gray-400" />
                      : <ChevronDown className="w-4 h-4 text-gray-400" />}
                  </button>

                  {showAttrs && (
                    <div className="px-4 pb-4 border-t border-gray-100 pt-3">
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {item.attributes.map(attr => (
                          <div key={attr.id} className={cn(
                            'px-3 py-2.5 rounded-xl border',
                            attr.value_name
                              ? 'bg-gray-50 border-gray-100'
                              : 'bg-[#EF4444]/5 border-[#EF4444]/15',
                          )}>
                            <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5 truncate">
                              {attr.name}
                            </p>
                            <p className={cn(
                              'text-[11px] font-semibold truncate',
                              attr.value_name ? 'text-gray-800' : 'text-[#EF4444]/60 italic',
                            )}>
                              {attr.value_name ?? 'Sin completar'}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Helper (outside component to avoid re-creation)
function filledAttrsCount(item: MLItem) {
  return item.attributes?.filter(a => a.value_name).length ?? 0;
}
