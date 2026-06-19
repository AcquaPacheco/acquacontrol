'use client';

import { useMemo, useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import {
  Settings, Package, Users, FileSpreadsheet,
  DollarSign, TrendingDown, ShoppingCart, FileText,
  BarChart3, Zap, ArrowRight, Star, Tag, Layers,
  ThumbsUp, ThumbsDown, RefreshCw, CheckCircle2,
  AlertTriangle, ChevronRight, Sparkles,
} from 'lucide-react';
import productsData  from '@/data/products.json';
import stockData     from '@/data/stock.json';
import suppliersData from '@/data/suppliers.json';
import odooSupData   from '@/data/odoo-supplierinfo.json';

// ─── Types ───────────────────────────────────────────────────────────────────
interface LiveProduct {
  id: string; name: string; cost: number; price: number;
  margin: number | null; supplierName: string | null;
  category: string | null; stock: number; active: boolean;
  hidden: boolean; terciarizado?: boolean; image?: string | null;
}
interface StockItem  { id: string; qtyAvailable: number }
interface OdooSup    { count: number }
interface Supplier   { id: string }

interface Rec {
  id: string;
  type: 'promo' | 'kit' | 'star' | 'price' | 'margin';
  icon: string;
  color: 'amber' | 'blue' | 'emerald' | 'rose' | 'purple';
  title: string;
  desc: string;
  cta: string;
  href: string;
  tag: string;
  product?: LiveProduct;
  kitProducts?: LiveProduct[];
}

// ─── Static seeds (build-time, updated by live fetch) ────────────────────────
const staticProducts  = productsData  as unknown as LiveProduct[];
const staticStock     = stockData     as unknown as StockItem[];
const staticSuppliers = suppliersData as unknown as Supplier[];
const staticOdooSup   = odooSupData   as unknown as OdooSup[];

// ─── Derive stats from product list ──────────────────────────────────────────
function deriveStats(prods: LiveProduct[], stock: StockItem[], odooSup: OdooSup[]) {
  const active    = prods.filter(p => p.active && !p.hidden);
  const sinCosto  = active.filter(p => !p.cost || p.cost === 0).length;
  const criticos  = active.filter(p => p.cost > 0 && p.price > 1 && (p.margin === null || p.margin < 35) && !p.terciarizado).length;
  const conLista  = odooSup.filter(s => s.count > 0).length;
  return {
    total: active.length, sinCosto, criticos, conLista,
    totalSuppliers: staticSuppliers.length, stockItems: stock.length,
    allOk: sinCosto === 0 && criticos === 0,
  };
}

// ─── Recommendations engine ───────────────────────────────────────────────────
function buildRecs(prods: LiveProduct[], stock: StockItem[]): Rec[] {
  const stockMap = new Map(stock.map(s => [s.id, s.qtyAvailable]));
  const active   = prods.filter(p => p.active && !p.hidden);
  const recs: Rec[] = [];

  // 1. PROMO URGENTE — stock + margen bajo
  const promoProds = active
    .filter(p => {
      const q = stockMap.get(p.id) ?? 0;
      return q > 0 && p.cost > 0 && p.price > 1 && p.margin !== null && p.margin < 35 && !p.terciarizado;
    })
    .sort((a, b) => (a.margin ?? 99) - (b.margin ?? 99));

  if (promoProds.length > 0) {
    const p = promoProds[0];
    const qty = stockMap.get(p.id) ?? 0;
    recs.push({
      id: `promo-${p.id}`,
      type: 'promo', icon: '🏷️', color: 'amber',
      tag: 'PROMO URGENTE',
      title: p.name.length > 40 ? p.name.slice(0, 40) + '…' : p.name,
      desc: `Margen actual ${p.margin?.toFixed(0) ?? '?'}% con ${qty} unidades en stock. Hacé una promo antes de perder más margen.`,
      cta: 'Ver producto', href: '/productos',
      product: p,
    });
  }

  // 2. ESTRELLA — alto margen + stock
  const starProds = active
    .filter(p => {
      const q = stockMap.get(p.id) ?? 0;
      return q > 0 && p.cost > 0 && p.margin !== null && p.margin >= 50;
    })
    .sort((a, b) => (b.margin ?? 0) - (a.margin ?? 0));

  if (starProds.length > 0) {
    const p = starProds[0];
    const qty = stockMap.get(p.id) ?? 0;
    recs.push({
      id: `star-${p.id}`,
      type: 'star', icon: '⭐', color: 'blue',
      tag: 'PRODUCTO ESTRELLA',
      title: p.name.length > 40 ? p.name.slice(0, 40) + '…' : p.name,
      desc: `Margen ${p.margin?.toFixed(0)}% con ${qty} unidades disponibles. Excelente candidato para destacar o armar un combo.`,
      cta: 'Armar combo', href: '/productos',
      product: p,
    });
  }

  // 3. KIT — varios productos del mismo proveedor con stock
  const bySupplier: Record<string, LiveProduct[]> = {};
  active.forEach(p => {
    if (!p.supplierName) return;
    const q = stockMap.get(p.id) ?? 0;
    if (q <= 0) return;
    if (!bySupplier[p.supplierName]) bySupplier[p.supplierName] = [];
    bySupplier[p.supplierName].push(p);
  });
  const kitEntry = Object.entries(bySupplier)
    .filter(([, ps]) => ps.length >= 3)
    .sort((a, b) => b[1].length - a[1].length)[0];

  if (kitEntry) {
    const [supplier, kitProds] = kitEntry;
    recs.push({
      id: `kit-${supplier}`,
      type: 'kit', icon: '📦', color: 'emerald',
      tag: 'OPORTUNIDAD KIT',
      title: `Kit ${supplier}`,
      desc: `Tenés ${kitProds.length} productos de ${supplier} disponibles en stock. Agrupálos en un kit para aumentar el ticket promedio.`,
      cta: 'Armar kit', href: '/productos',
      kitProducts: kitProds.slice(0, 4),
    });
  }

  // 4. PRECIO FALTANTE — tienen costo pero precio = $1
  const sinPrecio = active.filter(p => p.cost > 0 && (p.price <= 1 || p.price === 0)).slice(0, 1);
  if (sinPrecio.length > 0) {
    const p = sinPrecio[0];
    recs.push({
      id: `price-${p.id}`,
      type: 'price', icon: '💲', color: 'rose',
      tag: 'PRECIO FALTANTE',
      title: p.name.length > 40 ? p.name.slice(0, 40) + '…' : p.name,
      desc: `Tiene costo cargado ($${p.cost.toLocaleString('es-AR')}) pero sin precio de venta. Fijale precio para que aparezca en listas.`,
      cta: 'Fijar precio', href: '/productos',
      product: p,
    });
  }

  // 5. MARGEN MEJORABLE — varios productos terciarizados con margen bajo
  const tercBajo = active.filter(p => p.terciarizado && p.margin !== null && p.margin < 5);
  if (tercBajo.length > 0) {
    recs.push({
      id: 'margin-terc',
      type: 'margin', icon: '📊', color: 'purple',
      tag: 'MARGEN TERCIARIZADO',
      title: `${tercBajo.length} productos con comisión muy baja`,
      desc: `Tenés ${tercBajo.length} productos terciarizados con menos del 5% de comisión. Considerá renegociar condiciones con el proveedor.`,
      cta: 'Ver rentabilidad', href: '/rentabilidad',
    });
  }

  return recs.slice(0, 4); // máximo 4 recomendaciones
}

// ─── Rec Card ─────────────────────────────────────────────────────────────────
const COLOR_BG: Record<string, string> = {
  amber:   'bg-amber-50  border-amber-100',
  blue:    'bg-blue-50   border-blue-100',
  emerald: 'bg-emerald-50 border-emerald-100',
  rose:    'bg-rose-50   border-rose-100',
  purple:  'bg-purple-50 border-purple-100',
};
const COLOR_TAG: Record<string, string> = {
  amber:   'bg-amber-100 text-amber-700',
  blue:    'bg-blue-100  text-blue-700',
  emerald: 'bg-emerald-100 text-emerald-700',
  rose:    'bg-rose-100  text-rose-700',
  purple:  'bg-purple-100 text-purple-700',
};

function RecCard({ rec, onDismiss, onLike }: {
  rec: Rec;
  onDismiss: (id: string) => void;
  onLike: (id: string) => void;
}) {
  const [liked, setLiked] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div className={cn(
      'rounded-2xl border p-4 flex flex-col gap-3 transition-all hover:shadow-sm',
      COLOR_BG[rec.color],
    )}>
      <div className="flex items-start gap-3">
        <div className="text-2xl shrink-0 leading-none mt-0.5">{rec.icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={cn('text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full', COLOR_TAG[rec.color])}>
              {rec.tag}
            </span>
          </div>
          <h3 className="text-[13px] font-bold text-gray-900 leading-snug">{rec.title}</h3>
          <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">{rec.desc}</p>
        </div>
      </div>

      {/* Kit preview */}
      {rec.kitProducts && rec.kitProducts.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {rec.kitProducts.map((kp, i) => (
            <span key={i} className="text-[10px] font-semibold bg-white/70 px-2 py-0.5 rounded-full text-gray-600 border border-white">
              {kp.name.split(' ').slice(0, 3).join(' ')}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <a href={rec.href}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-white border border-gray-200 text-[11px] font-bold text-gray-700 rounded-xl hover:border-gray-300 hover:shadow-sm transition-all">
          {rec.cta} <ArrowRight className="w-3 h-3" />
        </a>
        <button
          onClick={() => { setLiked(true); onLike(rec.id); }}
          className={cn(
            'w-9 h-9 rounded-xl border flex items-center justify-center transition-all',
            liked ? 'bg-emerald-100 border-emerald-200 text-emerald-600' : 'bg-white border-gray-200 text-gray-400 hover:text-emerald-500 hover:border-emerald-200',
          )}>
          <ThumbsUp className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => { setDismissed(true); onDismiss(rec.id); }}
          className="w-9 h-9 rounded-xl bg-white border border-gray-200 flex items-center justify-center text-gray-400 hover:text-rose-400 hover:border-rose-200 transition-all">
          <ThumbsDown className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Module tile ──────────────────────────────────────────────────────────────
function ModTile({ icon: Icon, label, stat, href, accent }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; stat: string; href: string; accent?: boolean;
}) {
  return (
    <a href={href}
      className={cn(
        'flex flex-col items-start gap-2 p-4 rounded-2xl border transition-all group hover:shadow-md cursor-pointer',
        accent ? 'bg-[#07111F] border-[#07111F] hover:bg-gray-900' : 'bg-white border-gray-100 hover:border-gray-200',
      )}>
      <div className={cn(
        'w-9 h-9 rounded-xl flex items-center justify-center transition-colors',
        accent ? 'bg-white/10' : 'bg-gray-50 group-hover:bg-[#0784F2]/10',
      )}>
        <Icon className={cn('w-4 h-4 transition-colors', accent ? 'text-white/70' : 'text-gray-400 group-hover:text-[#0784F2]')} />
      </div>
      <div>
        <div className={cn('text-[12px] font-bold leading-tight', accent ? 'text-white' : 'text-gray-800')}>{label}</div>
        <div className={cn('text-[10px] mt-0.5', accent ? 'text-white/40' : 'text-gray-400')}>{stat}</div>
      </div>
    </a>
  );
}

// ─── Stat block inside hero ───────────────────────────────────────────────────
function HeroStat({ value, label, danger }: { value: number; label: string; danger?: boolean }) {
  return (
    <div className="text-center px-6 first:pl-0 last:pr-0">
      <div className={cn(
        'text-[44px] lg:text-[56px] font-black leading-none tabular-nums tracking-tight',
        danger && value > 0 ? 'text-rose-400' : 'text-white',
      )}>
        {value}
      </div>
      <div className="text-[10px] font-bold uppercase tracking-widest text-white/40 mt-1">{label}</div>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────
export default function ControlPage() {
  // ── Live data ──────────────────────────────────────────────────────────────
  const [liveProds, setLiveProds] = useState<LiveProduct[]>(staticProducts);
  const [loading,   setLoading]   = useState(true);
  const [mlProducts, setMlProducts] = useState(0);

  const fetchLive = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/products?showHidden=true');
      const data = await res.json() as unknown[];
      if (Array.isArray(data)) setLiveProds(data as LiveProduct[]);
    } catch { /* use static */ } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void fetchLive();
    try {
      const raw = localStorage.getItem('acqua_ml_lab_v1');
      if (raw) {
        const p = JSON.parse(raw) as { products?: unknown[] };
        setMlProducts(p.products?.length ?? 0);
      }
    } catch { /* ignore */ }
  }, [fetchLive]);

  // ── Dismissed / liked recs (localStorage) ──────────────────────────────────
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const raw = localStorage.getItem('acqua_rec_dismissed_v1');
      if (raw) setDismissed(new Set(JSON.parse(raw) as string[]));
    } catch { /* ignore */ }
  }, []);

  const handleDismiss = useCallback((id: string) => {
    setDismissed(prev => {
      const next = new Set(prev);
      next.add(id);
      localStorage.setItem('acqua_rec_dismissed_v1', JSON.stringify([...next]));
      return next;
    });
  }, []);

  const handleLike = useCallback((id: string) => {
    try {
      const raw  = localStorage.getItem('acqua_rec_liked_v1') ?? '[]';
      const liked = JSON.parse(raw) as string[];
      if (!liked.includes(id)) {
        liked.push(id);
        localStorage.setItem('acqua_rec_liked_v1', JSON.stringify(liked));
      }
    } catch { /* ignore */ }
  }, []);

  // ── Derived stats ──────────────────────────────────────────────────────────
  const stats = useMemo(() =>
    deriveStats(liveProds, staticStock, staticOdooSup),
    [liveProds],
  );

  const recs = useMemo(() =>
    buildRecs(liveProds, staticStock).filter(r => !dismissed.has(r.id)),
    [liveProds, dismissed],
  );

  // ── Health label ───────────────────────────────────────────────────────────
  const alertCount = (stats.sinCosto > 0 ? 1 : 0) + (stats.criticos > 0 ? 1 : 0);
  const healthOk   = alertCount === 0;

  const today = new Date().toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  const modules = [
    { icon: Users,          label: 'Proveedores',   stat: `${stats.totalSuppliers} importados`,                href: '/proveedores' },
    { icon: Package,        label: 'Productos',     stat: `${stats.total} activos`,                           href: '/productos' },
    { icon: DollarSign,     label: 'Costos',        stat: stats.sinCosto > 0 ? `${stats.sinCosto} pendientes` : 'Al día', href: '/costos' },
    { icon: BarChart3,      label: 'Rentabilidad',  stat: stats.criticos > 0 ? `${stats.criticos} críticos`  : 'Saludable', href: '/rentabilidad' },
    { icon: ShoppingCart,   label: 'ML Lab',        stat: mlProducts > 0 ? `${mlProducts} productos`         : 'Sin vincular', href: '/mercadolibre' },
    { icon: FileText,       label: 'Lista precios', stat: 'Efectivo · Débito',                                href: '/lista-precios' },
    { icon: FileSpreadsheet,label: 'Act. Costos',   stat: 'Excel proveedor',                                  href: '/actualizacion-costos' },
    { icon: FileSpreadsheet,label: 'Export Odoo',   stat: 'Exportar',                                         href: '/export-odoo' },
    { icon: Settings,       label: 'Parámetros',    stat: 'Configuración',                                    href: '/parametros' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
    <div className="max-w-[1680px] mx-auto px-4 lg:px-6 py-4 space-y-4">

      {/* ── HERO ─────────────────────────────────────────────────────── */}
      <div className="relative rounded-3xl overflow-hidden bg-[#07111F] min-h-[220px]">
        {/* Glows */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-24 right-1/3 w-96 h-96 rounded-full bg-[#0784F2]/15 blur-[80px]" />
          <div className="absolute bottom-0 left-20 w-60 h-48 rounded-full bg-indigo-600/10 blur-[60px]" />
          {healthOk
            ? <div className="absolute top-6 right-6 w-40 h-40 rounded-full bg-emerald-400/10 blur-[40px]" />
            : <div className="absolute top-6 right-6 w-40 h-40 rounded-full bg-rose-500/10 blur-[40px]" />
          }
        </div>

        <div className="relative z-10 px-8 py-8">
          {/* Top row: brand + status + refresh */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <div className={cn(
                'w-2.5 h-2.5 rounded-full animate-pulse',
                healthOk ? 'bg-emerald-400' : alertCount === 1 ? 'bg-amber-400' : 'bg-rose-400',
              )} />
              <span className="text-white/80 text-[13px] font-bold tracking-wide">Acqua Control OS</span>
              <span className="text-white/30 text-[11px] capitalize">{today}</span>
            </div>
            <button
              onClick={() => void fetchLive()}
              className="flex items-center gap-1.5 text-[11px] font-semibold text-white/30 hover:text-white/60 transition-colors"
            >
              <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} />
              {loading ? 'Actualizando…' : 'Actualizar'}
            </button>
          </div>

          {/* Big numbers */}
          <div className="flex items-end gap-0 divide-x divide-white/10">
            <HeroStat value={stats.total}         label="Productos"    />
            <HeroStat value={stats.totalSuppliers} label="Proveedores" />
            <HeroStat value={stats.criticos}       label="Críticos"    danger />
            <HeroStat value={stats.sinCosto}       label="Sin costo"   danger />

            {/* Status badge */}
            <div className="flex-1 flex justify-end items-end pb-2">
              {healthOk ? (
                <div className="flex items-center gap-2 px-4 py-2 bg-emerald-400/15 border border-emerald-400/20 rounded-2xl">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span className="text-[12px] font-bold text-emerald-400">Sistema operativo</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 px-4 py-2 bg-rose-400/15 border border-rose-400/20 rounded-2xl">
                  <AlertTriangle className="w-4 h-4 text-rose-400" />
                  <span className="text-[12px] font-bold text-rose-400">
                    {alertCount} {alertCount === 1 ? 'alerta activa' : 'alertas activas'}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── MAIN GRID ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">

        {/* LEFT: Consultor ────────────────────────────────────────────── */}
        <div className="xl:col-span-2 space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#0784F2]" />
            <span className="text-[13px] font-bold text-gray-900">Recomendaciones del día</span>
            <span className="text-[10px] font-bold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full ml-1">
              {recs.length} sugerencia{recs.length !== 1 ? 's' : ''}
            </span>
          </div>

          {recs.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 px-6 py-10 text-center">
              <div className="text-3xl mb-3">🎉</div>
              <p className="text-[14px] font-bold text-gray-900">Sin sugerencias pendientes</p>
              <p className="text-[12px] text-gray-400 mt-1">
                Todo parece estar en orden — o descartaste todas las sugerencias.
              </p>
              <button
                onClick={() => {
                  localStorage.removeItem('acqua_rec_dismissed_v1');
                  setDismissed(new Set());
                }}
                className="mt-4 text-[11px] font-semibold text-[#0784F2] hover:underline"
              >
                Restaurar descartadas
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {recs.map(rec => (
                <RecCard
                  key={rec.id}
                  rec={rec}
                  onDismiss={handleDismiss}
                  onLike={handleLike}
                />
              ))}
            </div>
          )}

          {/* Alerts strip */}
          {alertCount > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-50">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
                <span className="text-[12px] font-bold text-gray-900">Alertas activas</span>
              </div>
              {stats.sinCosto > 0 && (
                <a href="/costos" className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 transition-colors group border-b border-gray-50 last:border-0">
                  <div className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
                  <div className="flex-1">
                    <p className="text-[12px] font-semibold text-gray-900">{stats.sinCosto} productos sin costo</p>
                    <p className="text-[10px] text-gray-400">Subí la lista del proveedor para actualizarlos</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 transition-colors" />
                </a>
              )}
              {stats.criticos > 0 && (
                <a href="/rentabilidad" className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 transition-colors group border-b border-gray-50 last:border-0">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                  <div className="flex-1">
                    <p className="text-[12px] font-semibold text-gray-900">{stats.criticos} productos con margen crítico</p>
                    <p className="text-[10px] text-gray-400">Revisá si el costo subió y no ajustaste el precio</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 transition-colors" />
                </a>
              )}
            </div>
          )}
        </div>

        {/* RIGHT: Módulos ─────────────────────────────────────────────── */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-gray-400" />
            <span className="text-[13px] font-bold text-gray-900">Módulos</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {modules.map((m, i) => (
              <ModTile
                key={i}
                icon={m.icon}
                label={m.label}
                stat={m.stat}
                href={m.href}
                accent={i === 0}
              />
            ))}
          </div>

          {/* ML Lab progress (compact) */}
          {mlProducts === 0 && (
            <a href="/mercadolibre"
              className="flex items-center gap-3 bg-gradient-to-r from-[#07111F] to-gray-800 rounded-2xl px-4 py-3.5 group hover:opacity-90 transition-opacity">
              <Star className="w-4 h-4 text-amber-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-bold text-white">Conectá ML Lab</p>
                <p className="text-[10px] text-white/40">Importá publicaciones de MercadoLibre</p>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-white/30 group-hover:text-white/60 transition-colors shrink-0" />
            </a>
          )}
        </div>

      </div>
    </div>
    </div>
  );
}
