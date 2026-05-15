'use client';

import { useState, useMemo, useEffect } from 'react';
import { useColumnResize } from '@/lib/use-column-resize';
import productsData from '@/data/products.json';
import {
  Search, LayoutGrid, List, Package,
  ChevronDown, Sparkles, Image as ImageIcon,
  X, ExternalLink, Copy, Edit2,
  Truck, Star, ArrowUpRight, ChevronRight,
  Globe, AlertTriangle, Check,
  Tag, Eye, EyeOff,
} from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { useSettings, buildOdooImageUrl } from '@/lib/use-settings';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface Product {
  id: string;
  sku: string | null;
  name: string;
  barcode: string | null;
  cost: number;
  price: number;
  supPrice: number;
  supMinQty: number;
  supCode: string | null;
  supProductName: string | null;
  supplierName: string | null;
  supPartnerId: string | null;
  tag: string | null;
  uom: string;
  category: string | null;
  posCategory: string | null;
  isPublished: boolean;
  isFavorite: boolean;
  availablePos: boolean;
  margin: number | null;
  markup: number | null;
  status: string;
  image: string | null;
  odooId: number | null;
  active: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calcula el status de un producto a partir de sus datos reales.
 * No confía en el campo `status` importado (puede venir como 'active' en inglés
 * o desactualizado). Siempre lo deriva on-the-fly.
 */
function derivedStatus(p: { cost: number; price: number; margin: number | null }): string {
  if (!p.cost || p.cost === 0) return 'sin_costo';
  if (!p.price || p.price <= 1) return 'revisar';      // precio placeholder ($1 en Odoo)
  if (p.margin !== null && p.margin < 35) return 'critico';
  return 'activo';
}

const products = (productsData as unknown as Product[]).map(p => ({
  ...p,
  active: p.active !== false, // default true si el campo no existe
  status: derivedStatus(p),
}));

const allCategories = ['Todas', ...Array.from(new Set(
  products.map(p => (p.category || 'Sin categoría').split(' / ')[0])
)).sort()];

const allSuppliers = ['Todos', ...Array.from(new Set(
  products.map(p => p.supplierName || 'Sin proveedor')
)).sort()];

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const roundTo10 = (n: number) => Math.round(n / 10) * 10;

function formatARS(n: number) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', maximumFractionDigits: 0,
  }).format(n);
}

function marginBadge(m: number | null) {
  if (m === null) return { bg: 'bg-gray-200 text-gray-500',       text: '—'      };
  if (m >= 55)    return { bg: 'bg-[#16A34A] text-white',         text: `${m}%`  };
  if (m >= 45)    return { bg: 'bg-[#4ADE80] text-[#14532D]',    text: `${m}%`  };
  if (m >= 35)    return { bg: 'bg-[#F97316] text-white',         text: `${m}%`  };
  return             { bg: 'bg-[#EF4444] text-white',             text: `${m}%`  };
}

function statusBadge(status: string) {
  return {
    cls:
      status === 'activo'    ? 'bg-[#16A34A]/10 text-[#16A34A]' :
      status === 'sin_costo' ? 'bg-gray-100 text-gray-400'       :
      status === 'revisar'   ? 'bg-[#EF4444]/10 text-[#EF4444]'  :
                               'bg-[#F97316]/10 text-[#F97316]',
    label:
      status === 'activo'    ? 'Activo'    :
      status === 'sin_costo' ? 'Sin costo' :
      status === 'revisar'   ? 'Revisar'   : 'Crítico',
  };
}

function calcLists(price: number) {
  if (!price || price <= 1) return null;
  return {
    A:           roundTo10(price),
    B:           roundTo10(price * 0.90),
    C:           roundTo10(price * 0.85),
    profesional: roundTo10(price * 0.80),
    consorcio:   roundTo10(price * 1.10),
    mayorista:   roundTo10(price * 0.75),
  };
}

function commercialReading(p: Product) {
  if (!p.cost || p.cost === 0) return {
    status: 'Falta costo',
    bg: 'bg-gray-100', textColor: 'text-gray-600', dot: 'bg-gray-400',
    body: 'No hay costo cargado. Sin este dato no se puede calcular rentabilidad ni exportar con seguridad.',
    action: 'Completar costo antes de exportar.',
  };
  if (p.status === 'revisar') return {
    status: 'Revisar precio',
    bg: 'bg-[#F97316]/8', textColor: 'text-[#F97316]', dot: 'bg-[#F97316]',
    body: 'Precio o costo con inconsistencias. Revisá los datos antes de usar en pedido o export.',
    action: 'Corregir inconsistencia de precio/costo.',
  };
  if (p.margin !== null && p.margin < 35) return {
    status: 'Margen crítico',
    bg: 'bg-[#EF4444]/8', textColor: 'text-[#EF4444]', dot: 'bg-[#EF4444]',
    body: `Margen de ${p.margin}% por debajo del mínimo recomendado (35%). Revisá costo o precio de Lista A.`,
    action: 'Actualizar costo o subir precio Lista A.',
  };
  if (p.margin !== null && p.margin < 45) return {
    status: 'Margen ajustado',
    bg: 'bg-[#F97316]/8', textColor: 'text-[#F97316]', dot: 'bg-[#F97316]',
    body: `Margen de ${p.margin}% en zona de atención. Aceptable pero verificá si el proveedor puede mejorar condiciones.`,
    action: 'Verificar condiciones de compra.',
  };
  return {
    status: 'Ganancia sana',
    bg: 'bg-[#16A34A]/8', textColor: 'text-[#16A34A]', dot: 'bg-[#16A34A]',
    body: `Margen de ${p.margin !== null ? p.margin + '%' : '—'} sobre Lista A. Producto rentable con los datos actuales.`,
    action: 'Mantener precio y asegurar stock antes de promocionar.',
  };
}

