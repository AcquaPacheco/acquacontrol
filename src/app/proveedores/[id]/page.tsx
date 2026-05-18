'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import { saveSupplierOverride, loadSupplierOverride } from '@/lib/use-local-storage';
import { loadGeminiKey } from '@/lib/gemini-key';
import type { Supplier, SupplierStatus } from '@/types';

// ── Colores por rubro ─────────────────────────────────────────────────────────
const rubroColors: Record<string, string> = {
  'Pileta & Química':        'bg-cyan-600 text-white',
  'Pileta & Limpieza':       'bg-cyan-700 text-white',
  'Pileta & Tratamiento':    'bg-sky-600 text-white',
  'Mangueras & Riego':       'bg-orange-600 text-white',
  'Riego & Jardinería':      'bg-green-600 text-white',
  'Jardín':                  'bg-emerald-600 text-white',
  'Limpieza':                'bg-blue-600 text-white',
  'Limpieza & Hogar':        'bg-blue-700 text-white',
  'Perfumería & Hogar':      'bg-purple-600 text-white',
  'Perfumería & Fragancias': 'bg-pink-600 text-white',
  'Papelera':                'bg-amber-600 text-white',
  'Química':                 'bg-red-600 text-white',
  'Almacén & Mascotas':      'bg-green-700 text-white',
  'default':                 'bg-zinc-600 text-white',
};

// ── Estado labels + colores ───────────────────────────────────────────────────
const statusConfig: Record<string, { label: string; color: string; dot: string }> = {
  actualizado:      { label: 'Actualizado',      color: 'text-success bg-success/10',  dot: 'bg-success' },
  atencion:         { label: 'Atención',          color: 'text-warning bg-warning/10',  dot: 'bg-warning' },
  pendiente:        { label: 'Pendiente',          color: 'text-zinc-400 bg-zinc-800',   dot: 'bg-zinc-500' },
  lista_vencida:    { label: 'Lista Vencida',      color: 'text-danger bg-danger/10',    dot: 'bg-danger' },
  falta_actualizar: { label: 'Falta Actualizar',   color: 'text-warning bg-warning/10',  dot: 'bg-warning' },
  lista_cargada:    { label: 'Lista Cargada',      color: 'text-acqua bg-acqua/10',      dot: 'bg-acqua' },
  revisar_errores:  { label: 'Revisar Errores',    color: 'text-danger bg-danger/10',    dot: 'bg-danger' },
};
import odooData from '@/data/odoo-supplierinfo.json';
import productsData from '@/data/products.json';
import suppliersContactsRaw from '@/data/suppliers.json';

