'use client';

import { useState, useCallback, useMemo } from 'react';
import productsData from '@/data/products.json';
import { cn } from '@/lib/utils';
import {
  ShoppingCart, Search, Calculator, TrendingUp, TrendingDown,
  Package, Truck, CreditCard, ExternalLink, AlertTriangle,
  CheckCircle2, Info, ChevronRight, DollarSign, Percent,
  BarChart3, Star, RefreshCw, Zap,
} from 'lucide-react';

// ─── Tipos ────────────────────────────────────────────────────────────────────
interface Product {
  id: string; sku: string | null; name: string;
  cost: number; price: number; margin: number | null;
  supplierName: string | null; odooId: number | null;
  category: string | null;
}

interface MLItem {
  id: string; title: string; price: number;
  condition: string; permalink: string; thumbnail: string | null;
  freeShipping: boolean; logisticType: string | null;
  soldQty: number; stock: number;
  installments: { qty: number; amount: number; rate: number } | null;
  seller: string | null;
}

interface MarketData {
  minPrice: number; maxPrice: number; avgPrice: number; medPrice: number;
  freeShipPct: number; installmentsPct: number;
}

// ─── Productos del sistema ─────────────────────────────────────────────────────
const systemProducts = productsData as unknown as Product[];

// ─── Cuotas opciones ──────────────────────────────────────────────────────────
const CUOTAS_OPTIONS = [
  { label: 'Sin cuotas (solo interés bancos)', pct: 0,    key: 'none' },
  { label: '3-12 cuotas con interés bajo (+5%)', pct: 5,  key: 'low' },
  { label: '3 cuotas sin interés (+8.8%)',  pct: 8.8,    key: 'c3' },
  { label: '6 cuotas sin interés (+12.7%)', pct: 12.7,   key: 'c6' },
  { label: '9 cuotas sin interés (+15.9%)', pct: 15.9,   key: 'c9' },
  { label: '12 cuotas sin interés (+19.3%)',pct: 19.3,   key: 'c12' },
] as const;

type CuotaKey = typeof CUOTAS_OPTIONS[number]['key'];

// ─── Unit cost por banda de precio (Envíos Flex / Correo) ─────────────────────
function unitCostForPrice(price: number): number {
  if (price >= 33000) return 0;
  if (price >= 24000) return 3030;
  if (price >= 16000) return 2500;
  return 1255;
}

// ─── Calculadora ML ───────────────────────────────────────────────────────────
interface MLCalcParams {
  costo:         number;   // costo del producto
  targetMargin:  number;   // margen deseado (0-100%)
  commission:    number;   // % comisión ML (11.62 - 17.75)
  cuotasPct:     number;   // % costo cuotas
  includeUnitCost: boolean;// aplicar costo por unidad (<$33k)
  iibb:          number;   // % ingresos brutos
  isRI:          boolean;  // Responsable Inscripto (descuenta IVA del ingreso)
}

interface MLCalcResult {
  precioPublicado:  number;
  comisionML:       number;
  costosCuotas:     number;
  costoUnitario:    number;
  depositoML:       number;
  ivaDescontado:    number;
  ingresoBrutoSinIva: number;
  iibbCosto:        number;
  ingresoNeto:      number;
  utilidad:         number;
  margenEfectivo:   number;
  markupSobrecosto: number;
  // Para Odoo:
  precioSinIva:     number; // lo que va a Lista Markup
  precioConIva:     number; // lo que va a Lista ML (= precioPublicado redondeado)
}

