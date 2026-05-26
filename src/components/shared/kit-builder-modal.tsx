'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { buildOdooImageUrl } from '@/lib/use-settings';
import {
  X, Search, Plus, Minus, Trash2, Package, Layers,
  TrendingUp, ChevronRight, Check, AlertTriangle,
  Image as ImageIcon, Zap, Star, Target, RefreshCw,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface KitComponent {
  productId: string;
  productName: string;
  qty: number;
  unitCost: number;
  unitPrice: number;
  subtotal: number;
  image: string | null;
}

export interface KitProduct {
  id: string;
  type: 'kit';
  name: string;
  sku: string | null;
  barcode: string | null;
  cost: number;
  price: number;
  margin: number;
  markup: number;
  category: string | null;
  supplierName: string | null;
  image: string | null;
  odooId: null;
  active: boolean;
  hidden: boolean;
  stock: number;
  notes: string;
  kitComponents: KitComponent[];
  terciarizado: false;
  status: string;
}

interface CatalogProduct {
  id: string;
  name: string;
  cost: number;
  price: number;
  sku: string | null;
  category: string | null;
  supplierName: string | null;
  image: string | null;
  odooId: number | null;
}

interface Props {
  products: CatalogProduct[];
  odooUrl: string;
  allCategories: string[];
  onClose: () => void;
  onCreated: (kit: KitProduct) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', maximumFractionDigits: 0,
  }).format(n);
}

function calcPrice(cost: number, margin: number) {
  if (cost <= 0 || margin >= 100) return 0;
  const raw = cost / (1 - margin / 100);
  return Math.ceil(raw / 10) * 10; // round up to nearest $10
}

function calcMargin(cost: number, price: number) {
  if (!price || !cost) return 0;
  return Math.round(((price - cost) / price) * 1000) / 10;
}

function calcMarkup(cost: number, price: number) {
  if (!cost) return 0;
  return Math.round(((price / cost) - 1) * 1000) / 10;
}

