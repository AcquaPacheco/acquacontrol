'use client';

import { useState, useMemo } from 'react';
import productsData from '@/data/products.json';
import { cn } from '@/lib/utils';
import {
  TrendingUp, TrendingDown, Package, AlertTriangle,
  ChevronRight, Search, ArrowUpRight, Layers,
  Users, Star, X,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES & DATA
// ─────────────────────────────────────────────────────────────────────────────

interface Product {
  id: string; sku: string | null; name: string;
  cost: number; price: number; margin: number | null;
  supplierName: string | null; category: string | null;
  active: boolean;
}

const allProds = (productsData as unknown as (Product & { hidden?: boolean })[]).filter(p => p.active !== false && !p.hidden);
const withData = allProds.filter(p => p.cost > 0 && p.price > 1 && p.margin !== null);
const sinCosto = allProds.filter(p => !p.cost || p.cost === 0);

function fmt(n: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
}
function pct(n: number) { return `${n.toFixed(1)}%`; }
function avg(arr: number[]) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }

// ── Margin band label
function marginBand(m: number): { label: string; color: string; bg: string } {
  if (m >= 70) return { label: '70%+',    color: 'text-[#15803D]', bg: 'bg-[#15803D]' };
  if (m >= 55) return { label: '55-70%',  color: 'text-[#16A34A]', bg: 'bg-[#16A34A]' };
  if (m >= 45) return { label: '45-55%',  color: 'text-[#4ADE80]', bg: 'bg-[#4ADE80]' };
  if (m >= 35) return { label: '35-45%',  color: 'text-[#F97316]', bg: 'bg-[#F97316]' };
  return              { label: '<35%',     color: 'text-[#EF4444]', bg: 'bg-[#EF4444]' };
}

// ── Build category stats
interface CatStat {
  name: string;
  total: number;
  conDatos: number;
  sinCosto: number;
  avgMargin: number;
  minMargin: number;
  maxMargin: number;
  bajo35: number;       // margen < 35%
  estrella: number;     // margen >= 70%
  products: Product[];
}

function buildCatStats(): CatStat[] {
  const map = new Map<string, Product[]>();
  allProds.forEach(p => {
    const cat = (p.category || 'Sin categoría').split(' / ')[0];
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat)!.push(p);
  });
  return Array.from(map.entries())
    .map(([name, prods]) => {
      const cd = prods.filter(p => p.cost > 0 && p.price > 1 && p.margin !== null);
      const margins = cd.map(p => p.margin as number);
      return {
        name,
        total:      prods.length,
        conDatos:   cd.length,
        sinCosto:   prods.filter(p => !p.cost || p.cost === 0).length,
        avgMargin:  avg(margins),
        minMargin:  margins.length ? Math.min(...margins) : 0,
        maxMargin:  margins.length ? Math.max(...margins) : 0,
        bajo35:     cd.filter(p => (p.margin ?? 0) < 35).length,
        estrella:   cd.filter(p => (p.margin ?? 0) >= 70).length,
        products:   prods,
      };
    })
    .sort((a, b) => b.total - a.total);
}

// ── Build supplier stats
interface SupStat {
  name: string;
  total: number;
  conDatos: number;
  avgMargin: number;
  minMargin: number;
  bajo35: number;
  products: Product[];
}

function buildSupStats(): SupStat[] {
  const map = new Map<string, Product[]>();
  withData.forEach(p => {
    const s = p.supplierName || 'Sin proveedor';
    if (!map.has(s)) map.set(s, []);
    map.get(s)!.push(p);
  });
  return Array.from(map.entries())
    .map(([name, prods]) => {
      const margins = prods.map(p => p.margin as number);
      return {
        name,
        total:     prods.length,
        conDatos:  prods.length,
        avgMargin: avg(margins),
        minMargin: Math.min(...margins),
        bajo35:    prods.filter(p => (p.margin ?? 0) < 35).length,
        products:  prods,
      };
    })
    .sort((a, b) => b.total - a.total);
}

const catStats = buildCatStats();
const supStats = buildSupStats();