function getMarketUrls(p: Product) {
  const q = encodeURIComponent(p.name.replace(/['"]/g, '').slice(0, 60));
  return [
    { name: 'MercadoLibre', url: `https://listado.mercadolibre.com.ar/${q}`,               cls: 'bg-[#FFE600] text-gray-900 hover:opacity-80' },
    { name: 'Acqua Shop',   url: `https://www.acquapacheco.com/shop?search=${q}`,           cls: 'bg-[#0784F2] text-white hover:opacity-80' },
    { name: 'Jumbo',        url: `https://www.jumbo.com.ar/busca/?ft=${q}`,                 cls: 'bg-red-500 text-white hover:opacity-80' },
    { name: 'Carrefour',    url: `https://www.carrefour.com.ar/busca/?ft=${q}`,             cls: 'bg-blue-600 text-white hover:opacity-80' },
    { name: 'PedidosYa',    url: `https://www.pedidosya.com.ar/supermercados?search=${q}`,  cls: 'bg-orange-500 text-white hover:opacity-80' },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// ROW HELPER
// ─────────────────────────────────────────────────────────────────────────────

function Row({ label, value, strong, mono }: {
  label: string; value: string; strong?: boolean; mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-gray-400 shrink-0">{label}</span>
      <span className={cn(
        'text-[11px] text-right truncate',
        strong ? 'font-bold text-[#07111F]' : 'text-gray-600',
        mono && 'font-mono',
      )}>
        {value}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PRODUCT INSPECTOR
// ─────────────────────────────────────────────────────────────────────────────

function ProductInspector({ product: p, onClose, odooUrl = '', onToggleActive }: {
  product: Product;
  onClose: () => void;
  odooUrl?: string;
  onToggleActive?: (id: string, active: boolean) => void;
}) {
  const [showMarket,   setShowMarket]   = useState(false);
  const [showLists,    setShowLists]    = useState(true);
  const [copied,       setCopied]       = useState<string | null>(null);
  const [toggling,     setToggling]     = useState(false);
  const imgSrc = p.image || buildOdooImageUrl(p.odooId, 'product.template', odooUrl);

  const handleToggleActive = async () => {
    setToggling(true);
    try {
      const newActive = !p.active;
      await fetch('/api/products', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id: p.id, active: newActive }),
      });
      onToggleActive?.(p.id, newActive);
    } finally {
      setToggling(false);
    }
  };

  const sb        = statusBadge(p.status);
  const lists     = calcLists(p.price);
  const rd        = commercialReading(p);
  const mb        = marginBadge(p.margin);
  const utilidad  = p.price > 1 && p.cost > 0 ? p.price - p.cost : null;
  const marketUrls = getMarketUrls(p);

  const missingFields: string[] = [];
  if (!p.sku && !p.barcode) missingFields.push('SKU / código');
  if (!p.cost || p.cost === 0) missingFields.push('Costo');
  if (!p.supplierName)  missingFields.push('Proveedor');
  if (!imgSrc)          missingFields.push('Foto');
  if (!p.category)      missingFields.push('Categoría');

  const copy = (text: string, key: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1800);
  };

  const supplierSlug = p.supplierName
    ? p.supplierName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    : '';

  return (
    <div className="bg-white rounded-[22px] border border-gray-100 shadow-sm flex flex-col max-h-[calc(100vh-88px)]">

      {/* ── 1. Header: estado + origen ── */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-gray-50 shrink-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={cn('whitespace-nowrap px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide', sb.cls)}>
            {sb.label}
          </span>
          <span className="px-2 py-0.5 bg-[#714B67]/10 text-[#714B67] rounded-full text-[10px] font-semibold">
            product.template
          </span>
          {p.isFavorite && <span className="text-[#F97316] text-[12px] leading-none">★</span>}
        </div>
        <div className="flex items-center gap-1 ml-1 shrink-0">
          {/* Toggle activo/inactivo */}
          <button
            onClick={handleToggleActive}
            disabled={toggling}
            title={p.active ? 'Desactivar producto' : 'Activar producto'}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all border',
              p.active
                ? 'bg-white border-gray-200 text-gray-500 hover:bg-red-50 hover:text-red-500 hover:border-red-200'
                : 'bg-[#16A34A]/10 border-[#16A34A]/20 text-[#16A34A] hover:bg-[#16A34A]/20',
              toggling && 'opacity-50',
            )}
          >
            {p.active
              ? <><EyeOff className="w-3 h-3" /> Desactivar</>
              : <><Eye    className="w-3 h-3" /> Activar</>}
          </button>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Scrollable body ── */}
      <div className="overflow-y-auto flex-1 divide-y divide-gray-50">

        {/* ── 2. Foto + Nombre + Identificadores ── */}
        <div className="px-4 py-4">
          <p className="text-[9px] font-black tracking-[0.15em] text-[#0784F2] uppercase mb-3">
            Ficha Producto Acqua
          </p>
          <div className="flex gap-3">
            {/* Foto */}
            <div className="w-[80px] h-[80px] rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-center shrink-0 overflow-hidden">
              {imgSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imgSrc} alt={p.name} className="w-full h-full object-contain p-1.5" />
              ) : (
                <div className="flex flex-col items-center gap-1 text-center p-2">
                  <ImageIcon className="w-6 h-6 text-gray-400" />
                  <span className="text-[8px] text-gray-400 leading-tight">sin foto</span>
                </div>
              )}
            </div>

            {/* Datos principales */}
            <div className="flex-1 min-w-0">
              <h2 className="text-[14px] font-black text-[#07111F] leading-snug mb-2 line-clamp-3">
                {p.name}
              </h2>

              {/* ID Odoo */}
              <div className="flex items-center gap-1 mb-1">
                <span className="text-[9px] font-mono text-gray-400 truncate">
                  tmpl_{p.id}
                </span>
                <button
                  onClick={() => copy(`product_template_${p.id}`, 'id')}
                  className="text-gray-400 hover:text-[#0784F2] shrink-0 transition-colors"
                >
                  {copied === 'id'
                    ? <Check className="w-2.5 h-2.5 text-[#16A34A]" />
                    : <Copy className="w-2.5 h-2.5" />}
                </button>
              </div>

              {/* SKU / Barcode */}
              <div className="flex items-center gap-1 flex-wrap mb-1.5">
                {p.sku && (
                  <span className="px-1.5 py-0.5 bg-gray-100 rounded text-[9px] font-mono text-gray-600">
                    {p.sku}
                  </span>
                )}
                {p.barcode && (
                  <span className="px-1.5 py-0.5 bg-gray-100 rounded text-[9px] font-mono text-gray-500">
                    {p.barcode}
                  </span>
                )}
                {!p.sku && !p.barcode && (
                  <span className="text-[9px] text-gray-400">sin código</span>
                )}
              </div>

              {/* Categoría · Proveedor */}
              <div className="flex items-center gap-1 flex-wrap">
                {p.category && (
                  <span className="text-[9px] text-gray-400 truncate max-w-[110px]">
                    {p.category.split(' / ').slice(-1)[0]}
                  </span>
                )}
                {p.supplierName && (
                  <>
                    {p.category && <span className="text-gray-400 text-[9px]">·</span>}
                    <span className="text-[9px] text-gray-500 font-semibold truncate max-w-[110px]">
                      {p.supplierName}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── 3. Precio protagonista ── */}
        <div className="px-4 py-4">
          <p className="text-[9px] font-bold tracking-widest text-gray-400 uppercase mb-3">
            Lista A · precio exportable
          </p>

          <div className="flex items-end gap-3 mb-4">
            <div className="flex-1 min-w-0">
              {p.price > 1 ? (
                <div className="text-[32px] font-black text-[#07111F] leading-none tracking-tight">
                  {formatARS(p.price)}
                </div>
              ) : (
                <div className="text-xl font-bold text-[#EF4444]">Sin precio</div>
              )}
              <div className="text-[10px] text-gray-400 mt-1">list_price · IVA incluido</div>
            </div>

            {/* Margen pill */}
            <div className={cn('rounded-2xl px-3 py-2.5 text-center min-w-[60px] shrink-0', mb.bg)}>
              <div className="text-[20px] font-black leading-none">{mb.text}</div>
              <div className="text-[9px] font-semibold mt-0.5 opacity-70">margen</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="bg-gray-50 rounded-xl px-3 py-2.5">
              <div className="text-[9px] text-gray-400 font-semibold uppercase tracking-wide mb-1">
                Costo neto
              </div>
              <div className="text-[15px] font-bold text-[#07111F]">
                {p.cost > 0
                  ? formatARS(p.cost)
                  : <span className="text-gray-400 text-[12px] font-medium">—</span>}
              </div>
            </div>
            <div className="bg-gray-50 rounded-xl px-3 py-2.5">
              <div className="text-[9px] text-gray-400 font-semibold uppercase tracking-wide mb-1">
                Utilidad
              </div>
              <div className={cn(
                'text-[15px] font-bold',
                utilidad !== null && utilidad > 0 ? 'text-[#16A34A]' : 'text-gray-400',
              )}>
                {utilidad !== null && utilidad > 0 ? formatARS(utilidad) : '—'}
              </div>
            </div>
          </div>

          {p.markup !== null && p.markup > 0 && (
            <p className="text-[10px] text-gray-400 mt-2">
              Markup: <span className="font-semibold text-gray-600">{p.markup}%</span>
            </p>
          )}
        </div>

        {/* ── 4. Lectura comercial ── */}
        <div className="px-4 py-3">
          <p className="text-[9px] font-bold tracking-widest text-gray-400 uppercase mb-2">
            Lectura comercial
          </p>
          <div className={cn('rounded-xl px-3 py-3', rd.bg)}>
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', rd.dot)} />
              <span className={cn('text-[11px] font-bold', rd.textColor)}>{rd.status}</span>
            </div>
            <p className={cn('text-[11px] leading-relaxed opacity-90', rd.textColor)}>{rd.body}</p>
            <p className={cn('text-[10px] font-semibold mt-2 opacity-70', rd.textColor)}>
              → {rd.action}
            </p>
          </div>
        </div>

        {/* ── 5. Estado operativo ── */}
        <div className="px-4 py-3">
          <p className="text-[9px] font-bold tracking-widest text-gray-400 uppercase mb-2">
            Estado operativo
          </p>
          <div className="grid grid-cols-4 gap-1.5">
            {[
              { label: 'Export', value: p.status === 'activo' ? 'Listo' : 'Bloq.', ok: p.status === 'activo' },
              { label: 'Costo',  value: p.cost > 0 ? 'OK' : 'Falta', ok: p.cost > 0 },
              { label: 'POS',    value: p.availablePos ? 'Sí' : 'No',  ok: p.availablePos },
              { label: 'Online', value: p.isPublished  ? 'Sí' : 'No',  ok: p.isPublished  },
            ].map(item => (
              <div key={item.label} className={cn(
                'rounded-xl px-1.5 py-2 text-center border',
                item.ok
                  ? 'bg-[#16A34A]/8 border-[#16A34A]/20'
                  : 'bg-gray-50 border-gray-100',
              )}>
                <div className={cn(
                  'text-[11px] font-bold leading-none',
                  item.ok ? 'text-[#16A34A]' : 'text-gray-400',
                )}>
                  {item.value}
                </div>
                <div className="text-[9px] text-gray-400 mt-1 leading-none">{item.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── 6. Recomendación Socio Acqua ── */}
        <div className="px-4 py-3">
          <div className="bg-[#0784F2]/8 border border-[#0784F2]/15 rounded-xl px-3 py-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Sparkles className="w-3.5 h-3.5 text-[#0784F2] shrink-0" />
              <span className="text-[10px] font-bold text-[#0784F2] uppercase tracking-wide">
                Socio Acqua
              </span>
            </div>
            <p className="text-[11px] text-[#07111F] leading-relaxed">
              {p.status === 'sin_costo'
                ? 'Completá el costo antes de exportar. Sin este dato el precio de Lista A no tiene respaldo de rentabilidad.'
                : p.status === 'revisar'
                ? 'Revisá precio y costo. Hay inconsistencias que pueden generar pérdida si se vende sin corregir.'
                : p.margin !== null && p.margin < 35
                ? `Margen crítico (${p.margin}%). Actualizá el costo o subí el precio antes de promover o exportar.`
                : p.margin !== null && p.margin < 45
                ? 'Margen ajustado. Podés vender, pero verificá si el proveedor puede mejorar las condiciones de compra.'
                : `Rentable. ${p.availablePos ? '' : 'Habilitá en POS si estás listo. '}Asegurate de tener stock antes de promocionar.`
              }
            </p>
          </div>
        </div>

        {/* ── 7. Mercado y competencia ── */}
        <div className="px-4 py-3">
          <button
            onClick={() => setShowMarket(v => !v)}
            className="flex items-center justify-between w-full group"
          >
            <p className="text-[9px] font-bold tracking-widest text-gray-400 uppercase">
              Mercado y competencia
            </p>
            <ChevronRight className={cn(
              'w-3.5 h-3.5 text-gray-400 transition-transform duration-200',
              showMarket && 'rotate-90',
            )} />
          </button>

          {showMarket && (
            <div className="mt-3 space-y-3">
              <div className="bg-gray-50 rounded-xl p-3 text-center border border-gray-100">
                <Globe className="w-5 h-5 text-gray-400 mx-auto mb-1.5" />
                <p className="text-[11px] text-gray-500 font-medium">Sin scan de mercado</p>
                <p className="text-[10px] text-gray-400 mt-0.5">
                  Buscá referencias antes de tocar Lista A.
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {marketUrls.map(m => (
                  <a
                    key={m.name}
                    href={m.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      'inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold transition-opacity',
                      m.cls,
                    )}
                  >
                    {m.name}
                    <ExternalLink className="w-2.5 h-2.5 opacity-70" />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── 8. Proveedor y costo ── */}
        {p.supplierName && (
          <div className="px-4 py-3">
            <p className="text-[9px] font-bold tracking-widest text-gray-400 uppercase mb-2.5">
              Proveedor y costo
            </p>
            <div className="space-y-2">
              <Row label="Proveedor"      value={p.supplierName}         strong />
              {p.supCode  && <Row label="Código prov."    value={p.supCode}            mono />}
              {p.supPrice > 0 && <Row label="Precio proveedor" value={formatARS(p.supPrice)} />}
              {p.supMinQty > 1 && <Row label="Mínimo"  value={`${p.supMinQty} ${p.uom}`} />}
              {p.supProductName && p.supProductName !== p.name && (
                <p className="text-[10px] text-gray-400 italic pt-1 border-t border-gray-50 line-clamp-2">
                  &ldquo;{p.supProductName}&rdquo;
                </p>
              )}
            </div>
            <Link
              href={`/proveedores/${supplierSlug}`}
              className="mt-3 flex items-center gap-1.5 px-3 py-2 border border-gray-200 rounded-xl text-[11px] font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              <Truck className="w-3 h-3" /> Abrir ficha proveedor
            </Link>
          </div>
        )}

        {/* ── 9. Listas calculadas ── */}
        {lists && (
          <div className="px-4 py-3">
            <button
              onClick={() => setShowLists(v => !v)}
              className="flex items-center justify-between w-full group"
            >
              <p className="text-[9px] font-bold tracking-widest text-gray-400 uppercase">
                Listas de precio
              </p>
              <ChevronRight className={cn(
                'w-3.5 h-3.5 text-gray-400 transition-transform duration-200',
                showLists && 'rotate-90',
              )} />
            </button>

            {showLists && (
              <div className="mt-2 space-y-1">
                {([
                  { label: 'Lista A',     val: lists.A,           hl: true  },
                  { label: 'Lista B',     val: lists.B,           hl: false },
                  { label: 'Lista C',     val: lists.C,           hl: false },
                  { label: 'Profesional', val: lists.profesional, hl: false },
                  { label: 'Consorcio',   val: lists.consorcio,   hl: false },
                  { label: 'Mayorista',   val: lists.mayorista,   hl: false },
                ] as const).map(l => (
                  <div
                    key={l.label}
                    className={cn(
                      'flex items-center justify-between py-1.5 px-2.5 rounded-lg',
                      l.hl
                        ? 'bg-[#0784F2]/8 border border-[#0784F2]/15'
                        : 'hover:bg-gray-50',
                    )}
                  >
                    <span className={cn(
                      'text-[11px] font-semibold',
                      l.hl ? 'text-[#0784F2]' : 'text-gray-500',
                    )}>
                      {l.label}
                    </span>
                    <span className={cn(
                      'text-[13px] font-bold',
                      l.hl ? 'text-[#0784F2]' : 'text-[#07111F]',
                    )}>
                      {formatARS(l.val)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── 10. Datos faltantes ── */}
        {missingFields.length > 0 && (
          <div className="px-4 py-3">
            <p className="text-[9px] font-bold tracking-widest text-[#F97316] uppercase mb-2">
              Completar datos
            </p>
            <div className="bg-[#F97316]/8 border border-[#F97316]/20 rounded-xl px-3 py-2.5 flex flex-wrap gap-1.5">
              {missingFields.map(f => (
                <span
                  key={f}
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#F97316]/15 text-[#F97316] rounded-full text-[10px] font-semibold"
                >
                  <AlertTriangle className="w-2.5 h-2.5" />
                  {f}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ── 11. Acciones rápidas ── */}
        <div className="px-4 py-4 shrink-0">
          <p className="text-[9px] font-bold tracking-widest text-gray-400 uppercase mb-3">
            Acciones
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setShowMarket(true)}
              className="flex items-center justify-center gap-1.5 py-2.5 px-3 bg-gray-50 border border-gray-200 rounded-xl text-[11px] font-semibold text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <Globe className="w-3.5 h-3.5" /> Buscar mercado
            </button>
            <button className="flex items-center justify-center gap-1.5 py-2.5 px-3 bg-[#714B67]/10 border border-[#714B67]/20 rounded-xl text-[11px] font-semibold text-[#714B67] hover:bg-[#714B67]/15 transition-colors">
              <ArrowUpRight className="w-3.5 h-3.5" /> Enviar a Export
            </button>
            <button className="flex items-center justify-center gap-1.5 py-2.5 px-3 border border-gray-200 rounded-xl text-[11px] font-semibold text-gray-600 hover:bg-gray-50 transition-colors">
              <Edit2 className="w-3.5 h-3.5" /> Editar datos
            </button>
            <button className="flex items-center justify-center gap-1.5 py-2.5 px-3 bg-[#FFE600] rounded-xl text-[11px] font-bold text-gray-900 hover:opacity-80 transition-opacity">
              <Star className="w-3.5 h-3.5" /> ML Lab
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STAT + DIVIDER
// ─────────────────────────────────────────────────────────────────────────────

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="text-center">
      <div className={cn('text-2xl font-bold', color)}>{value}</div>
      <div className="text-[10px] text-white/40 uppercase tracking-wide mt-0.5">{label}</div>
    </div>
  );
}
function Divider() { return <div className="w-px h-8 bg-white/10" />; }

// ─────────────────────────────────────────────────────────────────────────────
// PAGINATION
// ─────────────────────────────────────────────────────────────────────────────

function Pagination({
  page, totalPages, setPage,
}: {
  page: number;
  totalPages: number;
  setPage: React.Dispatch<React.SetStateAction<number>>;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50/50">
      <button
        onClick={() => setPage(p => Math.max(1, p - 1))}
        disabled={page === 1}
        className="px-3 py-1.5 text-[12px] font-medium border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-100 transition-colors"
      >
        ← Anterior
      </button>
      <div className="flex items-center gap-1">
        {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
          const pg = totalPages <= 7 ? i + 1
            : page <= 4            ? i + 1
            : page >= totalPages - 3 ? totalPages - 6 + i
            : page - 3 + i;
          return (
            <button
              key={pg}
              onClick={() => setPage(() => pg)}
              className={cn(
                'w-7 h-7 text-[11px] font-semibold rounded-md transition-colors',
                page === pg
                  ? 'bg-[#07111F] text-white'
                  : 'text-gray-500 hover:bg-gray-100',
              )}
            >
              {pg}
            </button>
          );
        })}
      </div>
      <button
        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
        disabled={page === totalPages}
        className="px-3 py-1.5 text-[12px] font-medium border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-100 transition-colors"
      >
        Siguiente →
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────

export default function ProductosPage() {
  const [selected,      setSelected]      = useState<Product | null>(null);
  const [search,        setSearch]        = useState('');
  const [category,      setCategory]      = useState('Todas');
  const [supplier,      setSupplier]      = useState('Todos');
  const [statusFilter,  setStatusFilter]  = useState('todos');
  const [view,          setView]          = useState<'lista' | 'grid'>('lista');
  const [page,          setPage]          = useState(1);
  const PER_PAGE = 50;

  // ── Columnas redimensionables ──
  const { widths: colW, startResize } = useColumnResize({
    producto:   260,
    categoria:  160,
    proveedor:  160,
    sku:        100,
    costo:      110,
    precio:     120,
    margen:     90,
    estado:     90,
  });

  // ── Odoo server URL para imágenes ──
  const { settings } = useSettings();
  const odooUrl = settings.odooServerUrl;

  // Helper para obtener la URL de imagen de un producto
  const getImg = (p: Product) =>
    p.image || buildOdooImageUrl(p.odooId, 'product.template', odooUrl);

  // ── Estado local de activos (para actualizar sin recargar la página) ──
  const [activeMap, setActiveMap] = useState<Record<string, boolean>>({});

  // Determina si un producto está activo considerando overrides locales
  const isActive = (p: Product) =>
    activeMap[p.id] !== undefined ? activeMap[p.id] : p.active;

  // Callback que recibe el toggle del inspector
  const handleToggleActive = (id: string, active: boolean) => {
    setActiveMap(prev => ({ ...prev, [id]: active }));
    // Si el producto seleccionado es el que se toggleó, actualizar el objeto
    setSelected(prev => prev && prev.id === id ? { ...prev, active } : prev);
  };

  // ── Leer filtros desde URL params (viene del Socio Acqua / consultor) ──
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const filterParam   = params.get('filter');
    const supplierParam = params.get('supplier');
    if (filterParam) {
      if (filterParam === 'noCost')    setStatusFilter('sin_costo');
      else if (filterParam === 'noImage')  setStatusFilter('noImage');
      else if (filterParam === 'noPrice')  setStatusFilter('noPrice');
      else if (filterParam === 'negMargin') setStatusFilter('negMargin');
      else if (filterParam === 'lowMargin') setStatusFilter('lowMargin');
      else setStatusFilter(filterParam);
    }
    if (supplierParam) setSupplier(supplierParam);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Stats globales ──
  const stats = useMemo(() => {
    // Solo productos activos para las stats
    const activos = products.filter(p => isActive(p));
    const inactivos = products.length - activos.length;
    // Solo incluir en el promedio productos con precio y costo reales (excluye placeholders price=1)
    const withMargin = activos.filter(p => p.margin !== null && p.price > 1 && p.cost > 0);
    return {
      total:        activos.length,
      inactivos,
      enPos:        activos.filter(p => p.availablePos).length,
      online:       activos.filter(p => p.isPublished).length,
      sinProveedor: activos.filter(p => !p.supplierName).length,
      sinCosto:     activos.filter(p => p.status === 'sin_costo').length,
      revisar:      activos.filter(p => p.status === 'revisar' || p.status === 'critico').length,
      avgMargin:    withMargin.length
        ? Math.round(withMargin.reduce((a, p) => a + p.margin!, 0) / withMargin.length * 10) / 10
        : 0,
    };
  }, []);

  // ── Insights con acciones de filtro ──
  const insights = useMemo<{
    type: 'danger' | 'warning' | 'info' | 'success';
    text: string;
    filterKey?: string;
  }[]>(() => {
    const ins = [];
    if (stats.sinCosto > 0)
      ins.push({ type: 'danger'  as const, text: `${stats.sinCosto} productos sin costo — no se puede calcular precio.`,   filterKey: 'sin_costo' });
    if (stats.revisar > 0)
      ins.push({ type: 'warning' as const, text: `${stats.revisar} productos requieren revisión de precios.`,              filterKey: 'revisar'   });
    if (stats.sinProveedor > 0)
      ins.push({ type: 'warning' as const, text: `${stats.sinProveedor} sin proveedor asignado en Odoo.` });
    if (stats.inactivos > 0)
      ins.push({ type: 'info' as const, text: `${stats.inactivos} productos inactivos (excluidos del cálculo).`, filterKey: 'inactivo' });
    ins.push({
      type: stats.avgMargin >= 45 ? 'success' as const : stats.avgMargin >= 30 ? 'warning' as const : 'danger' as const,
      text: `Margen promedio: ${stats.avgMargin}%${stats.avgMargin >= 45 ? ' — saludable.' : stats.avgMargin >= 30 ? ' — ajustado.' : ' — crítico.'}`,
    });
    ins.push({ type: 'info'    as const, text: `${stats.online} publicados online · ${stats.enPos} en POS.` });
    return ins;
  }, [stats]);

  // ── Filtros ──
  const filtered = useMemo(() => {
    setPage(1);
    return products.filter(p => {
      const active = isActive(p);
      // Filtro de inactivos: si se pide 'inactivo' solo muestra inactivos;
      // si se pide 'todos' o cualquier otro filtro, muestra solo activos
      if (statusFilter === 'inactivo') return !active;
      if (!active) return false; // inactivos siempre ocultos en los demás filtros

      const q = search.toLowerCase();
      const matchSearch = !search
        || p.name.toLowerCase().includes(q)
        || (p.sku        || '').toLowerCase().includes(q)
        || (p.barcode    || '').toLowerCase().includes(q)
        || (p.supplierName || '').toLowerCase().includes(q)
        || (p.supCode    || '').toLowerCase().includes(q);
      const matchCat    = category     === 'Todas' || (p.category    || 'Sin categoría').startsWith(category);
      const matchSup    = supplier     === 'Todos' || (p.supplierName || 'Sin proveedor') === supplier;
      const matchStatus =
        statusFilter === 'todos'    ||
        p.status === statusFilter   ||
        (statusFilter === 'noImage'   && !getImg(p)) ||
        (statusFilter === 'noPrice'   && (!p.price || p.price === 0)) ||
        (statusFilter === 'negMargin' && p.margin !== null && p.margin < 0) ||
        (statusFilter === 'lowMargin' && p.margin !== null && p.margin >= 0 && p.margin < 30);
      return matchSearch && matchCat && matchSup && matchStatus;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, category, supplier, statusFilter]);

  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const paginated  = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const inspectorOpen = !!selected;

  return (
    <div className="min-h-screen bg-[#F4F7FA]">

      {/* ── Hero ── */}
      <div className="bg-[#07111F] border-b border-white/10 px-5 lg:px-8 xl:px-12 py-5">
        <div className="max-w-[1680px] mx-auto flex items-start justify-between gap-4">
          <div>
            <p className="text-white/40 text-[11px] font-semibold uppercase tracking-widest mb-1">Inventario</p>
            <h1 className="text-white font-bold text-2xl">Productos</h1>
            <p className="text-white/40 text-sm mt-0.5">
              {stats.total} productos · Odoo sync 13/05/2026
            </p>
          </div>
          <div className="hidden lg:flex items-center gap-6 shrink-0">
            <Stat label="Total"        value={String(stats.total)}       color="text-white" />
            <Divider />
            <Stat label="Margen prom." value={`${stats.avgMargin}%`}     color="text-[#16A34A]" />
            <Divider />
            <Stat label="En POS"       value={String(stats.enPos)}       color="text-[#0784F2]" />
            <Divider />
            <Stat label="Online"       value={String(stats.online)}      color="text-[#0784F2]" />
            {stats.sinCosto > 0 && (
              <>
                <Divider />
                <Stat label="Sin costo"  value={String(stats.sinCosto)} color="text-[#EF4444]" />
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Layout principal ── */}
      <div className="max-w-[1680px] mx-auto px-5 lg:px-8 xl:px-12 py-5">
        <div className={cn(
          'grid grid-cols-1 gap-6 items-start',
          inspectorOpen && 'lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]',
        )}>

          {/* ─────── COLUMNA IZQUIERDA ─────── */}
          <div className="min-w-0">

            {/* Socio Acqua — chips clickeables */}
            <div className="bg-white border border-gray-100 rounded-2xl p-4 mb-5 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded-full bg-[#0784F2]/10 border border-[#0784F2]/20 flex items-center justify-center shrink-0">
                  <Sparkles className="w-3.5 h-3.5 text-[#0784F2]" />
                </div>
                <span className="text-[12px] font-bold text-gray-700">Socio Acqua — Inventario</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {insights.map((ins, i) => {
                  const isClickable = !!ins.filterKey;
                  const isActive    = ins.filterKey === statusFilter;
                  const dotColor =
                    ins.type === 'danger'  ? 'bg-[#EF4444]' :
                    ins.type === 'warning' ? 'bg-[#F97316]' :
                    ins.type === 'success' ? 'bg-[#16A34A]' : 'bg-[#0784F2]';
                  const chipColor =
                    ins.type === 'danger'  ? 'bg-[#EF4444]/8 text-[#EF4444] border-[#EF4444]/15' :
                    ins.type === 'warning' ? 'bg-[#F97316]/8 text-[#F97316] border-[#F97316]/15' :
                    ins.type === 'success' ? 'bg-[#16A34A]/8 text-[#16A34A] border-[#16A34A]/15' :
                                             'bg-[#0784F2]/8 text-[#0784F2] border-[#0784F2]/15';
                  const ringColor =
                    ins.type === 'danger'  ? 'ring-[#EF4444]/40' :
                    ins.type === 'warning' ? 'ring-[#F97316]/40' : '';
                  return (
                    <div
                      key={i}
                      onClick={isClickable ? () => {
                        setStatusFilter(isActive ? 'todos' : ins.filterKey!);
                        setPage(1);
                      } : undefined}
                      className={cn(
                        'flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-lg border transition-all select-none',
                        chipColor,
                        isClickable && 'cursor-pointer hover:shadow-sm',
                        isActive && `ring-2 ${ringColor}`,
                      )}
                    >
                      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', dotColor)} />
                      {ins.text}
                      {isClickable && (
                        <span className="ml-0.5 text-[10px] font-bold opacity-50">
                          {isActive ? '✕' : '→'}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Toolbar */}
            <div className="flex flex-col sm:flex-row gap-3 mb-4">
              {/* Search */}
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={search}
                  onChange={e => { setSearch(e.target.value); setPage(1); }}
                  placeholder="Buscar por nombre, SKU, código, proveedor…"
                  className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0784F2]/30 focus:border-[#0784F2]"
                />
              </div>

              {/* Categoría */}
              <div className="relative">
                <select
                  value={category}
                  onChange={e => { setCategory(e.target.value); setPage(1); }}
                  className="appearance-none pl-3 pr-8 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#0784F2]/30 cursor-pointer"
                >
                  {allCategories.map(c => <option key={c}>{c}</option>)}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              </div>

              {/* Proveedor */}
              <div className="relative">
                <select
                  value={supplier}
                  onChange={e => { setSupplier(e.target.value); setPage(1); }}
                  className="appearance-none pl-3 pr-8 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#0784F2]/30 cursor-pointer max-w-[200px]"
                >
                  {allSuppliers.map(s => <option key={s}>{s}</option>)}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              </div>

              {/* Status */}
              <div className="flex bg-white border border-gray-200 rounded-xl overflow-hidden shrink-0">
                {[
                  { key: 'todos',     label: 'Todos'    },
                  { key: 'activo',    label: 'Activos'  },
                  { key: 'sin_costo', label: 'Sin costo'},
                  { key: 'revisar',   label: 'Revisar'  },
                ].map(s => (
                  <button
                    key={s.key}
                    onClick={() => { setStatusFilter(s.key); setPage(1); }}
                    className={cn(
                      'px-3 py-2.5 text-[11px] font-semibold transition-colors',
                      statusFilter === s.key
                        ? 'bg-[#07111F] text-white'
                        : 'text-gray-500 hover:text-gray-700',
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              {/* Vista */}
              <div className="flex bg-white border border-gray-200 rounded-xl overflow-hidden shrink-0">
                <button
                  onClick={() => setView('lista')}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-2.5 text-[12px] font-medium transition-colors',
                    view === 'lista' ? 'bg-[#07111F] text-white' : 'text-gray-500 hover:text-gray-700',
                  )}
                >
                  <List className="w-3.5 h-3.5" /> Lista
                </button>
                <button
                  onClick={() => setView('grid')}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-2.5 text-[12px] font-medium transition-colors',
                    view === 'grid' ? 'bg-[#07111F] text-white' : 'text-gray-500 hover:text-gray-700',
                  )}
                >
                  <LayoutGrid className="w-3.5 h-3.5" /> Grid
                </button>
              </div>
            </div>

            {/* Count + clear */}
            <div className="flex items-center justify-between mb-3">
              <p className="text-[12px] text-gray-400">
                <span className="font-semibold text-gray-700">{filtered.length}</span> de {stats.total} productos
                {stats.inactivos > 0 && (
                  <> · <span className="text-gray-400">{stats.inactivos} inactivos</span></>
                )}
                {search && (
                  <> · <span className="text-[#0784F2] font-medium">&ldquo;{search}&rdquo;</span></>
                )}
              </p>
              <div className="flex items-center gap-2">
                {statusFilter !== 'todos' && (
                  <button
                    onClick={() => setStatusFilter('todos')}
                    className="text-[11px] text-[#0784F2] hover:underline"
                  >
                    × quitar filtro
                  </button>
                )}
                {totalPages > 1 && (
                  <p className="text-[12px] text-gray-400">Pág. {page}/{totalPages}</p>
                )}
              </div>
            </div>

            {/* ─── LISTA ─── */}
            {view === 'lista' && (
              <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider bg-gray-50/80 border-b border-gray-100 select-none">
                        <th className="text-left px-4 py-2.5 relative group/th" style={{ width: colW.producto, minWidth: 120 }}>
                          Producto
                          <div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize opacity-0 group-hover/th:opacity-100 hover:bg-acqua/40 transition-opacity" onMouseDown={startResize('producto')} />
                        </th>
                        {!inspectorOpen && (
                          <th className="text-left px-3 py-2.5 hidden lg:table-cell relative group/th" style={{ width: colW.categoria, minWidth: 80 }}>
                            Categoría
                            <div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize opacity-0 group-hover/th:opacity-100 hover:bg-acqua/40 transition-opacity" onMouseDown={startResize('categoria')} />
                          </th>
                        )}
                        {!inspectorOpen && (
                          <th className="text-left px-3 py-2.5 hidden xl:table-cell relative group/th" style={{ width: colW.proveedor, minWidth: 80 }}>
                            Proveedor
                            <div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize opacity-0 group-hover/th:opacity-100 hover:bg-acqua/40 transition-opacity" onMouseDown={startResize('proveedor')} />
                          </th>
                        )}
                        <th className="text-center px-3 py-2.5 relative group/th" style={{ width: colW.sku, minWidth: 60 }}>
                          SKU
                          <div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize opacity-0 group-hover/th:opacity-100 hover:bg-acqua/40 transition-opacity" onMouseDown={startResize('sku')} />
                        </th>
                        <th className="text-right px-3 py-2.5 relative group/th" style={{ width: colW.costo, minWidth: 70 }}>
                          Costo
                          <div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize opacity-0 group-hover/th:opacity-100 hover:bg-acqua/40 transition-opacity" onMouseDown={startResize('costo')} />
                        </th>
                        <th className="text-right px-3 py-2.5 relative group/th" style={{ width: colW.precio, minWidth: 70 }}>
                          Lista A
                          <div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize opacity-0 group-hover/th:opacity-100 hover:bg-acqua/40 transition-opacity" onMouseDown={startResize('precio')} />
                        </th>
                        <th className="text-center px-3 py-2.5 relative group/th" style={{ width: colW.margen, minWidth: 60 }}>
                          Margen
                          <div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize opacity-0 group-hover/th:opacity-100 hover:bg-acqua/40 transition-opacity" onMouseDown={startResize('margen')} />
                        </th>
                        <th className="text-center px-3 py-2.5 hidden sm:table-cell relative group/th" style={{ width: colW.estado, minWidth: 60 }}>
                          Estado
                          <div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize opacity-0 group-hover/th:opacity-100 hover:bg-acqua/40 transition-opacity" onMouseDown={startResize('estado')} />
                        </th>
                        <th className="w-8 px-2 py-2.5" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {paginated.map(p => {
                        const mb2 = marginBadge(p.margin);
                        const isSelected = selected?.id === p.id;
                        const inactive = !isActive(p);
                        return (
                          <tr
                            key={p.id}
                            onClick={() => setSelected(isSelected ? null : p)}
                            className={cn(
                              'transition-colors cursor-pointer group',
                              inactive
                                ? 'opacity-45 bg-gray-50/60'
                                : isSelected
                                  ? 'bg-[#0784F2]/5 ring-1 ring-inset ring-[#0784F2]/20'
                                  : 'hover:bg-[#0784F2]/3',
                            )}
                          >
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-3">
                                <div className={cn(
                                  'w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 overflow-hidden',
                                  isSelected ? 'border-[#0784F2]/30 bg-[#0784F2]/5' : 'bg-gray-50 border-gray-200',
                                )}>
                                  {getImg(p)
                                    // eslint-disable-next-line @next/next/no-img-element
                                    ? <img src={getImg(p)!} alt={p.name} className="w-full h-full object-cover" />
                                    : <ImageIcon className="w-4 h-4 text-gray-400" />}
                                </div>
                                <div className="min-w-0">
                                  <p className={cn(
                                    'text-[12px] font-semibold leading-tight line-clamp-1',
                                    isSelected ? 'text-[#0784F2]' : 'text-gray-900',
                                  )}>
                                    {p.name}
                                  </p>
                                  <p className="text-[10px] text-gray-400 mt-0.5">
                                    {p.uom}{p.tag && ` · ${p.tag}`}
                                  </p>
                                </div>
                              </div>
                            </td>
                            {!inspectorOpen && (
                              <td className="px-3 py-2.5 hidden lg:table-cell">
                                <span className="text-[11px] text-gray-500 line-clamp-1">
                                  {p.category || '—'}
                                </span>
                              </td>
                            )}
                            {!inspectorOpen && (
                              <td className="px-3 py-2.5 hidden xl:table-cell">
                                <span className="text-[11px] text-gray-600 font-medium line-clamp-1">
                                  {p.supplierName || <span className="text-gray-400">—</span>}
                                </span>
                              </td>
                            )}
                            <td className="px-3 py-2.5 text-center">
                              {p.sku
                                ? <span className="text-[10px] font-mono text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">{p.sku}</span>
                                : <span className="text-gray-400">—</span>}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <span className="text-[12px] text-gray-600">
                                {p.cost > 0
                                  ? formatARS(p.cost)
                                  : <span className="text-gray-400">—</span>}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <span className="text-[13px] font-bold text-[#07111F]">
                                {p.price > 1
                                  ? formatARS(p.price)
                                  : <span className="text-[#EF4444] text-[11px] font-semibold">—</span>}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              <span className={cn(
                                'inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold',
                                mb2.bg,
                              )}>
                                {mb2.text}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-center hidden sm:table-cell">
                              <span className={cn(
                                'inline-flex whitespace-nowrap px-2 py-0.5 rounded-full text-[10px] font-semibold',
                                statusBadge(p.status).cls,
                              )}>
                                {statusBadge(p.status).label}
                              </span>
                            </td>
                            {/* Toggle activo — inline, sin abrir inspector */}
                            <td className="px-2 py-2.5 text-center"
                              onClick={e => e.stopPropagation()}
                            >
                              <button
                                onClick={() => handleToggleActive(p.id, !isActive(p))}
                                title={isActive(p) ? 'Desactivar' : 'Activar'}
                                className={cn(
                                  'w-6 h-6 flex items-center justify-center rounded-md transition-all opacity-0 group-hover:opacity-100',
                                  !isActive(p) && 'opacity-100',
                                  isActive(p)
                                    ? 'text-gray-400 hover:text-red-400 hover:bg-red-50'
                                    : 'text-[#16A34A] bg-[#16A34A]/10 hover:bg-[#16A34A]/20',
                                )}
                              >
                                {isActive(p) ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {totalPages > 1 && (
                  <Pagination page={page} totalPages={totalPages} setPage={setPage} />
                )}
              </div>
            )}

            {/* ─── GRID ─── */}
            {view === 'grid' && (
              <>
                <div className={cn(
                  'grid gap-3',
                  inspectorOpen
                    ? 'grid-cols-2 sm:grid-cols-3'
                    : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5',
                )}>
                  {paginated.map(p => {
                    const mb2 = marginBadge(p.margin);
                    const sb  = statusBadge(p.status);
                    const isSelected = selected?.id === p.id;
                    const inactive = !isActive(p);
                    return (
                      <div
                        key={p.id}
                        onClick={() => setSelected(isSelected ? null : p)}
                        className={cn(
                          'bg-white rounded-2xl border overflow-hidden hover:shadow-md transition-all cursor-pointer',
                          inactive
                            ? 'opacity-45 border-gray-100'
                            : isSelected
                              ? 'border-[#0784F2]/40 shadow-md ring-2 ring-[#0784F2]/20'
                              : 'border-gray-100 hover:border-gray-200',
                        )}
                      >
                        <div className="h-28 bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center relative overflow-hidden">
                          {getImg(p)
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <img src={getImg(p)!} alt={p.name} className="w-full h-full object-contain p-2" />
                            : <ImageIcon className="w-10 h-10 text-gray-400" />}
                          <span className={cn(
                            'absolute top-2 right-2 whitespace-nowrap px-1.5 py-0.5 rounded-full text-[9px] font-semibold',
                            sb.cls,
                          )}>
                            {sb.label}
                          </span>
                          {p.isFavorite && (
                            <span className="absolute top-2 left-2 text-[#F97316] text-[10px]">★</span>
                          )}
                        </div>
                        <div className="p-3">
                          <p className="text-[11px] font-semibold text-[#07111F] line-clamp-2 leading-tight mb-1">
                            {p.name}
                          </p>
                          {p.sku && (
                            <p className="text-[9px] font-mono text-gray-400 mb-2">{p.sku}</p>
                          )}
                          <div className="flex items-end justify-between">
                            <div>
                              <div className="text-[10px] text-gray-400">
                                {p.cost > 0 ? formatARS(p.cost) : '—'}
                              </div>
                              <div className="text-[13px] font-bold text-[#07111F]">
                                {p.price > 1 ? formatARS(p.price) : '—'}
                              </div>
                            </div>
                            <span className={cn(
                              'text-[12px] font-bold px-1.5 py-0.5 rounded-lg',
                              mb2.bg,
                            )}>
                              {mb2.text}
                            </span>
                          </div>
                          {p.supplierName && (
                            <p className="text-[9px] text-gray-400 mt-1.5 truncate">{p.supplierName}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-2 mt-5">
                    <button
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="px-4 py-2 text-[12px] font-medium border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-white bg-white"
                    >
                      ← Anterior
                    </button>
                    <span className="text-[12px] text-gray-500 px-3">{page}/{totalPages}</span>
                    <button
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                      className="px-4 py-2 text-[12px] font-medium border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-white bg-white"
                    >
                      Siguiente →
                    </button>
                  </div>
                )}
              </>
            )}

            {/* Sin resultados */}
            {filtered.length === 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center shadow-sm">
                <Package className="w-10 h-10 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-500 font-medium">Sin resultados</p>
                <p className="text-[13px] text-gray-400 mt-1">Probá con otros filtros o términos.</p>
                <button
                  onClick={() => {
                    setSearch('');
                    setCategory('Todas');
                    setSupplier('Todos');
                    setStatusFilter('todos');
                  }}
                  className="mt-4 px-4 py-2 bg-[#0784F2] text-white text-[12px] font-semibold rounded-lg hover:opacity-90"
                >
                  Limpiar filtros
                </button>
              </div>
            )}
          </div>

          {/* ─────── COLUMNA DERECHA: INSPECTOR (desktop) ─────── */}
          {inspectorOpen && (
            <div className="hidden lg:block">
              <div className="sticky top-4">
                <ProductInspector product={selected!} onClose={() => setSelected(null)} odooUrl={odooUrl} onToggleActive={handleToggleActive} />
              </div>
            </div>
          )}

        </div>

        {/* Inspector mobile (debajo de la lista) */}
        {inspectorOpen && (
          <div className="lg:hidden mt-5">
            <ProductInspector product={selected!} onClose={() => setSelected(null)} odooUrl={odooUrl} onToggleActive={handleToggleActive} />
          </div>
        )}

      </div>
    </div>
  );
}

// Evitar warning de import no utilizado
const _Tag = Tag;
void _Tag;