function calcML(params: MLCalcParams): MLCalcResult | null {
  const { costo, targetMargin, commission, cuotasPct, includeUnitCost, iibb, isRI } = params;
  if (costo <= 0) return null;

  // Iteramos porque unitCost depende del precio (que aún no conocemos)
  let precio = costo * 3; // seed inicial
  for (let iter = 0; iter < 15; iter++) {
    const uc = includeUnitCost ? unitCostForPrice(precio) : 0;
    // Queremos: ingresoNeto = costo / (1 - targetMargin/100)
    const ingresoNetoTarget = costo / (1 - targetMargin / 100);
    // ingresoNeto = ingresoBrutoSinIva × (1 - iibb/100)
    const ingresoBrutoSinIvaTarget = ingresoNetoTarget / (1 - iibb / 100);
    // ingresoBrutoSinIva = deposito / 1.21  (si RI)  o  deposito  (si mono)
    const depositoTarget = isRI
      ? ingresoBrutoSinIvaTarget * 1.21
      : ingresoBrutoSinIvaTarget;
    // deposito = precio × (1 - comm - cuotas) - unitCost
    const newPrecio = (depositoTarget + uc) / (1 - commission / 100 - cuotasPct / 100);
    if (Math.abs(newPrecio - precio) < 1) break;
    precio = newPrecio;
  }

  // Redondear a múltiplo de $10
  precio = Math.ceil(precio / 10) * 10;

  const uc        = includeUnitCost ? unitCostForPrice(precio) : 0;
  const comisionML  = precio * (commission / 100);
  const costosCuotas = precio * (cuotasPct / 100);
  const depositoML   = precio - comisionML - costosCuotas - uc;
  const ivaDesc      = isRI ? depositoML - depositoML / 1.21 : 0;
  const ingBrutoSinIva = isRI ? depositoML / 1.21 : depositoML;
  const iibbCosto    = ingBrutoSinIva * (iibb / 100);
  const ingresoNeto  = ingBrutoSinIva - iibbCosto;
  const utilidad     = ingresoNeto - costo;
  const margenEfectivo = ingresoNeto > 0 ? (utilidad / ingresoNeto) * 100 : 0;
  const markupSobrecosto = costo > 0 ? (utilidad / costo) * 100 : 0;

  // Para Odoo: Lista Markup = precioSinIva, Lista ML = precioSinIva × 1.21
  // precio publicado ya tiene IVA incluido (es el precio final del consumidor)
  const precioSinIva = precio / 1.21;

  return {
    precioPublicado: precio,
    comisionML, costosCuotas, costoUnitario: uc,
    depositoML, ivaDescontado: ivaDesc,
    ingresoBrutoSinIva: ingBrutoSinIva,
    iibbCosto, ingresoNeto,
    utilidad, margenEfectivo, markupSobrecosto,
    precioSinIva,
    precioConIva: precio,
  };
}

// ─── Helpers UI ───────────────────────────────────────────────────────────────
function ars(n: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
}

function pct(n: number) {
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

function MarginBadge({ value }: { value: number }) {
  const color = value >= 30 ? 'bg-success/10 text-success' :
                value >= 20 ? 'bg-warning/10 text-warning' : 'bg-danger/10 text-danger';
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold', color)}>
      {value.toFixed(1)}%
    </span>
  );
}

// ─── ML Market card ───────────────────────────────────────────────────────────
function MLCard({ item, myPrice }: { item: MLItem; myPrice: number }) {
  const diff = myPrice > 0 ? ((item.price - myPrice) / myPrice) * 100 : 0;
  return (
    <a href={item.permalink} target="_blank" rel="noopener noreferrer"
      className="flex items-start gap-3 p-3 rounded-xl border border-gray-100 hover:border-meli-blue/30 hover:shadow-sm transition-all group bg-white">
      {/* Thumbnail */}
      <div className="w-14 h-14 rounded-lg bg-gray-100 border border-gray-200 overflow-hidden shrink-0">
        {item.thumbnail
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={item.thumbnail} alt={item.title} className="w-full h-full object-contain" />
          : <Package className="w-6 h-6 text-gray-400 m-auto mt-3" />}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-semibold text-gray-900 leading-tight line-clamp-2 mb-1.5">{item.title}</p>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-base font-black text-gray-900">{ars(item.price)}</span>
          {myPrice > 0 && (
            <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded',
              diff > 5 ? 'bg-success/10 text-success' :
              diff < -5 ? 'bg-danger/10 text-danger' : 'bg-gray-100 text-gray-500'
            )}>
              {diff > 0 ? '▲' : '▼'} {Math.abs(diff).toFixed(0)}% vs tuyo
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          {item.freeShipping && (
            <span className="flex items-center gap-0.5 text-[10px] text-success font-semibold">
              <Truck className="w-3 h-3" /> Envío gratis
            </span>
          )}
          {item.installments && item.installments.rate === 0 && (
            <span className="flex items-center gap-0.5 text-[10px] text-meli-blue font-semibold">
              <CreditCard className="w-3 h-3" /> {item.installments.qty}x sin interés
            </span>
          )}
          {item.soldQty > 0 && (
            <span className="text-[10px] text-gray-400">{item.soldQty} vendidos</span>
          )}
        </div>
        {item.seller && (
          <p className="text-[10px] text-gray-400 mt-0.5">{item.seller}</p>
        )}
      </div>
      <ExternalLink className="w-3.5 h-3.5 text-gray-300 group-hover:text-meli-blue mt-0.5 shrink-0 transition-colors" />
    </a>
  );
}