// ── Global margin bands
const BANDS = [
  { min: 70, max: Infinity, label: '70%+',   bg: 'bg-[#15803D]', text: 'text-[#15803D]', light: 'bg-[#15803D]/10' },
  { min: 55, max: 70,       label: '55–70%', bg: 'bg-[#16A34A]', text: 'text-[#16A34A]', light: 'bg-[#16A34A]/10' },
  { min: 45, max: 55,       label: '45–55%', bg: 'bg-[#4ADE80]', text: 'text-[#228B22]', light: 'bg-[#4ADE80]/10' },
  { min: 35, max: 45,       label: '35–45%', bg: 'bg-[#F97316]', text: 'text-[#F97316]', light: 'bg-[#F97316]/10' },
  { min: 0,  max: 35,       label: '<35%',   bg: 'bg-[#EF4444]', text: 'text-[#EF4444]', light: 'bg-[#EF4444]/10' },
];

// ─────────────────────────────────────────────────────────────────────────────
// AUTO-INSIGHTS
// ─────────────────────────────────────────────────────────────────────────────

function buildInsights() {
  const insights: { icon: string; type: 'good' | 'warn' | 'info'; title: string; body: string }[] = [];

  // Worst category
  const worstCat = catStats.filter(c => c.conDatos > 5).sort((a, b) => a.avgMargin - b.avgMargin)[0];
  if (worstCat && worstCat.avgMargin < 60) {
    insights.push({
      icon: '📉', type: 'warn',
      title: `${worstCat.name} arrastra el promedio`,
      body: `Margen promedio ${pct(worstCat.avgMargin)} — el más bajo entre categorías con más de 5 productos. Revisá condiciones de compra con los proveedores de esa categoría.`,
    });
  }

  // Products killing a category
  catStats.forEach(cat => {
    if (cat.bajo35 > 0 && cat.bajo35 <= 5) {
      const culprits = cat.products
        .filter(p => p.margin !== null && p.margin < 35 && p.cost > 0)
        .sort((a, b) => (a.margin ?? 0) - (b.margin ?? 0))
        .slice(0, 3)
        .map(p => p.name.split(' ').slice(0, 4).join(' '))
        .join(', ');
      insights.push({
        icon: '⚠️', type: 'warn',
        title: `${cat.bajo35} producto${cat.bajo35 > 1 ? 's' : ''} perjudica${cat.bajo35 > 1 ? 'n' : ''} ${cat.name}`,
        body: `${culprits}. Subir su precio Lista A o negociar mejor costo con el proveedor mejoraría el promedio de la categoría.`,
      });
    }
  });

  // Best category
  const bestCat = catStats.filter(c => c.conDatos > 5).sort((a, b) => b.avgMargin - a.avgMargin)[0];
  if (bestCat) {
    insights.push({
      icon: '🏆', type: 'good',
      title: `${bestCat.name} es tu categoría más rentable`,
      body: `Margen promedio ${pct(bestCat.avgMargin)} con ${bestCat.estrella} productos estrella (>70%). Mantené stock y priorizá la visibilidad online de esta categoría.`,
    });
  }

  // Sin costo
  if (sinCosto.length > 0) {
    insights.push({
      icon: '🔍', type: 'info',
      title: `${sinCosto.length} productos sin costo cargado`,
      body: `No es posible calcular rentabilidad para estos artículos. Completá el costo en Odoo o importá la lista de precios del proveedor correspondiente.`,
    });
  }

  // Supplier with worst avg margin
  const worstSup = supStats.filter(s => s.total >= 5).sort((a, b) => a.avgMargin - b.avgMargin)[0];
  if (worstSup && worstSup.avgMargin < 50) {
    insights.push({
      icon: '🚚', type: 'warn',
      title: `${worstSup.name} tiene el margen promedio más bajo`,
      body: `${pct(worstSup.avgMargin)} en ${worstSup.total} productos. ${worstSup.bajo35} por debajo de 35%. Evaluá si hay espacio para negociar mejores condiciones.`,
    });
  }

  return insights;
}