const MARGIN_OPTIONS = [
  { label: 'Agresivo', pct: 40, color: 'text-[#F97316]', bg: 'bg-[#F97316]/10 border-[#F97316]/30', dot: 'bg-[#F97316]', desc: 'Precio muy competitivo' },
  { label: 'Ideal',    pct: 47, color: 'text-[#16A34A]', bg: 'bg-[#16A34A]/10 border-[#16A34A]/30', dot: 'bg-[#16A34A]', desc: 'Margen sano y competitivo' },
  { label: 'Premium',  pct: 55, color: 'text-[#15803D]', bg: 'bg-[#15803D]/10 border-[#15803D]/30', dot: 'bg-[#15803D]', desc: 'Máximo margen' },
];

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export function KitBuilderModal({ products, odooUrl, allCategories, onClose, onCreated }: Props) {
  // ── form state
  const [kitName, setKitName]       = useState('');
  const [category, setCategory]     = useState('');
  const [notes, setNotes]           = useState('');
  const [components, setComponents] = useState<KitComponent[]>([]);

  // ── price state
  const [selectedMarginPct, setSelectedMarginPct] = useState<number>(47);
  const [customPrice, setCustomPrice]             = useState<string>('');
  const [priceMode, setPriceMode]                 = useState<'auto' | 'custom'>('auto');

  // ── search state
  const [search, setSearch]         = useState('');
  const [showResults, setShowResults] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // ── saving state
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');

  // ── derived calculations
  const totalCost = useMemo(() =>
    components.reduce((sum, c) => sum + c.subtotal, 0),
  [components]);

  const autoPrice = useMemo(() =>
    calcPrice(totalCost, selectedMarginPct),
  [totalCost, selectedMarginPct]);

  const finalPrice = priceMode === 'custom' && customPrice
    ? parseFloat(customPrice.replace(/[^0-9.]/g, '')) || 0
    : autoPrice;

  const finalMargin = calcMargin(totalCost, finalPrice);
  const finalMarkup = calcMarkup(totalCost, finalPrice);

  const marginColor =
    finalMargin >= 45 ? 'text-[#16A34A]' :
    finalMargin >= 35 ? 'text-[#F97316]' :
    'text-[#EF4444]';

  // ── search results
  const searchResults = useMemo(() => {
    if (!search || search.length < 2) return [];
    const q = search.toLowerCase();
    const addedIds = new Set(components.map(c => c.productId));
    return products
      .filter(p =>
        !addedIds.has(p.id) &&
        (p.name.toLowerCase().includes(q) || (p.sku ?? '').toLowerCase().includes(q))
      )
      .slice(0, 15);
  }, [search, products, components]);

  // ── handlers
  const addComponent = useCallback((p: CatalogProduct) => {
    const img = p.image || buildOdooImageUrl(p.odooId, 'product.template', odooUrl);
    setComponents(prev => {
      const existing = prev.find(c => c.productId === p.id);
      if (existing) {
        return prev.map(c => c.productId === p.id
          ? { ...c, qty: c.qty + 1, subtotal: c.unitCost * (c.qty + 1) }
          : c
        );
      }
      return [...prev, {
        productId:   p.id,
        productName: p.name,
        qty:         1,
        unitCost:    p.cost,
        unitPrice:   p.price,
        subtotal:    p.cost,
        image:       img,
      }];
    });
    setSearch('');
    setShowResults(false);
  }, [odooUrl]);

  const updateQty = useCallback((productId: string, delta: number) => {
    setComponents(prev => prev
      .map(c => c.productId === productId
        ? { ...c, qty: Math.max(1, c.qty + delta), subtotal: c.unitCost * Math.max(1, c.qty + delta) }
        : c
      )
    );
  }, []);

  const setQty = useCallback((productId: string, val: number) => {
    setComponents(prev => prev.map(c =>
      c.productId === productId
        ? { ...c, qty: val, subtotal: c.unitCost * val }
        : c
    ));
  }, []);

  const removeComponent = useCallback((productId: string) => {
    setComponents(prev => prev.filter(c => c.productId !== productId));
  }, []);

  // ── close on backdrop click
  const handleBackdrop = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  // ── submit
  const handleCreate = async () => {
    if (!kitName.trim())         { setError('El kit necesita un nombre'); return; }
    if (components.length === 0) { setError('Agregá al menos un componente'); return; }
    if (finalPrice <= 0)         { setError('El precio final no puede ser 0'); return; }

    setSaving(true);
    setError('');

    const id = `kit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const status = finalMargin >= 35 ? 'activo' : finalMargin >= 20 ? 'revisar' : 'critico';

    const kit: KitProduct = {
      id,
      type:           'kit',
      name:           kitName.trim(),
      sku:            null,
      barcode:        null,
      cost:           Math.round(totalCost * 100) / 100,
      price:          finalPrice,
      margin:         finalMargin,
      markup:         finalMarkup,
      category:       category || null,
      supplierName:   null,
      image:          null,
      odooId:         null,
      active:         true,
      hidden:         false,
      stock:          0,
      notes,
      kitComponents:  components,
      terciarizado:   false,
      status,
    };

    try {
      const res = await fetch('/api/products', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ...kit, source: 'kit_builder' }),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      if (!data.ok) { setError(data.error ?? 'Error al crear kit'); setSaving(false); return; }
      onCreated(kit);
      onClose();
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  };

  // ── close with Escape
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const canCreate = kitName.trim().length > 0 && components.length > 0 && finalPrice > 0;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      style={{ background: 'rgba(7,17,31,0.65)', backdropFilter: 'blur(6px)' }}
      onClick={handleBackdrop}
    >
      <div className="w-full max-w-[1050px] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[92vh]">

        {/* ── HEADER ── */}
        <div className="shrink-0 bg-[#07111F] px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#FFE600]/20 flex items-center justify-center">
              <Layers className="w-5 h-5 text-[#FFE600]" />
            </div>
            <div>
              <h2 className="text-white text-[16px] font-black">Crear Kit</h2>
              <p className="text-white/40 text-[11px]">Armá un conjunto de productos y calculá el precio ideal</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── BODY ── */}
        <div className="flex flex-1 overflow-hidden">

          {/* ─── LEFT: COMPONENTES ─── */}
          <div className="flex flex-col w-[55%] border-r border-gray-100 overflow-hidden">

            {/* Kit name + category */}
            <div className="shrink-0 px-5 pt-4 pb-3 border-b border-gray-100 space-y-2.5">
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Nombre del kit *</label>
                <input
                  value={kitName}
                  onChange={e => setKitName(e.target.value)}
                  placeholder="Ej: Kit O-rings Hayward CX900"
                  className="w-full px-3 py-2 text-[13px] font-semibold border border-gray-200 rounded-xl focus:outline-none focus:border-[#07111F] placeholder:font-normal"
                />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Categoría</label>
                  <select
                    value={category}
                    onChange={e => setCategory(e.target.value)}
                    className="w-full px-3 py-2 text-[12px] border border-gray-200 rounded-xl bg-white focus:outline-none focus:border-[#07111F]"
                  >
                    <option value="">Sin categoría</option>
                    {allCategories.filter(c => c !== 'Todas').map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Notas internas</label>
                  <input
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="Uso, referencia, armado…"
                    className="w-full px-3 py-2 text-[12px] border border-gray-200 rounded-xl focus:outline-none focus:border-[#07111F]"
                  />
                </div>
              </div>
            </div>

            {/* Search productos */}
            <div className="shrink-0 px-5 py-3 border-b border-gray-100">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">Agregar componente</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input
                  ref={searchRef}
                  value={search}
                  onChange={e => { setSearch(e.target.value); setShowResults(true); }}
                  onFocus={() => setShowResults(true)}
                  placeholder="Buscar producto por nombre o SKU…"
                  className="w-full pl-9 pr-3 py-2 text-[12px] border border-gray-200 rounded-xl focus:outline-none focus:border-[#07111F]"
                />
                {/* Search dropdown */}
                {showResults && searchResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-10 overflow-y-auto max-h-72">
                    {searchResults.map(p => {
                      const img = p.image || buildOdooImageUrl(p.odooId, 'product.template', odooUrl);
                      return (
                        <button
                          key={p.id}
                          onMouseDown={() => addComponent(p)}
                          className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 text-left transition-colors"
                        >
                          <div className="w-8 h-8 rounded-lg bg-gray-50 border border-gray-100 overflow-hidden shrink-0 flex items-center justify-center">
                            {img
                              ? <img src={img} alt={p.name} className="w-full h-full object-contain p-0.5" />
                              : <ImageIcon className="w-3 h-3 text-gray-300" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] font-semibold text-gray-900 line-clamp-1">{p.name}</p>
                            <p className="text-[10px] text-gray-400">{p.sku ? `${p.sku} · ` : ''}{p.supplierName ?? ''}</p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-[11px] font-bold text-gray-700">{fmt(p.cost)}</p>
                            <p className="text-[9px] text-gray-400">costo</p>
                          </div>
                          <Plus className="w-4 h-4 text-[#07111F] shrink-0" />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Component list */}
            <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
              {components.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full py-12 text-center">
                  <Package className="w-10 h-10 text-gray-200 mb-3" />
                  <p className="text-[13px] font-semibold text-gray-400">Sin componentes todavía</p>
                  <p className="text-[11px] text-gray-300 mt-1">Buscá productos arriba para agregarlos al kit</p>
                </div>
              ) : (
                components.map((c, i) => (
                  <div key={c.productId} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50/50 transition-colors group">
                    {/* Index */}
                    <span className="text-[10px] font-bold text-gray-300 w-4 shrink-0">{i + 1}</span>

                    {/* Foto */}
                    <div className="w-9 h-9 rounded-lg bg-gray-50 border border-gray-100 overflow-hidden shrink-0 flex items-center justify-center">
                      {c.image
                        ? <img src={c.image} alt={c.productName} className="w-full h-full object-contain p-0.5" />
                        : <ImageIcon className="w-3.5 h-3.5 text-gray-300" />}
                    </div>

                    {/* Name */}
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-semibold text-gray-900 line-clamp-1">{c.productName}</p>
                      <p className="text-[10px] text-gray-400">{fmt(c.unitCost)} c/u</p>
                    </div>

                    {/* Qty control */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => updateQty(c.productId, -1)}
                        className="w-6 h-6 flex items-center justify-center rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <input
                        type="number"
                        min={1}
                        value={c.qty}
                        onChange={e => { const v = parseInt(e.target.value); if (v >= 1) setQty(c.productId, v); }}
                        className="w-10 text-center text-[12px] font-bold border border-gray-200 rounded-lg py-0.5 focus:outline-none focus:border-[#07111F]"
                      />
                      <button
                        onClick={() => updateQty(c.productId, 1)}
                        className="w-6 h-6 flex items-center justify-center rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>

                    {/* Subtotal */}
                    <div className="shrink-0 text-right w-20">
                      <p className="text-[12px] font-black text-gray-900">{fmt(c.subtotal)}</p>
                    </div>

                    {/* Remove */}
                    <button
                      onClick={() => removeComponent(c.productId)}
                      className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-300 hover:text-[#EF4444] hover:bg-[#EF4444]/10 transition-all opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Cost total */}
            {components.length > 0 && (
              <div className="shrink-0 px-5 py-3 bg-[#07111F] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-white/50 text-[11px] font-semibold uppercase tracking-wider">Costo total del kit</span>
                  <span className="text-[10px] text-white/30">{components.length} componentes</span>
                </div>
                <span className="text-[#FFE600] text-[18px] font-black tabular-nums">{fmt(totalCost)}</span>
              </div>
            )}
          </div>

          {/* ─── RIGHT: PRECIO + CREAR ─── */}
          <div className="w-[45%] flex flex-col overflow-hidden">

            {/* Price strategy */}
            <div className="shrink-0 px-5 pt-4 pb-3 border-b border-gray-100">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-2">Estrategia de precio</label>
              <div className="grid grid-cols-3 gap-2">
                {MARGIN_OPTIONS.map(opt => (
                  <button
                    key={opt.label}
                    onClick={() => { setSelectedMarginPct(opt.pct); setPriceMode('auto'); }}
                    className={cn(
                      'rounded-xl border p-2.5 text-left transition-all',
                      selectedMarginPct === opt.pct && priceMode === 'auto'
                        ? opt.bg + ' ring-1 ring-inset ring-current'
                        : 'border-gray-200 hover:border-gray-300',
                    )}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <div className={cn('w-1.5 h-1.5 rounded-full', opt.dot)} />
                      <span className={cn('text-[11px] font-black', selectedMarginPct === opt.pct && priceMode === 'auto' ? opt.color : 'text-gray-700')}>
                        {opt.label}
                      </span>
                    </div>
                    <p className={cn('text-[13px] font-black tabular-nums', opt.color)}>
                      {totalCost > 0 ? fmt(calcPrice(totalCost, opt.pct)) : '—'}
                    </p>
                    <p className="text-[9px] text-gray-400 mt-0.5">{opt.pct}% margen · {opt.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Custom price override */}
            <div className="shrink-0 px-5 py-3 border-b border-gray-100">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">Precio final (editable)</label>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-gray-400 font-bold">$</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={priceMode === 'custom' ? customPrice : finalPrice > 0 ? String(finalPrice) : ''}
                    onChange={e => {
                      setCustomPrice(e.target.value);
                      setPriceMode('custom');
                    }}
                    onFocus={() => {
                      if (priceMode === 'auto') {
                        setCustomPrice(String(finalPrice));
                        setPriceMode('custom');
                      }
                    }}
                    placeholder="0"
                    className={cn(
                      'w-full pl-7 pr-3 py-2.5 text-[16px] font-black border rounded-xl focus:outline-none transition-colors tabular-nums',
                      priceMode === 'custom'
                        ? 'border-[#07111F] bg-[#07111F]/5'
                        : 'border-gray-200 focus:border-[#07111F]',
                    )}
                  />
                </div>
                {priceMode === 'custom' && (
                  <button
                    onClick={() => { setPriceMode('auto'); setCustomPrice(''); }}
                    className="px-3 py-2 text-[11px] font-semibold text-gray-500 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
                  >
                    Auto
                  </button>
                )}
              </div>
            </div>

            {/* Margin summary */}
            <div className="shrink-0 px-5 py-4 border-b border-gray-100">
              <div className="bg-gray-50 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-gray-500 font-semibold">Costo del kit</span>
                  <span className="text-[13px] font-black text-gray-900 tabular-nums">{fmt(totalCost)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-gray-500 font-semibold">Precio de venta</span>
                  <span className="text-[13px] font-black text-gray-900 tabular-nums">{finalPrice > 0 ? fmt(finalPrice) : '—'}</span>
                </div>
                <div className="h-px bg-gray-200" />
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-gray-500 font-semibold">Ganancia por kit</span>
                  <span className="text-[13px] font-black text-[#16A34A] tabular-nums">
                    {finalPrice > totalCost ? fmt(finalPrice - totalCost) : '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-gray-500 font-semibold">Margen</span>
                  <span className={cn('text-[22px] font-black tabular-nums', marginColor)}>
                    {totalCost > 0 && finalPrice > 0 ? `${finalMargin.toFixed(1)}%` : '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-gray-500 font-semibold">Markup</span>
                  <span className="text-[12px] font-bold text-gray-600 tabular-nums">
                    {finalMarkup > 0 ? `${finalMarkup.toFixed(1)}%` : '—'}
                  </span>
                </div>

                {/* Margin health bar */}
                {totalCost > 0 && finalPrice > 0 && (
                  <div className="pt-1">
                    <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className={cn('h-full rounded-full transition-all duration-300',
                          finalMargin >= 45 ? 'bg-[#16A34A]' : finalMargin >= 35 ? 'bg-[#F97316]' : 'bg-[#EF4444]'
                        )}
                        style={{ width: `${Math.min(100, (finalMargin / 70) * 100)}%` }}
                      />
                    </div>
                    <div className="flex justify-between mt-1">
                      <span className="text-[9px] text-gray-400">0%</span>
                      <span className="text-[9px] text-gray-400">35%</span>
                      <span className="text-[9px] text-gray-400">70%</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Competitive context */}
              {components.length > 0 && (
                <div className="mt-3 rounded-xl bg-[#07111F]/5 border border-[#07111F]/10 p-3">
                  <div className="flex items-start gap-2">
                    <Target className="w-3.5 h-3.5 text-[#07111F] shrink-0 mt-0.5" />
                    <div>
                      <p className="text-[11px] font-bold text-[#07111F] mb-1">Precio competitivo</p>
                      <p className="text-[10px] text-gray-600 leading-relaxed">
                        Para estar en MercadoLibre con 20% de comisión, el costo real es{' '}
                        <span className="font-bold">{fmt(totalCost / 0.8)}</span> (precio × 80%).{' '}
                        Precio ML sugerido:{' '}
                        <span className="font-bold text-[#07111F]">{fmt(calcPrice(totalCost / 0.8, selectedMarginPct))}</span>
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Error */}
            {error && (
              <div className="mx-5 mt-3 flex items-center gap-2 px-3 py-2 bg-[#EF4444]/10 border border-[#EF4444]/20 rounded-xl">
                <AlertTriangle className="w-3.5 h-3.5 text-[#EF4444] shrink-0" />
                <p className="text-[11px] text-[#EF4444] font-semibold">{error}</p>
              </div>
            )}

            {/* Spacer */}
            <div className="flex-1" />

            {/* Create button */}
            <div className="shrink-0 px-5 py-4 border-t border-gray-100">
              <button
                onClick={handleCreate}
                disabled={!canCreate || saving}
                className={cn(
                  'w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl font-black text-[14px] transition-all',
                  canCreate && !saving
                    ? 'bg-[#07111F] text-white hover:bg-[#1a2e47] active:scale-[0.98]'
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed',
                )}
              >
                {saving ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Creando…
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    Crear Kit como producto
                    <ChevronRight className="w-4 h-4" />
                  </>
                )}
              </button>
              {canCreate && !saving && (
                <p className="text-center text-[10px] text-gray-400 mt-2">
                  Se agregará a la lista de productos con badge{' '}
                  <span className="font-bold text-[#07111F]">KIT</span>
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
