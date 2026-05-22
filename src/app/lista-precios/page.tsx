'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import productsData from '@/data/products.json';
import { ArrowLeft, Printer, Search, ChevronDown, FileText, Tag } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Product {
  id: string;
  sku: string | null;
  name: string;
  cost: number;
  price: number;
  margin: number | null;
  category: string | null;
  supplierName: string | null;
  active: boolean;
  hidden: boolean;
  stock: number;
  seiqCategory?: string | null;
}

interface Lista {
  id: string;
  nombre: string;
  descripcion: string;
  descuento: number;
}

interface Pago {
  id: string;
  medio: string;
  lista: string;
  recargo: number;
  activo: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const products = (productsData as unknown as Product[]).filter(p =>
  p.active !== false && !p.hidden && p.price > 1
);

const allCategories = ['Todas', ...Array.from(new Set(
  products.map(p => (p.category || 'Sin categoría').split(' / ')[0])
)).sort()];

const allSuppliers = ['Todos', ...Array.from(new Set(
  products.map(p => p.supplierName || 'Sin proveedor')
)).sort()];

function round(n: number, mult: number, alwaysUp: boolean) {
  if (mult <= 1) return Math.round(n);
  if (alwaysUp) return Math.ceil(n / mult) * mult;
  return Math.round(n / mult) * mult;
}

function fmt(n: number) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', maximumFractionDigits: 0,
  }).format(n);
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function ListaPreciosPage() {
  // ── Params from server ──
  const [listas,   setListas]   = useState<Lista[]>([]);
  const [pagos,    setPagos]    = useState<Pago[]>([]);
  const [redondeo, setRedondeo] = useState({ multiplo: 10, siempreArriba: true });
  const [loaded,   setLoaded]   = useState(false);

  useEffect(() => {
    fetch('/api/params').then(r => r.json()).then((d: {
      listas?: Lista[];
      pagos?: Pago[];
      redondeo?: { multiplo: number; siempreArriba: boolean };
    }) => {
      setListas(d.listas ?? []);
      setPagos((d.pagos ?? []).filter((p: Pago) => p.activo));
      setRedondeo(d.redondeo ?? { multiplo: 10, siempreArriba: true });
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  // ── Filters ──
  const [search,     setSearch]     = useState('');
  const [category,   setCategory]   = useState('Todas');
  const [supplier,   setSupplier]   = useState('Todos');
  const [showStock,  setShowStock]  = useState(false); // only in-stock
  const [selectedLista, setSelectedLista] = useState<string>('A');
  const [showPriceCol,  setShowPriceCol]  = useState<'lista' | 'costo' | 'ambos'>('lista');
  const [compact,       setCompact]       = useState(false);

  // Find active lista config
  const listaConfig = listas.find(l => l.id === selectedLista) ?? { descuento: 0, nombre: selectedLista };

  // Payment methods for this lista
  const pagosMedios = pagos.filter(p => p.lista === selectedLista);

  // ── Filtered products ──
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return products.filter(p => {
      if (showStock && (p.stock ?? 0) === 0) return false;
      if (category !== 'Todas' && !(p.category || 'Sin categoría').startsWith(category)) return false;
      if (supplier !== 'Todos' && (p.supplierName || 'Sin proveedor') !== supplier) return false;
      if (!p.price || p.price <= 1) return false;
      return !search
        || p.name.toLowerCase().includes(q)
        || (p.sku || '').toLowerCase().includes(q)
        || (p.category || '').toLowerCase().includes(q);
    });
  }, [search, category, supplier, showStock]);

  // ── Calc price for selected lista ──
  const calcPrice = (basePrice: number, recargo = 0) => {
    const afterDiscount = basePrice * (1 - listaConfig.descuento / 100);
    const afterRecargo  = afterDiscount * (1 + recargo / 100);
    return round(afterRecargo, redondeo.multiplo, redondeo.siempreArriba);
  };

  // ── Group by category ──
  const grouped = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const p of filtered) {
      const cat = (p.category || 'Sin categoría').split(' / ')[0];
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(p);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  // Payment method recargo
  const [selectedPago, setSelectedPago] = useState<string>('');
  const pagoActivo = pagos.find(p => p.id === selectedPago);
  const recargo = pagoActivo?.recargo ?? 0;

  if (!loaded) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin w-6 h-6 border-2 border-acqua border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 print:bg-white">

      {/* ── Toolbar (oculta al imprimir) ── */}
      <div className="print:hidden sticky top-0 z-20 bg-[#07111F] border-b border-white/10 px-5 py-3">
        <div className="max-w-[1400px] mx-auto flex items-center gap-3 flex-wrap">
          <Link href="/" className="flex items-center gap-1.5 text-white/50 hover:text-white text-[12px] transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" /> Inicio
          </Link>

          <div className="w-px h-5 bg-white/20" />

          <FileText className="w-4 h-4 text-acqua" />
          <span className="text-white font-bold text-[13px]">Lista de Precios</span>

          <div className="flex-1" />

          {/* Lista selector */}
          <div className="flex gap-1.5">
            {listas.filter(l => !['ml', 'mayorista', 'prof', 'cons'].includes(l.id)).map(l => (
              <button
                key={l.id}
                onClick={() => { setSelectedLista(l.id); setSelectedPago(''); }}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-[12px] font-bold border transition-all',
                  selectedLista === l.id
                    ? 'bg-acqua text-white border-acqua'
                    : 'bg-white/10 text-white/60 border-white/20 hover:bg-white/20 hover:text-white'
                )}
              >
                {l.nombre}
              </button>
            ))}
          </div>

          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 px-4 py-2 bg-acqua text-white text-[12px] font-bold rounded-lg hover:bg-acqua-dark transition-colors"
          >
            <Printer className="w-3.5 h-3.5" />
            Imprimir / PDF
          </button>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-4 py-4">

        {/* ── Filters (ocultas al imprimir) ── */}
        <div className="print:hidden bg-white rounded-xl border border-gray-200 p-4 mb-4 space-y-3">

          {/* Lista info + medio de pago */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className={cn(
              'flex-1 min-w-[200px] p-3 rounded-xl border',
              selectedLista === 'A' && 'bg-blue-50 border-blue-200',
              selectedLista === 'B' && 'bg-green-50 border-green-200',
              selectedLista === 'C' && 'bg-amber-50 border-amber-200',
            )}>
              <div className="text-[11px] font-bold text-gray-700">{listaConfig.nombre}</div>
              <div className="text-[10px] text-gray-500">{(listaConfig as Lista).descripcion}</div>
              {listaConfig.descuento > 0 && (
                <div className="text-[11px] font-bold text-green-600 mt-1">
                  -{listaConfig.descuento}% sobre Lista A
                </div>
              )}
              {pagosMedios.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {pagosMedios.map(p => (
                    <span key={p.id} className="text-[10px] bg-white border border-gray-200 px-1.5 py-0.5 rounded text-gray-600">
                      {p.medio}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Recargo extra por medio */}
            {pagos.some(p => p.lista === selectedLista && p.recargo > 0) && (
              <div className="min-w-[180px]">
                <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1">Recargo adicional</label>
                <div className="relative">
                  <select
                    value={selectedPago}
                    onChange={e => setSelectedPago(e.target.value)}
                    className="w-full appearance-none pl-3 pr-8 py-2 bg-white border border-gray-200 rounded-lg text-[12px] text-gray-700 focus:outline-none"
                  >
                    <option value="">Sin recargo</option>
                    {pagos.filter(p => p.lista === selectedLista && p.recargo > 0).map(p => (
                      <option key={p.id} value={p.id}>{p.medio} (+{p.recargo}%)</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                </div>
              </div>
            )}
          </div>

          {/* Filtros de productos */}
          <div className="flex gap-2 flex-wrap items-center">
            {/* Búsqueda */}
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                type="text"
                placeholder="Buscar producto…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-[12px] focus:outline-none focus:ring-2 focus:ring-acqua/30"
              />
            </div>

            {/* Categoría */}
            <div className="relative">
              <select value={category} onChange={e => setCategory(e.target.value)}
                className="appearance-none pl-3 pr-8 py-2 border border-gray-200 rounded-lg text-[12px] text-gray-700 focus:outline-none max-w-[180px]">
                {allCategories.map(c => <option key={c}>{c}</option>)}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
            </div>

            {/* Proveedor */}
            <div className="relative">
              <select value={supplier} onChange={e => setSupplier(e.target.value)}
                className="appearance-none pl-3 pr-8 py-2 border border-gray-200 rounded-lg text-[12px] text-gray-700 focus:outline-none max-w-[200px]">
                {allSuppliers.map(s => <option key={s}>{s}</option>)}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
            </div>

            {/* Con stock */}
            <label className="flex items-center gap-1.5 text-[12px] text-gray-600 cursor-pointer">
              <input type="checkbox" checked={showStock} onChange={e => setShowStock(e.target.checked)} className="rounded accent-acqua" />
              Solo con stock
            </label>

            {/* Compact */}
            <label className="flex items-center gap-1.5 text-[12px] text-gray-600 cursor-pointer">
              <input type="checkbox" checked={compact} onChange={e => setCompact(e.target.checked)} className="rounded accent-acqua" />
              Vista compacta
            </label>

            <div className="text-[11px] text-gray-400 ml-auto">
              <span className="font-semibold text-gray-700">{filtered.length}</span> productos
            </div>
          </div>
        </div>

        {/* ── Print header (solo al imprimir) ── */}
        <div className="hidden print:block mb-6">
          <div className="flex items-center justify-between border-b-2 border-gray-900 pb-3 mb-2">
            <div>
              <h1 className="text-2xl font-black text-gray-900">ACQUA PACHECO</h1>
              <p className="text-sm text-gray-500">Lista de Precios — {listaConfig.nombre}</p>
            </div>
            <div className="text-right text-sm text-gray-500">
              <div>{new Date().toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
              {listaConfig.descuento > 0 && (
                <div className="font-bold text-gray-900">{listaConfig.descuento}% de descuento</div>
              )}
              {pagosMedios.length > 0 && (
                <div className="text-xs">{pagosMedios.map(p => p.medio).join(' · ')}</div>
              )}
              {category !== 'Todas' && <div className="text-xs">Categoría: {category}</div>}
              {supplier !== 'Todos' && <div className="text-xs">Proveedor: {supplier}</div>}
            </div>
          </div>
          <p className="text-xs text-gray-400">Los precios incluyen IVA. Sujetos a cambio sin previo aviso.</p>
        </div>

        {/* ── Product table ── */}
        {grouped.map(([cat, prods]) => (
          <div key={cat} className="mb-6 print:mb-4 print:break-inside-avoid-page">

            {/* Category header */}
            <div className={cn(
              'flex items-center gap-2 px-3 py-2 rounded-lg mb-2 print:rounded-none print:px-0 print:border-b print:border-gray-300',
              'bg-gray-100 print:bg-transparent'
            )}>
              <Tag className="w-3.5 h-3.5 text-gray-500 print:hidden" />
              <span className="font-bold text-[12px] text-gray-700 uppercase tracking-wide">{cat}</span>
              <span className="text-[10px] text-gray-400 print:hidden">({prods.length})</span>
            </div>

            {/* Products */}
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden print:border-0 print:rounded-none">
              <table className="w-full text-[12px]">
                <thead className={cn(
                  'bg-gray-50 border-b border-gray-100 print:bg-transparent print:border-gray-300',
                  compact ? 'hidden' : ''
                )}>
                  <tr>
                    <th className="text-left px-4 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                      Producto
                    </th>
                    <th className="text-left px-4 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wide hidden sm:table-cell print:table-cell">
                      SKU
                    </th>
                    <th className="text-right px-4 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wide w-32">
                      Precio {listaConfig.nombre}
                      {recargo > 0 && ` (+${recargo}%)`}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {prods.map((p, i) => {
                    const precio = calcPrice(p.price, recargo);
                    const isLast = i === prods.length - 1;
                    return (
                      <tr
                        key={p.id}
                        className={cn(
                          'hover:bg-gray-50/60 print:hover:bg-transparent transition-colors print:break-inside-avoid',
                          !isLast && 'border-b border-gray-50 print:border-gray-200',
                          compact ? 'py-0.5' : ''
                        )}
                      >
                        <td className={cn('px-4', compact ? 'py-1' : 'py-2.5')}>
                          <div className="font-medium text-gray-900 leading-snug">
                            {p.name}
                          </div>
                          {p.seiqCategory && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-blue-600 print:hidden">
                              <Tag className="w-2.5 h-2.5" /> {p.seiqCategory}
                            </span>
                          )}
                        </td>
                        <td className={cn('px-4 hidden sm:table-cell print:table-cell', compact ? 'py-1' : 'py-2.5')}>
                          {p.sku
                            ? <span className="text-[10px] font-mono text-gray-400 bg-gray-50 print:bg-transparent px-1.5 py-0.5 rounded">{p.sku}</span>
                            : <span className="text-gray-300">—</span>}
                        </td>
                        <td className={cn('px-4 text-right font-bold text-gray-900', compact ? 'py-1' : 'py-2.5')}>
                          {fmt(precio)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="text-center py-20 text-gray-400">
            <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No hay productos con los filtros seleccionados</p>
          </div>
        )}

        {/* ── Print footer ── */}
        <div className="hidden print:block mt-8 pt-4 border-t border-gray-300 text-center text-xs text-gray-400">
          ACQUA PACHECO · Lista generada el {new Date().toLocaleDateString('es-AR')} · Precios en pesos argentinos (ARS) con IVA incluido
        </div>
      </div>

      {/* ── Print CSS ── */}
      <style>{`
        @media print {
          @page {
            margin: 1.5cm 1.5cm 2cm 1.5cm;
            size: A4;
          }
          body { font-size: 11pt; }
          table { page-break-inside: auto; }
          tr    { page-break-inside: avoid; page-break-after: auto; }
          thead { display: table-header-group; }
          tfoot { display: table-footer-group; }
        }
      `}</style>
    </div>
  );
}