// ── Real contacts from Odoo export
interface RealContact {
  id: string; name: string; slug: string; phone: string | null;
  tags: string[]; fiscalCondition: string | null; odooId?: number | null;
}
const suppliersContacts = suppliersContactsRaw as unknown as RealContact[];
import {
  ArrowLeft, Upload, Download, Edit2, Phone, Mail, Building2,
  DollarSign, Package, CheckCircle2, Search,
  Info, RefreshCw, Sparkles, X,
  Eye, FileSpreadsheet, Calendar, TrendingUp, Copy, Save,
  LayoutGrid, List, ShoppingCart, Minus, Plus, FileDown,
  Image as ImageIcon, Tag, AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── URL base de Odoo (misma que en settings.json)
const ODOO_BASE = 'https://sistemasdehudson-acquapacheco1.odoo.com';

// ── Mapa de imágenes: keyed by odooId numérico (= tmpl_id en supplierinfo)
//    Usa URL de Odoo como imagen (sin base64 — el import almacena null en p.image)
const productImageMap: Record<string, string> = {};
(productsData as Array<{ id: string; sku: string | null; image: string | null; odooId?: number | null }>).forEach(p => {
  // Construir URL de Odoo si hay odooId
  const imgUrl = p.image || (p.odooId ? `${ODOO_BASE}/web/image/product.template/${p.odooId}/image_1920` : null);
  if (imgUrl) {
    if (p.odooId) productImageMap[String(p.odooId)] = imgUrl;  // ← tmpl_id en supplierinfo
    if (p.sku)    productImageMap[p.sku] = imgUrl;              // fallback por SKU
  }
});

// ── Tipos
interface OdooProduct {
  si_id: string;
  tmpl_id: string | null;
  tmpl_name: string;
  sup_name: string | null;
  code: string;
  min_qty: number;
  price: number;
  discount: number;
  net_price: number;
}

type ProductStatus = 'en_sistema' | 'no_figura' | 'sin_costo' | 'nuevo';
type ViewMode = 'tabla' | 'grid' | 'pedido';

interface ProductRow extends OdooProduct {
  productStatus: ProductStatus;
}

// ── Helpers
function formatARS(n: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
}

function daysSince(dateStr?: string) {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

// ── Exportar pedido a Excel (CSV descargable)
function exportarPedido(
  items: { code: string; tmpl_name: string; sup_name: string | null; price: number; qty: number; discount: number; net_price: number }[],
  supplierName: string
) {
  const rows = [
    ['COD', 'Nombre Odoo', 'Nombre Proveedor', 'Precio unitario', 'Descuento %', 'Precio neto', 'Cantidad', 'Subtotal'],
    ...items.map(i => [
      i.code || '',
      i.tmpl_name,
      i.sup_name || '',
      i.price.toFixed(2),
      i.discount.toString(),
      i.net_price.toFixed(2),
      i.qty.toString(),
      (i.net_price * i.qty).toFixed(2),
    ]),
    [],
    ['', '', '', '', '', '', 'TOTAL:', items.reduce((acc, i) => acc + i.net_price * i.qty, 0).toFixed(2)],
  ];

  const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pedido-${supplierName.toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── EditField
function EditField({
  label, value, onChange, type = 'text', options, placeholder,
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: 'text' | 'number' | 'email' | 'select' | 'textarea';
  options?: { value: string; label: string }[];
  placeholder?: string;
}) {
  const inputClass = 'w-full px-2.5 py-1.5 text-[12px] border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-acqua/30 focus:border-acqua bg-white';
  return (
    <div>
      <label className="block text-[9px] text-gray-400 font-semibold uppercase tracking-wide mb-0.5">{label}</label>
      {type === 'select' ? (
        <select value={value} onChange={e => onChange(e.target.value)} className={inputClass}>
          {options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : type === 'textarea' ? (
        <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={2} className={cn(inputClass, 'resize-none')} />
      ) : (
        <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={inputClass} />
      )}
    </div>
  );
}

// ── Modal de carga de lista — conectado al API real
type UploadPhase = 'idle' | 'selected' | 'previewing' | 'preview_ok' | 'importing' | 'done' | 'error';

interface PreviewSheet {
  type: string;
  stats: { total: number; imported: number; skipped: number; warnings: string[] };
  detectedCols: Record<string, number>;
  headers: string[];
  sample: unknown[];
  supplierInfo?: { name: string; slug: string };
}

function UploadModal({
  onClose,
  supplierName,
  supplierSlug,
}: {
  onClose: (refreshed?: boolean) => void;
  supplierName: string;
  supplierSlug: string;
}) {
  const [phase,    setPhase]    = useState<UploadPhase>('idle');
  const [dragging, setDragging] = useState(false);
  const [file,     setFile]     = useState<File | null>(null);
  const [preview,  setPreview]  = useState<PreviewSheet[] | null>(null);
  const [result,   setResult]   = useState<{ imported: number; skipped: number } | null>(null);
  const [error,    setError]    = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = (f: File) => {
    setFile(f);
    setPhase('selected');
    setError(null);
  };

  const runPreview = async () => {
    if (!file) return;
    setPhase('previewing');
    try {
      const buffer   = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
      const sheets   = workbook.SheetNames.map(name => ({
        name,
        rows: XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, defval: '', blankrows: false }),
      }));
      const res  = await fetch('/api/import-excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'supplier', supplierName, supplierSlug, dryRun: true, sheets }),
      });
      const data = await res.json() as { ok: boolean; sheets?: PreviewSheet[]; error?: string };

      if (!data.ok) throw new Error(data.error ?? 'Error desconocido');
      setPreview(data.sheets ?? []);
      setPhase('preview_ok');
    } catch (e) {
      setError(String(e));
      setPhase('error');
    }
  };

  const runImport = async () => {
    if (!file) return;
    setPhase('importing');
    try {
      const buffer   = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
      const sheets   = workbook.SheetNames.map(name => ({
        name,
        rows: XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, defval: '', blankrows: false }),
      }));
      const res  = await fetch('/api/import-excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'supplier', supplierName, supplierSlug, sheets }),
      });
      const data = await res.json() as { ok: boolean; isVercel?: boolean; summary?: { stats: { imported: number; skipped: number } }[]; error?: string };

      if (!data.ok) {
        if (data.isVercel) {
          setError('⚠️ Estás en producción (Vercel). Para importar listas usá "Comparar listas de precios" — te permite analizar diferencias sin necesidad de escribir al servidor. Para aplicar cambios, trabajá desde tu entorno local.');
        } else {
          throw new Error(data.error ?? 'Error desconocido');
        }
        setPhase('error');
        return;
      }
      const stats = data.summary?.[0]?.stats;
      setResult({ imported: stats?.imported ?? 0, skipped: stats?.skipped ?? 0 });
      setPhase('done');
    } catch (e) {
      setError(String(e));
      setPhase('error');
    }
  };

  const colLabel: Record<string, string> = {
    code: 'Código', name: 'Nombre', price: 'Precio base',
    discount: 'Descuento %', netPrice: 'Precio neto', minQty: 'Mín. cant.',
    supName: 'Nombre prov.', tmplId: 'ID Odoo',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl w-full max-w-xl shadow-2xl max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <div>
            <h3 className="font-bold text-gray-900">Cargar lista del proveedor</h3>
            <p className="text-[12px] text-gray-500 mt-0.5">{supplierName}</p>
          </div>
          <button onClick={() => onClose(phase === 'done')} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6">

          {/* ── IDLE / SELECTED: drop zone ── */}
          {(phase === 'idle' || phase === 'selected') && (
            <>
              <div className="flex items-center gap-2 mb-4 flex-wrap">
                {[
                  { label: 'Excel (.xlsx / .xls)', color: 'bg-green-50 text-green-700 border-green-200' },
                  { label: 'CSV', color: 'bg-orange-50 text-orange-700 border-orange-200' },
                ].map(f => (
                  <span key={f.label} className={cn('inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-lg border', f.color)}>
                    <FileSpreadsheet className="w-3 h-3" />
                    {f.label}
                  </span>
                ))}
              </div>

              {phase === 'idle' ? (
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
                  onClick={() => fileInputRef.current?.click()}
                  className={cn(
                    'border-2 border-dashed rounded-xl p-10 text-center transition-colors cursor-pointer',
                    dragging ? 'border-acqua bg-acqua/5' : 'border-gray-200 hover:border-acqua/50 hover:bg-gray-50',
                  )}
                >
                  <Upload className="w-8 h-8 text-gray-400 mx-auto mb-3" />
                  <p className="text-sm font-medium text-gray-600">Arrastrá el Excel aquí</p>
                  <p className="text-[12px] text-gray-400 mt-1">o hacé click para seleccionar</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                  />
                </div>
              ) : (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-success rounded-xl p-6 bg-success/5 text-center cursor-pointer hover:bg-success/10 transition-colors"
                >
                  <CheckCircle2 className="w-8 h-8 text-success mx-auto mb-2" />
                  <p className="text-sm font-semibold text-gray-700">{file?.name}</p>
                  <p className="text-[12px] text-gray-400 mt-1">Click para cambiar el archivo</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                  />
                </div>
              )}

              <p className="text-[11px] text-gray-400 mt-3 text-center">
                El sistema detecta las columnas automáticamente. Podés ver el preview antes de confirmar.
              </p>
            </>
          )}

          {/* ── PREVIEWING ── */}
          {phase === 'previewing' && (
            <div className="flex flex-col items-center py-10 gap-3">
              <RefreshCw className="w-8 h-8 text-acqua animate-spin" />
              <p className="text-sm text-gray-600 font-medium">Analizando el archivo…</p>
              <p className="text-[12px] text-gray-400">Detectando columnas y leyendo filas</p>
            </div>
          )}

          {/* ── PREVIEW OK: mostrar detección ── */}
          {phase === 'preview_ok' && preview && preview.map((sheet, si) => (
            <div key={si} className="space-y-4">
              {/* Stats detectadas */}
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-acqua/5 border border-acqua/20 rounded-xl p-3 text-center">
                  <div className="text-xl font-bold text-acqua">{sheet.stats.imported}</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">Productos leídos</div>
                </div>
                <div className="bg-gray-50 rounded-xl p-3 text-center">
                  <div className="text-xl font-bold text-gray-500">{sheet.stats.skipped}</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">Filas vacías</div>
                </div>
                <div className={cn('rounded-xl p-3 text-center', sheet.stats.warnings.length ? 'bg-warning/5 border border-warning/20' : 'bg-success/5 border border-success/20')}>
                  <div className={cn('text-xl font-bold', sheet.stats.warnings.length ? 'text-warning' : 'text-success')}>{sheet.stats.warnings.length}</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">Advertencias</div>
                </div>
              </div>

              {/* Columnas detectadas */}
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-3">Columnas detectadas</p>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(sheet.detectedCols)
                    .filter(([, idx]) => idx !== -1)
                    .map(([field, idx]) => (
                      <div key={field} className="flex items-center gap-2">
                        <CheckCircle2 className="w-3 h-3 text-success shrink-0" />
                        <span className="text-[11px] text-gray-600">
                          <span className="font-semibold">{colLabel[field] || field}</span>
                          {' → '}
                          <span className="text-gray-400 font-mono text-[10px]">col. {idx + 1}</span>
                        </span>
                      </div>
                    ))}
                  {Object.entries(sheet.detectedCols)
                    .filter(([, idx]) => idx === -1)
                    .map(([field]) => (
                      <div key={field} className="flex items-center gap-2 opacity-40">
                        <X className="w-3 h-3 text-gray-400 shrink-0" />
                        <span className="text-[11px] text-gray-400">{colLabel[field] || field} — no encontrada</span>
                      </div>
                    ))}
                </div>
              </div>

              {/* Advertencias */}
              {sheet.stats.warnings.length > 0 && (
                <div className="bg-warning/5 border border-warning/20 rounded-xl p-3 space-y-1">
                  {sheet.stats.warnings.slice(0, 3).map((w, i) => (
                    <p key={i} className="text-[11px] text-warning">{w}</p>
                  ))}
                  {sheet.stats.warnings.length > 3 && (
                    <p className="text-[11px] text-warning opacity-60">+ {sheet.stats.warnings.length - 3} más…</p>
                  )}
                </div>
              )}

              {/* Sample */}
              {(sheet.sample as Record<string, unknown>[]).length > 0 && (
                <div className="bg-gray-50 rounded-xl overflow-hidden">
                  <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide px-3 py-2 border-b border-gray-200">
                    Muestra (primeras {sheet.sample.length} filas)
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[10px]">
                      <thead>
                        <tr className="border-b border-gray-200">
                          {['code', 'tmpl_name', 'price', 'discount', 'net_price'].map(k => (
                            <th key={k} className="text-left px-3 py-1.5 text-gray-400 font-semibold">{k}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(sheet.sample as Record<string, unknown>[]).map((row, i) => (
                          <tr key={i} className="border-b border-gray-100 last:border-0">
                            {['code', 'tmpl_name', 'price', 'discount', 'net_price'].map(k => (
                              <td key={k} className="px-3 py-1.5 text-gray-600 max-w-[120px] truncate">
                                {String(row[k] ?? '—')}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* ── IMPORTING ── */}
          {phase === 'importing' && (
            <div className="flex flex-col items-center py-10 gap-3">
              <RefreshCw className="w-8 h-8 text-acqua animate-spin" />
              <p className="text-sm text-gray-600 font-medium">Importando lista…</p>
              <p className="text-[12px] text-gray-400">Esto reemplaza la lista anterior de {supplierName}</p>
            </div>
          )}

          {/* ── DONE ── */}
          {phase === 'done' && result && (
            <div className="flex flex-col items-center py-8 gap-4">
              <div className="w-14 h-14 rounded-full bg-success/10 flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-success" />
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-gray-900">Lista cargada</p>
                <p className="text-sm text-gray-500 mt-1">
                  <span className="font-semibold text-acqua">{result.imported}</span> productos importados ·{' '}
                  <span className="text-gray-400">{result.skipped} filas vacías</span>
                </p>
              </div>
              <div className="bg-success/5 border border-success/20 rounded-xl p-4 text-[12px] text-gray-600 text-center max-w-xs">
                La lista de <strong>{supplierName}</strong> está actualizada. Ahora podés ver los productos en la solapa "Tabla".
              </div>
            </div>
          )}

          {/* ── ERROR ── */}
          {phase === 'error' && (
            <div className="flex flex-col items-center py-8 gap-4">
              <div className="w-12 h-12 rounded-full bg-danger/10 flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-danger" />
              </div>
              <div className="text-center">
                <p className="text-sm font-bold text-danger">Error al procesar el archivo</p>
                <p className="text-[12px] text-gray-500 mt-1 max-w-sm">{error}</p>
              </div>
              <button
                onClick={() => { setPhase('selected'); setError(null); }}
                className="text-[12px] text-acqua hover:underline font-medium"
              >
                Intentar de nuevo
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 sticky bottom-0 bg-white">
          <button
            onClick={() => onClose(phase === 'done')}
            className="px-4 py-2 text-[13px] text-gray-500 hover:text-gray-700 font-medium"
          >
            {phase === 'done' ? 'Cerrar' : 'Cancelar'}
          </button>

          <div className="flex gap-2">
            {/* Preview */}
            {phase === 'selected' && (
              <button
                onClick={runPreview}
                className="flex items-center gap-2 px-4 py-2 border border-acqua text-acqua text-[13px] font-semibold rounded-lg hover:bg-acqua/5 transition-colors"
              >
                <Eye className="w-3.5 h-3.5" />
                Ver preview
              </button>
            )}

            {/* Importar directo */}
            {phase === 'selected' && (
              <button
                onClick={runImport}
                className="flex items-center gap-2 px-5 py-2 bg-acqua text-white text-[13px] font-semibold rounded-lg hover:bg-acqua-dark transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Importar
              </button>
            )}

            {/* Confirmar tras preview */}
            {phase === 'preview_ok' && (
              <button
                onClick={runImport}
                className="flex items-center gap-2 px-5 py-2 bg-acqua text-white text-[13px] font-semibold rounded-lg hover:bg-acqua-dark transition-colors"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Confirmar e importar
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ── COMPARAR LISTAS DE PRECIOS
// ─────────────────────────────────────────────────────────────────────────────

type Decision = 'mantener' | 'aplicar_markup' | 'marcar_promo' | 'revisar';

interface DiffItem {
  code: string; desc: string;
  oldPrice: number; newPrice: number; delta: number; pct: number; uxb: number;
  clusterPct?: number; clusterHint?: 'adjustment' | 'promo' | 'individual';
  suspicious: boolean;
  inSystem: boolean;
  productId?: string; odooId?: number | null; productName?: string;
  currentSalePrice?: number; currentMargin?: number;
  marginIfMantener?: number; marginIfMarkup?: number; marginImprovement?: number;
}

interface ClusterInfo {
  pct: number; count: number;
  hint: 'adjustment' | 'promo' | 'individual';
  label: string;
}

interface CompareResult {
  stats: {
    upCount: number; downCount: number; newCount: number; discCount: number;
    unchangedCt: number; suspiciousDown: number; linkedCount: number;
  };
  up: DiffItem[]; down: DiffItem[];
  new: DiffItem[]; discontinued: DiffItem[];
  downClusters: ClusterInfo[]; upClusters: ClusterInfo[];
}

type ComparePhase = 'idle' | 'comparing' | 'results' | 'applying' | 'done';
type CompareTab   = 'down' | 'up' | 'new' | 'disc';

function pctBadge(item: DiffItem, clusters: ClusterInfo[]) {
  if (item.suspicious) return { color: 'bg-danger/10 text-danger border border-danger/20', label: '⚠️ Caída extrema' };
  if (item.clusterHint === 'adjustment') {
    const cl = clusters.find(c => c.pct === item.clusterPct);
    return { color: 'bg-blue-50 text-blue-700 border border-blue-200', label: `Bloque ${item.clusterPct}%` + (cl ? ` (${cl.count} prod.)` : '') };
  }
  if (item.clusterHint === 'promo') {
    return { color: 'bg-purple-50 text-purple-700 border border-purple-200', label: `Posible promo ${item.clusterPct}%` };
  }
  return null;
}

function ComparePriceModal({
  onClose, supplierName, supplierSlug,
}: {
  onClose: (refreshed?: boolean) => void;
  supplierName: string;
  supplierSlug: string;
}) {
  const [phase,        setPhase]        = useState<ComparePhase>('idle');
  const [newFile,      setNewFile]      = useState<File | null>(null);
  const [results,      setResults]      = useState<CompareResult | null>(null);
  const [activeTab,    setActiveTab]    = useState<CompareTab>('down');
  const [decisions,    setDecisions]    = useState<Record<string, Decision>>({});
  const [applyResult,  setApplyResult]  = useState<{ updatedCosts: number; updatedPrices: number } | null>(null);
  const [applyError,   setApplyError]   = useState<string | null>(null);
  const [isVercel,     setIsVercel]     = useState(false);
  const [dragging,     setDragging]     = useState(false);

  const newInputRef = useRef<HTMLInputElement>(null);

  // Init decisions when results arrive
  useEffect(() => {
    if (!results) return;
    const init: Record<string, Decision> = {};
    for (const item of results.up)   init[item.code] = 'aplicar_markup';
    for (const item of results.down) {
      // suspicious items default to 'revisar', cluster items to 'mantener'
      init[item.code] = item.suspicious ? 'revisar' : 'mantener';
    }
    setDecisions(init);
  }, [results]);

  const runCompare = async () => {
    if (!newFile) return;
    setPhase('comparing');
    try {
      // Parsear el Excel en el browser (evita el límite de 4.5MB de Vercel)
      // Se envían TODAS las hojas para capturar catálogos multi-hoja (ej: Vulcano)
      const buffer   = await newFile.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
      const sheets   = workbook.SheetNames.map(name => ({
        name,
        rows: XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, defval: '', blankrows: false }),
      }));

      const res = await fetch('/api/compare-pricelists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheets, supplierSlug, supplierName }),
      });
      const data = await res.json() as CompareResult & { ok: boolean; error?: string };
      if (!data.ok) throw new Error(data.error ?? 'Error desconocido');
      setResults(data);
      setPhase('results');
    } catch (e) {
      setPhase('idle');
      alert('Error comparando listas: ' + String(e));
    }
  };

  // Bulk change decision for a cluster group
  const setGroupDecision = (clusterPct: number, dec: Decision) => {
    if (!results) return;
    setDecisions(prev => {
      const next = { ...prev };
      for (const item of results.down) {
        if (item.clusterPct === clusterPct || Math.round(item.pct) === clusterPct) {
          next[item.code] = dec;
        }
      }
      return next;
    });
  };

  const setAllUpDecision = (dec: Decision) => {
    if (!results) return;
    setDecisions(prev => {
      const next = { ...prev };
      for (const item of results.up) next[item.code] = dec;
      return next;
    });
  };

  const runApply = async () => {
    if (!results) return;
    setPhase('applying');
    setApplyError(null);
    try {
      // Build items to apply: all up + down with decisions
      const items = [
        ...results.up.map(i => ({ code: i.code, desc: i.desc, newPrice: i.newPrice, oldPrice: i.oldPrice, uxb: i.uxb, decision: decisions[i.code] ?? 'aplicar_markup' })),
        ...results.down.map(i => ({ code: i.code, desc: i.desc, newPrice: i.newPrice, oldPrice: i.oldPrice, uxb: i.uxb, decision: decisions[i.code] ?? 'mantener' })),
      ];
      // All new items for updating supplierinfo fully
      const allNewItems = [
        ...results.up, ...results.down, ...results.new,
      ].map(i => ({ code: i.code, desc: i.desc, newPrice: i.newPrice, oldPrice: i.oldPrice, uxb: i.uxb, decision: 'mantener' as Decision }));

      const res  = await fetch('/api/apply-pricelists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supplierName, supplierSlug, items, allNewItems }),
      });
      const data = await res.json() as { ok: boolean; updatedCosts: number; updatedPrices: number; error?: string; isVercel?: boolean };
      if (!data.ok) {
        if (data.isVercel) setIsVercel(true);
        throw new Error(data.error ?? 'Error desconocido');
      }
      setApplyResult({ updatedCosts: data.updatedCosts, updatedPrices: data.updatedPrices });
      setPhase('done');
    } catch (e) {
      setApplyError(String(e));
      setPhase('results');
    }
  };

  const decisionLabel: Record<Decision, string> = {
    mantener:      'Mantener precio',
    aplicar_markup:'Aplicar markup',
    marcar_promo:  'Es promo (no tocar)',
    revisar:       'Revisar manualmente',
  };

  const decisionColor: Record<Decision, string> = {
    mantener:      'bg-success/10 text-success',
    aplicar_markup:'bg-acqua/10 text-acqua',
    marcar_promo:  'bg-purple-50 text-purple-700',
    revisar:       'bg-warning/10 text-warning',
  };

  const formatP = (n: number) => `$${n.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`;

  const tabItems: Record<CompareTab, DiffItem[]> = results ? {
    down: results.down,
    up:   results.up,
    new:  results.new,
    disc: results.discontinued,
  } : { down: [], up: [], new: [], disc: [] };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl w-full max-w-4xl shadow-2xl flex flex-col" style={{ maxHeight: '92vh' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h3 className="font-bold text-gray-900">Comparar listas de precios</h3>
            <p className="text-[12px] text-gray-500 mt-0.5">{supplierName}</p>
          </div>
          <button onClick={() => onClose(phase === 'done')} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">

          {/* ── IDLE: file selection ── */}
          {phase === 'idle' && (
            <div className="space-y-5">
              <div className="bg-acqua/5 border border-acqua/20 rounded-xl p-4 text-[12px] text-gray-600">
                <p className="font-semibold text-acqua mb-1">¿Cómo funciona?</p>
                <p>Subí la lista nueva del proveedor. El sistema la compara contra los <strong>costos actuales cargados en el sistema</strong> para los productos de <strong>{supplierName}</strong> — te muestra qué subió, qué bajó y cuánto mejora tu margen si mantenés precio.</p>
              </div>

              <div>
                <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Lista del proveedor (Excel / CSV)</p>
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) setNewFile(f); }}
                  onClick={() => newInputRef.current?.click()}
                  className={cn(
                    'border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors',
                    newFile ? 'border-acqua/50 bg-acqua/5' : dragging ? 'border-acqua bg-acqua/8' : 'border-gray-200 hover:border-acqua/40 hover:bg-acqua/3',
                  )}
                >
                  <input ref={newInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) setNewFile(f); }} />
                  {newFile ? (
                    <div>
                      <FileSpreadsheet className="w-8 h-8 text-acqua mx-auto mb-2" />
                      <p className="text-[13px] font-semibold text-gray-700">{newFile.name}</p>
                      <p className="text-[11px] text-gray-400 mt-1">Click para cambiar</p>
                    </div>
                  ) : (
                    <div>
                      <FileSpreadsheet className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                      <p className="text-[13px] text-gray-500 font-medium">Arrastrá o hacé click para seleccionar</p>
                      <p className="text-[11px] text-gray-400 mt-1">.xlsx · .xls · .csv — el sistema detecta columnas automáticamente</p>
                    </div>
                  )}
                </div>
              </div>

              <button
                onClick={runCompare}
                disabled={!newFile}
                className={cn(
                  'w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[13px] font-semibold transition-colors',
                  newFile ? 'bg-acqua text-white hover:bg-acqua-dark' : 'bg-gray-100 text-gray-400 cursor-not-allowed',
                )}
              >
                <TrendingUp className="w-4 h-4" />
                Analizar lista
              </button>
            </div>
          )}

          {/* ── COMPARING: loading ── */}
          {phase === 'comparing' && (
            <div className="flex flex-col items-center py-16 gap-3">
              <RefreshCw className="w-8 h-8 text-acqua animate-spin" />
              <p className="text-sm text-gray-600 font-medium">Analizando diferencias…</p>
              <p className="text-[12px] text-gray-400">Detectando subidas, bajadas y agrupando por clusters</p>
            </div>
          )}

          {/* ── APPLYING: loading ── */}
          {phase === 'applying' && (
            <div className="flex flex-col items-center py-16 gap-3">
              <RefreshCw className="w-8 h-8 text-acqua animate-spin" />
              <p className="text-sm text-gray-600 font-medium">Aplicando cambios…</p>
            </div>
          )}

          {/* ── DONE ── */}
          {phase === 'done' && applyResult && (
            <div className="flex flex-col items-center py-12 gap-4">
              <div className="w-14 h-14 rounded-full bg-success/10 flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-success" />
              </div>
              <p className="text-lg font-bold text-gray-900">Lista aplicada</p>
              <div className="grid grid-cols-2 gap-3 w-full max-w-xs">
                <div className="bg-acqua/5 rounded-xl p-3 text-center">
                  <div className="text-2xl font-bold text-acqua">{applyResult.updatedCosts}</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">Costos actualizados</div>
                </div>
                <div className="bg-success/5 rounded-xl p-3 text-center">
                  <div className="text-2xl font-bold text-success">{applyResult.updatedPrices}</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">Precios recalculados</div>
                </div>
              </div>
            </div>
          )}

          {/* ── RESULTS ── */}
          {(phase === 'results') && results && (
            <div className="space-y-4">

              {/* Apply error */}
              {applyError && (
                <div className="bg-danger/5 border border-danger/20 rounded-xl p-3 text-[12px] text-danger">
                  {isVercel
                    ? '⚠️ No se puede aplicar en producción (Vercel). Descargá el resumen o aplicá desde tu entorno local.'
                    : `Error: ${applyError}`}
                </div>
              )}

              {/* Summary cards */}
              {results.stats.linkedCount === 0 && (
                <div className="bg-warning/5 border border-warning/20 rounded-xl p-3 text-[12px] text-warning">
                  ⚠️ No hay productos de <strong>{supplierName}</strong> cargados en el sistema con código vinculado. Importá primero una lista via "Cargar nueva lista" para establecer los costos base.
                </div>
              )}

              <div className="grid grid-cols-4 gap-2">
                {[
                  { tab: 'up' as CompareTab,   label: 'Subieron', count: results.stats.upCount,   color: 'text-danger', bg: 'bg-danger/5 border border-danger/20' },
                  { tab: 'down' as CompareTab, label: 'Bajaron',  count: results.stats.downCount,  color: 'text-success', bg: 'bg-success/5 border border-success/20' },
                  { tab: 'new' as CompareTab,  label: 'No vinculado', count: results.stats.newCount, color: 'text-acqua', bg: 'bg-acqua/5 border border-acqua/20' },
                  { tab: 'disc' as CompareTab, label: 'Sin datos', count: results.stats.discCount, color: 'text-gray-500', bg: 'bg-gray-50 border border-gray-200' },
                ].map(s => (
                  <button key={s.tab} onClick={() => setActiveTab(s.tab)}
                    className={cn('rounded-xl p-3 text-center transition-all border-2', s.bg, activeTab === s.tab ? 'ring-2 ring-acqua/30 scale-[1.02]' : 'opacity-80 hover:opacity-100')}>
                    <div className={cn('text-2xl font-bold', s.color)}>{s.count}</div>
                    <div className="text-[10px] text-gray-500 mt-0.5">{s.label}</div>
                  </button>
                ))}
              </div>

              {/* Cluster info banner */}
              {activeTab === 'down' && results.downClusters.length > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2">
                  <p className="text-[11px] font-bold text-blue-700 uppercase tracking-wide">Grupos detectados</p>
                  {results.downClusters.slice(0, 5).map(cl => (
                    <div key={cl.pct} className="flex items-center gap-3">
                      <span className="text-[11px] text-blue-700 flex-1">{cl.label}</span>
                      <div className="flex gap-1.5">
                        {(['mantener', 'aplicar_markup', 'marcar_promo'] as Decision[]).map(d => {
                          // Count how many in this cluster have this decision
                          const clItems = results.down.filter(i => Math.round(i.pct) === cl.pct);
                          const matches = clItems.filter(i => decisions[i.code] === d).length;
                          const isActive = matches === clItems.length;
                          return (
                            <button key={d} onClick={() => setGroupDecision(cl.pct, d)}
                              className={cn(
                                'px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors',
                                isActive
                                  ? d === 'mantener' ? 'bg-success text-white' : d === 'aplicar_markup' ? 'bg-acqua text-white' : 'bg-purple-600 text-white'
                                  : 'bg-white text-gray-500 border border-gray-200 hover:border-acqua/50',
                              )}>
                              {d === 'mantener' ? 'Mantener' : d === 'aplicar_markup' ? 'Markup' : 'Promo'}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === 'up' && results.stats.upCount > 0 && (
                <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl p-3">
                  <p className="text-[12px] text-red-700 flex-1">
                    <strong>{results.stats.upCount}</strong> productos subieron de precio. Por defecto se aplica el markup (precio sube proporcional al costo).
                  </p>
                  <div className="flex gap-1.5">
                    {(['aplicar_markup', 'revisar'] as Decision[]).map(d => (
                      <button key={d} onClick={() => setAllUpDecision(d)}
                        className={cn('px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors',
                          d === 'aplicar_markup' ? 'bg-acqua text-white border-acqua' : 'bg-white text-gray-500 border-gray-200 hover:border-warning')}>
                        {d === 'aplicar_markup' ? 'Todos: markup' : 'Todos: revisar'}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Table */}
              <div className="border border-gray-100 rounded-xl overflow-hidden">
                <div className="overflow-x-auto" style={{ maxHeight: '44vh' }}>
                  <table className="w-full text-[12px]">
                    <thead className="sticky top-0 bg-gray-50 border-b border-gray-100 text-[10px] text-gray-400 font-semibold uppercase tracking-wider z-10">
                      <tr>
                        <th className="text-left px-4 py-2.5 w-8"></th>
                        <th className="text-left px-3 py-2.5">Producto</th>
                        <th className="text-right px-3 py-2.5 whitespace-nowrap">Costo ant.</th>
                        <th className="text-right px-3 py-2.5 whitespace-nowrap">Costo nuevo</th>
                        <th className="text-right px-3 py-2.5">Var.</th>
                        <th className="text-center px-3 py-2.5 whitespace-nowrap">Margen actual</th>
                        {(activeTab === 'down' || activeTab === 'up') && (
                          <>
                            <th className="text-center px-3 py-2.5 whitespace-nowrap">Si mantener</th>
                            <th className="text-center px-3 py-2.5">Decisión</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {tabItems[activeTab].map(item => {
                        const badge = (activeTab === 'down') ? pctBadge(item, results.downClusters) : null;
                        const dec   = decisions[item.code];
                        const isUp  = item.delta > 0;
                        const imgUrl = item.odooId
                          ? `${ODOO_BASE}/web/image/product.template/${item.odooId}/image_1920`
                          : null;
                        // Margen con decisión actual
                        const effMargin = dec === 'mantener' ? item.marginIfMantener
                          : dec === 'aplicar_markup' ? item.marginIfMarkup
                          : item.currentMargin;
                        const marginDelta = (item.marginImprovement ?? 0) * (isUp ? -1 : 1);

                        return (
                          <tr key={item.code} className={cn(
                            'hover:bg-gray-50/60 transition-colors',
                            item.suspicious && 'bg-danger/3',
                            !item.inSystem && 'opacity-70',
                          )}>
                            {/* Foto */}
                            <td className="px-4 py-2 w-10">
                              <div className="w-9 h-9 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center overflow-hidden shrink-0">
                                {imgUrl
                                  // eslint-disable-next-line @next/next/no-img-element
                                  ? <img src={imgUrl} alt={item.desc} className="w-full h-full object-cover"
                                      onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                  : <ImageIcon className="w-4 h-4 text-gray-300" />}
                              </div>
                            </td>

                            {/* Nombre */}
                            <td className="px-3 py-2.5 min-w-[200px]">
                              <div className="font-medium text-gray-800 line-clamp-1 text-[12px]">
                                {item.productName || item.desc}
                              </div>
                              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                <span className="text-[9px] text-gray-400 font-mono">{item.code}</span>
                                {item.uxb > 1 && <span className="text-[9px] text-gray-400">×{item.uxb}</span>}
                                {/* Sistema badge */}
                                <span className={cn('inline-flex px-1.5 py-0.5 rounded-full text-[9px] font-bold',
                                  item.inSystem ? 'bg-success/10 text-success' : 'bg-gray-100 text-gray-400')}>
                                  {item.inSystem ? '✓ En sistema' : '✗ No figura'}
                                </span>
                                {badge && (
                                  <span className={cn('inline-flex px-1.5 py-0.5 rounded-full text-[9px] font-bold', badge.color)}>
                                    {badge.label}
                                  </span>
                                )}
                              </div>
                              {item.currentSalePrice && (
                                <div className="text-[9px] text-purple-600 mt-0.5">
                                  Venta: {formatP(item.currentSalePrice)}
                                </div>
                              )}
                            </td>

                            {/* Costo anterior */}
                            <td className="px-3 py-2.5 text-right font-mono text-gray-400 whitespace-nowrap text-[11px]">
                              {item.oldPrice > 0 ? formatP(item.oldPrice) : '—'}
                            </td>

                            {/* Costo nuevo */}
                            <td className="px-3 py-2.5 text-right font-mono font-semibold text-gray-800 whitespace-nowrap text-[11px]">
                              {item.newPrice > 0 ? formatP(item.newPrice) : '—'}
                            </td>

                            {/* Variación */}
                            <td className="px-3 py-2.5 text-right whitespace-nowrap">
                              <span className={cn('font-bold font-mono text-[11px]', isUp ? 'text-danger' : 'text-success')}>
                                {isUp ? '+' : ''}{item.pct.toFixed(1)}%
                              </span>
                            </td>

                            {/* Margen actual */}
                            <td className="px-3 py-2.5 text-center whitespace-nowrap">
                              {item.currentMargin != null
                                ? <span className={cn('text-[11px] font-bold',
                                    item.currentMargin < 0 ? 'text-danger' :
                                    item.currentMargin < 35 ? 'text-warning' : 'text-success')}>
                                    {item.currentMargin.toFixed(1)}%
                                  </span>
                                : <span className="text-[10px] text-gray-300">—</span>}
                            </td>

                            {/* Si mantener / Si markup + decisión */}
                            {(activeTab === 'down' || activeTab === 'up') && (
                              <>
                                <td className="px-3 py-2.5 text-center whitespace-nowrap">
                                  {item.marginIfMantener != null ? (
                                    <div className="inline-flex flex-col items-center">
                                      <span className={cn('text-[11px] font-bold',
                                        item.marginIfMantener < 0 ? 'text-danger' :
                                        item.marginIfMantener < 35 ? 'text-warning' : 'text-success')}>
                                        {item.marginIfMantener.toFixed(1)}%
                                      </span>
                                      {item.marginImprovement != null && Math.abs(item.marginImprovement) > 0.2 && (
                                        <span className={cn('text-[9px] font-semibold mt-0.5',
                                          item.marginImprovement > 0 ? 'text-success' : 'text-danger')}>
                                          {item.marginImprovement > 0 ? '↑' : '↓'}{Math.abs(item.marginImprovement).toFixed(1)}pp
                                        </span>
                                      )}
                                    </div>
                                  ) : <span className="text-[10px] text-gray-300">—</span>}
                                </td>
                                <td className="px-3 py-2.5 text-center">
                                  <select
                                    value={dec ?? (isUp ? 'aplicar_markup' : 'mantener')}
                                    onChange={e => setDecisions(prev => ({ ...prev, [item.code]: e.target.value as Decision }))}
                                    className={cn(
                                      'text-[10px] font-semibold px-2 py-1 rounded-lg border-0 cursor-pointer focus:outline-none focus:ring-1 focus:ring-acqua/30 w-full max-w-[130px]',
                                      dec ? decisionColor[dec] : 'bg-gray-100 text-gray-600',
                                    )}
                                  >
                                    <option value="mantener">Mantener precio</option>
                                    <option value="aplicar_markup">Aplicar markup</option>
                                    <option value="marcar_promo">Es promo</option>
                                    <option value="revisar">Revisar</option>
                                  </select>
                                  {/* Impacto de la decisión seleccionada */}
                                  {dec === 'mantener' && item.marginImprovement != null && Math.abs(item.marginImprovement) > 0.2 && (
                                    <div className={cn('text-[9px] font-semibold mt-0.5',
                                      item.marginImprovement > 0 ? 'text-success' : 'text-danger')}>
                                      {item.marginImprovement > 0 ? `↑ +${item.marginImprovement.toFixed(1)}pp utilidad` : `↓ ${item.marginImprovement.toFixed(1)}pp`}
                                    </div>
                                  )}
                                  {dec === 'aplicar_markup' && item.marginIfMarkup != null && (
                                    <div className="text-[9px] text-gray-400 mt-0.5">= margen igual</div>
                                  )}
                                </td>
                              </>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {tabItems[activeTab].length === 0 && (
                    <div className="py-12 text-center text-[12px] text-gray-400">
                      {activeTab === 'down' ? 'No hay productos con costo reducido' :
                       activeTab === 'up'   ? 'No hay productos con costo aumentado' :
                       activeTab === 'new'  ? 'No hay productos nuevos' : 'No hay productos discontinuados'}
                    </div>
                  )}
                </div>
              </div>

              {/* Decision summary */}
              {(activeTab === 'down' || activeTab === 'up') && Object.keys(decisions).length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] text-gray-400 font-semibold">Resumen:</span>
                  {(['mantener', 'aplicar_markup', 'marcar_promo', 'revisar'] as Decision[]).map(d => {
                    const count = Object.values(decisions).filter(v => v === d).length;
                    if (!count) return null;
                    return (
                      <span key={d} className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold', decisionColor[d])}>
                        {count} × {decisionLabel[d]}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 shrink-0">
          <button onClick={() => onClose(phase === 'done')}
            className="px-4 py-2 text-[13px] text-gray-500 hover:text-gray-700 font-medium">
            {phase === 'done' ? 'Cerrar' : 'Cancelar'}
          </button>

          <div className="flex gap-2 items-center">
            {phase === 'results' && (
              <>
                <button
                  onClick={() => { setPhase('idle'); setResults(null); setApplyError(null); }}
                  className="px-4 py-2 border border-gray-200 text-gray-600 text-[13px] font-semibold rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Nueva comparación
                </button>
                <button
                  onClick={runApply}
                  className="flex items-center gap-2 px-5 py-2 bg-acqua text-white text-[13px] font-semibold rounded-lg hover:bg-acqua-dark transition-colors"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Aplicar decisiones
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ── CATÁLOGO COMPLETO DEL PROVEEDOR (Excel + PDF + Imagen via IA)
// ─────────────────────────────────────────────────────────────────────────────

interface CatalogItem {
  id: string;
  sheet: string;
  category: string;
  code: string;
  desc: string;
  priceUSD: number | null;
  priceARS: number | null;
  unit: string;
  pack: number;
  isNew: boolean;
  notes: string;
  inAcqua: boolean;
  acquaId?: string;
  acquaName?: string;
  acquaCost?: number;
  acquaPrice?: number;
  source: 'excel' | 'ai';
}

function parseCatalogSheets(sheets: { name: string; rows: unknown[][] }[]): CatalogItem[] {
  const items: CatalogItem[] = [];
  const byCode = new Map<string, { id: string; name: string; cost: number; price: number }>();
  const byName = new Map<string, { id: string; name: string; cost: number; price: number }>();
  (productsData as Array<{ id: string; supplierCode: string | null; name: string; cost: number; price: number }>).forEach(p => {
    if (p.supplierCode) byCode.set(p.supplierCode.trim().toLowerCase(), { id: p.id, name: p.name, cost: p.cost, price: p.price });
    byName.set(p.name.trim().toLowerCase(), { id: p.id, name: p.name, cost: p.cost, price: p.price });
  });
  const norm    = (v: unknown) => String(v ?? '').trim();
  const toNum   = (v: unknown) => { const n = parseFloat(String(v ?? '').replace(',','.')); return isFinite(n) && n > 0 ? n : 0; };
  const isNumId = (v: unknown) => { const n = Number(v); return isFinite(n) && n > 0; };
  let idx = 0;
  for (const { name: sheetName, rows } of sheets) {
    if (!rows || rows.length < 5) continue;
    let cat = '';
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] as unknown[];
      if (!row || row.length < 3) continue;
      const col1 = row[1]; const col2 = norm(row[2]);
      if (isNumId(col1) && col2) {
        const code = String(col1).trim();
        const pUSD = toNum(row[6]);
        const match = byCode.get(code.toLowerCase()) ?? byName.get(col2.toLowerCase());
        items.push({ id: `cat_${idx++}`, sheet: sheetName, category: cat, code, desc: col2,
          priceUSD: pUSD || null, priceARS: null,
          unit: norm(row[7]) || 'U', pack: toNum(row[8]) || 1, isNew: norm(row[5]).toLowerCase().includes('nuevo'),
          notes: '', source: 'excel',
          inAcqua: !!match, acquaId: match?.id, acquaName: match?.name, acquaCost: match?.cost, acquaPrice: match?.price });
      } else {
        const c1s = norm(col1).toLowerCase();
        if (!c1s || c1s === 'código' || c1s === ' ' || c1s.length > 50) continue;
        cat = norm(col1);
      }
    }
  }
  return items;
}

function mergeAIItems(aiItems: Array<{ code: string; desc: string; priceUSD: number | null; priceARS: number | null; unit: string; category: string; notes: string }>): CatalogItem[] {
  const byCode = new Map<string, { id: string; name: string; cost: number; price: number }>();
  const byName = new Map<string, { id: string; name: string; cost: number; price: number }>();
  (productsData as Array<{ id: string; supplierCode: string | null; name: string; cost: number; price: number }>).forEach(p => {
    if (p.supplierCode) byCode.set(p.supplierCode.trim().toLowerCase(), { id: p.id, name: p.name, cost: p.cost, price: p.price });
    byName.set(p.name.trim().toLowerCase(), { id: p.id, name: p.name, cost: p.cost, price: p.price });
  });
  return aiItems.map((ai, i) => {
    const match = byCode.get(ai.code.trim().toLowerCase()) ?? byName.get(ai.desc.trim().toLowerCase());
    return { id: `ai_${i}`, sheet: 'IA', category: ai.category, code: ai.code, desc: ai.desc,
      priceUSD: ai.priceUSD, priceARS: ai.priceARS,
      unit: ai.unit || 'U', pack: 1, isNew: false, notes: ai.notes, source: 'ai' as const,
      inAcqua: !!match, acquaId: match?.id, acquaName: match?.name, acquaCost: match?.cost, acquaPrice: match?.price };
  });
}

function downloadCSV(rows: string[][], filename: string) {
  const csv  = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

const MIME_MAP: Record<string, 'excel' | 'image' | 'pdf'> = {
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'excel',
  'application/vnd.ms-excel': 'excel',
  'application/pdf': 'pdf',
  'image/jpeg': 'image', 'image/jpg': 'image', 'image/png': 'image',
  'image/webp': 'image', 'image/gif': 'image', 'image/heic': 'image',
};

function guessType(f: File): 'excel' | 'image' | 'pdf' | '' {
  if (MIME_MAP[f.type]) return MIME_MAP[f.type];
  const n = f.name.toLowerCase();
  if (n.endsWith('.xlsx') || n.endsWith('.xls')) return 'excel';
  if (n.endsWith('.pdf')) return 'pdf';
  if (n.match(/\.(jpg|jpeg|png|gif|webp|heic)$/)) return 'image';
  return '';
}

function SupplierCatalogModal({ onClose, supplierName, geminiKey }: {
  onClose: () => void; supplierName: string; geminiKey?: string;
}) {
  type Phase = 'idle' | 'reading' | 'ai_processing' | 'review' | 'ready';

  const [phase,       setPhase]       = useState<Phase>('idle');
  const [items,       setItems]       = useState<CatalogItem[]>([]);
  const [aiSummary,   setAiSummary]   = useState('');
  const [currency,    setCurrency]    = useState<'USD' | 'ARS' | 'unknown'>('USD');
  const [search,      setSearch]      = useState('');
  const [sheetFilter, setSheetFilter] = useState<string>('todas');
  const [matchFilter, setMatchFilter] = useState<'todos' | 'acqua' | 'nuevo'>('todos');
  const [usdRate,     setUsdRate]     = useState<number>(1200);
  const [qtys,        setQtys]        = useState<Record<string, number>>({});
  const [tab,         setTab]         = useState<'catalogo' | 'pedido'>('catalogo');
  const [dragging,    setDragging]    = useState(false);
  const [fileName,    setFileName]    = useState('');
  const [fileType,    setFileType]    = useState<'excel' | 'image' | 'pdf' | ''>('');
  const [error,       setError]       = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const sheetNames = useMemo(() => ['todas', ...Array.from(new Set(items.map(i => i.sheet)))], [items]);

  const filtered = useMemo(() => items.filter(item => {
    if (sheetFilter !== 'todas' && item.sheet !== sheetFilter) return false;
    if (matchFilter === 'acqua' && !item.inAcqua) return false;
    if (matchFilter === 'nuevo' &&  item.inAcqua) return false;
    if (search) {
      const q = search.toLowerCase();
      return item.code.toLowerCase().includes(q) || item.desc.toLowerCase().includes(q) || item.category.toLowerCase().includes(q);
    }
    return true;
  }), [items, sheetFilter, matchFilter, search]);

  const pedidoItems = useMemo(() => items.filter(i => (qtys[i.id] ?? 0) > 0).map(i => ({ ...i, qty: qtys[i.id] })), [items, qtys]);
  const pedidoTotalUSD = pedidoItems.reduce((s, i) => s + (i.priceUSD ?? 0) * i.qty, 0);
  const pedidoTotalARS = pedidoItems.reduce((s, i) => { const ars = i.priceARS ?? (i.priceUSD ? i.priceUSD * usdRate : 0); return s + ars * i.qty; }, 0);
  const stats = useMemo(() => ({ total: items.length, acqua: items.filter(i => i.inAcqua).length, nuevo: items.filter(i => !i.inAcqua).length }), [items]);

  const priceInARS = (item: CatalogItem) => item.priceARS ?? (item.priceUSD && usdRate > 0 ? item.priceUSD * usdRate : null);

  const handleFile = async (f: File) => {
    setError('');
    setFileName(f.name);
    const ftype = guessType(f);
    if (!ftype) { setError('Formato no soportado. Usá Excel (.xlsx), PDF o imagen (JPG/PNG/WEBP).'); return; }
    setFileType(ftype);

    if (ftype === 'excel') {
      setPhase('reading');
      try {
        const buf  = await f.arrayBuffer();
        const wb   = XLSX.read(buf, { type: 'array', cellDates: false });
        const sheets = wb.SheetNames.map(name => ({
          name,
          rows: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: '', blankrows: false }),
        }));
        setItems(parseCatalogSheets(sheets));
        setCurrency('USD');
        setPhase('ready');
      } catch (e) { setError('Error leyendo el Excel: ' + String(e)); setPhase('idle'); }
    } else {
      if (!geminiKey) { setError('Para leer PDF e imágenes configurá tu clave Gemini en ML Lab → Parámetros globales → Clave IA.'); return; }
      setPhase('ai_processing');
      try {
        const buf  = await f.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let b64 = '';
        const chunkSize = 8192;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          b64 += String.fromCharCode(...bytes.slice(i, i + chunkSize));
        }
        b64 = btoa(b64);
        const mimeType = ftype === 'pdf' ? 'application/pdf' : (f.type || 'image/jpeg');
        const res = await fetch('/api/catalog-ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Gemini-Key': geminiKey },
          body: JSON.stringify({ mimeType, data: b64, fileName: f.name }),
        });
        const data = await res.json() as { ok: boolean; items?: Array<{ code: string; desc: string; priceUSD: number|null; priceARS: number|null; unit: string; category: string; notes: string }>; currency?: 'USD'|'ARS'|'unknown'; supplierGuess?: string; rawSummary?: string; error?: string };
        if (!data.ok || !data.items) throw new Error(data.error ?? 'La IA no pudo interpretar el archivo');
        setAiSummary(data.rawSummary ?? '');
        setCurrency(data.currency ?? 'unknown');
        if (data.currency === 'ARS') setUsdRate(0);
        setItems(mergeAIItems(data.items));
        setPhase('review');
      } catch (e) { setError(String(e)); setPhase('idle'); }
    }
  };

  const reset = () => { setPhase('idle'); setItems([]); setQtys({}); setFileName(''); setFileType(''); setError(''); setAiSummary(''); };
  const setQty = (id: string, qty: number) => setQtys(prev => qty > 0 ? { ...prev, [id]: qty } : (({ [id]: _, ...rest }) => rest)(prev));

  const exportCSV = () => downloadCSV([
    ['Categoría','Código','Descripción','USD','ARS','Unid','Pack','En Acqua','Nombre Acqua','Costo Acqua'],
    ...filtered.map(i => [i.category,i.code,i.desc, i.priceUSD?.toFixed(2)??'', priceInARS(i)?.toFixed(0)??'',i.unit,String(i.pack),i.inAcqua?'Sí':'No',i.acquaName??'',i.acquaCost?.toFixed(2)??'']),
  ], `catalogo-${supplierName.toLowerCase().replace(/\s+/g,'-')}-${new Date().toISOString().slice(0,10)}.csv`);

  const exportPedido = () => downloadCSV([
    ['Código','Descripción','USD unit','ARS unit','Cantidad','Total USD','Total ARS'],
    ...pedidoItems.map(i => [i.code,i.desc, i.priceUSD?.toFixed(2)??'', priceInARS(i)?.toFixed(0)??'', String(i.qty), ((i.priceUSD??0)*i.qty).toFixed(2), ((priceInARS(i)??0)*i.qty).toFixed(0)]),
    ['','','','','TOTAL',pedidoTotalUSD.toFixed(2),pedidoTotalARS.toFixed(0)],
  ], `pedido-${supplierName.toLowerCase().replace(/\s+/g,'-')}-${new Date().toISOString().slice(0,10)}.csv`);

  const ftypeIcon = { excel: '📊', pdf: '📄', image: '🖼️', '': '' }[fileType];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl w-full shadow-2xl flex flex-col" style={{ maxWidth: 1200, maxHeight: '96vh' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h3 className="font-bold text-gray-900 flex items-center gap-2">
              <Package className="w-4 h-4 text-purple-600" />
              Lista de precios — {supplierName}
              {fileType && <span className="text-[11px] font-normal text-gray-400">{ftypeIcon} {fileName}</span>}
            </h3>
            {(phase === 'ready' || phase === 'review') && (
              <p className="text-[11px] text-gray-400 mt-0.5">{stats.total} productos · <span className="text-success font-semibold">{stats.acqua} ya en Acqua</span> · {stats.nuevo} nuevos</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {(phase === 'ready' || phase === 'review') && (
              <>
                {(currency === 'USD' || currency === 'unknown') && (
                  <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
                    <span className="text-[10px] font-semibold text-amber-700">USD →</span>
                    <span className="text-[10px] text-amber-500">$</span>
                    <input type="number" value={usdRate} onChange={e => setUsdRate(Math.max(1, Number(e.target.value)))}
                      className="w-16 text-[12px] font-bold text-amber-800 bg-transparent outline-none" step="50" />
                    <span className="text-[9px] text-amber-400">ARS</span>
                  </div>
                )}
                <div className="flex bg-gray-100 rounded-lg p-0.5">
                  <button onClick={() => setTab('catalogo')}
                    className={cn('px-3 py-1.5 rounded-md text-[11px] font-semibold transition-colors', tab === 'catalogo' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500')}>
                    Catálogo
                  </button>
                  <button onClick={() => setTab('pedido')}
                    className={cn('px-3 py-1.5 rounded-md text-[11px] font-semibold transition-colors flex items-center gap-1.5', tab === 'pedido' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500')}>
                    Pedido
                    {pedidoItems.length > 0 && <span className="inline-flex items-center justify-center w-4 h-4 bg-acqua text-white text-[9px] font-bold rounded-full">{pedidoItems.length}</span>}
                  </button>
                </div>
              </>
            )}
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col">

          {/* IDLE */}
          {phase === 'idle' && (
            <div className="flex-1 flex flex-col items-center justify-center p-8 gap-5">
              {error && (
                <div className="w-full max-w-lg bg-danger/5 border border-danger/20 rounded-xl p-3 text-[12px] text-danger flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span>{error}</span>
                </div>
              )}
              <div
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
                onClick={() => fileRef.current?.click()}
                className={cn('border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-colors w-full max-w-lg',
                  dragging ? 'border-purple-400 bg-purple-50' : 'border-gray-200 hover:border-purple-300 hover:bg-purple-50/40')}
              >
                <FileSpreadsheet className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <p className="text-[16px] font-semibold text-gray-600">Arrastrá la lista de precios</p>
                <p className="text-[13px] text-gray-400 mt-1">o hacé click para seleccionar</p>
                <div className="flex items-center justify-center gap-2 mt-4 flex-wrap">
                  {[
                    { l: '📊 Excel .xlsx', c: 'bg-green-50 border-green-200 text-green-700' },
                    { l: '📄 PDF', c: 'bg-red-50 border-red-200 text-red-700' },
                    { l: '🖼️ Imagen JPG/PNG', c: 'bg-blue-50 border-blue-200 text-blue-700' },
                  ].map(f => <span key={f.l} className={cn('px-2.5 py-1 rounded-lg border text-[11px] font-medium', f.c)}>{f.l}</span>)}
                </div>
                <p className="text-[11px] text-gray-300 mt-3">PDF e imágenes → IA de Gemini las interpreta automáticamente</p>
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.pdf,.jpg,.jpeg,.png,.webp,.gif,.heic" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              </div>
              <div className="grid grid-cols-3 gap-3 max-w-lg w-full text-[11px] text-center">
                {[
                  { icon: '📊', t: 'Excel', s: 'Detección automática de todas las hojas' },
                  { icon: '📄', t: 'PDF', s: 'IA interpreta el contenido completo' },
                  { icon: '🖼️', t: 'Imagen', s: 'Foto o lista escaneada' },
                ].map(c => (
                  <div key={c.t} className="bg-gray-50 rounded-xl p-3">
                    <div className="text-2xl mb-1">{c.icon}</div>
                    <p className="font-semibold text-gray-700">{c.t}</p>
                    <p className="text-gray-400">{c.s}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* LOADING */}
          {(phase === 'reading' || phase === 'ai_processing') && (
            <div className="flex-1 flex flex-col items-center justify-center gap-4">
              <RefreshCw className="w-10 h-10 text-purple-500 animate-spin" />
              <div className="text-center">
                <p className="text-[14px] font-semibold text-gray-700">
                  {phase === 'reading' ? 'Leyendo el Excel…' : 'La IA está interpretando el archivo…'}
                </p>
                <p className="text-[12px] text-gray-400 mt-1">
                  {phase === 'ai_processing' ? 'Puede tardar hasta 30 segundos' : 'Detectando productos en todas las hojas'}
                </p>
              </div>
              {phase === 'ai_processing' && (
                <div className="flex items-center gap-2 px-4 py-2 bg-purple-50 border border-purple-200 rounded-xl text-[12px] text-purple-700">
                  <Sparkles className="w-4 h-4 animate-pulse" /> Gemini 2.0 Flash leyendo {ftypeIcon}
                </div>
              )}
            </div>
          )}

          {/* REVIEW banner (IA result) */}
          {phase === 'review' && (
            <div className="px-5 py-3 border-b border-gray-100 bg-purple-50/80 shrink-0">
              <div className="flex items-start gap-3">
                <Sparkles className="w-5 h-5 text-purple-600 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-bold text-purple-800">IA interpretó el archivo — revisá los datos antes de usar</p>
                  {aiSummary && <p className="text-[12px] text-purple-700 mt-0.5">{aiSummary}</p>}
                  <p className="text-[11px] text-purple-500 mt-0.5">Moneda: <strong>{currency === 'USD' ? '🇺🇸 USD' : currency === 'ARS' ? '🇦🇷 ARS' : 'No detectada'}</strong></p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => setPhase('ready')}
                    className="px-3 py-1.5 bg-purple-600 text-white text-[12px] font-semibold rounded-lg hover:bg-purple-700 transition-colors">
                    Confirmar ✓
                  </button>
                  <button onClick={reset}
                    className="px-3 py-1.5 border border-purple-200 text-purple-600 text-[12px] font-medium rounded-lg hover:bg-purple-100 transition-colors">
                    Subir otro
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TABLE */}
          {(phase === 'ready' || phase === 'review') && tab === 'catalogo' && (
            <div className="flex-1 overflow-hidden flex flex-col">
              <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50/50 shrink-0 flex items-center gap-2 flex-wrap">
                <div className="relative flex-1 min-w-[160px] max-w-xs">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Código, descripción, categoría…"
                    className="w-full pl-8 pr-3 py-1.5 text-[12px] border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-purple-300 focus:border-purple-400 bg-white" />
                </div>
                {sheetNames.length > 2 && (
                  <select value={sheetFilter} onChange={e => setSheetFilter(e.target.value)}
                    className="px-2.5 py-1.5 text-[12px] border border-gray-200 rounded-lg outline-none bg-white">
                    {sheetNames.map(s => <option key={s} value={s}>{s === 'todas' ? 'Todas las hojas' : s.replace(/^LPs+/i,'')}</option>)}
                  </select>
                )}
                <div className="flex bg-gray-100 rounded-lg p-0.5">
                  {([{ k: 'todos', l: 'Todos' }, { k: 'acqua', l: '✓ En Acqua' }, { k: 'nuevo', l: 'Nuevos' }] as const).map(f => (
                    <button key={f.k} onClick={() => setMatchFilter(f.k)}
                      className={cn('px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors', matchFilter === f.k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500')}>
                      {f.l}
                    </button>
                  ))}
                </div>
                <span className="text-[11px] text-gray-400">{filtered.length} resultados</span>
                <button onClick={exportCSV}
                  className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 text-white text-[12px] font-semibold rounded-lg hover:bg-purple-700 transition-colors">
                  <FileDown className="w-3.5 h-3.5" /> Exportar CSV
                </button>
                <button onClick={reset} className="flex items-center gap-1 px-2.5 py-1.5 border border-gray-200 text-gray-500 text-[11px] rounded-lg hover:bg-gray-50">
                  <RefreshCw className="w-3 h-3" /> Nueva lista
                </button>
              </div>

              <div className="flex-1 overflow-auto">
                <table className="w-full text-[11px] border-collapse">
                  <thead className="sticky top-0 bg-white border-b border-gray-200 z-10">
                    <tr>
                      <th className="text-left px-3 py-2 text-[9px] font-semibold text-gray-400 uppercase w-28">Categoría</th>
                      <th className="text-left px-3 py-2 text-[9px] font-semibold text-gray-400 uppercase w-24">Código</th>
                      <th className="text-left px-3 py-2 text-[9px] font-semibold text-gray-400 uppercase">Descripción</th>
                      <th className="text-right px-3 py-2 text-[9px] font-semibold text-gray-400 uppercase w-24">Precio</th>
                      <th className="text-right px-3 py-2 text-[9px] font-semibold text-gray-400 uppercase w-28">ARS</th>
                      <th className="text-center px-3 py-2 text-[9px] font-semibold text-gray-400 uppercase w-14">Unid</th>
                      <th className="text-center px-3 py-2 text-[9px] font-semibold text-gray-400 uppercase w-20">Estado</th>
                      <th className="text-left px-3 py-2 text-[9px] font-semibold text-gray-400 uppercase w-44">En Acqua</th>
                      <th className="text-center px-3 py-2 text-[9px] font-semibold text-gray-400 uppercase w-24">Pedido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(0, 700).map(item => {
                      const arsPrice = priceInARS(item);
                      const priceDiff = item.acquaCost && arsPrice ? arsPrice - item.acquaCost : null;
                      return (
                        <tr key={item.id} className={cn('border-b border-gray-50 hover:bg-gray-50/70 transition-colors', item.inAcqua && 'bg-green-50/20')}>
                          <td className="px-3 py-1.5"><span className="text-[9px] text-gray-400 truncate block max-w-[110px]" title={item.category}>{item.category}</span></td>
                          <td className="px-3 py-1.5">
                            <span className="font-mono text-[10px] text-gray-700 font-semibold">{item.code}</span>
                            {item.isNew && <span className="ml-1 text-[8px] bg-green-100 text-green-700 px-1 py-0.5 rounded font-bold">NEW</span>}
                            {item.source === 'ai' && <span className="ml-1 text-[8px] bg-purple-100 text-purple-600 px-1 py-0.5 rounded">IA</span>}
                          </td>
                          <td className="px-3 py-1.5 max-w-[250px]">
                            <span className="text-gray-800 leading-tight line-clamp-2 text-[11px]">{item.desc}</span>
                            {item.notes && <span className="text-[9px] text-amber-600 block">{item.notes}</span>}
                          </td>
                          <td className="px-3 py-1.5 text-right whitespace-nowrap">
                            {item.priceUSD != null ? <span className="font-semibold text-gray-700">US$ {item.priceUSD.toFixed(2)}</span>
                            : item.priceARS != null ? <span className="font-semibold text-gray-700">{formatARS(item.priceARS)}</span>
                            : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            {arsPrice != null && arsPrice > 0 ? <span className="font-bold text-acqua">{formatARS(arsPrice)}</span> : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-3 py-1.5 text-center text-gray-500 text-[10px]">{item.unit}</td>
                          <td className="px-3 py-1.5 text-center">
                            {item.inAcqua
                              ? <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-success/10 text-success text-[9px] font-bold rounded-full border border-success/20"><span className="w-1.5 h-1.5 rounded-full bg-success" /> Acqua</span>
                              : <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-purple-50 text-purple-600 text-[9px] font-bold rounded-full border border-purple-200"><span className="w-1.5 h-1.5 rounded-full bg-purple-400" /> Nuevo</span>}
                          </td>
                          <td className="px-3 py-1.5">
                            {item.acquaName ? (
                              <div>
                                <p className="text-[10px] text-gray-600 leading-tight truncate max-w-[170px]" title={item.acquaName}>{item.acquaName}</p>
                                {item.acquaCost && arsPrice ? (
                                  <p className="text-[9px]">
                                    <span className="text-gray-400">Costo: {formatARS(item.acquaCost)}</span>
                                    {priceDiff !== null && (
                                      <span className={cn('ml-1 font-bold', priceDiff > 0 ? 'text-danger' : 'text-success')}>
                                        {priceDiff > 0 ? '↑' : '↓'} {formatARS(Math.abs(priceDiff))}
                                      </span>
                                    )}
                                  </p>
                                ) : null}
                              </div>
                            ) : <span className="text-gray-300 text-[10px]">—</span>}
                          </td>
                          <td className="px-3 py-1.5">
                            <div className="flex items-center justify-center gap-1">
                              <button onClick={() => setQty(item.id, Math.max(0, (qtys[item.id] ?? 0) - 1))} className="w-5 h-5 rounded border border-gray-200 flex items-center justify-center text-gray-400 hover:bg-gray-100 text-[10px] font-bold">−</button>
                              <input type="number" min="0" value={qtys[item.id] ?? 0}
                                onChange={e => setQty(item.id, Math.max(0, parseInt(e.target.value) || 0))}
                                className="w-8 text-center text-[11px] font-semibold border border-gray-200 rounded outline-none focus:border-acqua" />
                              <button onClick={() => setQty(item.id, (qtys[item.id] ?? 0) + 1)} className="w-5 h-5 rounded border border-gray-200 flex items-center justify-center text-gray-400 hover:bg-gray-100 text-[10px] font-bold">+</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {filtered.length > 700 && <tr><td colSpan={9} className="px-3 py-3 text-center text-[11px] text-gray-400">Mostrando 700 de {filtered.length}. Usá filtros o exportá el CSV.</td></tr>}
                    {filtered.length === 0 && <tr><td colSpan={9} className="px-3 py-12 text-center text-[12px] text-gray-400">Sin resultados</td></tr>}
                  </tbody>
                </table>
              </div>

              {pedidoItems.length > 0 && (
                <div className="px-4 py-3 border-t border-gray-200 bg-acqua/5 shrink-0 flex items-center justify-between">
                  <div className="flex items-center gap-4 text-[12px] text-gray-600">
                    <span><span className="font-bold text-gray-900">{pedidoItems.length}</span> en pedido</span>
                    {pedidoTotalUSD > 0 && <span>USD: <span className="font-bold text-gray-900">US$ {pedidoTotalUSD.toFixed(2)}</span></span>}
                    <span>ARS: <span className="font-bold text-acqua">{formatARS(pedidoTotalARS)}</span></span>
                  </div>
                  <button onClick={() => setTab('pedido')} className="flex items-center gap-1.5 px-3 py-1.5 bg-acqua text-white text-[12px] font-semibold rounded-lg hover:bg-acqua-dark transition-colors">
                    Ver pedido →
                  </button>
                </div>
              )}
            </div>
          )}

          {/* PEDIDO tab */}
          {(phase === 'ready' || phase === 'review') && tab === 'pedido' && (
            <div className="flex-1 overflow-hidden flex flex-col">
              {pedidoItems.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-400">
                  <ShoppingCart className="w-10 h-10 text-gray-200" />
                  <p className="text-[13px] font-medium">No hay productos en el pedido</p>
                  <button onClick={() => setTab('catalogo')} className="mt-2 px-4 py-2 bg-gray-100 text-gray-600 text-[12px] font-semibold rounded-lg hover:bg-gray-200 transition-colors">← Ir al catálogo</button>
                </div>
              ) : (
                <>
                  <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/50 shrink-0 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="bg-white border border-gray-200 rounded-xl px-4 py-2 text-center">
                        <p className="text-[10px] text-gray-400 uppercase">Total USD</p>
                        <p className="text-lg font-bold text-gray-900">US$ {pedidoTotalUSD.toFixed(2)}</p>
                      </div>
                      <div className="bg-acqua/5 border border-acqua/20 rounded-xl px-4 py-2 text-center">
                        <p className="text-[10px] text-gray-400 uppercase">Total ARS</p>
                        <p className="text-lg font-bold text-acqua">{formatARS(pedidoTotalARS)}</p>
                      </div>
                    </div>
                    <button onClick={exportPedido} className="flex items-center gap-1.5 px-4 py-2 bg-acqua text-white text-[13px] font-semibold rounded-lg hover:bg-acqua-dark transition-colors">
                      <FileDown className="w-4 h-4" /> Exportar pedido CSV
                    </button>
                  </div>
                  <div className="flex-1 overflow-auto">
                    <table className="w-full text-[11px] border-collapse">
                      <thead className="sticky top-0 bg-white border-b border-gray-200 z-10">
                        <tr>
                          <th className="text-left px-4 py-2.5 text-[9px] font-semibold text-gray-400 uppercase w-24">Código</th>
                          <th className="text-left px-4 py-2.5 text-[9px] font-semibold text-gray-400 uppercase">Descripción</th>
                          <th className="text-right px-4 py-2.5 text-[9px] font-semibold text-gray-400 uppercase w-24">USD unit</th>
                          <th className="text-right px-4 py-2.5 text-[9px] font-semibold text-gray-400 uppercase w-28">ARS unit</th>
                          <th className="text-center px-4 py-2.5 text-[9px] font-semibold text-gray-400 uppercase w-24">Cant.</th>
                          <th className="text-right px-4 py-2.5 text-[9px] font-semibold text-gray-400 uppercase w-28">Total USD</th>
                          <th className="text-right px-4 py-2.5 text-[9px] font-semibold text-gray-400 uppercase w-32">Total ARS</th>
                          <th className="w-10"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {pedidoItems.map(item => {
                          const ars = priceInARS(item);
                          return (
                            <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                              <td className="px-4 py-2.5 font-mono text-[10px] text-gray-700 font-semibold">{item.code}</td>
                              <td className="px-4 py-2.5"><p className="text-gray-800 font-medium">{item.desc}</p><p className="text-[9px] text-gray-400">{item.category}</p></td>
                              <td className="px-4 py-2.5 text-right text-gray-600">{item.priceUSD != null ? `US$ ${item.priceUSD.toFixed(2)}` : '—'}</td>
                              <td className="px-4 py-2.5 text-right font-semibold text-acqua">{ars ? formatARS(ars) : '—'}</td>
                              <td className="px-4 py-2.5 text-center">
                                <div className="flex items-center justify-center gap-1">
                                  <button onClick={() => setQty(item.id, item.qty - 1)} className="w-6 h-6 rounded border border-gray-200 flex items-center justify-center text-gray-400 hover:bg-gray-100 text-[11px] font-bold">−</button>
                                  <span className="w-8 text-center font-bold text-gray-900">{item.qty}</span>
                                  <button onClick={() => setQty(item.id, item.qty + 1)} className="w-6 h-6 rounded border border-gray-200 flex items-center justify-center text-gray-400 hover:bg-gray-100 text-[11px] font-bold">+</button>
                                </div>
                              </td>
                              <td className="px-4 py-2.5 text-right font-semibold text-gray-800">{item.priceUSD != null ? `US$ ${(item.priceUSD * item.qty).toFixed(2)}` : '—'}</td>
                              <td className="px-4 py-2.5 text-right font-bold text-acqua">{ars ? formatARS(ars * item.qty) : '—'}</td>
                              <td className="px-4 py-2.5 text-center"><button onClick={() => setQty(item.id, 0)} className="text-gray-300 hover:text-danger transition-colors"><X className="w-3.5 h-3.5" /></button></td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-gray-200 bg-gray-50">
                          <td colSpan={5} className="px-4 py-3 text-right text-[12px] font-bold text-gray-700">TOTAL:</td>
                          <td className="px-4 py-3 text-right text-[13px] font-bold text-gray-900">US$ {pedidoTotalUSD.toFixed(2)}</td>
                          <td className="px-4 py-3 text-right text-[13px] font-bold text-acqua">{formatARS(pedidoTotalARS)}</td>
                          <td></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Draft de edición
type SupplierDraft = {
  rubro: string; cuit: string; contact: string; whatsapp: string; email: string;
  fiscalCondition: string; currency: string; paymentMethod: string;
  paymentDays: string; deliveryDays: string; minOrder: string; freight: string;
  discount1: string; discount2: string; discount3: string;
  status: string; lastListDate: string; notes: string;
};

const supplierStatusOptions = [
  { value: 'actualizado', label: 'Actualizado' },
  { value: 'lista_cargada', label: 'Lista cargada' },
  { value: 'cambios_detectados', label: 'Cambios detectados' },
  { value: 'falta_actualizar', label: 'Falta actualizar' },
  { value: 'lista_vencida', label: 'Lista vencida' },
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'atencion', label: 'Atención' },
];

// ── Status de producto
const statusColors: Record<ProductStatus, string> = {
  en_sistema: 'text-success bg-success/10',
  no_figura:  'text-danger bg-danger/10',
  sin_costo:  'text-warning bg-warning/10',
  nuevo:      'text-acqua bg-acqua/10',
};
const statusLabels: Record<ProductStatus, string> = {
  en_sistema: 'En sistema',
  no_figura:  'No figura',
  sin_costo:  'Sin costo',
  nuevo:      'Nuevo',
};

// ── Página principal
export default function SupplierDetailPage() {
  const params = useParams();
  const id = params?.id as string;

  // Buscar en los contactos reales importados de Odoo
  const realContact = suppliersContacts.find(c => c.slug === id || c.id === id);

  const [overrides, setOverrides] = useState<Partial<Supplier>>({});
  useEffect(() => {
    const stored = loadSupplierOverride(id);
    setOverrides(stored as Partial<Supplier>);
  }, [id]);

  useEffect(() => {
    setGeminiKey(loadGeminiKey());
  }, []);

  // Construir ficha desde contacto real + overrides guardados en localStorage
  const syntheticSupplier: Supplier | null = realContact ? {
    id: realContact.id,
    name: realContact.name,
    rubro: realContact.tags.find(t => !['Proveedor', 'Cliente', 'Empleado'].includes(t)) || 'Sin rubro',
    status: 'pendiente' as SupplierStatus,
    productCount: 0,
    pendingProducts: 0,
    avgMargin: 0,
    contact: realContact.phone || '',
    whatsapp: '',
    email: '',
    cuit: '',
    fiscalCondition: realContact.fiscalCondition || '',
    currency: 'ARS',
    paymentMethod: '',
    paymentDays: 0,
    deliveryDays: 0,
    minOrder: 0,
    freight: '',
    discount1: 0,
    discount2: 0,
    discount3: 0,
    appliesToIVA: true,
    invoices: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } : null;

  const supplier = syntheticSupplier
    ? { ...syntheticSupplier, ...overrides } as Supplier
    : null;

  // Edit mode
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState<SupplierDraft>({
    rubro: '', cuit: '', contact: '', whatsapp: '', email: '',
    fiscalCondition: '', currency: 'ARS', paymentMethod: '',
    paymentDays: '', deliveryDays: '', minOrder: '', freight: '',
    discount1: '', discount2: '', discount3: '', status: 'pendiente',
    lastListDate: '', notes: '',
  });

  const startEdit = () => {
    if (!supplier) return;
    setDraft({
      rubro: supplier.rubro || '',
      cuit: supplier.cuit || '',
      contact: supplier.contact || '',
      whatsapp: supplier.whatsapp || '',
      email: supplier.email || '',
      fiscalCondition: supplier.fiscalCondition || '',
      currency: supplier.currency || 'ARS',
      paymentMethod: supplier.paymentMethod || '',
      paymentDays: String(supplier.paymentDays || ''),
      deliveryDays: String(supplier.deliveryDays || ''),
      minOrder: String(supplier.minOrder || ''),
      freight: supplier.freight || '',
      discount1: String(supplier.discount1 || ''),
      discount2: String(supplier.discount2 || ''),
      discount3: String(supplier.discount3 || ''),
      status: supplier.status || 'pendiente',
      lastListDate: supplier.lastListDate || '',
      notes: (supplier as Supplier & { notes?: string }).notes || '',
    });
    setEditMode(true);
  };

  const saveEdit = () => {
    const parsed: Record<string, unknown> = {
      rubro: draft.rubro, cuit: draft.cuit, contact: draft.contact,
      whatsapp: draft.whatsapp, email: draft.email, fiscalCondition: draft.fiscalCondition,
      currency: draft.currency, paymentMethod: draft.paymentMethod,
      paymentDays: draft.paymentDays ? Number(draft.paymentDays) : undefined,
      deliveryDays: draft.deliveryDays ? Number(draft.deliveryDays) : undefined,
      minOrder: draft.minOrder ? Number(draft.minOrder) : undefined,
      freight: draft.freight,
      discount1: draft.discount1 ? Number(draft.discount1) : undefined,
      discount2: draft.discount2 ? Number(draft.discount2) : undefined,
      discount3: draft.discount3 ? Number(draft.discount3) : undefined,
      status: draft.status as SupplierStatus,
      lastListDate: draft.lastListDate,
      notes: draft.notes,
    };
    Object.keys(parsed).forEach(k => {
      if (parsed[k] === undefined || parsed[k] === '') delete parsed[k];
    });
    saveSupplierOverride(id, parsed);
    setOverrides(prev => ({ ...prev, ...parsed }));
    setEditMode(false);
  };

  const setField = (field: keyof SupplierDraft) => (value: string) =>
    setDraft(prev => ({ ...prev, [field]: value }));

  // Datos Odoo
  const odooSupplier = (odooData as Array<{ name: string; slug: string; count: number; products: OdooProduct[] }>)
    .find(s => s.slug === id);

  // View & filter state
  const [viewMode, setViewMode] = useState<ViewMode>('tabla');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'todos' | ProductStatus>('todos');
  const [showUpload,   setShowUpload]   = useState(false);
  const [showCompare,  setShowCompare]  = useState(false);
  const [showCatalog,  setShowCatalog]  = useState(false);
  const [geminiKey,    setGeminiKey]    = useState('');
  const [editingRow, setEditingRow] = useState<string | null>(null);
  const [prices, setPrices] = useState<Record<string, number>>({});
  // Pedido: cantidad por producto
  const [pedido, setPedido] = useState<Record<string, number>>({});
  const [showPedidoSummary, setShowPedidoSummary] = useState(false);
  const [pedidoView, setPedidoView] = useState<'tabla' | 'grid'>('tabla');

  const products: ProductRow[] = useMemo(() => {
    if (!odooSupplier) return [];
    // Build lookup map: supplierCode → product for real status detection
    const productByCode = new Map<string, { cost: number }>();
    (productsData as Array<{ supplierCode: string | null; cost: number }>).forEach(p => {
      if (p.supplierCode) productByCode.set(p.supplierCode.trim().toLowerCase(), { cost: p.cost });
    });

    return odooSupplier.products.map((p) => {
      const match = productByCode.get((p.code || '').trim().toLowerCase());
      // sin_costo = el proveedor no tiene precio puesto (price === 0 o null)
      // en_sistema = está vinculado en Odoo (aunque el costo interno sea 0)
      // no_figura  = no hay match en products.json
      const productStatus: ProductStatus = (!p.price || p.price === 0)
        ? 'sin_costo'
        : !match
        ? 'no_figura'
        : 'en_sistema';
      return { ...p, productStatus };
    });
  }, [odooSupplier]);

  const filtered = useMemo(() => {
    return products.filter(p => {
      const matchStatus = statusFilter === 'todos' || p.productStatus === statusFilter;
      const matchSearch = !search
        || p.tmpl_name.toLowerCase().includes(search.toLowerCase())
        || (p.sup_name || '').toLowerCase().includes(search.toLowerCase())
        || p.code.toLowerCase().includes(search.toLowerCase())
        || p.si_id.includes(search);
      return matchStatus && matchSearch;
    });
  }, [products, statusFilter, search]);

  const productStats = useMemo(() => ({
    total: products.length,
    en_sistema: products.filter(p => p.productStatus === 'en_sistema').length,
    sin_costo: products.filter(p => p.productStatus === 'sin_costo').length,
    no_figura: products.filter(p => p.productStatus === 'no_figura').length,
    nuevo: products.filter(p => p.productStatus === 'nuevo').length,
  }), [products]);

  // Pedido stats
  const pedidoItems = useMemo(() => {
    return Object.entries(pedido)
      .filter(([, qty]) => qty > 0)
      .map(([si_id, qty]) => {
        const p = products.find(x => x.si_id === si_id)!;
        return p ? { ...p, qty } : null;
      })
      .filter(Boolean) as (ProductRow & { qty: number })[];
  }, [pedido, products]);

  const pedidoTotal = pedidoItems.reduce((acc, i) => acc + i.net_price * i.qty, 0);
  const pedidoUnidades = pedidoItems.reduce((acc, i) => acc + i.qty, 0);

  const setPedidoQty = (si_id: string, qty: number) => {
    setPedido(prev => {
      if (qty <= 0) { const n = {...prev}; delete n[si_id]; return n; }
      return { ...prev, [si_id]: qty };
    });
  };

  if (!supplier) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-400">Proveedor no encontrado</p>
          <Link href="/proveedores" className="mt-4 inline-flex items-center gap-2 text-acqua text-sm font-medium hover:underline">
            <ArrowLeft className="w-4 h-4" /> Volver
          </Link>
        </div>
      </div>
    );
  }

  const st = statusConfig[supplier.status] || statusConfig['pendiente'];
  const rubroColor = rubroColors[supplier.rubro] || rubroColors['default'];
  const ds = daysSince(supplier.lastListDate);

  // Socio Acqua messages
  const socioMessages: { type: 'danger' | 'warning' | 'info' | 'success'; text: string }[] = [];
  if (ds !== null && ds > 30) socioMessages.push({ type: 'danger', text: `Lista vencida hace ${ds} días — pedí actualización urgente.` });
  else if (ds !== null && ds > 14) socioMessages.push({ type: 'warning', text: `Lista con ${ds} días — verificá si hubo cambios de precio.` });
  if ((supplier.pendingProducts || 0) > 0) socioMessages.push({ type: 'warning', text: `${supplier.pendingProducts} productos sin costo aprobado en Odoo.` });
  if (productStats.sin_costo > 0) socioMessages.push({ type: 'warning', text: `${productStats.sin_costo} productos sin precio base — revisá antes de exportar.` });
  if (productStats.no_figura > 0) socioMessages.push({ type: 'info', text: `${productStats.no_figura} productos no figuran en la última lista del proveedor.` });
  if ((supplier.avgMargin || 0) >= 50) socioMessages.push({ type: 'success', text: `Margen promedio ${supplier.avgMargin}% — proveedor rentable. ✓` });
  if (ds !== null && ds <= 7) socioMessages.push({ type: 'success', text: 'Lista reciente. Podés generar el export a Odoo.' });

  return (
    <div className="min-h-screen bg-surface">

      {showUpload && (
        <UploadModal
          onClose={(refreshed) => {
            setShowUpload(false);
            if (refreshed) window.location.reload();
          }}
          supplierName={supplier.name}
          supplierSlug={id}
        />
      )}

      {showCompare && (
        <ComparePriceModal
          onClose={(refreshed) => {
            setShowCompare(false);
            if (refreshed) window.location.reload();
          }}
          supplierName={supplier.name}
          supplierSlug={id}
        />
      )}

      {showCatalog && (
        <SupplierCatalogModal
          onClose={() => setShowCatalog(false)}
          supplierName={supplier.name}
          geminiKey={geminiKey}
        />
      )}

      {/* Breadcrumb */}
      <div className="bg-header border-b border-white/10 px-5 lg:px-8 xl:px-12 py-3">
        <div className="max-w-[1680px] mx-auto flex items-center gap-2 text-[12px]">
          <Link href="/proveedores" className="flex items-center gap-1.5 text-white/50 hover:text-white transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" /> Proveedores
          </Link>
          <span className="text-white/20">/</span>
          <span className="text-white font-medium">{supplier.name}</span>
          {editMode && (
            <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 bg-acqua/20 text-acqua text-[10px] font-semibold rounded-full">
              <Edit2 className="w-3 h-3" /> Modo edición
            </span>
          )}
        </div>
      </div>

      <div className="max-w-[1680px] mx-auto px-5 lg:px-8 xl:px-12 py-5">

        {/* ─── Socio Acqua — BARRA SUPERIOR ─── */}
        {socioMessages.length > 0 && (
          <div className="mb-5 bg-white border border-gray-100 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-full bg-acqua/10 border border-acqua/20 flex items-center justify-center shrink-0 mt-0.5">
                <Sparkles className="w-4 h-4 text-acqua" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[12px] font-bold text-gray-700">Socio Acqua — {supplier.name}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {socioMessages.map((m, i) => (
                    <div key={i} className={cn(
                      'flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-lg',
                      m.type === 'danger'  ? 'bg-danger/8 text-danger border border-danger/20' :
                      m.type === 'warning' ? 'bg-warning/8 text-warning border border-warning/20' :
                      m.type === 'success' ? 'bg-success/8 text-success border border-success/20' :
                      'bg-acqua/8 text-acqua border border-acqua/20'
                    )}>
                      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0',
                        m.type === 'danger' ? 'bg-danger' :
                        m.type === 'warning' ? 'bg-warning' :
                        m.type === 'success' ? 'bg-success' : 'bg-acqua'
                      )} />
                      {m.text}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-col xl:flex-row gap-5">

          {/* ─────── LEFT PANEL ─────── */}
          <aside className="xl:w-64 shrink-0">

            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              {/* Cover */}
              <div className={cn('relative h-16 bg-gradient-to-br', supplier.headerColor || 'from-zinc-700 to-zinc-900')}>
                {!editMode ? (
                  <button
                    onClick={startEdit}
                    className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 bg-black/30 hover:bg-black/50 rounded-md text-white/90 text-[11px] font-medium transition-colors"
                  >
                    <Edit2 className="w-3 h-3" /> Editar
                  </button>
                ) : (
                  <div className="absolute top-2 right-2 flex items-center gap-1">
                    <button onClick={saveEdit} className="flex items-center gap-1 px-2 py-1 bg-success hover:bg-success/90 rounded-md text-white text-[11px] font-semibold">
                      <Save className="w-3 h-3" /> Guardar
                    </button>
                    <button onClick={() => setEditMode(false)} className="px-1.5 py-1 bg-black/30 rounded-md text-white/80 text-[11px]">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}
                {!editMode && (
                  <div className="absolute bottom-1.5 left-14">
                    <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold', st.color)}>
                      <span className={cn('w-1.5 h-1.5 rounded-full', st.dot)} />
                      {st.label}
                    </span>
                  </div>
                )}
              </div>

              {/* Avatar + photo upload */}
              <div className="relative px-4">
                <div
                  className="absolute -top-5 left-4 w-10 h-10 rounded-xl bg-white border-2 border-white shadow-md flex items-center justify-center overflow-hidden group cursor-pointer"
                  title="Subir logo del proveedor"
                  onClick={() => {
                    const inp = document.createElement('input');
                    inp.type = 'file'; inp.accept = 'image/*';
                    inp.onchange = () => {
                      const file = inp.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => {
                        const b64 = reader.result as string;
                        saveSupplierOverride(id, { logo: b64 });
                        setOverrides(prev => ({ ...prev, logo: b64 }));
                      };
                      reader.readAsDataURL(file);
                    };
                    inp.click();
                  }}
                >
                  {(overrides.logo || supplier.logo)
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={(overrides.logo || supplier.logo) as string} alt={supplier.name} className="w-full h-full object-cover" />
                    : <span className="text-lg font-black text-gray-700">{supplier.name.charAt(0)}</span>
                  }
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <ImageIcon className="w-4 h-4 text-white" />
                  </div>
                </div>
              </div>

              {/* Body */}
              <div className="px-4 pt-7 pb-4">
                <h2 className="font-bold text-[13px] text-gray-900 leading-tight">{supplier.name}</h2>

                {!editMode ? (
                  <>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className={cn('inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide', rubroColor)}>
                        {supplier.rubro}
                      </span>
                      {supplier.currency === 'USD' && (
                        <span className="px-1.5 py-0.5 bg-green-100 text-green-700 text-[9px] font-bold rounded">USD</span>
                      )}
                    </div>

                    <div className="mt-3 space-y-2">
                      {supplier.cuit && <InfoRow icon={<Building2 className="w-3 h-3" />} label="CUIT" value={supplier.cuit} />}
                      {supplier.contact && <InfoRow icon={<Package className="w-3 h-3" />} label="Contacto" value={supplier.contact} />}
                      {supplier.whatsapp && (
                        <InfoRow icon={<Phone className="w-3 h-3" />} label="WhatsApp" value={supplier.whatsapp}
                          link={`https://wa.me/${supplier.whatsapp.replace(/\D/g, '')}`} />
                      )}
                      {supplier.email && (
                        <InfoRow icon={<Mail className="w-3 h-3" />} label="Email" value={supplier.email}
                          link={`mailto:${supplier.email}`} truncate />
                      )}
                      {supplier.fiscalCondition && (
                        <InfoRow icon={<Info className="w-3 h-3" />} label="Cond. fiscal" value={supplier.fiscalCondition} />
                      )}
                    </div>

                    <div className="border-t border-gray-100 my-3" />
                    <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Condiciones</p>
                    <div className="space-y-2">
                      {supplier.paymentMethod && <InfoRow icon={<DollarSign className="w-3 h-3" />} label="Pago" value={supplier.paymentMethod} />}
                      {supplier.deliveryDays && <InfoRow icon={<Calendar className="w-3 h-3" />} label="Entrega" value={`${supplier.deliveryDays} días hábiles`} />}
                      {supplier.minOrder && <InfoRow icon={<Package className="w-3 h-3" />} label="Mínimo" value={formatARS(supplier.minOrder)} />}
                      {supplier.freight && <InfoRow icon={<TrendingUp className="w-3 h-3" />} label="Flete" value={supplier.freight} />}
                    </div>

                    {(supplier.discount1 || supplier.equivalentDiscount) && (
                      <>
                        <div className="border-t border-gray-100 my-3" />
                        <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Descuentos</p>
                        <div className="flex flex-wrap gap-1.5">
                          {supplier.discount1 && (
                            <div className="flex flex-col items-center bg-gray-50 rounded-lg px-2.5 py-1.5">
                              <span className="text-sm font-bold text-gray-800">{supplier.discount1}%</span>
                              <span className="text-[9px] text-gray-400">Dto. 1</span>
                            </div>
                          )}
                          {supplier.discount2 && (
                            <div className="flex flex-col items-center bg-gray-50 rounded-lg px-2.5 py-1.5">
                              <span className="text-sm font-bold text-gray-800">{supplier.discount2}%</span>
                              <span className="text-[9px] text-gray-400">Dto. 2</span>
                            </div>
                          )}
                          {supplier.discount3 && (
                            <div className="flex flex-col items-center bg-gray-50 rounded-lg px-2.5 py-1.5">
                              <span className="text-sm font-bold text-gray-800">{supplier.discount3}%</span>
                              <span className="text-[9px] text-gray-400">Dto. 3</span>
                            </div>
                          )}
                          {supplier.equivalentDiscount && (
                            <div className="flex flex-col items-center bg-acqua/10 border border-acqua/20 rounded-lg px-2.5 py-1.5">
                              <span className="text-sm font-bold text-acqua">{supplier.equivalentDiscount}%</span>
                              <span className="text-[9px] text-acqua/70">Equiv.</span>
                            </div>
                          )}
                        </div>
                      </>
                    )}

                    {(supplier as Supplier & { notes?: string }).notes && (
                      <>
                        <div className="border-t border-gray-100 my-3" />
                        <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Notas</p>
                        <p className="text-[11px] text-gray-600 leading-relaxed">
                          {(supplier as Supplier & { notes?: string }).notes}
                        </p>
                      </>
                    )}
                  </>
                ) : (
                  /* EDIT MODE */
                  <div className="mt-2 space-y-2.5">
                    <div className="grid grid-cols-2 gap-2">
                      <EditField label="Rubro" value={draft.rubro} onChange={setField('rubro')} placeholder="Limpieza" />
                      <EditField label="Estado" value={draft.status} onChange={setField('status')} type="select" options={supplierStatusOptions} />
                    </div>
                    <EditField label="CUIT" value={draft.cuit} onChange={setField('cuit')} placeholder="30-12345678-9" />
                    <EditField label="Contacto / Vendedor" value={draft.contact} onChange={setField('contact')} />
                    <EditField label="WhatsApp" value={draft.whatsapp} onChange={setField('whatsapp')} placeholder="+549 11 xxxx-xxxx" />
                    <EditField label="Email" value={draft.email} onChange={setField('email')} type="email" />
                    <div className="grid grid-cols-2 gap-2">
                      <EditField label="Cond. fiscal" value={draft.fiscalCondition} onChange={setField('fiscalCondition')} type="select"
                        options={[
                          { value: '', label: '—' },
                          { value: 'Responsable Inscripto', label: 'Resp. Inscripto' },
                          { value: 'Monotributista', label: 'Monotributista' },
                          { value: 'Exento', label: 'Exento' },
                        ]} />
                      <EditField label="Moneda" value={draft.currency} onChange={setField('currency')} type="select"
                        options={[{ value: 'ARS', label: 'ARS' }, { value: 'USD', label: 'USD' }]} />
                    </div>
                    <div className="border-t border-gray-100 pt-2">
                      <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Condiciones</p>
                      <div className="space-y-2">
                        <EditField label="Método de pago" value={draft.paymentMethod} onChange={setField('paymentMethod')} placeholder="Transferencia 30 días" />
                        <div className="grid grid-cols-2 gap-2">
                          <EditField label="Días pago" value={draft.paymentDays} onChange={setField('paymentDays')} type="number" placeholder="30" />
                          <EditField label="Días entrega" value={draft.deliveryDays} onChange={setField('deliveryDays')} type="number" placeholder="3" />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <EditField label="Mínimo ($)" value={draft.minOrder} onChange={setField('minOrder')} type="number" />
                          <EditField label="Flete" value={draft.freight} onChange={setField('freight')} />
                        </div>
                      </div>
                    </div>
                    <div className="border-t border-gray-100 pt-2">
                      <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Descuentos</p>
                      <div className="grid grid-cols-3 gap-1.5">
                        <EditField label="Dto. 1 %" value={draft.discount1} onChange={setField('discount1')} type="number" />
                        <EditField label="Dto. 2 %" value={draft.discount2} onChange={setField('discount2')} type="number" />
                        <EditField label="Dto. 3 %" value={draft.discount3} onChange={setField('discount3')} type="number" />
                      </div>
                    </div>
                    <EditField label="Fecha última lista (YYYY-MM-DD)" value={draft.lastListDate} onChange={setField('lastListDate')} />
                    <EditField label="Notas internas" value={draft.notes} onChange={setField('notes')} type="textarea" placeholder="Observaciones..." />
                    <div className="flex gap-2 pt-1">
                      <button onClick={saveEdit} className="flex-1 flex items-center justify-center gap-1 py-2 bg-success text-white text-[12px] font-semibold rounded-lg">
                        <Save className="w-3.5 h-3.5" /> Guardar
                      </button>
                      <button onClick={() => setEditMode(false)} className="px-3 py-2 border border-gray-200 text-gray-500 text-[12px] rounded-lg hover:bg-gray-50">
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Acciones */}
            {!editMode && (
              <div className="mt-4 bg-white rounded-xl border border-gray-100 p-3 space-y-2">
                <button onClick={() => setShowUpload(true)}
                  className="flex items-center gap-2 w-full px-3 py-2.5 bg-acqua text-white text-[12px] font-semibold rounded-lg hover:bg-acqua-dark transition-colors">
                  <Upload className="w-3.5 h-3.5" /> Cargar nueva lista
                </button>
                <button onClick={() => setShowCompare(true)}
                  className="flex items-center gap-2 w-full px-3 py-2.5 bg-white border border-acqua/40 text-acqua text-[12px] font-semibold rounded-lg hover:bg-acqua/5 transition-colors">
                  <TrendingUp className="w-3.5 h-3.5" /> Comparar listas de precios
                </button>
                <button onClick={() => setShowCatalog(true)}
                  className="flex items-center gap-2 w-full px-3 py-2.5 bg-white border border-purple-200 text-purple-700 text-[12px] font-semibold rounded-lg hover:bg-purple-50 transition-colors">
                  <Package className="w-3.5 h-3.5" /> Catálogo completo
                </button>
                <button className="flex items-center gap-2 w-full px-3 py-2.5 bg-odoo text-white text-[12px] font-semibold rounded-lg hover:opacity-90 transition-opacity">
                  <Download className="w-3.5 h-3.5" /> Export Odoo (supplierinfo)
                </button>
                <button className="flex items-center gap-2 w-full px-3 py-2.5 border border-gray-200 text-gray-600 text-[12px] font-medium rounded-lg hover:bg-gray-50 transition-colors">
                  <Eye className="w-3.5 h-3.5" /> Ver historial
                </button>
              </div>
            )}
          </aside>

          {/* ─────── RIGHT PANEL ─────── */}
          <div className="flex-1 min-w-0">

            {/* Header con stats + view toggle */}
            <div className="bg-white rounded-xl border border-gray-100 p-4 mb-4">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-bold text-gray-900">
                    {viewMode === 'pedido' ? 'Armar pedido' : 'Productos del proveedor'}
                  </h3>
                  <p className="text-[12px] text-gray-400 mt-0.5">
                    {viewMode === 'pedido'
                      ? 'Seleccioná cantidades para armar el pedido de compra'
                      : 'Lista vinculada con product.supplierinfo de Odoo'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {/* View mode toggle */}
                  <div className="flex bg-gray-100 rounded-lg p-1 gap-0.5">
                    {([
                      { key: 'tabla', icon: List,         label: 'Tabla' },
                      { key: 'grid',  icon: LayoutGrid,   label: 'Grid' },
                      { key: 'pedido', icon: ShoppingCart, label: 'Pedido' },
                    ] as const).map(v => {
                      const Icon = v.icon;
                      return (
                        <button
                          key={v.key}
                          onClick={() => setViewMode(v.key)}
                          className={cn(
                            'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-semibold transition-colors',
                            viewMode === v.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                          )}
                        >
                          <Icon className="w-3.5 h-3.5" />
                          {v.label}
                          {v.key === 'pedido' && pedidoItems.length > 0 && (
                            <span className="inline-flex items-center justify-center w-4 h-4 bg-acqua text-white text-[9px] font-bold rounded-full">
                              {pedidoItems.length}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {ds !== null && (
                    <span className="text-[11px] text-gray-400 hidden lg:flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {supplier.lastListDate?.split('-').reverse().join('/')}
                    </span>
                  )}
                </div>
              </div>

              {/* Status filter tabs */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {([
                  { key: 'todos',      label: 'Todos',      count: productStats.total },
                  { key: 'en_sistema', label: 'En sistema', count: productStats.en_sistema },
                  { key: 'sin_costo',  label: 'Sin costo',  count: productStats.sin_costo },
                  { key: 'no_figura',  label: 'No figura',  count: productStats.no_figura },
                  { key: 'nuevo',      label: 'Nuevo',      count: productStats.nuevo },
                ] as const).map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setStatusFilter(tab.key as 'todos' | ProductStatus)}
                    className={cn(
                      'flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold transition-colors',
                      statusFilter === tab.key
                        ? tab.key === 'todos' ? 'bg-gray-900 text-white'
                          : tab.key === 'en_sistema' ? 'bg-success/15 text-success'
                          : tab.key === 'sin_costo' ? 'bg-warning/15 text-warning'
                          : tab.key === 'no_figura' ? 'bg-danger/15 text-danger'
                          : 'bg-acqua/15 text-acqua'
                        : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                    )}
                  >
                    {tab.label}
                    <span className="text-[10px] font-bold opacity-70">{tab.count}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Search bar */}
            {viewMode !== 'pedido' && (
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Buscar por nombre, código, nombre proveedor…"
                  className="w-full pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-lg text-[13px] placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-acqua/30"
                />
              </div>
            )}

            {/* ─── VISTA TABLA ─── */}
            {viewMode === 'tabla' && odooSupplier && (
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider bg-gray-50/80 border-b border-gray-100">
                        <th className="text-left px-3 py-2.5 w-8">#</th>
                        <th className="text-left px-3 py-2.5">Producto (Odoo)</th>
                        <th className="text-left px-3 py-2.5 hidden xl:table-cell">Nombre proveedor</th>
                        <th className="text-center px-2 py-2.5">Código</th>
                        <th className="text-center px-2 py-2.5">Mín.</th>
                        <th className="text-right px-2 py-2.5">Precio base</th>
                        <th className="text-center px-2 py-2.5">Dto%</th>
                        <th className="text-right px-2 py-2.5 font-bold text-gray-600">Costo neto</th>
                        <th className="text-center px-2 py-2.5">Estado</th>
                        <th className="text-center px-2 py-2.5">SI_ID</th>
                        <th className="w-8 px-1 py-2.5" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {filtered.slice(0, 60).map((p, i) => {
                        const isEditing = editingRow === p.si_id;
                        const currentPrice = prices[p.si_id] ?? p.price;
                        const currentNet = currentPrice * (1 - p.discount / 100);

                        return (
                          <tr key={p.si_id} className={cn('group hover:bg-gray-50/50 transition-colors', p.productStatus === 'no_figura' && 'opacity-50')}>
                            <td className="px-3 py-2 text-[11px] text-gray-400 font-mono">{i + 1}</td>
                            <td className="px-3 py-2">
                              <div className="flex items-start gap-1.5">
                                {/* Foto */}
                                <div className="w-8 h-8 rounded-md bg-gray-100 border border-gray-200 flex items-center justify-center shrink-0 overflow-hidden">
                                  {p.tmpl_id && productImageMap[p.tmpl_id] ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={productImageMap[p.tmpl_id]} alt={p.tmpl_name} className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display='none'; }} />
                                  ) : (
                                    <ImageIcon className="w-3.5 h-3.5 text-gray-400" />
                                  )}
                                </div>
                                <div className="min-w-0">
                                  {p.tmpl_id && <span className="text-[9px] font-mono text-gray-400">[{p.tmpl_id}] </span>}
                                  <span className="text-[12px] font-medium text-gray-800 leading-tight line-clamp-1">
                                    {p.tmpl_name || '—'}
                                  </span>
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-2 hidden xl:table-cell">
                              <span className="text-[11px] text-gray-400 italic line-clamp-1">{p.sup_name || '—'}</span>
                            </td>
                            <td className="px-2 py-2 text-center">
                              {p.code ? (
                                <span className="text-[10px] font-mono text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded">{p.code}</span>
                              ) : <span className="text-gray-400 text-[11px]">—</span>}
                            </td>
                            <td className="px-2 py-2 text-center text-[12px] text-gray-500">{p.min_qty}</td>
                            <td className="px-2 py-2 text-right">
                              {isEditing ? (
                                <input
                                  type="number"
                                  value={currentPrice}
                                  onChange={e => setPrices(prev => ({ ...prev, [p.si_id]: parseFloat(e.target.value) || 0 }))}
                                  className="w-24 text-right text-[12px] border border-acqua rounded px-2 py-0.5 focus:outline-none"
                                  autoFocus
                                />
                              ) : (
                                <span className="text-[12px] text-gray-600">{formatARS(currentPrice)}</span>
                              )}
                            </td>
                            <td className="px-2 py-2 text-center">
                              {p.discount > 0
                                ? <span className="text-[12px] font-semibold text-success">{p.discount}%</span>
                                : <span className="text-gray-400 text-[11px]">—</span>}
                            </td>
                            <td className="px-2 py-2 text-right">
                              <span className="text-[13px] font-bold text-gray-900">
                                {formatARS(isEditing ? currentNet : p.net_price)}
                              </span>
                            </td>
                            <td className="px-2 py-2 text-center">
                              <span className={cn('inline-flex whitespace-nowrap px-1.5 py-0.5 rounded-full text-[10px] font-semibold', statusColors[p.productStatus])}>
                                {statusLabels[p.productStatus]}
                              </span>
                            </td>
                            <td className="px-2 py-2 text-center">
                              <button
                                onClick={() => navigator.clipboard?.writeText(p.si_id)}
                                className="text-[10px] font-mono text-gray-400 hover:text-gray-600 transition-colors"
                              >
                                {p.si_id}
                              </button>
                            </td>
                            <td className="px-1 py-2">
                              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                {isEditing ? (
                                  <>
                                    <button onClick={() => setEditingRow(null)} className="w-5 h-5 flex items-center justify-center rounded bg-success/10 text-success">
                                      <CheckCircle2 className="w-3 h-3" />
                                    </button>
                                    <button onClick={() => { setPrices(prev => { const n={...prev}; delete n[p.si_id]; return n; }); setEditingRow(null); }} className="w-5 h-5 flex items-center justify-center rounded bg-gray-100 text-gray-400">
                                      <X className="w-3 h-3" />
                                    </button>
                                  </>
                                ) : (
                                  <button onClick={() => setEditingRow(p.si_id)} className="w-5 h-5 flex items-center justify-center rounded hover:bg-gray-100 text-gray-400">
                                    <Edit2 className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {filtered.length > 60 && (
                  <div className="px-4 py-3 text-center border-t border-gray-100 bg-gray-50/50">
                    <p className="text-[12px] text-gray-400">
                      Mostrando 60 de {filtered.length} productos.{' '}
                      <button className="text-acqua font-medium hover:underline">Cargar más</button>
                    </p>
                  </div>
                )}
                <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50/50">
                  <div className="text-[12px] text-gray-500">
                    <span className="font-semibold text-gray-700">{productStats.en_sistema}</span> en sistema ·{' '}
                    <span className="font-semibold text-warning">{productStats.sin_costo}</span> sin costo ·{' '}
                    <span className="font-semibold text-danger">{productStats.no_figura}</span> no figura
                  </div>
                  <button className="flex items-center gap-2 px-3 py-1.5 bg-odoo text-white text-[12px] font-semibold rounded-lg hover:opacity-90">
                    <Download className="w-3.5 h-3.5" /> Export Odoo
                  </button>
                </div>
              </div>
            )}

            {/* ─── VISTA GRID ─── */}
            {viewMode === 'grid' && odooSupplier && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-3">
                {filtered.slice(0, 60).map(p => (
                  <div
                    key={p.si_id}
                    className={cn(
                      'bg-white rounded-xl border overflow-hidden hover:shadow-md transition-shadow group',
                      p.productStatus === 'no_figura'
                        ? 'border-gray-200 bg-gray-50/50'
                        : 'border-gray-100'
                    )}
                  >
                    {/* Foto */}
                    <div className="h-28 bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center relative overflow-hidden">
                      {p.tmpl_id && productImageMap[p.tmpl_id] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={productImageMap[p.tmpl_id]} alt={p.tmpl_name} className="w-full h-full object-contain p-2" />
                      ) : (
                        <ImageIcon className="w-10 h-10 text-gray-400" />
                      )}
                      <span className={cn(
                        'absolute top-2 right-2 whitespace-nowrap px-1.5 py-0.5 rounded-full text-[9px] font-semibold',
                        statusColors[p.productStatus]
                      )}>
                        {statusLabels[p.productStatus]}
                      </span>
                      {p.code && (
                        <span className="absolute bottom-2 left-2 text-[9px] font-mono text-gray-400 bg-white/90 px-1.5 py-0.5 rounded">
                          {p.code}
                        </span>
                      )}
                    </div>

                    {/* Info */}
                    <div className="p-3">
                      <p className="text-[11px] font-semibold text-gray-800 line-clamp-2 leading-tight mb-2">
                        {p.tmpl_name}
                      </p>
                      {p.sup_name && p.sup_name !== p.tmpl_name && (
                        <p className="text-[10px] text-gray-400 italic line-clamp-1 mb-2">{p.sup_name}</p>
                      )}

                      <div className="flex items-end justify-between">
                        <div>
                          {p.discount > 0 && (
                            <div className="text-[9px] text-gray-400 line-through">{formatARS(p.price)}</div>
                          )}
                          <div className="text-[13px] font-bold text-gray-900">{formatARS(p.net_price)}</div>
                          {p.discount > 0 && (
                            <div className="text-[9px] text-success font-semibold">-{p.discount}%</div>
                          )}
                        </div>
                        <div className="text-right">
                          <div className="text-[9px] text-gray-400">Mín. {p.min_qty}</div>
                        </div>
                      </div>

                      {/* Add to pedido */}
                      <div className="mt-2.5 flex items-center gap-1">
                        <button
                          onClick={() => setPedidoQty(p.si_id, Math.max(0, (pedido[p.si_id] || 0) - 1))}
                          className="w-7 h-7 flex items-center justify-center rounded-lg border border-gray-200 text-gray-400 hover:bg-gray-100 transition-colors"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <input
                          type="number"
                          value={pedido[p.si_id] || 0}
                          min={0}
                          onChange={e => setPedidoQty(p.si_id, Math.max(0, parseInt(e.target.value) || 0))}
                          className="flex-1 text-center text-[12px] font-semibold text-gray-700 border border-gray-200 rounded-lg py-1 focus:outline-none focus:ring-1 focus:ring-acqua"
                        />
                        <button
                          onClick={() => setPedidoQty(p.si_id, (pedido[p.si_id] || 0) + 1)}
                          className={cn(
                            'w-7 h-7 flex items-center justify-center rounded-lg border transition-colors',
                            (pedido[p.si_id] || 0) > 0
                              ? 'border-acqua bg-acqua text-white hover:bg-acqua-dark'
                              : 'border-gray-200 text-gray-400 hover:bg-gray-100'
                          )}
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ─── VISTA PEDIDO ─── */}
            {viewMode === 'pedido' && (
              <div className="space-y-4">
                {/* Selector rápido */}
                <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                  {/* Search + toggle tabla/grid */}
                  <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50 flex items-center gap-3">
                    <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                    <input
                      type="text"
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      placeholder="Buscar producto para agregar al pedido…"
                      className="flex-1 text-[13px] bg-transparent focus:outline-none text-gray-700 placeholder-gray-400"
                    />
                    {/* Toggle vista pedido */}
                    <div className="flex bg-white border border-gray-200 rounded-lg overflow-hidden shrink-0">
                      <button
                        onClick={() => setPedidoView('tabla')}
                        className={cn(
                          'flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-semibold transition-colors',
                          pedidoView === 'tabla' ? 'bg-gray-900 text-white' : 'text-gray-400 hover:text-gray-600'
                        )}
                      >
                        <List className="w-3 h-3" /> Tabla
                      </button>
                      <button
                        onClick={() => setPedidoView('grid')}
                        className={cn(
                          'flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-semibold transition-colors',
                          pedidoView === 'grid' ? 'bg-gray-900 text-white' : 'text-gray-400 hover:text-gray-600'
                        )}
                      >
                        <LayoutGrid className="w-3 h-3" /> Grid
                      </button>
                    </div>
                  </div>

                  {/* ── Pedido TABLA ── */}
                  {pedidoView === 'tabla' && (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider border-b border-gray-100">
                            <th className="text-left px-4 py-2.5">Producto</th>
                            <th className="text-center px-3 py-2.5">Código</th>
                            <th className="text-right px-3 py-2.5">P. base</th>
                            <th className="text-right px-3 py-2.5 text-acqua">Costo neto</th>
                            <th className="text-center px-3 py-2.5 w-36">Cantidad</th>
                            <th className="text-right px-4 py-2.5">Subtotal</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {filtered.slice(0, 60).filter(p => p.productStatus !== 'no_figura').map(p => {
                            const qty = pedido[p.si_id] || 0;
                            const imgSrc = p.tmpl_id ? productImageMap[p.tmpl_id] : undefined;
                            return (
                              <tr key={p.si_id} className={cn('hover:bg-gray-50/50 transition-colors', qty > 0 && 'bg-acqua/3')}>
                                <td className="px-4 py-2.5">
                                  <div className="flex items-center gap-2.5">
                                    {/* Foto */}
                                    <div className="w-8 h-8 rounded-md bg-gray-100 border border-gray-200 flex items-center justify-center shrink-0 overflow-hidden">
                                      {imgSrc
                                        // eslint-disable-next-line @next/next/no-img-element
                                        ? <img src={imgSrc} alt={p.tmpl_name} className="w-full h-full object-cover" />
                                        : <ImageIcon className="w-3.5 h-3.5 text-gray-400" />}
                                    </div>
                                    <div className="min-w-0">
                                      <div className="text-[12px] font-medium text-gray-800 line-clamp-1">{p.tmpl_name}</div>
                                      {p.sup_name && p.sup_name !== p.tmpl_name && (
                                        <div className="text-[10px] text-gray-400 italic">{p.sup_name}</div>
                                      )}
                                    </div>
                                  </div>
                                </td>
                                <td className="px-3 py-2.5 text-center">
                                  {p.code
                                    ? <span className="text-[10px] font-mono text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">{p.code}</span>
                                    : <span className="text-gray-400">—</span>}
                                </td>
                                <td className="px-3 py-2.5 text-right text-[12px] text-gray-500">{formatARS(p.price)}</td>
                                <td className="px-3 py-2.5 text-right">
                                  <span className="text-[13px] font-bold text-gray-900">{formatARS(p.net_price)}</span>
                                  {p.discount > 0 && (
                                    <span className="ml-1 text-[9px] text-success">-{p.discount}%</span>
                                  )}
                                </td>
                                <td className="px-3 py-2.5">
                                  <div className="flex items-center gap-1 justify-center">
                                    <button onClick={() => setPedidoQty(p.si_id, Math.max(0, qty - 1))}
                                      className="w-6 h-6 flex items-center justify-center rounded border border-gray-200 text-gray-400 hover:bg-gray-100">
                                      <Minus className="w-2.5 h-2.5" />
                                    </button>
                                    <input type="number" value={qty} min={0}
                                      onChange={e => setPedidoQty(p.si_id, Math.max(0, parseInt(e.target.value) || 0))}
                                      className="w-12 text-center text-[12px] font-bold text-gray-800 border border-gray-200 rounded py-0.5 focus:outline-none focus:ring-1 focus:ring-acqua"
                                    />
                                    <button onClick={() => setPedidoQty(p.si_id, qty + 1)}
                                      className={cn(
                                        'w-6 h-6 flex items-center justify-center rounded border transition-colors',
                                        qty > 0 ? 'border-acqua bg-acqua text-white' : 'border-gray-200 text-gray-400 hover:bg-gray-100'
                                      )}>
                                      <Plus className="w-2.5 h-2.5" />
                                    </button>
                                  </div>
                                </td>
                                <td className="px-4 py-2.5 text-right">
                                  {qty > 0
                                    ? <span className="text-[13px] font-bold text-acqua">{formatARS(p.net_price * qty)}</span>
                                    : <span className="text-gray-400 text-[12px]">—</span>}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* ── Pedido GRID ── */}
                  {pedidoView === 'grid' && (
                    <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                      {filtered.slice(0, 60).filter(p => p.productStatus !== 'no_figura').map(p => {
                        const qty = pedido[p.si_id] || 0;
                        const imgSrc = p.tmpl_id ? productImageMap[p.tmpl_id] : undefined;
                        return (
                          <div key={p.si_id} className={cn(
                            'bg-white rounded-xl border overflow-hidden transition-all',
                            qty > 0 ? 'border-acqua/40 shadow-sm ring-1 ring-acqua/20' : 'border-gray-100 hover:border-gray-200 hover:shadow-sm'
                          )}>
                            {/* Foto */}
                            <div className="h-24 bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center relative overflow-hidden">
                              {imgSrc
                                // eslint-disable-next-line @next/next/no-img-element
                                ? <img src={imgSrc} alt={p.tmpl_name} className="w-full h-full object-contain p-2" />
                                : <ImageIcon className="w-8 h-8 text-gray-400" />}
                              {p.code && (
                                <span className="absolute bottom-1.5 left-1.5 text-[9px] font-mono text-gray-400 bg-white/90 px-1.5 py-0.5 rounded">
                                  {p.code}
                                </span>
                              )}
                              {qty > 0 && (
                                <span className="absolute top-1.5 right-1.5 w-5 h-5 flex items-center justify-center bg-acqua text-white text-[9px] font-bold rounded-full">
                                  {qty}
                                </span>
                              )}
                            </div>
                            {/* Info */}
                            <div className="p-2.5">
                              <p className="text-[10px] font-semibold text-gray-800 line-clamp-2 leading-tight mb-1.5">
                                {p.tmpl_name}
                              </p>
                              <div className="flex items-baseline justify-between mb-2">
                                <span className="text-[12px] font-bold text-gray-900">{formatARS(p.net_price)}</span>
                                {p.discount > 0 && (
                                  <span className="text-[9px] text-success font-semibold">-{p.discount}%</span>
                                )}
                              </div>
                              {/* Controles qty */}
                              <div className="flex items-center gap-1">
                                <button onClick={() => setPedidoQty(p.si_id, Math.max(0, qty - 1))}
                                  className="w-7 h-7 flex items-center justify-center rounded-lg border border-gray-200 text-gray-400 hover:bg-gray-100 transition-colors">
                                  <Minus className="w-3 h-3" />
                                </button>
                                <input type="number" value={qty} min={0}
                                  onChange={e => setPedidoQty(p.si_id, Math.max(0, parseInt(e.target.value) || 0))}
                                  className="flex-1 text-center text-[12px] font-bold text-gray-800 border border-gray-200 rounded-lg py-1 focus:outline-none focus:ring-1 focus:ring-acqua"
                                />
                                <button onClick={() => setPedidoQty(p.si_id, qty + 1)}
                                  className={cn(
                                    'w-7 h-7 flex items-center justify-center rounded-lg border transition-colors',
                                    qty > 0 ? 'border-acqua bg-acqua text-white hover:bg-acqua-dark' : 'border-gray-200 text-gray-400 hover:bg-gray-100'
                                  )}>
                                  <Plus className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Resumen del pedido */}
                <div className="bg-white rounded-xl border border-gray-100 p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h4 className="font-bold text-gray-900">Resumen del pedido</h4>
                      <p className="text-[12px] text-gray-400">{supplier.name}</p>
                    </div>
                    {pedidoItems.length > 0 && (
                      <button
                        onClick={() => exportarPedido(pedidoItems, supplier.name)}
                        className="flex items-center gap-2 px-4 py-2 bg-acqua text-white text-[12px] font-semibold rounded-lg hover:bg-acqua-dark transition-colors"
                      >
                        <FileDown className="w-4 h-4" />
                        Exportar pedido (.csv)
                      </button>
                    )}
                  </div>

                  {pedidoItems.length === 0 ? (
                    <div className="text-center py-8">
                      <ShoppingCart className="w-10 h-10 text-gray-400 mx-auto mb-2" />
                      <p className="text-[13px] text-gray-400">No hay productos en el pedido todavía.</p>
                      <p className="text-[12px] text-gray-400">Usá los controles + / − en cada fila para agregar.</p>
                    </div>
                  ) : (
                    <>
                      <div className="space-y-2 mb-4">
                        {pedidoItems.map(item => (
                          <div key={item.si_id} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                            {/* Mini foto */}
                            <div className="w-8 h-8 rounded-md bg-gray-100 border border-gray-200 flex items-center justify-center shrink-0 overflow-hidden">
                              {item.tmpl_id && productImageMap[item.tmpl_id] ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={productImageMap[item.tmpl_id]} alt={item.tmpl_name} className="w-full h-full object-cover" />
                              ) : (
                                <ImageIcon className="w-3 h-3 text-gray-400" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[12px] font-medium text-gray-800 line-clamp-1">{item.tmpl_name}</p>
                              {item.code && <p className="text-[10px] text-gray-400 font-mono">{item.code}</p>}
                            </div>
                            <div className="text-right shrink-0">
                              <div className="text-[11px] text-gray-500">{formatARS(item.net_price)} × {item.qty}</div>
                              <div className="text-[13px] font-bold text-gray-900">{formatARS(item.net_price * item.qty)}</div>
                            </div>
                            <button
                              onClick={() => setPedidoQty(item.si_id, 0)}
                              className="w-6 h-6 flex items-center justify-center rounded hover:bg-danger/10 text-gray-400 hover:text-danger transition-colors shrink-0"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>

                      <div className="flex items-center justify-between pt-3 border-t-2 border-gray-900">
                        <div className="text-[13px] text-gray-500">
                          <span className="font-semibold text-gray-900">{pedidoItems.length}</span> productos ·{' '}
                          <span className="font-semibold text-gray-900">{pedidoUnidades}</span> unidades
                        </div>
                        <div className="text-right">
                          <div className="text-[11px] text-gray-400">Total estimado (costo neto)</div>
                          <div className="text-xl font-bold text-acqua">{formatARS(pedidoTotal)}</div>
                        </div>
                      </div>

                      {supplier.minOrder && pedidoTotal < supplier.minOrder && (
                        <div className="mt-3 flex items-center gap-2 px-3 py-2 bg-warning/8 border border-warning/20 rounded-lg">
                          <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0" />
                          <p className="text-[11px] text-warning">
                            Pedido mínimo: <strong>{formatARS(supplier.minOrder)}</strong> — te faltan{' '}
                            <strong>{formatARS(supplier.minOrder - pedidoTotal)}</strong>
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Sin datos Odoo */}
            {!odooSupplier && (
              <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
                <Package className="w-10 h-10 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-600 font-medium">Sin productos cargados</p>
                <p className="text-[13px] text-gray-400 mt-1 mb-4">
                  Cargá el Excel de Odoo para vincular los productos de este proveedor.
                </p>
                <button onClick={() => setShowUpload(true)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-acqua text-white text-[13px] font-semibold rounded-lg hover:bg-acqua-dark transition-colors">
                  <Upload className="w-4 h-4" /> Cargar lista
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── InfoRow
function InfoRow({ icon, label, value, link, truncate }: {
  icon: React.ReactNode; label: string; value: string; link?: string; truncate?: boolean;
}) {
  const content = (
    <div className="flex items-start gap-2">
      <span className="text-gray-400 mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-[9px] text-gray-400 font-semibold uppercase tracking-wide leading-none">{label}</p>
        <p className={cn('text-[11px] text-gray-700 font-medium mt-0.5', truncate && 'truncate', link && 'text-acqua hover:underline')}>
          {value}
        </p>
      </div>
    </div>
  );
  if (link) return <a href={link} target="_blank" rel="noopener noreferrer" className="block">{content}</a>;
  return <div>{content}</div>;
}
