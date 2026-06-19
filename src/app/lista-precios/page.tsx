'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import Link from 'next/link';
import productsData from '@/data/products.json';
import {
  ArrowLeft, Printer, Search, ChevronDown, FileText, Tag,
  Image as ImageIcon, Upload, CheckSquare, Square, X,
  Camera, Eye, EyeOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSettings, buildOdooImageUrl } from '@/lib/use-settings';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Product {
  id: string; sku: string | null; name: string;
  cost: number; price: number; margin: number | null;
  category: string | null; supplierName: string | null;
  active: boolean; hidden: boolean; stock: number;
  seiqCategory?: string | null; image?: string | null; odooId?: number | null;
}

interface Lista { id: string; nombre: string; descripcion: string; descuento: number }
interface Pago  { id: string; medio: string; lista: string; recargo: number; activo: boolean }

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
  // ── Params ──
  const [listas,   setListas]   = useState<Lista[]>([]);
  const [pagos,    setPagos]    = useState<Pago[]>([]);
  const [redondeo, setRedondeo] = useState({ multiplo: 10, siempreArriba: true });
  const [loaded,   setLoaded]   = useState(false);

  const { settings } = useSettings();
  const odooUrl = settings?.odooServerUrl ?? '';
  const getImg = (p: Product) =>
    p.image || buildOdooImageUrl(p.odooId ?? null, 'product.template', odooUrl);

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
  const [search,        setSearch]        = useState('');
  const [category,      setCategory]      = useState('Todas');
  const [supplier,      setSupplier]      = useState('Todos');
  const [showStock,     setShowStock]     = useState(false);
  const [selectedLista, setSelectedLista] = useState<string>('A');
  const [compact,       setCompact]       = useState(false);
  const [numColumnas,   setNumColumnas]   = useState(3);       // 1, 2 o 3 columnas de precio
  const [showPhotos,    setShowPhotos]    = useState(true);    // fotos en impresión
  const [selectedPago,  setSelectedPago]  = useState<string>('');

  // ── Product selection ──────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set()); // empty = todos
  const toggleProduct = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
    });
  };

  // ── Custom header image ────────────────────────────────────────────────────
  const [customHeader, setCustomHeader] = useState<string | null>(null);
  const headerInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('acqua_lista_header_v1');
      if (saved) setCustomHeader(saved);
    } catch { /* ignore */ }
  }, []);

  const handleHeaderUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      setCustomHeader(base64);
      try { localStorage.setItem('acqua_lista_header_v1', base64); } catch { /* ignore */ }
    };
    reader.readAsDataURL(file);
  };

  const removeHeader = () => {
    setCustomHeader(null);
    try { localStorage.removeItem('acqua_lista_header_v1'); } catch { /* ignore */ }
  };

  // ── Config ──
  const listaConfig  = listas.find(l => l.id === selectedLista) ?? { id: selectedLista, nombre: selectedLista, descripcion: '', descuento: 0 };
  const pagosMedios  = pagos.filter(p => p.lista === selectedLista);
  const pagoActivo   = pagos.find(p => p.id === selectedPago);
  const recargo      = pagoActivo?.recargo ?? 0;

  // Tres columnas de precios: A (crédito), B (débito/transf 10%off), C (efectivo retiro 15%off)
  const listaA = listas.find(l => l.id === 'A') ?? { descuento: 0 };
  const listaB = listas.find(l => l.id === 'B') ?? { descuento: 10 };
  const listaC = listas.find(l => l.id === 'C') ?? { descuento: 15 };
  const descB  = listaB.descuento || 10;
  const descC  = listaC.descuento || 15;

  const precioA = (p: number) => round(p * (1 - (listaA.descuento || 0) / 100), redondeo.multiplo, redondeo.siempreArriba);
  const precioB = (p: number) => round(p * (1 - descB / 100), redondeo.multiplo, redondeo.siempreArriba);
  const precioC = (p: number) => round(p * (1 - descC / 100), redondeo.multiplo, redondeo.siempreArriba);

  const calcPrice = (basePrice: number, rec = 0) => {
    const afterDiscount = basePrice * (1 - listaConfig.descuento / 100);
    const afterRecargo  = afterDiscount * (1 + rec / 100);
    return round(afterRecargo, redondeo.multiplo, redondeo.siempreArriba);
  };

  // ── Filtered ──
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

  // ── Grouped ──
  const grouped = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const p of filtered) {
      const cat = (p.category || 'Sin categoría').split(' / ')[0];
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(p);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const selectedCount = selectedIds.size;
  const isSelected    = (id: string) => selectedIds.size === 0 || selectedIds.has(id);

  if (!loaded) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin w-6 h-6 border-2 border-acqua border-t-transparent rounded-full" />
      </div>
    );
  }

  // Payment icons
  const PAGO_ICONS: Record<string, string> = {
    efectivo: '💵', debito: '💳', transferencia: '📲',
    tarjeta: '💳', credito: '💳', qr: '📱',
  };
  const pagoIcon = (medio: string) => {
    const key = medio.toLowerCase();
    return Object.entries(PAGO_ICONS).find(([k]) => key.includes(k))?.[1] ?? '💰';
  };

  return (
    <div className="min-h-screen bg-gray-50 print:bg-white">

      {/* ── Toolbar (oculta al imprimir) ─────────────────────────────────────── */}
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
              <button key={l.id}
                onClick={() => { setSelectedLista(l.id); setSelectedPago(''); }}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-[12px] font-bold border transition-all',
                  selectedLista === l.id
                    ? 'bg-acqua text-white border-acqua'
                    : 'bg-white/10 text-white/60 border-white/20 hover:bg-white/20 hover:text-white'
                )}>
                {l.nombre}
              </button>
            ))}
          </div>

          {/* Columnas de precio */}
          <div className="flex items-center gap-0.5 bg-white/10 rounded-lg p-0.5">
            {[1, 2, 3].map(n => (
              <button key={n} onClick={() => setNumColumnas(n)}
                className={cn(
                  'px-2.5 py-1 rounded-md text-[11px] font-bold transition-all',
                  numColumnas === n
                    ? 'bg-acqua text-white'
                    : 'text-white/50 hover:text-white',
                )}>
                {n} {n === 1 ? 'precio' : 'precios'}
              </button>
            ))}
          </div>

          {/* Fotos toggle */}
          <button
            onClick={() => setShowPhotos(v => !v)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-all',
              showPhotos
                ? 'bg-white/20 text-white border-white/30'
                : 'bg-white/5 text-white/40 border-white/10',
            )}>
            {showPhotos ? <Camera className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            {showPhotos ? 'Con fotos' : 'Sin fotos'}
          </button>

          {/* Header image upload */}
          <input ref={headerInputRef} type="file" accept="image/*" className="hidden" onChange={handleHeaderUpload} />
          <button
            onClick={() => headerInputRef.current?.click()}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-all',
              customHeader
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                : 'bg-white/10 text-white/60 border-white/20 hover:bg-white/20 hover:text-white',
            )}>
            <Upload className="w-3.5 h-3.5" />
            {customHeader ? 'Header ✓' : 'Subir header'}
          </button>
          {customHeader && (
            <button onClick={removeHeader} className="text-white/40 hover:text-rose-400 transition-colors" title="Quitar header">
              <X className="w-4 h-4" />
            </button>
          )}

          {/* Print */}
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 px-4 py-2 bg-acqua text-white text-[12px] font-bold rounded-lg hover:bg-acqua-dark transition-colors"
          >
            <Printer className="w-3.5 h-3.5" />
            {selectedCount > 0 ? `Imprimir (${selectedCount})` : 'Imprimir / PDF'}
          </button>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-4 py-4">

        {/* ── Filters (ocultas al imprimir) ─────────────────────────────────── */}
        <div className="print:hidden bg-white rounded-xl border border-gray-200 p-4 mb-4 space-y-3">
          <div className="flex items-center gap-4 flex-wrap">
            {/* Lista info */}
            <div className={cn(
              'flex-1 min-w-[200px] p-3 rounded-xl border',
              selectedLista === 'A' && 'bg-blue-50 border-blue-200',
              selectedLista === 'B' && 'bg-green-50 border-green-200',
              selectedLista === 'C' && 'bg-amber-50 border-amber-200',
            )}>
              <div className="text-[11px] font-bold text-gray-700">{listaConfig.nombre}</div>
              <div className="text-[10px] text-gray-500">{listaConfig.descripcion}</div>
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

            {/* Recargo adicional */}
            {pagos.some(p => p.lista === selectedLista && p.recargo > 0) && (
              <div className="min-w-[180px]">
                <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1">Recargo adicional</label>
                <div className="relative">
                  <select value={selectedPago} onChange={e => setSelectedPago(e.target.value)}
                    className="w-full appearance-none pl-3 pr-8 py-2 bg-white border border-gray-200 rounded-lg text-[12px] text-gray-700 focus:outline-none">
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

          {/* Filtros */}
          <div className="flex gap-2 flex-wrap items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input type="text" placeholder="Buscar producto…" value={search} onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-[12px] focus:outline-none focus:ring-2 focus:ring-acqua/30" />
            </div>
            <div className="relative">
              <select value={category} onChange={e => setCategory(e.target.value)}
                className="appearance-none pl-3 pr-8 py-2 border border-gray-200 rounded-lg text-[12px] text-gray-700 focus:outline-none max-w-[180px]">
                {allCategories.map(c => <option key={c}>{c}</option>)}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
            </div>
            <div className="relative">
              <select value={supplier} onChange={e => setSupplier(e.target.value)}
                className="appearance-none pl-3 pr-8 py-2 border border-gray-200 rounded-lg text-[12px] text-gray-700 focus:outline-none max-w-[200px]">
                {allSuppliers.map(s => <option key={s}>{s}</option>)}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
            </div>
            <label className="flex items-center gap-1.5 text-[12px] text-gray-600 cursor-pointer">
              <input type="checkbox" checked={showStock} onChange={e => setShowStock(e.target.checked)} className="rounded accent-acqua" />
              Solo con stock
            </label>
            <label className="flex items-center gap-1.5 text-[12px] text-gray-600 cursor-pointer">
              <input type="checkbox" checked={compact} onChange={e => setCompact(e.target.checked)} className="rounded accent-acqua" />
              Compacto
            </label>

            {/* Separador */}
            <div className="w-px h-5 bg-gray-200" />

            {/* Selection controls */}
            <button onClick={() => setSelectedIds(new Set(filtered.map(p => p.id)))}
              className="flex items-center gap-1 text-[11px] font-semibold text-[#0784F2] hover:underline">
              <CheckSquare className="w-3.5 h-3.5" /> Seleccionar todos
            </button>
            {selectedCount > 0 && (
              <button onClick={() => setSelectedIds(new Set())}
                className="flex items-center gap-1 text-[11px] font-semibold text-gray-400 hover:text-gray-600 hover:underline">
                <Square className="w-3.5 h-3.5" /> Limpiar selección
              </button>
            )}
            <div className="text-[11px] text-gray-400 ml-auto">
              {selectedCount > 0
                ? <span><span className="font-bold text-[#07111F]">{selectedCount}</span> seleccionados de {filtered.length}</span>
                : <span><span className="font-semibold text-gray-700">{filtered.length}</span> productos (todos)</span>
              }
            </div>
          </div>

          {/* Header upload hint */}
          {!customHeader && (
            <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg border border-dashed border-gray-200 text-[11px] text-gray-500">
              <Upload className="w-3.5 h-3.5 shrink-0" />
              <span>
                Podés subir un <strong>header personalizado</strong> (JPG/PNG) que aparecerá al imprimir.
                Tamaño recomendado: <strong>2480 × 480 px</strong> (fondo negro, texto blanco).
              </span>
              <button onClick={() => headerInputRef.current?.click()}
                className="ml-auto shrink-0 text-[#0784F2] font-semibold hover:underline">
                Subir
              </button>
            </div>
          )}
        </div>

        {/* ── Print header ──────────────────────────────────────────────────── */}
        <div className="hidden print:block mb-4">
          {customHeader ? (
            /* Custom uploaded header */
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={customHeader} alt="Header" className="w-full object-cover mb-4 rounded-lg" style={{ maxHeight: '140px' }} />
          ) : (
            /* Auto-generated black header */
            <div className="bg-black text-white rounded-xl overflow-hidden mb-3">
              <div className="flex items-center justify-between px-8 py-5">
                {/* Left: logo + contact */}
                <div className="flex items-center gap-5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/brand/acqua-logo-white.png" alt="Acqua" className="h-9 object-contain" />
                  <div className="w-px h-10 bg-white/20" />
                  <div className="text-[10px] leading-relaxed text-white/70">
                    <div className="font-bold text-white text-[11px]">Av. Boulogne Sur Mer 919</div>
                    <div>General Pacheco, Tigre, Bs. As.</div>
                    <div>Cel.: 11-5857-8383 · hola@acquapacheco.com</div>
                  </div>
                </div>

                {/* Center: 3 pricing tiers */}
                <div className="flex items-center gap-3">
                  {/* Tier 1: Lista A — Crédito */}
                  <div className="text-center px-3 py-2 border border-white/20 rounded-lg">
                    <div className="text-[8px] font-bold text-white/50 uppercase tracking-widest mb-0.5">Precio Final</div>
                    <div className="text-[10px] font-black text-white">💳 CRÉDITO</div>
                    <div className="text-[9px] text-white/50 mt-0.5">Lista A · 1 cuota</div>
                  </div>
                  <div className="w-px h-10 bg-white/20" />
                  {/* Tier 2: Lista B — Débito / Transferencia / Efectivo */}
                  <div className="text-center px-3 py-2 border border-blue-400/40 rounded-lg bg-blue-400/10">
                    <div className="text-[8px] font-bold text-blue-300 uppercase tracking-widest mb-0.5">{descB}% OFF</div>
                    <div className="text-[10px] font-black text-white">📲 DÉBITO / TRANSF.</div>
                    <div className="text-[9px] text-blue-200 mt-0.5">y efectivo</div>
                  </div>
                  <div className="w-px h-10 bg-white/20" />
                  {/* Tier 3: Lista C — Efectivo Retiro en Tienda */}
                  <div className="text-center px-3 py-2 border border-emerald-400/40 rounded-lg bg-emerald-400/10">
                    <div className="text-[8px] font-bold text-emerald-300 uppercase tracking-widest mb-0.5">{descC}% OFF</div>
                    <div className="text-[10px] font-black text-white">💵 EFECTIVO</div>
                    <div className="text-[9px] text-emerald-200 mt-0.5">retiro en tienda</div>
                  </div>
                </div>

                {/* Right: lista + date */}
                <div className="text-right">
                  <div className="text-[9px] font-bold uppercase tracking-widest text-white/40 mb-0.5">Lista de precios</div>
                  <div className="text-2xl font-black text-white">{listaConfig.nombre}</div>
                  <div className="text-[10px] text-white/50 mt-0.5">
                    {new Date().toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </div>
                  {listaConfig.descuento > 0 && (
                    <div className="text-[11px] font-bold text-emerald-400 mt-0.5">{listaConfig.descuento}% de descuento</div>
                  )}
                </div>
              </div>
            </div>
          )}
          <p className="text-[9px] text-gray-400 mb-2">Los precios incluyen IVA. Sujetos a cambio sin previo aviso.</p>
        </div>

        {/* ── Product table ──────────────────────────────────────────────────── */}
        {grouped.map(([cat, prods]) => {
          const printableProds = prods.filter(p => isSelected(p.id));
          if (printableProds.length === 0 && selectedIds.size > 0) return null;
          return (
            <div key={cat} className="mb-6 print:mb-3 print:break-inside-avoid-page">
              {/* Category header */}
              <div className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-lg mb-2 print:rounded-none print:px-0 print:border-b print:border-gray-300',
                'bg-gray-100 print:bg-transparent'
              )}>
                <Tag className="w-3.5 h-3.5 text-gray-500 print:hidden" />
                <span className="font-bold text-[12px] text-gray-700 uppercase tracking-wide">{cat}</span>
                <span className="text-[10px] text-gray-400 print:hidden">({prods.length})</span>
              </div>

              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden print:border-0 print:rounded-none">
                <table className="w-full text-[12px]">
                  <thead className={cn(
                    'bg-gray-50 border-b border-gray-100 print:bg-transparent print:border-gray-300',
                    compact ? 'hidden' : ''
                  )}>
                    <tr>
                      {/* Checkbox col (screen only) */}
                      <th className="print:hidden w-10 px-2 py-2" />
                      {/* Photo col */}
                      {showPhotos && <th className={cn('w-16 print:w-28 px-2 py-2')} />}
                      <th className="text-left px-4 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                        Producto
                      </th>
                      <th className="text-right px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wide w-36">
                        <span className="hidden print:inline">💳 Crédito</span>
                        <span className="print:hidden">{numColumnas === 1 ? 'Precio' : 'Crédito (A)'}</span>
                      </th>
                      {numColumnas >= 2 && (
                        <th className="text-right px-3 py-2 text-[10px] font-semibold text-blue-500 uppercase tracking-wide w-36">
                          <span className="hidden print:inline">📲 Débito/Transf</span>
                          <span className="print:hidden">Déb/Transf ({descB}%off)</span>
                        </th>
                      )}
                      {numColumnas >= 3 && (
                        <th className="text-right px-3 py-2 text-[10px] font-semibold text-emerald-600 uppercase tracking-wide w-36">
                          <span className="hidden print:inline">💵 Ef. Retiro</span>
                          <span className="print:hidden">Ef. Retiro ({descC}%off)</span>
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {prods.map((p, i) => {
                      const precio  = calcPrice(p.price, recargo);
                      const img     = getImg(p);
                      const isLast  = i === prods.length - 1;
                      const checked = selectedIds.has(p.id);
                      const hidden  = selectedIds.size > 0 && !selectedIds.has(p.id);
                      return (
                        <tr
                          key={p.id}
                          className={cn(
                            'hover:bg-gray-50/60 print:hover:bg-transparent transition-colors print:break-inside-avoid',
                            !isLast && 'border-b border-gray-50 print:border-gray-200',
                            compact && 'py-0.5',
                            hidden && 'print:hidden',    // hide unselected when printing
                          )}
                        >
                          {/* Checkbox (screen only) */}
                          <td className="print:hidden w-10 px-2" onClick={() => toggleProduct(p.id)}>
                            <div className={cn(
                              'w-5 h-5 rounded border-2 flex items-center justify-center cursor-pointer transition-colors mx-auto',
                              checked
                                ? 'bg-[#0784F2] border-[#0784F2]'
                                : 'border-gray-300 hover:border-[#0784F2]',
                            )}>
                              {checked && <span className="text-white text-[10px] font-black">✓</span>}
                            </div>
                          </td>

                          {/* Photo */}
                          {showPhotos && (
                            <td className={cn('w-16 print:w-28 px-1', compact ? 'py-0.5' : 'py-1.5')}>
                              <div className="w-14 h-14 rounded-lg bg-gray-50 border border-gray-100 overflow-hidden flex items-center justify-center mx-auto print:w-24 print:h-24">
                                {img
                                  ? <img src={img} alt={p.name} className="w-full h-full object-contain" />
                                  : <ImageIcon className="w-4 h-4 text-gray-300" />}
                              </div>
                            </td>
                          )}

                          {/* Name */}
                          <td className={cn('px-4', compact ? 'py-1' : 'py-2.5')}>
                            <div className="font-medium text-gray-900 leading-snug">{p.name}</div>
                            {p.seiqCategory && (
                              <span className="inline-flex items-center gap-1 text-[10px] text-blue-600 print:hidden">
                                <Tag className="w-2.5 h-2.5" /> {p.seiqCategory}
                              </span>
                            )}
                          </td>

                          {/* Price A — Crédito */}
                          <td className={cn('px-3 text-right font-bold text-gray-900', compact ? 'py-1' : 'py-2.5')}>
                            {fmt(precioA(p.price))}
                          </td>
                          {/* Price B — Débito/Transf */}
                          {numColumnas >= 2 && (
                            <td className={cn('px-3 text-right font-bold text-blue-700', compact ? 'py-1' : 'py-2.5')}>
                              {fmt(precioB(p.price))}
                            </td>
                          )}
                          {/* Price C — Efectivo retiro */}
                          {numColumnas >= 3 && (
                            <td className={cn('px-3 text-right font-bold text-emerald-700', compact ? 'py-1' : 'py-2.5')}>
                              {fmt(precioC(p.price))}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="text-center py-20 text-gray-400">
            <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No hay productos con los filtros seleccionados</p>
          </div>
        )}

        {/* ── Print footer ── */}
        <div className="hidden print:block mt-6 pt-3 border-t border-gray-300 text-center text-[9px] text-gray-400">
          ACQUA PACHECO · Lista generada el {new Date().toLocaleDateString('es-AR')} · Precios en pesos argentinos (ARS) con IVA incluido
        </div>
      </div>

      {/* ── Print CSS ── */}
      <style>{`
        @media print {
          @page { margin: 1cm 1.2cm 1.5cm 1.2cm; size: A4; }
          body { font-size: 10pt; }
          table { page-break-inside: auto; }
          tr    { page-break-inside: avoid; page-break-after: auto; }
          thead { display: table-header-group; }
          tfoot { display: table-footer-group; }
        }
      `}</style>
    </div>
  );
}
