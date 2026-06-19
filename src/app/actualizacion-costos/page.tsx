'use client';

import { useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Upload, FileSpreadsheet,
  TrendingUp, TrendingDown, AlertCircle, Check, X,
  Image as ImageIcon, ChevronDown, ChevronUp, CheckSquare,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSettings, buildOdooImageUrl } from '@/lib/use-settings';

// ── Types ──────────────────────────────────────────────────────────────────────

interface CompareRow {
  localId: string; localName: string; localSku: string | null;
  odooId: number | null; category: string | null;
  currentCost: number; newCost: number;
  costDiff: number; costDiffPct: number;
  currentPrice: number; newPrice: number;
  markup: number; direction: 'up' | 'down' | 'same';
  matchMethod: string; supplierCode: string | null;
}

interface PreviewData {
  headers: string[];
  headerIdx: number;
  detected: { colCode: number; colName: number; colCost: number; colDisc: number; colBarcode: number; hasNet: boolean };
  sample: string[][];
}

type Step = 'upload' | 'mapping' | 'compare' | 'done';
type FilterTab = 'all' | 'up' | 'down' | 'same';
type MatchBy = 'name' | 'sku' | 'supplier_code';

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
}
function pct(n: number) {
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
}

const NONE = -1;

function ColSelect({ headers, value, onChange, placeholder }: {
  headers: string[]; value: number; onChange: (v: number) => void; placeholder: string;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full appearance-none pl-3 pr-8 py-2 bg-[#0f1c2d] border border-white/10 rounded-lg text-[12px] text-white focus:outline-none focus:ring-1 focus:ring-acqua/50"
      >
        <option value={NONE}>{placeholder}</option>
        {headers.map((h, i) => (
          <option key={i} value={i}>{h || `Columna ${i + 1}`}</option>
        ))}
      </select>
      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30 pointer-events-none" />
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function ActualizacionCostosPage() {
  const { settings } = useSettings();
  const odooUrl = settings?.odooServerUrl ?? '';

  // step
  const [step, setStep] = useState<Step>('upload');

  // upload
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [supplierName, setSupplierName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [matchBy, setMatchBy] = useState<MatchBy>('name');

  // mapping
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [colName, setColName] = useState(NONE);
  const [colCode, setColCode] = useState(NONE);
  const [colCost, setColCost] = useState(NONE);
  const [colDisc, setColDisc] = useState(NONE);
  const [comparing, setComparing] = useState(false);

  // compare
  const [matches, setMatches] = useState<CompareRow[]>([]);
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<FilterTab>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showUnmatched, setShowUnmatched] = useState(false);

  // apply
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<string | null>(null);

  // ── Upload → Preview ──────────────────────────────────────────────────────

  const handleFile = useCallback(async (f: File) => {
    setFile(f);
    setLoading(true);
    setError(null);
    const fd = new FormData();
    fd.append('file', f);
    fd.append('supplierName', supplierName);
    fd.append('previewOnly', 'true');
    try {
      const res = await fetch('/api/compare-supplier-costs', { method: 'POST', body: fd });
      const data = await res.json() as {
        ok: boolean; error?: string; headers?: string[]; detected?: PreviewData['detected'];
        sample?: string[][]; headerIdx?: number;
      };
      if (!data.ok) { setError(data.error ?? 'Error al procesar'); return; }
      const pv: PreviewData = {
        headers: data.headers ?? [],
        headerIdx: data.headerIdx ?? 0,
        detected: data.detected!,
        sample: data.sample ?? [],
      };
      setPreview(pv);
      setColName(pv.detected.colName);
      setColCode(pv.detected.colCode);
      setColCost(pv.detected.colCost);
      setColDisc(pv.detected.colDisc);
      setStep('mapping');
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [supplierName]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  // ── Mapping → Compare ─────────────────────────────────────────────────────

  const runCompare = async () => {
    if (!file || colCost === NONE) return;
    setComparing(true);
    setError(null);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('supplierName', supplierName);
    fd.append('colOverrides', JSON.stringify({ colCode, colName, colCost, colDisc }));
    fd.append('matchBy', matchBy);
    try {
      const res = await fetch('/api/compare-supplier-costs', { method: 'POST', body: fd });
      const data = await res.json() as {
        ok: boolean; error?: string;
        matches?: CompareRow[]; unmatched?: string[]; stats?: Record<string, number>;
      };
      if (!data.ok) { setError(data.error ?? 'Error al comparar'); return; }
      setMatches(data.matches ?? []);
      setUnmatched(data.unmatched ?? []);
      setStats(data.stats ?? {});
      setSelected(new Set((data.matches ?? []).filter(m => m.direction !== 'same').map(m => m.localId)));
      setStep('compare');
    } catch (e) {
      setError(String(e));
    } finally {
      setComparing(false);
    }
  };

  // ── Apply ─────────────────────────────────────────────────────────────────

  const applyItems = async (ids: Set<string>) => {
    const items = matches
      .filter(m => ids.has(m.localId))
      .map(m => ({ localId: m.localId, newCost: m.newCost, newPrice: m.newPrice }));
    if (!items.length) return;
    setApplying(true); setApplyResult(null);
    try {
      const res = await fetch('/api/apply-supplier-costs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, source: `excel_${supplierName || 'proveedor'}` }),
      });
      const data = await res.json() as { ok: boolean; updated?: number; error?: string };
      if (data.ok) {
        setApplyResult(`✅ ${data.updated} productos actualizados`);
        setTimeout(() => setStep('done'), 1500);
      } else {
        setApplyResult(`❌ ${data.error}`);
      }
    } catch (e) {
      setApplyResult(`❌ ${String(e)}`);
    } finally {
      setApplying(false);
    }
  };

  const filtered = matches.filter(m => filter === 'all' || m.direction === filter);
  const toggleRow = (id: string) =>
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#07111F]">

      {/* Toolbar */}
      <div className="sticky top-0 z-20 bg-[#07111F] border-b border-white/10 px-5 py-3">
        <div className="max-w-[1400px] mx-auto flex items-center gap-3">
          <Link href="/proveedores" className="flex items-center gap-1.5 text-white/40 hover:text-white text-[12px] transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" /> Proveedores
          </Link>
          <div className="w-px h-5 bg-white/10" />
          <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
          <span className="text-white font-bold text-[13px]">Actualizar Costos desde Excel</span>

          {/* Step indicators */}
          <div className="flex items-center gap-1.5 ml-4">
            {(['upload', 'mapping', 'compare'] as const).map((s, i) => (
              <div key={s} className="flex items-center gap-1.5">
                <div className={cn(
                  'w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold transition-all',
                  step === s ? 'bg-acqua text-white' :
                  ['upload','mapping','compare','done'].indexOf(step) > i ? 'bg-emerald-500 text-white' :
                  'bg-white/10 text-white/30'
                )}>
                  {['upload','mapping','compare','done'].indexOf(step) > i ? <Check className="w-3 h-3" /> : i + 1}
                </div>
                <span className={cn('text-[10px]', step === s ? 'text-white' : 'text-white/30')}>
                  {s === 'upload' ? 'Subir' : s === 'mapping' ? 'Columnas' : 'Comparar'}
                </span>
                {i < 2 && <div className="w-4 h-px bg-white/10" />}
              </div>
            ))}
          </div>

          {step === 'compare' && (
            <>
              <div className="flex-1" />
              <span className="text-white/30 text-[11px]">
                {stats.matched} coincidencias · {stats.unmatched ?? 0} sin match
              </span>
            </>
          )}
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-4 py-6">

        {/* ══ STEP 1: Upload ══════════════════════════════════════════════════ */}
        {step === 'upload' && (
          <div className="max-w-xl mx-auto">
            <div className="mb-6">
              <h1 className="text-xl font-bold text-white">Actualizar costos de proveedor</h1>
              <p className="text-[13px] text-white/40 mt-1">
                Subí el Excel del proveedor. Primero te mostramos qué columnas detectamos para que puedas corregir antes de comparar.
              </p>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-4">
              <label className="block text-[11px] font-semibold text-white/40 uppercase mb-1.5">
                Nombre del proveedor (opcional)
              </label>
              <input
                type="text" value={supplierName}
                onChange={e => setSupplierName(e.target.value)}
                placeholder="Ej: Mavi, Romyl, Vulcano…"
                className="w-full px-3 py-2 bg-[#0f1c2d] border border-white/10 rounded-lg text-[13px] text-white placeholder:text-white/20 focus:outline-none focus:ring-1 focus:ring-acqua/50"
              />
            </div>

            {/* Match method selector */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-4">
              <label className="block text-[11px] font-semibold text-white/40 uppercase mb-2.5">
                ¿Cómo identificar cada producto?
              </label>
              <div className="flex flex-col gap-2">
                {([
                  { value: 'name',          label: 'Por nombre del producto',      desc: 'Compara el nombre del Excel con los nombres del sistema (recomendado si no tenés códigos)' },
                  { value: 'sku',           label: 'Por SKU / código interno',     desc: 'Usa el código de la columna del Excel y lo compara contra el SKU local' },
                  { value: 'supplier_code', label: 'Por código del proveedor',     desc: 'El código que el proveedor le asigna a cada artículo en su lista' },
                ] as {value: MatchBy; label: string; desc: string}[]).map(opt => (
                  <label key={opt.value}
                    className={cn(
                      'flex items-start gap-3 p-3 rounded-lg cursor-pointer border transition-all',
                      matchBy === opt.value
                        ? 'border-acqua/40 bg-acqua/5'
                        : 'border-white/5 hover:border-white/10 hover:bg-white/5'
                    )}>
                    <input type="radio" name="matchBy" value={opt.value}
                      checked={matchBy === opt.value}
                      onChange={() => setMatchBy(opt.value)}
                      className="mt-0.5 accent-acqua" />
                    <div>
                      <div className={cn('text-[12px] font-semibold', matchBy === opt.value ? 'text-white' : 'text-white/50')}>
                        {opt.label}
                      </div>
                      <div className="text-[11px] text-white/25 mt-0.5">{opt.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                'border-2 border-dashed rounded-xl p-14 flex flex-col items-center justify-center cursor-pointer transition-all',
                dragging ? 'border-emerald-400 bg-emerald-400/5' : 'border-white/10 hover:border-white/20 hover:bg-white/5',
              )}
            >
              {loading ? (
                <div className="flex flex-col items-center gap-3">
                  <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-[13px] text-white/40">Leyendo columnas…</span>
                </div>
              ) : (
                <>
                  <Upload className="w-10 h-10 text-white/20 mb-3" />
                  <p className="font-semibold text-white text-[14px]">Arrastrá el Excel aquí</p>
                  <p className="text-[12px] text-white/30 mt-1">o hacé clic para seleccionar</p>
                  <p className="text-[11px] text-white/15 mt-3">.xlsx · .xls · .csv</p>
                </>
              )}
            </div>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />

            {error && (
              <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                <p className="text-[12px] text-red-300">{error}</p>
              </div>
            )}
          </div>
        )}

        {/* ══ STEP 2: Column Mapping ══════════════════════════════════════════ */}
        {step === 'mapping' && preview && (
          <div className="max-w-3xl mx-auto">
            <div className="mb-5">
              <h2 className="text-lg font-bold text-white">¿Qué columna es cada cosa?</h2>
              <p className="text-[13px] text-white/40 mt-1">
                El sistema detectó las columnas automáticamente. Verificá y corregí si hace falta.
              </p>
            </div>

            {/* Column mappers */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-5 mb-4 grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-bold text-white/50 uppercase mb-1.5">
                  Nombre del producto <span className="text-red-400">*</span>
                </label>
                <ColSelect headers={preview.headers} value={colName} onChange={setColName} placeholder="— Seleccionar columna —" />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-white/50 uppercase mb-1.5">
                  Código / SKU <span className="text-white/20">(opcional)</span>
                </label>
                <ColSelect headers={preview.headers} value={colCode} onChange={setColCode} placeholder="— No tiene —" />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-emerald-400 uppercase mb-1.5">
                  Precio / Costo <span className="text-red-400">*</span>
                </label>
                <ColSelect headers={preview.headers} value={colCost} onChange={setColCost} placeholder="— Seleccionar columna —" />
                {preview.detected.hasNet && (
                  <p className="text-[10px] text-emerald-400/60 mt-1">✓ Detectado como precio neto (ya con descuento)</p>
                )}
              </div>
              <div>
                <label className="block text-[11px] font-bold text-white/50 uppercase mb-1.5">
                  Descuento % <span className="text-white/20">(opcional)</span>
                </label>
                <ColSelect headers={preview.headers} value={colDisc} onChange={setColDisc} placeholder="— No tiene —" />
                {colDisc !== NONE && (
                  <p className="text-[10px] text-blue-400/60 mt-1">Costo final = Precio × (1 - Descuento%)</p>
                )}
              </div>
            </div>

            {/* Preview table */}
            <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden mb-5">
              <div className="px-4 py-2.5 border-b border-white/10">
                <span className="text-[11px] font-semibold text-white/40 uppercase">Vista previa del archivo</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-white/10">
                      {preview.headers.map((h, i) => (
                        <th key={i} className={cn(
                          'px-3 py-2 text-left font-semibold whitespace-nowrap',
                          i === colName ? 'text-white bg-white/5' :
                          i === colCost ? 'text-emerald-400 bg-emerald-400/5' :
                          i === colCode ? 'text-blue-400 bg-blue-400/5' :
                          i === colDisc ? 'text-amber-400 bg-amber-400/5' :
                          'text-white/25'
                        )}>
                          {h || `Col ${i + 1}`}
                          {i === colName && <span className="ml-1 text-[9px] bg-white/10 px-1 rounded">NOMBRE</span>}
                          {i === colCost && <span className="ml-1 text-[9px] bg-emerald-400/20 px-1 rounded text-emerald-400">COSTO</span>}
                          {i === colCode && <span className="ml-1 text-[9px] bg-blue-400/20 px-1 rounded text-blue-400">CÓDIGO</span>}
                          {i === colDisc && <span className="ml-1 text-[9px] bg-amber-400/20 px-1 rounded text-amber-400">DTO%</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sample.map((row, ri) => (
                      <tr key={ri} className="border-b border-white/5">
                        {preview.headers.map((_, ci) => (
                          <td key={ci} className={cn(
                            'px-3 py-1.5 whitespace-nowrap',
                            ci === colName ? 'text-white font-medium' :
                            ci === colCost ? 'text-emerald-400 font-mono' :
                            ci === colCode ? 'text-blue-300 font-mono text-[10px]' :
                            ci === colDisc ? 'text-amber-300' :
                            'text-white/20'
                          )}>
                            {row[ci] ?? ''}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                <p className="text-[12px] text-red-300">{error}</p>
              </div>
            )}

            <div className="flex items-center gap-3">
              <button onClick={() => setStep('upload')}
                className="px-4 py-2.5 border border-white/10 text-white/50 rounded-xl text-[13px] hover:border-white/20 hover:text-white transition-all">
                ← Volver
              </button>
              <button
                onClick={runCompare}
                disabled={comparing || colCost === NONE || colName === NONE}
                className={cn(
                  'flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-[13px] transition-all',
                  'bg-emerald-500 text-white hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed',
                )}>
                {comparing ? (
                  <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Comparando…</>
                ) : (
                  <>Comparar con el sistema →</>
                )}
              </button>
              {(colCost === NONE || colName === NONE) && (
                <span className="text-[11px] text-red-400">Seleccioná al menos Nombre y Precio</span>
              )}
            </div>
          </div>
        )}

        {/* ══ STEP 3: Compare ═════════════════════════════════════════════════ */}
        {step === 'compare' && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-4 gap-3 mb-4">
              {[
                { label: 'Procesados', value: stats.matched, color: 'neutral' },
                { label: 'Aumentaron', value: stats.increases, color: 'amber', icon: <TrendingUp className="w-3.5 h-3.5" /> },
                { label: 'Bajaron',    value: stats.decreases, color: 'emerald', icon: <TrendingDown className="w-3.5 h-3.5" /> },
                { label: 'Sin cambio', value: stats.same, color: 'neutral' },
              ].map(s => (
                <div key={s.label} className="bg-white/5 border border-white/10 rounded-xl p-4">
                  <div className={cn('flex items-center gap-1.5 mb-1 text-[10px] font-semibold uppercase tracking-wide',
                    s.color === 'amber' ? 'text-amber-400' : s.color === 'emerald' ? 'text-emerald-400' : 'text-white/30'
                  )}>
                    {s.icon}{s.label}
                  </div>
                  <div className="text-2xl font-black text-white">{s.value ?? 0}</div>
                </div>
              ))}
            </div>

            {/* Filters + selection */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-3 mb-3 flex items-center gap-2 flex-wrap">
              <div className="flex gap-1">
                {([
                  { id: 'all',  label: 'Todos' },
                  { id: 'up',   label: `↑ Aumentos (${stats.increases ?? 0})` },
                  { id: 'down', label: `↓ Bajas (${stats.decreases ?? 0})` },
                  { id: 'same', label: `= Sin cambio (${stats.same ?? 0})` },
                ] as {id: FilterTab; label: string}[]).map(tab => (
                  <button key={tab.id} onClick={() => setFilter(tab.id)}
                    className={cn('px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all',
                      filter === tab.id ? 'bg-white text-[#07111F]' : 'text-white/40 hover:text-white hover:bg-white/10'
                    )}>
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className="flex-1" />
              <div className="flex items-center gap-2 text-[11px]">
                <span className="text-white/30">{selected.size} sel.</span>
                <button onClick={() => setSelected(new Set(matches.filter(m => m.direction === 'up').map(m => m.localId)))}
                  className="text-amber-400 hover:underline">Sel. aumentos</button>
                <button onClick={() => setSelected(new Set(matches.filter(m => m.direction === 'down').map(m => m.localId)))}
                  className="text-emerald-400 hover:underline">Sel. bajas</button>
                <button onClick={() => setSelected(new Set(matches.map(m => m.localId)))}
                  className="text-white/50 hover:underline">Todos</button>
                {selected.size > 0 && (
                  <button onClick={() => setSelected(new Set())} className="text-white/30 hover:underline">Limpiar</button>
                )}
              </div>
            </div>

            {/* Table */}
            <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden mb-4">
              <table className="w-full text-[12px]">
                <thead className="border-b border-white/10">
                  <tr>
                    <th className="w-10 px-3 py-2.5" />
                    <th className="w-14 px-2 py-2.5" />
                    <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-white/30 uppercase">Producto</th>
                    <th className="text-right px-3 py-2.5 text-[10px] font-semibold text-white/30 uppercase">Costo actual</th>
                    <th className="text-right px-3 py-2.5 text-[10px] font-semibold text-white/30 uppercase">Costo nuevo</th>
                    <th className="text-right px-3 py-2.5 text-[10px] font-semibold text-white/30 uppercase">Var %</th>
                    <th className="text-right px-3 py-2.5 text-[10px] font-semibold text-white/30 uppercase">Precio actual</th>
                    <th className="text-right px-3 py-2.5 text-[10px] font-semibold text-white/50 uppercase">→ Precio nuevo</th>
                    <th className="text-right px-3 py-2.5 text-[10px] font-semibold text-white/20 uppercase w-16">MK%</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row, i) => {
                    const img = buildOdooImageUrl(row.odooId, 'product.template', odooUrl);
                    const checked = selected.has(row.localId);
                    const isLast = i === filtered.length - 1;
                    return (
                      <tr key={row.localId}
                        onClick={() => toggleRow(row.localId)}
                        className={cn(
                          'cursor-pointer transition-colors',
                          !isLast && 'border-b border-white/5',
                          row.direction === 'up'   && checked && 'bg-amber-400/5',
                          row.direction === 'down' && checked && 'bg-emerald-400/5',
                          'hover:bg-white/5',
                        )}>

                        <td className="px-3 py-2.5">
                          <div className={cn('w-5 h-5 rounded border-2 flex items-center justify-center mx-auto transition-colors',
                            checked ? 'bg-acqua border-acqua' : 'border-white/20 hover:border-acqua/50'
                          )}>
                            {checked && <span className="text-white text-[10px] font-black">✓</span>}
                          </div>
                        </td>

                        <td className="px-1 py-1.5">
                          <div className="w-12 h-12 rounded-lg bg-white/5 border border-white/10 overflow-hidden flex items-center justify-center mx-auto">
                            {img
                              ? <img src={img} alt={row.localName} className="w-full h-full object-contain" />
                              : <ImageIcon className="w-4 h-4 text-white/10" />}
                          </div>
                        </td>

                        <td className="px-3 py-2.5">
                          <div className="font-medium text-white">{row.localName}</div>
                          <div className="text-[10px] text-white/25 mt-0.5 flex items-center gap-2">
                            {row.category && <span>{row.category.split(' / ')[0]}</span>}
                            {row.localSku && <span className="font-mono bg-white/5 px-1 rounded">{row.localSku}</span>}
                            {row.supplierCode && row.supplierCode !== row.localSku && (
                              <span className="text-blue-400/60">prov: {row.supplierCode}</span>
                            )}
                          </div>
                        </td>

                        <td className="px-3 py-2.5 text-right font-mono text-white/40">{fmt(row.currentCost)}</td>

                        <td className="px-3 py-2.5 text-right font-mono font-bold">
                          <span className={
                            row.direction === 'up'   ? 'text-amber-400' :
                            row.direction === 'down' ? 'text-emerald-400' : 'text-white/25'
                          }>{fmt(row.newCost)}</span>
                        </td>

                        <td className="px-3 py-2.5 text-right">
                          {row.direction === 'same' ? (
                            <span className="text-white/15 text-[11px]">—</span>
                          ) : (
                            <span className={cn(
                              'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold',
                              row.direction === 'up' ? 'bg-amber-400/10 text-amber-400' : 'bg-emerald-400/10 text-emerald-400'
                            )}>
                              {row.direction === 'up' ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                              {pct(row.costDiffPct)}
                            </span>
                          )}
                        </td>

                        <td className="px-3 py-2.5 text-right font-mono text-white/30">{fmt(row.currentPrice)}</td>

                        <td className="px-3 py-2.5 text-right font-mono font-bold">
                          {row.direction === 'same' ? (
                            <span className="text-white/15">—</span>
                          ) : (
                            <span className={row.direction === 'up' ? 'text-amber-300' : 'text-emerald-300'}>
                              {fmt(row.newPrice)}
                            </span>
                          )}
                        </td>

                        <td className="px-3 py-2.5 text-right text-white/20 font-mono text-[11px]">{row.markup}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filtered.length === 0 && (
                <div className="py-12 text-center text-white/20 text-[13px]">No hay productos en esta categoría</div>
              )}
            </div>

            {/* Unmatched */}
            {unmatched.length > 0 && (
              <div className="bg-amber-400/5 border border-amber-400/20 rounded-xl p-4 mb-4">
                <button onClick={() => setShowUnmatched(v => !v)}
                  className="flex items-center gap-2 w-full text-left">
                  <AlertCircle className="w-4 h-4 text-amber-400" />
                  <span className="font-semibold text-amber-300 text-[13px]">{unmatched.length} productos del Excel no coincidieron</span>
                  {showUnmatched ? <ChevronUp className="w-4 h-4 text-amber-400/50 ml-auto" /> : <ChevronDown className="w-4 h-4 text-amber-400/50 ml-auto" />}
                </button>
                {showUnmatched && (
                  <ul className="mt-3 space-y-1">
                    {unmatched.map((name, i) => (
                      <li key={i} className="text-[12px] text-amber-400/60 flex items-center gap-1.5">
                        <X className="w-3 h-3" /> {name}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex items-center gap-3 flex-wrap">
              <button onClick={() => applyItems(new Set(matches.filter(m => m.direction === 'up').map(m => m.localId)))}
                disabled={applying || !stats.increases}
                className="flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-[13px] bg-amber-500 text-white hover:bg-amber-400 disabled:opacity-30 disabled:cursor-not-allowed transition-all">
                <TrendingUp className="w-4 h-4" />
                Aplicar aumentos ({stats.increases ?? 0})
              </button>

              <button onClick={() => applyItems(new Set(matches.filter(m => m.direction === 'down').map(m => m.localId)))}
                disabled={applying || !stats.decreases}
                className="flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-[13px] bg-emerald-500 text-white hover:bg-emerald-400 disabled:opacity-30 disabled:cursor-not-allowed transition-all">
                <TrendingDown className="w-4 h-4" />
                Aplicar bajas ({stats.decreases ?? 0})
              </button>

              <div className="w-px h-8 bg-white/10" />

              <button onClick={() => applyItems(selected)}
                disabled={applying || selected.size === 0}
                className="flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-[13px] border-2 border-acqua text-acqua hover:bg-acqua hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all">
                <CheckSquare className="w-4 h-4" />
                Aplicar seleccionados ({selected.size})
              </button>

              {applying && (
                <div className="flex items-center gap-2 text-[12px] text-white/40">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Aplicando…
                </div>
              )}

              {applyResult && (
                <div className={cn('text-[13px] font-semibold px-3 py-2 rounded-lg',
                  applyResult.startsWith('✅') ? 'bg-emerald-400/10 text-emerald-300' : 'bg-red-400/10 text-red-300'
                )}>
                  {applyResult}
                </div>
              )}
            </div>
          </>
        )}

        {/* ══ STEP 4: Done ════════════════════════════════════════════════════ */}
        {step === 'done' && (
          <div className="max-w-md mx-auto py-24 text-center">
            <div className="w-16 h-16 bg-emerald-400/10 border border-emerald-400/20 rounded-full flex items-center justify-center mx-auto mb-5">
              <Check className="w-8 h-8 text-emerald-400" />
            </div>
            <h2 className="text-xl font-bold text-white mb-2">¡Costos actualizados!</h2>
            <p className="text-[13px] text-white/40 mb-8">
              Los precios fueron recalculados manteniendo el markup de cada producto y quedaron guardados en el historial.
            </p>
            <div className="flex justify-center gap-3">
              <Link href="/productos"
                className="px-5 py-2.5 bg-white text-[#07111F] rounded-xl text-[13px] font-bold hover:bg-white/90 transition-colors">
                Ver productos
              </Link>
              <button onClick={() => { setStep('upload'); setFile(null); setMatches([]); setSelected(new Set()); setApplyResult(null); setPreview(null); }}
                className="px-5 py-2.5 border border-white/10 text-white/50 rounded-xl text-[13px] font-semibold hover:border-white/20 hover:text-white transition-all">
                Actualizar otro proveedor
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