const autoInsights = buildInsights();

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function KPI({ label, value, sub, color = 'text-gray-900' }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 px-5 py-4">
      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">{label}</div>
      <div className={cn('text-3xl font-black', color)}>{value}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function MarginBar({ value, max, bg }: { value: number; max: number; bg: string }) {
  return (
    <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
      <div className={cn('h-full rounded-full transition-all', bg)} style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PRODUCT DRAWER — drill-down panel
// ─────────────────────────────────────────────────────────────────────────────

function ProductDrawer({
  title, products, onClose,
}: { title: string; products: Product[]; onClose: () => void }) {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'margin_asc' | 'margin_desc' | 'name'>('margin_asc');

  const filtered = useMemo(() => {
    let p = products.filter(p => p.cost > 0 && p.price > 1 && p.margin !== null);
    if (search) p = p.filter(x => x.name.toLowerCase().includes(search.toLowerCase()) || (x.sku ?? '').toLowerCase().includes(search.toLowerCase()));
    if (sortBy === 'margin_asc')  p = [...p].sort((a, b) => (a.margin ?? 0) - (b.margin ?? 0));
    if (sortBy === 'margin_desc') p = [...p].sort((a, b) => (b.margin ?? 0) - (a.margin ?? 0));
    if (sortBy === 'name')        p = [...p].sort((a, b) => a.name.localeCompare(b.name));
    return p;
  }, [products, search, sortBy]);

  const sinDatos = products.filter(p => !p.cost || p.cost === 0 || p.price <= 1);
  const margins  = filtered.map(p => p.margin as number);
  const avgM     = margins.length ? avg(margins) : 0;

  return (
    <div className="fixed inset-0 z-50 flex" onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ background: 'rgba(7,17,31,0.45)', backdropFilter: 'blur(3px)' }}>
      <div className="ml-auto w-full max-w-xl bg-white h-full flex flex-col shadow-2xl">
        {/* Header */}
        <div className="shrink-0 px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-black text-gray-900">{title}</h3>
            <p className="text-[11px] text-gray-400">{filtered.length} productos · margen promedio {pct(avgM)}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filters */}
        <div className="shrink-0 px-4 py-3 border-b border-gray-100 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar producto…"
              className="w-full pl-8 pr-3 py-2 text-[12px] border border-gray-200 rounded-xl focus:outline-none focus:border-[#07111F]" />
          </div>
          <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}
            className="px-3 py-2 text-[11px] border border-gray-200 rounded-xl bg-white focus:outline-none">
            <option value="margin_asc">Margen ↑</option>
            <option value="margin_desc">Margen ↓</option>
            <option value="name">Nombre</option>
          </select>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
          {filtered.map(p => {
            const band = marginBand(p.margin as number);
            return (
              <div key={p.id} className="px-5 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-semibold text-gray-900 line-clamp-1">{p.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {p.sku && <span className="text-[9px] font-mono text-gray-400">{p.sku}</span>}
                    {p.supplierName && <span className="text-[9px] text-gray-400 truncate">{p.supplierName}</span>}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[11px] text-gray-400">{fmt(p.cost)} → {fmt(p.price)}</div>
                  <span className={cn('text-[13px] font-black', band.color)}>{pct(p.margin as number)}</span>
                </div>
              </div>
            );
          })}
          {sinDatos.length > 0 && (
            <div className="px-5 py-3 bg-gray-50">
              <p className="text-[11px] text-gray-400 font-semibold">{sinDatos.length} sin costo/precio — no calculable</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE
// ─────────────────────────────────────────────────────────────────────────────

export default function RentabilidadPage() {
  const [drawerData, setDrawerData] = useState<{ title: string; products: Product[] } | null>(null);
  const [activeView, setActiveView] = useState<'categorias' | 'proveedores'>('categorias');
  const [search, setSearch] = useState('');

  // Global stats
  const globalAvg  = avg(withData.map(p => p.margin as number));
  const bajo35     = withData.filter(p => (p.margin ?? 0) < 35).length;
  const estrella   = withData.filter(p => (p.margin ?? 0) >= 70).length;

  // Margin distribution
  const bandCounts = BANDS.map(b => ({
    ...b,
    count: withData.filter(p => (p.margin ?? 0) >= b.min && (p.margin ?? 0) < b.max).length,
  }));
  const maxBandCount = Math.max(...bandCounts.map(b => b.count));

  // Filter by search
  const filteredCats = catStats.filter(c =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()),
  );
  const filteredSups = supStats.filter(s =>
    !search || s.name.toLowerCase().includes(search.toLowerCase()),
  ).slice(0, 20);

  return (
    <div className="min-h-screen bg-[#F7F8FA]">

      {/* ── HEADER ── */}
      <div className="bg-[#07111F] px-6 py-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="w-5 h-5 text-[#FFE600]" />
            <h1 className="text-white text-[18px] font-black">Rentabilidad</h1>
            <span className="text-white/30 text-[11px] ml-1">— análisis de márgenes del catálogo</span>
          </div>
          <p className="text-white/50 text-[12px]">{allProds.length} productos activos · {withData.length} con datos completos · actualizado desde inventario</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 lg:px-6 py-6 space-y-6">

        {/* ── KPI ROW ── */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <KPI label="Margen promedio"   value={pct(globalAvg)}          color="text-[#16A34A]"  sub={`${withData.length} prods con datos`} />
          <KPI label="Estrella (≥70%)"   value={estrella}                 color="text-[#15803D]"  sub="margen excelente" />
          <KPI label="Críticos (<35%)"   value={bajo35}                   color={bajo35 > 0 ? 'text-[#EF4444]' : 'text-gray-400'} sub="requieren atención" />
          <KPI label="Sin costo"         value={sinCosto.length}          color={sinCosto.length > 0 ? 'text-[#F97316]' : 'text-gray-400'} sub="no calculable" />
          <KPI label="Proveedores"       value={supStats.length}          color="text-[#07111F]"  sub={`${catStats.length} categorías`} />
        </div>

        {/* ── TWO COLUMN LAYOUT ── */}
        <div className="grid lg:grid-cols-3 gap-5">

          {/* LEFT: Distribution + Insights */}
          <div className="space-y-4">

            {/* Margin distribution */}
            <div className="bg-white rounded-2xl border border-gray-100 p-5">
              <h3 className="text-[12px] font-bold text-gray-900 mb-4">Distribución de márgenes</h3>
              <div className="space-y-3">
                {bandCounts.map(b => (
                  <div key={b.label}>
                    <div className="flex items-center justify-between mb-1">
                      <span className={cn('text-[11px] font-bold', b.text)}>{b.label}</span>
                      <span className="text-[11px] font-black text-gray-700">{b.count}</span>
                    </div>
                    <MarginBar value={b.count} max={maxBandCount} bg={b.bg} />
                    <div className="text-[9px] text-gray-400 mt-0.5">
                      {withData.length > 0 ? Math.round(b.count / withData.length * 100) : 0}% del catálogo
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Auto-insights */}
            <div className="bg-white rounded-2xl border border-gray-100 p-5">
              <h3 className="text-[12px] font-bold text-gray-900 mb-3 flex items-center gap-1.5">
                <span>💡</span> Insights automáticos
              </h3>
              <div className="space-y-3">
                {autoInsights.map((ins, i) => (
                  <div key={i} className={cn(
                    'rounded-xl p-3 border',
                    ins.type === 'good' ? 'bg-[#16A34A]/5 border-[#16A34A]/15' :
                    ins.type === 'warn' ? 'bg-[#F97316]/5 border-[#F97316]/15' :
                    'bg-[#0784F2]/5 border-[#0784F2]/15',
                  )}>
                    <p className="text-[11px] font-bold text-gray-900 mb-0.5">{ins.icon} {ins.title}</p>
                    <p className="text-[10px] text-gray-600 leading-relaxed">{ins.body}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* RIGHT: Category / Supplier tables */}
          <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100">
            {/* Tabs + search */}
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3 flex-wrap">
              <div className="flex rounded-xl border border-gray-200 p-0.5 gap-0.5">
                {(['categorias', 'proveedores'] as const).map(v => (
                  <button key={v} onClick={() => setActiveView(v)}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all capitalize',
                      activeView === v ? 'bg-[#07111F] text-white' : 'text-gray-500 hover:text-gray-700',
                    )}>
                    {v === 'categorias' ? <><Layers className="w-3 h-3 inline mr-1" />Categorías</> : <><Users className="w-3 h-3 inline mr-1" />Proveedores</>}
                  </button>
                ))}
              </div>
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar…"
                  className="w-full pl-8 pr-3 py-2 text-[12px] border border-gray-200 rounded-xl focus:outline-none focus:border-[#07111F]" />
              </div>
            </div>

            {/* ── CATEGORÍAS ── */}
            {activeView === 'categorias' && (
              <div className="divide-y divide-gray-50">
                {/* Header */}
                <div className="px-5 py-2 grid grid-cols-12 gap-2 text-[9px] font-bold text-gray-400 uppercase tracking-wider">
                  <span className="col-span-4">Categoría</span>
                  <span className="col-span-2 text-right">Prods</span>
                  <span className="col-span-2 text-right">Avg margen</span>
                  <span className="col-span-2 text-right">Min</span>
                  <span className="col-span-2 text-right">Críticos</span>
                </div>
                {filteredCats.map(cat => {
                  const band = marginBand(cat.avgMargin);
                  return (
                    <button
                      key={cat.name}
                      onClick={() => setDrawerData({ title: cat.name, products: cat.products })}
                      className="w-full px-5 py-3.5 grid grid-cols-12 gap-2 items-center hover:bg-gray-50 transition-colors text-left group"
                    >
                      <div className="col-span-4">
                        <p className="text-[12px] font-semibold text-gray-900 line-clamp-1">{cat.name}</p>
                        {cat.sinCosto > 0 && (
                          <p className="text-[9px] text-[#F97316]">{cat.sinCosto} sin costo</p>
                        )}
                      </div>
                      <span className="col-span-2 text-right text-[12px] font-semibold text-gray-600">{cat.total}</span>
                      <div className="col-span-2 text-right">
                        <span className={cn('text-[13px] font-black', band.color)}>{pct(cat.avgMargin)}</span>
                      </div>
                      <span className="col-span-2 text-right text-[11px] text-gray-500">{pct(cat.minMargin)}</span>
                      <div className="col-span-2 flex items-center justify-end gap-1.5">
                        {cat.bajo35 > 0
                          ? <span className="px-1.5 py-0.5 bg-[#EF4444]/10 text-[#EF4444] rounded text-[9px] font-bold">{cat.bajo35}</span>
                          : <span className="text-[9px] text-[#16A34A] font-bold">✓</span>}
                        <ChevronRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-gray-500 transition-colors" />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* ── PROVEEDORES ── */}
            {activeView === 'proveedores' && (
              <div className="divide-y divide-gray-50">
                {/* Header */}
                <div className="px-5 py-2 grid grid-cols-12 gap-2 text-[9px] font-bold text-gray-400 uppercase tracking-wider">
                  <span className="col-span-5">Proveedor</span>
                  <span className="col-span-2 text-right">Prods</span>
                  <span className="col-span-2 text-right">Avg margen</span>
                  <span className="col-span-2 text-right">Min</span>
                  <span className="col-span-1 text-right">&lt;35%</span>
                </div>
                {filteredSups.map(sup => {
                  const band = marginBand(sup.avgMargin);
                  return (
                    <button
                      key={sup.name}
                      onClick={() => setDrawerData({ title: sup.name, products: sup.products })}
                      className="w-full px-5 py-3 grid grid-cols-12 gap-2 items-center hover:bg-gray-50 transition-colors text-left group"
                    >
                      <div className="col-span-5">
                        <p className="text-[11px] font-semibold text-gray-900 line-clamp-1">{sup.name}</p>
                      </div>
                      <span className="col-span-2 text-right text-[12px] font-semibold text-gray-600">{sup.total}</span>
                      <div className="col-span-2 text-right">
                        <span className={cn('text-[13px] font-black', band.color)}>{pct(sup.avgMargin)}</span>
                      </div>
                      <span className="col-span-2 text-right text-[11px] text-gray-500">{pct(sup.minMargin)}</span>
                      <div className="col-span-1 flex items-center justify-end gap-1">
                        {sup.bajo35 > 0
                          ? <span className="text-[10px] font-bold text-[#EF4444]">{sup.bajo35}</span>
                          : <span className="text-[9px] text-[#16A34A]">✓</span>}
                        <ChevronRight className="w-3 h-3 text-gray-300 group-hover:text-gray-500 transition-colors" />
                      </div>
                    </button>
                  );
                })}
                {filteredSups.length === 0 && (
                  <div className="py-12 text-center text-gray-400 text-[12px]">Sin resultados</div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── BOTTOM: Críticos + Estrellas ── */}
        <div className="grid lg:grid-cols-2 gap-5">

          {/* Críticos */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="w-4 h-4 text-[#EF4444]" />
              <h3 className="text-[13px] font-black text-gray-900">Productos críticos</h3>
              <span className="ml-auto text-[11px] text-[#EF4444] font-bold">{bajo35} bajo 35%</span>
            </div>
            {bajo35 === 0 ? (
              <div className="py-8 text-center">
                <p className="text-3xl mb-2">🎉</p>
                <p className="text-[13px] font-semibold text-[#16A34A]">Todos los productos sobre 35%</p>
                <p className="text-[11px] text-gray-400">Tu catálogo está en zona sana.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {withData
                  .filter(p => (p.margin ?? 0) < 35)
                  .sort((a, b) => (a.margin ?? 0) - (b.margin ?? 0))
                  .slice(0, 10)
                  .map(p => (
                    <div key={p.id} className="flex items-center gap-3 py-1.5">
                      <TrendingDown className="w-3.5 h-3.5 text-[#EF4444] shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-semibold text-gray-900 line-clamp-1">{p.name}</p>
                        <p className="text-[9px] text-gray-400">{p.supplierName} · {fmt(p.cost)} → {fmt(p.price)}</p>
                      </div>
                      <span className="text-[13px] font-black text-[#EF4444] shrink-0">{pct(p.margin ?? 0)}</span>
                    </div>
                  ))}
                {bajo35 > 10 && (
                  <button
                    onClick={() => setDrawerData({
                      title: 'Productos críticos (<35%)',
                      products: withData.filter(p => (p.margin ?? 0) < 35),
                    })}
                    className="w-full mt-2 py-2 text-[11px] font-bold text-[#EF4444] bg-[#EF4444]/5 rounded-xl hover:bg-[#EF4444]/10 transition-colors"
                  >
                    Ver los {bajo35} críticos →
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Estrellas */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <div className="flex items-center gap-2 mb-4">
              <Star className="w-4 h-4 text-[#FFE600] fill-[#FFE600]" />
              <h3 className="text-[13px] font-black text-gray-900">Productos estrella</h3>
              <span className="ml-auto text-[11px] text-[#15803D] font-bold">{estrella} sobre 70%</span>
            </div>
            <div className="space-y-2">
              {withData
                .filter(p => (p.margin ?? 0) >= 70)
                .sort((a, b) => (b.margin ?? 0) - (a.margin ?? 0))
                .slice(0, 10)
                .map(p => (
                  <div key={p.id} className="flex items-center gap-3 py-1.5">
                    <TrendingUp className="w-3.5 h-3.5 text-[#16A34A] shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-semibold text-gray-900 line-clamp-1">{p.name}</p>
                      <p className="text-[9px] text-gray-400">{p.supplierName} · {fmt(p.cost)} → {fmt(p.price)}</p>
                    </div>
                    <span className="text-[13px] font-black text-[#15803D] shrink-0">{pct(p.margin ?? 0)}</span>
                  </div>
                ))}
              {estrella > 10 && (
                <button
                  onClick={() => setDrawerData({
                    title: 'Productos estrella (≥70%)',
                    products: withData.filter(p => (p.margin ?? 0) >= 70),
                  })}
                  className="w-full mt-2 py-2 text-[11px] font-bold text-[#15803D] bg-[#16A34A]/5 rounded-xl hover:bg-[#16A34A]/10 transition-colors"
                >
                  Ver los {estrella} estrellas →
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── SIN COSTO ── */}
        {sinCosto.length > 0 && (
          <div className="bg-[#F97316]/5 border border-[#F97316]/15 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <Package className="w-4 h-4 text-[#F97316]" />
              <h3 className="text-[13px] font-black text-gray-900">{sinCosto.length} productos sin costo — no calculable</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              {sinCosto.slice(0, 20).map(p => (
                <span key={p.id} className="px-2 py-1 bg-white border border-[#F97316]/20 rounded-lg text-[10px] text-gray-700">
                  {p.name.split(' ').slice(0, 5).join(' ')}
                </span>
              ))}
              {sinCosto.length > 20 && (
                <button
                  onClick={() => setDrawerData({ title: 'Sin costo', products: sinCosto })}
                  className="px-2 py-1 bg-[#F97316]/10 border border-[#F97316]/20 rounded-lg text-[10px] font-bold text-[#F97316]">
                  +{sinCosto.length - 20} más →
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── PRODUCT DRAWER ── */}
      {drawerData && (
        <ProductDrawer
          title={drawerData.title}
          products={drawerData.products}
          onClose={() => setDrawerData(null)}
        />
      )}
    </div>
  );
}