// ─── Breakdown row ────────────────────────────────────────────────────────────
function BreakdownRow({
  label, value, sub, highlight, positive, negative, indent,
}: {
  label: string; value: string; sub?: string;
  highlight?: boolean; positive?: boolean; negative?: boolean; indent?: boolean;
}) {
  return (
    <div className={cn(
      'flex items-center justify-between py-2.5 border-b border-gray-100 last:border-0',
      highlight && 'bg-gray-50 -mx-4 px-4 rounded-lg',
      indent && 'pl-4',
    )}>
      <div className="flex items-center gap-2">
        {indent && <span className="w-1 h-1 rounded-full bg-gray-400 mt-0.5" />}
        <span className={cn('text-[12px]', highlight ? 'font-bold text-gray-900' : 'text-gray-600')}>
          {label}
        </span>
        {sub && <span className="text-[10px] text-gray-400">({sub})</span>}
      </div>
      <span className={cn(
        'text-[13px] font-bold tabular-nums',
        positive ? 'text-success' : negative ? 'text-danger' : highlight ? 'text-gray-900' : 'text-gray-700',
      )}>
        {value}
      </span>
    </div>
  );
}

// ─── PAGE ─────────────────────────────────────────────────────────────────────
export default function MLLabPage() {
  // ── Product selection
  const [productSearch, setProductSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [manualCosto, setManualCosto] = useState('');
  const [manualNombre, setManualNombre] = useState('');

  // ── ML params
  const [commission,    setCommission]    = useState(14);
  const [cuotaKey,      setCuotaKey]      = useState<CuotaKey>('none');
  const [includeUnitCost, setIncludeUnitCost] = useState(true);
  const [iibb,          setIibb]          = useState(3.5);
  const [isRI,          setIsRI]          = useState(true);
  const [targetMargin,  setTargetMargin]  = useState(30);

  // ── Market search
  const [marketQuery,   setMarketQuery]   = useState('');
  const [marketItems,   setMarketItems]   = useState<MLItem[]>([]);
  const [marketData,    setMarketData]    = useState<MarketData | null>(null);
  const [searching,     setSearching]     = useState(false);
  const [searchError,   setSearchError]   = useState<string | null>(null);

  // ── Derived
  const cuotaOption = CUOTAS_OPTIONS.find(o => o.key === cuotaKey) ?? CUOTAS_OPTIONS[0];

  const costo = useMemo(() => {
    if (selectedProduct) return selectedProduct.cost;
    const n = parseFloat(manualCosto);
    return isNaN(n) ? 0 : n;
  }, [selectedProduct, manualCosto]);

  const calc = useMemo<MLCalcResult | null>(() => {
    if (costo <= 0) return null;
    return calcML({ costo, targetMargin, commission, cuotasPct: cuotaOption.pct, includeUnitCost, iibb, isRI });
  }, [costo, targetMargin, commission, cuotaOption, includeUnitCost, iibb, isRI]);

  // Product search suggestions
  const suggestions = useMemo(() => {
    if (!productSearch || productSearch.length < 2 || selectedProduct) return [];
    const q = productSearch.toLowerCase();
    return systemProducts.filter(p =>
      p.cost > 0 && (
        p.name.toLowerCase().includes(q) ||
        (p.sku ?? '').toLowerCase().includes(q)
      )
    ).slice(0, 8);
  }, [productSearch, selectedProduct]);

  // ML market search
  const searchMarket = useCallback(async () => {
    const q = marketQuery.trim() || selectedProduct?.name || manualNombre;
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    try {
      const res  = await fetch(`/api/ml-search?q=${encodeURIComponent(q)}&limit=8`);
      const data = await res.json() as {
        ok: boolean; error?: string;
        items?: MLItem[]; market?: MarketData; total?: number;
      };
      if (!data.ok) throw new Error(data.error ?? 'Error desconocido');
      setMarketItems(data.items ?? []);
      setMarketData(data.market ?? null);
      if (!marketQuery && (selectedProduct?.name || manualNombre)) {
        setMarketQuery(selectedProduct?.name ?? manualNombre);
      }
    } catch (e) {
      setSearchError(String(e));
    } finally {
      setSearching(false);
    }
  }, [marketQuery, selectedProduct, manualNombre]);

  // Market position badge
  const marketPosition = useMemo(() => {
    if (!calc || !marketData || marketData.avgPrice === 0) return null;
    const diff = ((calc.precioPublicado - marketData.avgPrice) / marketData.avgPrice) * 100;
    if (diff < -10) return { label: 'Muy por debajo del mercado', color: 'text-success', icon: TrendingDown };
    if (diff < -3)  return { label: 'Por debajo del mercado',     color: 'text-success', icon: TrendingDown };
    if (diff < 3)   return { label: 'En línea con el mercado',    color: 'text-meli-blue',icon: BarChart3 };
    if (diff < 10)  return { label: 'Algo por encima del mercado',color: 'text-warning',  icon: TrendingUp };
    return             { label: 'Muy por encima del mercado',     color: 'text-danger',   icon: TrendingUp };
  }, [calc, marketData]);

  // Advisor recommendation
  const recommendation = useMemo(() => {
    if (!calc || !marketData) return null;
    const tips: { type: 'ok' | 'warn' | 'info'; text: string }[] = [];

    if (calc.margenEfectivo >= 30) {
      tips.push({ type: 'ok', text: `Margen ${calc.margenEfectivo.toFixed(1)}% — objetivo alcanzado con este precio.` });
    } else {
      tips.push({ type: 'warn', text: `Margen ${calc.margenEfectivo.toFixed(1)}% — debajo del 30% objetivo. Subí el precio o bajá los costos.` });
    }

    if (marketData.freeShipPct >= 70) {
      tips.push({ type: 'info', text: `${marketData.freeShipPct}% de los competidores ofrece envío gratis — fundamental incluirlo en tu precio.` });
    }
    if (marketData.installmentsPct >= 50) {
      tips.push({ type: 'info', text: `${marketData.installmentsPct}% de los competidores ofrece cuotas sin interés — ofrecerlas aumenta conversión.` });
    }
    if (calc.costoUnitario > 0) {
      tips.push({ type: 'warn', text: `Tu precio (${ars(calc.precioPublicado)}) < $33.000 — ML cobra costo fijo de ${ars(calc.costoUnitario)} por unidad. Considerá superar ese umbral.` });
    }
    if (marketData.medPrice > 0 && calc.precioPublicado > marketData.maxPrice) {
      tips.push({ type: 'warn', text: `Estás por encima del precio más alto del mercado (${ars(marketData.maxPrice)}). Revisá si el margen justifica el riesgo de no vender.` });
    }

    return tips;
  }, [calc, marketData]);

  return (
    <div className="min-h-screen bg-[#EBEBEB]">
    <div className="max-w-[1680px] mx-auto">

      {/* ── HEADER ML ─────────────────────────────────────────── */}
      <div className="bg-meli px-4 lg:px-8 py-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
            <ShoppingCart className="w-6 h-6 text-meli-dark" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-meli-dark tracking-tight">MercadoLibre Lab</h1>
            <p className="text-sm text-meli-dark/70">
              Calculá el precio ideal · Analizá el mercado · Vendé con margen real
            </p>
          </div>
        </div>
      </div>

      <div className="px-4 lg:px-8 py-6">
        <div className="flex flex-col xl:flex-row gap-6">

          {/* ═══════════════════════════════════════════════════════════ */}
          {/* LEFT — Configurador + Calculadora                          */}
          {/* ═══════════════════════════════════════════════════════════ */}
          <div className="xl:w-[440px] shrink-0 space-y-4">

            {/* ── 1. PRODUCTO ── */}
            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <h2 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
                <Package className="w-4 h-4 text-meli-blue" />
                Producto
              </h2>

              {/* Buscador del sistema */}
              {systemProducts.length > 0 ? (
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={selectedProduct ? selectedProduct.name : productSearch}
                    onChange={e => {
                      setProductSearch(e.target.value);
                      setSelectedProduct(null);
                    }}
                    placeholder="Buscar producto del sistema…"
                    className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-meli-blue/30 focus:border-meli-blue"
                  />
                  {selectedProduct && (
                    <button
                      onClick={() => { setSelectedProduct(null); setProductSearch(''); }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
                    >✕</button>
                  )}
                  {suggestions.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-20 overflow-hidden">
                      {suggestions.map(p => (
                        <button key={p.id}
                          onClick={() => { setSelectedProduct(p); setProductSearch(''); setMarketQuery(p.name); }}
                          className="w-full text-left px-4 py-2.5 hover:bg-gray-50 transition-colors"
                        >
                          <div className="text-[12px] font-semibold text-gray-900 truncate">{p.name}</div>
                          <div className="text-[11px] text-gray-400 flex items-center gap-2 mt-0.5">
                            <span>{p.sku ?? '—'}</span>
                            <span>·</span>
                            <span className="text-danger font-semibold">{ars(p.cost)} costo</span>
                            {p.margin && <><span>·</span><span>{p.margin.toFixed(0)}% margen</span></>}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}

              {/* Entrada manual */}
              {!selectedProduct && (
                <div className="space-y-2">
                  <div>
                    <label className="block text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-1">
                      Nombre del producto
                    </label>
                    <input type="text" value={manualNombre}
                      onChange={e => setManualNombre(e.target.value)}
                      placeholder="Ej: Cloro Triple Acción 5kg"
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-meli-blue/30"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-1">
                      Costo del producto ($)
                    </label>
                    <input type="number" value={manualCosto}
                      onChange={e => setManualCosto(e.target.value)}
                      placeholder="0"
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-meli-blue/30"
                    />
                  </div>
                </div>
              )}

              {/* Producto seleccionado */}
              {selectedProduct && (
                <div className="bg-meli/5 border border-meli/20 rounded-xl px-4 py-3">
                  <div className="text-[12px] font-bold text-gray-900 truncate">{selectedProduct.name}</div>
                  <div className="flex items-center gap-3 mt-1 text-[11px] text-gray-500">
                    <span className="font-bold text-danger">{ars(selectedProduct.cost)} costo</span>
                    {selectedProduct.price > 0 && <><span>·</span><span>{ars(selectedProduct.price)} Lista A</span></>}
                    {selectedProduct.margin && <><span>·</span><span>{selectedProduct.margin.toFixed(0)}% margen actual</span></>}
                  </div>
                </div>
              )}
            </div>

            {/* ── 2. CONFIGURACIÓN ML ── */}
            <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
              <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <Calculator className="w-4 h-4 text-meli-blue" />
                Configuración ML
              </h2>

              {/* Comisión */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">
                    Comisión ML por venta
                  </label>
                  <span className="text-[13px] font-black text-gray-900">{commission}%</span>
                </div>
                <input type="range" min={11.62} max={17.75} step={0.25}
                  value={commission} onChange={e => setCommission(Number(e.target.value))}
                  className="w-full accent-meli-blue"
                />
                <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
                  <span>11.62% (min)</span>
                  <span className="text-meli-blue text-[10px]">Varía por categoría</span>
                  <span>17.75% (max)</span>
                </div>
              </div>

              {/* Cuotas */}
              <div>
                <label className="block text-[11px] font-semibold text-gray-600 uppercase tracking-wide mb-2">
                  Cuotas a ofrecer
                </label>
                <div className="space-y-1.5">
                  {CUOTAS_OPTIONS.map(opt => (
                    <button key={opt.key}
                      onClick={() => setCuotaKey(opt.key)}
                      className={cn(
                        'w-full flex items-center justify-between px-3 py-2 rounded-lg border text-[12px] transition-all text-left',
                        cuotaKey === opt.key
                          ? 'border-meli-blue bg-meli-blue/5 text-meli-blue font-semibold'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300',
                      )}
                    >
                      <span>{opt.label}</span>
                      {opt.pct > 0 && (
                        <span className={cn('text-[10px] font-bold ml-2 shrink-0',
                          cuotaKey === opt.key ? 'text-meli-blue' : 'text-danger')}>
                          -{opt.pct}%
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Costo unitario */}
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[12px] font-semibold text-gray-700">Costo fijo por unidad</div>
                  <div className="text-[10px] text-gray-400">Aplica si precio &lt; $33.000 (envíos Flex/Correo)</div>
                </div>
                <button
                  onClick={() => setIncludeUnitCost(!includeUnitCost)}
                  className={cn(
                    'w-10 h-5 rounded-full transition-colors shrink-0',
                    includeUnitCost ? 'bg-meli-blue' : 'bg-gray-300',
                  )}
                >
                  <div className={cn('w-4 h-4 bg-white rounded-full shadow transition-transform mx-0.5',
                    includeUnitCost ? 'translate-x-5' : 'translate-x-0')} />
                </button>
              </div>

              {/* IIBB */}
              <div className="flex items-center justify-between">
                <label className="text-[12px] font-semibold text-gray-700">IIBB %</label>
                <div className="flex items-center gap-2">
                  <input type="number" value={iibb} onChange={e => setIibb(Number(e.target.value))}
                    min={0} max={10} step={0.5}
                    className="w-16 text-center px-2 py-1.5 border border-gray-200 rounded-lg text-[13px] font-bold focus:outline-none focus:ring-2 focus:ring-meli-blue/30"
                  />
                  <span className="text-[12px] text-gray-500">%</span>
                </div>
              </div>

              {/* Condición fiscal */}
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[12px] font-semibold text-gray-700">Condición fiscal</div>
                  <div className="text-[10px] text-gray-400">Afecta cómo se descuenta IVA</div>
                </div>
                <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
                  <button onClick={() => setIsRI(true)}
                    className={cn('px-3 py-1.5 rounded-md text-[11px] font-semibold transition-colors',
                      isRI ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500')}>
                    RI
                  </button>
                  <button onClick={() => setIsRI(false)}
                    className={cn('px-3 py-1.5 rounded-md text-[11px] font-semibold transition-colors',
                      !isRI ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500')}>
                    Mono
                  </button>
                </div>
              </div>

              {/* Margen objetivo */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">
                    Margen objetivo
                  </label>
                  <span className={cn('text-[14px] font-black',
                    targetMargin >= 30 ? 'text-success' : targetMargin >= 20 ? 'text-warning' : 'text-danger')}>
                    {targetMargin}%
                  </span>
                </div>
                <input type="range" min={10} max={60} step={1}
                  value={targetMargin} onChange={e => setTargetMargin(Number(e.target.value))}
                  className="w-full accent-meli-blue"
                />
                <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
                  <span>10%</span>
                  <span className="text-success">30% recomendado</span>
                  <span>60%</span>
                </div>
              </div>
            </div>

            {/* ── 3. RESULTADO ── */}
            {calc ? (
              <div className="bg-white rounded-2xl border border-gray-200 p-5">
                <h2 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-meli-blue" />
                  Resultado
                </h2>

                {/* Precio sugerido — HERO */}
                <div className={cn(
                  'text-center py-4 mb-4 rounded-xl',
                  calc.margenEfectivo >= 30 ? 'bg-success/5 border border-success/20' : 'bg-warning/5 border border-warning/20'
                )}>
                  <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    Precio a publicar en ML
                  </p>
                  <p className="text-3xl font-black text-gray-900 tracking-tight">
                    {ars(calc.precioPublicado)}
                  </p>
                  <div className="flex items-center justify-center gap-3 mt-2">
                    <MarginBadge value={calc.margenEfectivo} />
                    <span className="text-[11px] text-gray-500">margen neto</span>
                    <span className="text-[11px] text-gray-400">·</span>
                    <span className="text-[11px] text-gray-500">{pct(calc.markupSobrecosto)} markup</span>
                  </div>
                </div>

                {/* Breakdown */}
                <div className="space-y-0 -mx-4 px-4">
                  <BreakdownRow
                    label="Precio publicado (con IVA)" value={ars(calc.precioPublicado)} highlight
                  />
                  <BreakdownRow
                    label="Comisión ML" value={`-${ars(calc.comisionML)}`}
                    sub={`${commission}%`} negative indent
                  />
                  {cuotaOption.pct > 0 && (
                    <BreakdownRow
                      label="Cuotas" value={`-${ars(calc.costosCuotas)}`}
                      sub={`${cuotaOption.pct}%`} negative indent
                    />
                  )}
                  {calc.costoUnitario > 0 && (
                    <BreakdownRow
                      label="Costo por unidad" value={`-${ars(calc.costoUnitario)}`}
                      sub="precio < $33k" negative indent
                    />
                  )}
                  <BreakdownRow
                    label="Lo que deposita ML" value={ars(calc.depositoML)} highlight
                  />
                  {isRI && (
                    <BreakdownRow
                      label="IVA incluido" value={`-${ars(calc.ivaDescontado)}`}
                      sub="21% / 1.21" negative indent
                    />
                  )}
                  {iibb > 0 && (
                    <BreakdownRow
                      label="IIBB" value={`-${ars(calc.iibbCosto)}`}
                      sub={`${iibb}%`} negative indent
                    />
                  )}
                  <BreakdownRow
                    label="Ingreso neto (sin IVA)" value={ars(calc.ingresoNeto)} highlight
                  />
                  <BreakdownRow
                    label="Costo del producto" value={`-${ars(costo)}`} negative indent
                  />
                  <BreakdownRow
                    label="Utilidad" value={ars(calc.utilidad)}
                    positive={calc.utilidad > 0} negative={calc.utilidad <= 0}
                    highlight
                  />
                </div>

                {/* Para Odoo */}
                <div className="mt-4 p-3 bg-odoo/5 border border-odoo/20 rounded-xl">
                  <p className="text-[10px] font-bold text-odoo uppercase tracking-wide mb-2">Para Odoo</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="text-center">
                      <div className="text-[10px] text-gray-400 mb-0.5">Lista Markup (sin IVA)</div>
                      <div className="text-[14px] font-black text-gray-900">{ars(calc.precioSinIva)}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-[10px] text-gray-400 mb-0.5">Lista ML (+21% IVA)</div>
                      <div className="text-[14px] font-black text-meli-blue">{ars(calc.precioConIva)}</div>
                    </div>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-2 text-center">
                    Lista ML = Lista Markup × 1.21 → precio final al consumidor
                  </p>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center">
                <Calculator className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                <p className="text-sm font-semibold text-gray-500">Ingresá un costo para calcular el precio</p>
                <p className="text-xs text-gray-400 mt-1">Buscá un producto del sistema o ingresá el costo manualmente</p>
              </div>
            )}
          </div>

          {/* ═══════════════════════════════════════════════════════════ */}
          {/* RIGHT — Mercado + Asesor                                   */}
          {/* ═══════════════════════════════════════════════════════════ */}
          <div className="flex-1 min-w-0 space-y-4">

            {/* ── BÚSQUEDA DE MERCADO ── */}
            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <h2 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-meli-blue" />
                Referencia de mercado
                <span className="ml-auto text-[10px] text-gray-400 font-normal">
                  Datos en tiempo real de MercadoLibre
                </span>
              </h2>

              {/* Search bar */}
              <div className="flex gap-2 mb-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={marketQuery}
                    onChange={e => setMarketQuery(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && searchMarket()}
                    placeholder={selectedProduct?.name ?? manualNombre ?? 'Buscar en MercadoLibre…'}
                    className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-meli-blue/30 focus:border-meli-blue"
                  />
                </div>
                <button
                  onClick={searchMarket}
                  disabled={searching}
                  className="flex items-center gap-2 px-4 py-2.5 bg-meli text-meli-dark font-bold text-[13px] rounded-xl hover:brightness-95 transition-all disabled:opacity-60 shrink-0"
                >
                  {searching ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  {searching ? 'Buscando…' : 'Buscar'}
                </button>
              </div>

              {searchError && (
                <div className="flex items-center gap-2 p-3 bg-danger/5 border border-danger/20 rounded-xl text-sm text-danger mb-3">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {searchError}
                </div>
              )}

              {/* Stats de mercado */}
              {marketData && marketData.avgPrice > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                  <div className="bg-gray-50 rounded-xl p-3 text-center">
                    <div className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">Mínimo</div>
                    <div className="text-base font-black text-gray-900 mt-0.5">{ars(marketData.minPrice)}</div>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-3 text-center">
                    <div className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">Mediana</div>
                    <div className="text-base font-black text-meli-blue mt-0.5">{ars(marketData.medPrice)}</div>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-3 text-center">
                    <div className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">Promedio</div>
                    <div className="text-base font-black text-gray-900 mt-0.5">{ars(marketData.avgPrice)}</div>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-3 text-center">
                    <div className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">Máximo</div>
                    <div className="text-base font-black text-gray-900 mt-0.5">{ars(marketData.maxPrice)}</div>
                  </div>
                </div>
              )}

              {/* Benchmark bar */}
              {marketData && calc && marketData.maxPrice > 0 && (
                <div className="mb-4 p-3 bg-gray-50 rounded-xl">
                  <div className="flex items-center justify-between mb-2 text-[11px] font-semibold text-gray-600">
                    <span>Rango de precios del mercado</span>
                    {marketPosition && (
                      <span className={cn('flex items-center gap-1', marketPosition.color)}>
                        <marketPosition.icon className="w-3 h-3" />
                        {marketPosition.label}
                      </span>
                    )}
                  </div>
                  {/* Bar */}
                  <div className="relative h-3 bg-gray-200 rounded-full overflow-visible">
                    <div className="absolute inset-0 bg-gradient-to-r from-success via-meli-blue to-danger rounded-full opacity-30" />
                    {/* Tu precio */}
                    {calc && (() => {
                      const range = marketData.maxPrice - marketData.minPrice;
                      const pos = range > 0
                        ? Math.min(100, Math.max(0, ((calc.precioPublicado - marketData.minPrice) / range) * 100))
                        : 50;
                      return (
                        <div
                          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 bg-meli-dark border-2 border-white rounded-full shadow-md z-10 transition-all"
                          style={{ left: `${pos}%` }}
                          title={`Tu precio: ${ars(calc.precioPublicado)}`}
                        />
                      );
                    })()}
                  </div>
                  <div className="flex justify-between mt-1 text-[10px] text-gray-400">
                    <span>{ars(marketData.minPrice)}</span>
                    <span className="font-bold text-meli-dark">▲ Tu precio: {ars(calc.precioPublicado)}</span>
                    <span>{ars(marketData.maxPrice)}</span>
                  </div>
                </div>
              )}

              {/* Condiciones del mercado */}
              {marketData && marketItems.length > 0 && (
                <div className="flex items-center gap-4 mb-4 flex-wrap">
                  <div className="flex items-center gap-1.5 text-[12px]">
                    <Truck className={cn('w-4 h-4', marketData.freeShipPct >= 50 ? 'text-success' : 'text-gray-400')} />
                    <span className="font-semibold text-gray-700">{marketData.freeShipPct}%</span>
                    <span className="text-gray-500">con envío gratis</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[12px]">
                    <CreditCard className={cn('w-4 h-4', marketData.installmentsPct >= 50 ? 'text-meli-blue' : 'text-gray-400')} />
                    <span className="font-semibold text-gray-700">{marketData.installmentsPct}%</span>
                    <span className="text-gray-500">con cuotas sin interés</span>
                  </div>
                </div>
              )}

              {/* Listados */}
              {marketItems.length > 0 ? (
                <div className="space-y-2">
                  {marketItems.map(item => (
                    <MLCard key={item.id} item={item} myPrice={calc?.precioPublicado ?? 0} />
                  ))}
                </div>
              ) : !searching && (
                <div className="text-center py-10 text-gray-400">
                  <Search className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm font-semibold">Buscá un producto para ver precios reales del mercado</p>
                  <p className="text-xs mt-1">Se consulta la API pública de MercadoLibre en tiempo real</p>
                </div>
              )}
            </div>

            {/* ── ASESOR / RECOMENDACIONES ── */}
            {recommendation && recommendation.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-200 p-5">
                <h2 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-meli-blue" />
                  Asesor ML
                </h2>
                <div className="space-y-2">
                  {recommendation.map((tip, i) => (
                    <div key={i} className={cn(
                      'flex items-start gap-3 px-4 py-3 rounded-xl text-[12px]',
                      tip.type === 'ok'   ? 'bg-success/5 border border-success/20' :
                      tip.type === 'warn' ? 'bg-warning/5 border border-warning/20' :
                      'bg-acqua/5 border border-acqua/20',
                    )}>
                      {tip.type === 'ok'   ? <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" /> :
                       tip.type === 'warn' ? <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" /> :
                       <Info className="w-4 h-4 text-acqua shrink-0 mt-0.5" />}
                      <span className={
                        tip.type === 'ok' ? 'text-success' :
                        tip.type === 'warn' ? 'text-warning' : 'text-acqua'
                      }>{tip.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── INFO: Cómo se estructura el precio en Odoo ── */}
            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <h2 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
                <Info className="w-4 h-4 text-gray-400" />
                Estructura de precios ML en Odoo
              </h2>
              <div className="space-y-3">
                {[
                  {
                    step: '1', label: 'Costo del producto',
                    desc: 'El costo que pagás al proveedor. Base de todo.',
                    value: costo > 0 ? ars(costo) : '—',
                    color: 'bg-gray-100',
                  },
                  {
                    step: '2', label: 'Lista Markup (sin IVA)',
                    desc: 'Sube a Odoo como precio de la "Lista Markup". Incluye utilidad pero sin IVA.',
                    value: calc ? ars(calc.precioSinIva) : '—',
                    color: 'bg-odoo/10',
                  },
                  {
                    step: '3', label: 'Lista ML (+ 21% IVA)',
                    desc: 'Lista ML = Lista Markup × 1.21. Este es el precio que publicás en MercadoLibre.',
                    value: calc ? ars(calc.precioConIva) : '—',
                    color: 'bg-meli/20',
                  },
                ].map(row => (
                  <div key={row.step} className="flex items-center gap-3">
                    <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-black shrink-0', row.color)}>
                      {row.step}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-bold text-gray-900">{row.label}</div>
                      <div className="text-[11px] text-gray-400">{row.desc}</div>
                    </div>
                    <div className="text-[13px] font-black text-gray-900 shrink-0">{row.value}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 p-3 bg-gray-50 rounded-xl text-[11px] text-gray-500 leading-relaxed">
                <strong>¿Por qué este esquema?</strong> Odoo no maneja markup sobre costo + IVA nativamente.
                La Lista Markup es el precio neto que entrás en Odoo. La Lista ML es una lista derivada que toma ese valor
                y le suma el 21% de IVA, replicando el precio final que verá el comprador en MercadoLibre.
              </div>
            </div>

          </div>
        </div>
      </div>

    </div>
    </div>
  );
}
