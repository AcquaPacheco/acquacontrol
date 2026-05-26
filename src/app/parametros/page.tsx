'use client';

import { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { cn } from '@/lib/utils';
import {
  Settings, DollarSign, Percent, CreditCard, ListOrdered,
  Calculator, Save, RotateCcw, Check, Plus, Trash2,
  ChevronRight, Info, TrendingUp, HardDrive, AlertTriangle,
  Upload, CheckCircle2, RefreshCw, FileSpreadsheet, X,
  Globe, Link as LinkIcon, ShoppingCart, Eye, EyeOff, ExternalLink,
  Sparkles,
} from 'lucide-react';
import { useSettings } from '@/lib/use-settings';
import suppliersRaw from '@/data/suppliers.json';

const SUPPLIER_NAMES: string[] = (suppliersRaw as unknown as { name: string }[])
  .map(s => s.name)
  .filter(Boolean)
  .sort((a, b) => a.localeCompare(b, 'es'));

// ── Tipos de datos
interface DolarParams {
  bna: number;           // solo referencia
  operativo: number;     // usado en cálculos
  porProveedor: { nombre: string; tasa: number }[];
}

interface ImpuestosParams {
  ivaCompra: number;
  ivaVenta: number;
  ivaReducido: number;
  iibb: number;
}

interface MedioPago {
  id: string;
  medio: string;
  lista: string;
  recargo: number;
  activo: boolean;
}

interface ListaPrecio {
  id: string;
  nombre: string;
  descripcion: string;
  descuento: number;       // % sobre Lista A. Positivo = descuento (precio más bajo). Negativo = recargo (precio más alto).
  descuentoBase?: string;  // para listas que no derivan directo de A (ej: Profesional)
  margenMin: number;       // margen mínimo para esa lista
  exportaOdoo: boolean;
  esMarkup?: boolean;      // true = el precio lo calcula ML/Odoo por SKU, no aplica % de A
}

interface RedondeoParams {
  multiplo: number;
  siempreArriba: boolean;
  maxSinRedondeo: number;
  decimalesCostos: number;
}

// ── Defaults
const DEFAULT_DOLAR: DolarParams = {
  bna: 1085.50,
  operativo: 1120.00,
  porProveedor: [
    { nombre: 'SEIQ GROUP S.A.',       tasa: 1100 },
    { nombre: 'LAMBDA CHEMICAL S.A.', tasa: 1150 },
  ],
};

const DEFAULT_IMPUESTOS: ImpuestosParams = {
  ivaCompra: 21,
  ivaVenta: 21,
  ivaReducido: 10.5,
  iibb: 3.5,
};

const DEFAULT_PAGOS: MedioPago[] = [
  { id: 'credito_1c',    medio: 'Crédito — 1 cuota',            lista: 'A', recargo: 0,    activo: true },
  { id: 'credito_3c',    medio: 'Crédito — 3 cuotas',           lista: 'A', recargo: 8.0,  activo: true },
  { id: 'credito_6c',    medio: 'Crédito — 6 cuotas',           lista: 'A', recargo: 15.0, activo: true },
  { id: 'credito_12c',   medio: 'Crédito — 12 cuotas',          lista: 'A', recargo: 30.0, activo: true },
  { id: 'debito',        medio: 'Débito (Nave / Mercado Pago)',  lista: 'B', recargo: 0,    activo: true },
  { id: 'transferencia', medio: 'Transferencia bancaria',        lista: 'B', recargo: 0,    activo: true },
  { id: 'qr_nave',       medio: 'QR Nave / Dinero en cuenta',   lista: 'B', recargo: 0,    activo: true },
  { id: 'mp_link',       medio: 'MercadoPago Link de pago',     lista: 'B', recargo: 0,    activo: true },
  { id: 'efectivo',      medio: 'Efectivo',                     lista: 'C', recargo: 0,    activo: true },
];

const DEFAULT_LISTAS: ListaPrecio[] = [
  { id: 'A',         nombre: 'Lista A',       descripcion: 'Precio público — Tarjeta de crédito (base del negocio)',          descuento: 0,   margenMin: 45, exportaOdoo: true  },
  { id: 'B',         nombre: 'Lista B',       descripcion: 'Débito / Transferencia / QR — descuento sobre Lista A',           descuento: 10,  margenMin: 38, exportaOdoo: false },
  { id: 'C',         nombre: 'Lista C',       descripcion: 'Efectivo — descuento sobre Lista A',                              descuento: 15,  margenMin: 33, exportaOdoo: false },
  { id: 'prof',      nombre: 'Profesional',   descripcion: '5% adicional sobre Lista A, B o C según cómo pague el cliente',   descuento: 5,   margenMin: 28, exportaOdoo: false, descuentoBase: 'A/B/C' },
  { id: 'cons',      nombre: 'Consorcio',     descripcion: 'Consorcios y admin. de edificios — recargo sobre Lista A',        descuento: -10, margenMin: 50, exportaOdoo: false },
  { id: 'ml',        nombre: 'MercadoLibre',  descripcion: 'Precio calculado por ML Lab: Markup sobre costo + IVA 21%',      descuento: 0,   margenMin: 20, exportaOdoo: false, esMarkup: true },
  { id: 'mayorista', nombre: 'Mayorista',     descripcion: 'Sin regla fija — precio negociado por SKU',                      descuento: 25,  margenMin: 22, exportaOdoo: false },
];

const DEFAULT_REDONDEO: RedondeoParams = {
  multiplo: 10,
  siempreArriba: true,
  maxSinRedondeo: 500,
  decimalesCostos: 2,
};

// ── Storage helpers — servidor (src/data/params.json) ────────────────────────
async function loadParams(): Promise<Record<string, unknown>> {
  try {
    const res = await fetch('/api/params');
    if (!res.ok) return {};
    return await res.json() as Record<string, unknown>;
  } catch { return {}; }
}

async function saveParams(key: string, value: unknown): Promise<void> {
  try {
    await fetch('/api/params', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ [key]: value }),
    });
  } catch { /* no bloquear la UI si falla */ }
}

// ── Componentes de UI
function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-lg font-bold text-gray-900">{title}</h2>
      <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>
    </div>
  );
}

function SaveBar({ onSave, onReset, saved }: { onSave: () => void; onReset: () => void; saved: boolean }) {
  return (
    <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-100">
      <button
        onClick={onReset}
        className="flex items-center gap-1.5 px-3 py-2 text-[12px] text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
      >
        <RotateCcw className="w-3.5 h-3.5" />
        Resetear
      </button>
      <button
        onClick={onSave}
        className={cn(
          'flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-semibold transition-all',
          saved
            ? 'bg-success text-white'
            : 'bg-acqua text-white hover:bg-acqua-dark'
        )}
      >
        {saved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
        {saved ? 'Guardado' : 'Guardar cambios'}
      </button>
    </div>
  );
}

function NumericInput({
  value, onChange, unit, min, max, step = 0.5, disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
        className={cn(
          'w-28 px-3 py-2 text-sm font-mono text-right rounded-lg border transition-colors',
          disabled
            ? 'bg-gray-50 border-gray-100 text-gray-400 cursor-not-allowed'
            : 'bg-white border-gray-200 text-gray-900 focus:outline-none focus:ring-2 focus:ring-acqua/30 focus:border-acqua'
        )}
      />
      {unit && <span className="text-xs text-gray-400 w-10 shrink-0">{unit}</span>}
    </div>
  );
}

// ── Sección Dólar
function SeccionDolar() {
  const [data, setData] = useState<DolarParams>(DEFAULT_DOLAR);
  const [saved, setSaved] = useState(false);
  const [bnaDatos, setBnaDatos] = useState<{ compra: number; venta: number; fecha: string } | null>(null);
  const [bnaLoading, setBnaLoading] = useState(false);
  const [bnaError, setBnaError] = useState('');

  useEffect(() => {
    loadParams().then(all => { if (all.dolar) setData(all.dolar as DolarParams); });
  }, []);

  const fetchBNA = async () => {
    setBnaLoading(true);
    setBnaError('');
    try {
      const res = await fetch('https://dolarapi.com/v1/dolares/oficial');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as { compra: number; venta: number; fechaActualizacion: string };
      setBnaDatos({ compra: d.compra, venta: d.venta, fecha: d.fechaActualizacion });
    } catch (e) {
      setBnaError('No se pudo traer el dato. Verificá la conexión.');
      console.error('BNA fetch error:', e);
    } finally {
      setBnaLoading(false);
    }
  };

  const handleSave = async () => {
    await saveParams('dolar', data);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleReset = async () => {
    setData(DEFAULT_DOLAR);
    await saveParams('dolar', DEFAULT_DOLAR);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const updatePorProveedor = (idx: number, field: 'nombre' | 'tasa', val: string | number) => {
    setData(prev => {
      const arr = [...prev.porProveedor];
      arr[idx] = { ...arr[idx], [field]: val };
      return { ...prev, porProveedor: arr };
    });
  };

  const addProveedor = () => {
    setData(prev => ({
      ...prev,
      porProveedor: [...prev.porProveedor, { nombre: '', tasa: prev.operativo }],
    }));
  };

  const removeProveedor = (idx: number) => {
    setData(prev => ({
      ...prev,
      porProveedor: prev.porProveedor.filter((_, i) => i !== idx),
    }));
  };

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-6">
      <SectionHeader
        title="Dólar"
        subtitle="Tipos de cambio para cálculo de costos en USD"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div>
          <label className="text-xs font-semibold text-gray-600 block mb-1.5">
            Dólar BNA <span className="text-gray-400 font-normal">(referencia)</span>
          </label>
          <NumericInput value={data.bna} onChange={v => setData(p => ({...p, bna: v}))} unit="ARS" step={0.5} />
          <p className="text-[10px] text-gray-400 mt-1">Tipo de cambio oficial. Referencia para comparar con operativo.</p>

          {/* Live BNA fetch */}
          <div className="mt-3 bg-gray-50 border border-gray-100 rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold text-gray-600">BNA en tiempo real</span>
              <button
                onClick={fetchBNA}
                disabled={bnaLoading}
                className="flex items-center gap-1 px-2.5 py-1 bg-acqua/10 text-acqua rounded-lg text-[11px] font-semibold hover:bg-acqua/20 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={cn('w-3 h-3', bnaLoading && 'animate-spin')} />
                {bnaLoading ? 'Actualizando...' : 'Actualizar'}
              </button>
            </div>
            {bnaError && <p className="text-[11px] text-red-500 mb-2">{bnaError}</p>}
            {bnaDatos ? (
              <>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div className="bg-white rounded-lg p-2 text-center border border-gray-100">
                    <p className="text-[9px] text-gray-400 uppercase font-bold">Compra</p>
                    <p className="text-[15px] font-black text-gray-900">${bnaDatos.compra.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</p>
                  </div>
                  <div className="bg-white rounded-lg p-2 text-center border border-gray-100">
                    <p className="text-[9px] text-gray-400 uppercase font-bold">Venta</p>
                    <p className="text-[15px] font-black text-gray-900">${bnaDatos.venta.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setData(p => ({ ...p, bna: bnaDatos.venta }))}
                    className="flex-1 px-2 py-1.5 bg-acqua text-white text-[11px] font-semibold rounded-lg hover:bg-acqua-dark transition-colors"
                  >
                    Usar venta (${bnaDatos.venta}) como BNA
                  </button>
                </div>
                <p className="text-[9px] text-gray-400 mt-1.5">
                  Actualizado: {new Date(bnaDatos.fecha).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </p>
              </>
            ) : (
              <p className="text-[11px] text-gray-400">Presioná Actualizar para traer el tipo de cambio oficial del BNA.</p>
            )}
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-600 block mb-1.5">
            Dólar Operativo Acqua <span className="text-acqua font-bold">★</span>
          </label>
          <NumericInput value={data.operativo} onChange={v => setData(p => ({...p, operativo: v}))} unit="ARS" step={0.5} />
          <p className="text-[10px] text-gray-400 mt-1">Se usa como default cuando el proveedor es USD y no tiene tasa propia.</p>
        </div>
      </div>

      <div className="border-t border-gray-100 pt-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-gray-800">Tasa por proveedor</h3>
          <button
            onClick={addProveedor}
            className="flex items-center gap-1 px-2.5 py-1 bg-gray-100 text-gray-600 text-[12px] font-medium rounded-lg hover:bg-gray-200 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Agregar
          </button>
        </div>
        {/* Datalist de proveedores disponibles */}
        <datalist id="supplier-names-list">
          {SUPPLIER_NAMES.map(n => <option key={n} value={n} />)}
        </datalist>

        <div className="space-y-2">
          {data.porProveedor.map((p, i) => (
            <div key={i} className="flex items-center gap-3 bg-gray-50 rounded-lg px-4 py-2.5">
              <input
                type="text"
                list="supplier-names-list"
                value={p.nombre}
                onChange={e => updatePorProveedor(i, 'nombre', e.target.value)}
                placeholder="Seleccioná o escribí un proveedor…"
                className="flex-1 bg-transparent text-sm text-gray-700 focus:outline-none placeholder-gray-300 min-w-0"
              />
              <NumericInput value={p.tasa} onChange={v => updatePorProveedor(i, 'tasa', v)} unit="ARS" step={0.5} />
              <button
                onClick={() => removeProveedor(i)}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-danger/10 text-gray-400 hover:text-danger transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {data.porProveedor.length === 0 && (
            <p className="text-[12px] text-gray-400 text-center py-3">
              Sin tasas por proveedor. Se usará el Dólar Operativo para todos.
            </p>
          )}
        </div>
      </div>

      <SaveBar onSave={handleSave} onReset={handleReset} saved={saved} />
    </div>
  );
}

// ── Sección IVA / IIBB
function SeccionImpuestos() {
  const [data, setData] = useState<ImpuestosParams>(DEFAULT_IMPUESTOS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadParams().then(all => { if (all.impuestos) setData(all.impuestos as ImpuestosParams); });
  }, []);

  const handleSave = async () => {
    await saveParams('impuestos', data);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleReset = async () => {
    setData(DEFAULT_IMPUESTOS);
    await saveParams('impuestos', DEFAULT_IMPUESTOS);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-6">
      <SectionHeader
        title="IVA / IIBB"
        subtitle="Impuestos generales para cálculos de costo y precio"
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        {[
          { key: 'ivaCompra', label: 'IVA Compra', hint: 'Aplicado al costo del proveedor' },
          { key: 'ivaVenta',  label: 'IVA Venta',  hint: 'Incluido en el precio de venta' },
          { key: 'ivaReducido', label: 'IVA Reducido', hint: 'Para ciertos productos (alim., etc.)' },
          { key: 'iibb',     label: 'IIBB', hint: 'Ingresos brutos sobre ventas' },
        ].map(f => (
          <div key={f.key}>
            <label className="text-xs font-semibold text-gray-600 block mb-1.5">{f.label}</label>
            <NumericInput
              value={data[f.key as keyof ImpuestosParams]}
              onChange={v => setData(prev => ({ ...prev, [f.key]: v }))}
              unit="%"
              min={0}
              max={100}
              step={0.5}
            />
            <p className="text-[10px] text-gray-400 mt-1">{f.hint}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 p-3 bg-blue-50 border border-blue-100 rounded-lg">
        <p className="text-[11px] text-blue-700 flex items-start gap-1.5">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          Percepciones y retenciones específicas se configuran por proveedor en su ficha comercial.
        </p>
      </div>

      <SaveBar onSave={handleSave} onReset={handleReset} saved={saved} />
    </div>
  );
}

// ── Sección Medios de pago
function SeccionPagos() {
  const [data, setData] = useState<MedioPago[]>(DEFAULT_PAGOS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadParams().then(all => { if (all.pagos) setData(all.pagos as MedioPago[]); });
  }, []);

  const handleSave = async () => {
    await saveParams('pagos', data);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleReset = async () => {
    setData(DEFAULT_PAGOS);
    await saveParams('pagos', DEFAULT_PAGOS);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const update = (id: string, field: keyof MedioPago, val: unknown) => {
    setData(prev => prev.map(p => p.id === id ? { ...p, [field]: val } : p));
  };

  const listaOpts = ['A', 'B', 'C', 'Profesional', 'Consorcio'];

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-6">
      <SectionHeader
        title="Medios de pago"
        subtitle="Lista base y recargo (%) por medio de cobro"
      />

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider border-b border-gray-100">
              <th className="text-left pb-2 w-6"></th>
              <th className="text-left pb-2">Medio de pago</th>
              <th className="text-center pb-2 w-32">Lista base</th>
              <th className="text-center pb-2 w-36">Recargo %</th>
              <th className="text-center pb-2 w-36">Precio efectivo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {data.map((p) => (
              <tr key={p.id} className={cn('group', !p.activo && 'opacity-40')}>
                <td className="py-2.5 pr-2">
                  <input
                    type="checkbox"
                    checked={p.activo}
                    onChange={e => update(p.id, 'activo', e.target.checked)}
                    className="accent-acqua w-3.5 h-3.5"
                  />
                </td>
                <td className="py-2.5">
                  <input
                    type="text"
                    value={p.medio}
                    onChange={e => update(p.id, 'medio', e.target.value)}
                    className="text-[13px] font-medium text-gray-800 bg-transparent focus:outline-none focus:bg-gray-50 px-1 rounded w-full"
                  />
                </td>
                <td className="py-2.5 text-center">
                  <select
                    value={p.lista}
                    onChange={e => update(p.id, 'lista', e.target.value)}
                    className="text-[12px] text-gray-700 bg-gray-50 border border-gray-200 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-acqua/30"
                  >
                    {listaOpts.map(l => <option key={l} value={l}>Lista {l}</option>)}
                  </select>
                </td>
                <td className="py-2.5 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <input
                      type="number"
                      value={p.recargo}
                      min={0}
                      max={100}
                      step={0.1}
                      onChange={e => update(p.id, 'recargo', parseFloat(e.target.value) || 0)}
                      className="w-20 text-center text-[13px] font-mono text-gray-900 border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-acqua/30"
                    />
                    <span className="text-[11px] text-gray-400">%</span>
                  </div>
                </td>
                <td className="py-2.5 text-center">
                  <span className={cn(
                    'text-[12px] font-semibold px-2 py-0.5 rounded',
                    p.recargo === 0 ? 'text-success bg-success/10'
                      : p.recargo < 5 ? 'text-warning bg-warning/10'
                      : 'text-danger bg-danger/10'
                  )}>
                    Lista {p.lista} + {p.recargo}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="p-3 bg-acqua/5 border border-acqua/20 rounded-lg">
          <p className="text-[11px] text-gray-600">
            <strong className="text-acqua">Cómo funciona:</strong> El precio final = Lista base × (1 + recargo%).
            B y C ya son descuentos de A — el recargo adicional es 0 por defecto.
          </p>
        </div>
        <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
          <p className="text-[11px] text-gray-600">
            <strong>Crédito en cuotas:</strong> Los recargos financieros se trasladan al precio visible del cliente sobre Lista A.
            1 cuota = sin recargo (precio A puro).
          </p>
        </div>
      </div>

      <SaveBar onSave={handleSave} onReset={handleReset} saved={saved} />
    </div>
  );
}

// ── Sección Listas de precio
function SeccionListas() {
  const [data, setData] = useState<ListaPrecio[]>(DEFAULT_LISTAS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadParams().then(all => { if (all.listas) setData(all.listas as ListaPrecio[]); });
  }, []);

  const handleSave = async () => {
    await saveParams('listas', data);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleReset = async () => {
    setData(DEFAULT_LISTAS);
    await saveParams('listas', DEFAULT_LISTAS);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const update = (id: string, field: keyof ListaPrecio, val: unknown) => {
    setData(prev => prev.map(l => l.id === id ? { ...l, [field]: val } : l));
  };

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-6">
      <SectionHeader
        title="Listas de precio"
        subtitle="Reglas de cálculo, descuentos y margen mínimo por lista"
      />

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider border-b border-gray-100">
              <th className="text-left pb-2 w-28">Lista</th>
              <th className="text-left pb-2">Descripción</th>
              <th className="text-center pb-2 w-36">% sobre Lista A</th>
              <th className="text-center pb-2 w-32">Margen mín.</th>
              <th className="text-center pb-2 w-24">Export Odoo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {data.map(l => (
              <tr key={l.id} className="group">
                <td className="py-3 pr-3">
                  <div className={cn(
                    'inline-flex items-center whitespace-nowrap px-2.5 py-1 rounded-lg text-[11px] font-bold',
                    l.id === 'A'         ? 'bg-gray-900 text-white'
                      : l.id === 'B'    ? 'bg-acqua/10 text-acqua'
                      : l.id === 'C'    ? 'bg-success/10 text-success'
                      : l.id === 'ml'   ? 'bg-yellow-100 text-yellow-700'
                      : l.id === 'prof' ? 'bg-purple-50 text-purple-700'
                      : l.id === 'cons' ? 'bg-blue-50 text-blue-700'
                      : 'bg-gray-100 text-gray-600'
                  )}>
                    {l.nombre}
                  </div>
                </td>
                <td className="py-3">
                  <input
                    type="text"
                    value={l.descripcion}
                    onChange={e => update(l.id, 'descripcion', e.target.value)}
                    className="text-[12px] text-gray-600 bg-transparent focus:outline-none focus:bg-gray-50 px-1 rounded w-full"
                  />
                </td>
                <td className="py-3 text-center">
                  {l.id === 'A' ? (
                    <span className="text-[12px] text-gray-400 font-mono">— base —</span>
                  ) : l.esMarkup ? (
                    <span className="text-[11px] text-yellow-600 font-semibold bg-yellow-50 px-2 py-0.5 rounded whitespace-nowrap">Markup × SKU</span>
                  ) : l.descuentoBase ? (
                    <div className="flex items-center justify-center gap-1">
                      <input
                        type="number"
                        value={l.descuento}
                        min={0}
                        max={50}
                        step={1}
                        onChange={e => update(l.id, 'descuento', parseFloat(e.target.value) || 0)}
                        className="w-16 text-center text-[13px] font-mono border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-acqua/30"
                      />
                      <span className="text-[10px] text-gray-400 whitespace-nowrap">% de {l.descuentoBase}</span>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center gap-1">
                      <input
                        type="number"
                        value={l.descuento}
                        min={-50}
                        max={100}
                        step={1}
                        onChange={e => update(l.id, 'descuento', parseFloat(e.target.value) || 0)}
                        className="w-20 text-center text-[13px] font-mono border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-acqua/30"
                      />
                      <span className="text-[11px] text-gray-400">%</span>
                    </div>
                  )}
                </td>
                <td className="py-3 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <input
                      type="number"
                      value={l.margenMin}
                      min={0}
                      max={100}
                      step={1}
                      onChange={e => update(l.id, 'margenMin', parseFloat(e.target.value) || 0)}
                      className="w-20 text-center text-[13px] font-mono border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-acqua/30"
                    />
                    <span className="text-[11px] text-gray-400">%</span>
                  </div>
                </td>
                <td className="py-3 text-center">
                  <input
                    type="checkbox"
                    checked={l.exportaOdoo}
                    onChange={e => update(l.id, 'exportaOdoo', e.target.checked)}
                    className="accent-acqua w-4 h-4"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
          <p className="text-[11px] text-gray-600">
            <strong>% sobre Lista A:</strong> Positivo = descuento (precio más bajo que A).
            Negativo = recargo (Consorcio = -10% → precio más alto que A).
          </p>
        </div>
        <div className="p-3 bg-orange-50 border border-orange-100 rounded-lg">
          <p className="text-[11px] text-gray-600">
            <strong className="text-orange-600">Profesional:</strong> El 5% se aplica sobre la lista que corresponda al medio de pago (A, B o C). No es descuento fijo desde A.
          </p>
        </div>
        <div className="p-3 bg-acqua/5 border border-acqua/20 rounded-lg">
          <p className="text-[11px] text-gray-600">
            <strong className="text-acqua">Margen mínimo:</strong> Si el margen cae por debajo de este valor,
            Socio Acqua alerta y bloquea la exportación automática.
          </p>
        </div>
      </div>

      <SaveBar onSave={handleSave} onReset={handleReset} saved={saved} />
    </div>
  );
}

// ── Sección Redondeo
function SeccionRedondeo() {
  const [data, setData] = useState<RedondeoParams>(DEFAULT_REDONDEO);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadParams().then(all => { if (all.redondeo) setData(all.redondeo as RedondeoParams); });
  }, []);

  const handleSave = async () => {
    await saveParams('redondeo', data);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleReset = async () => {
    setData(DEFAULT_REDONDEO);
    await saveParams('redondeo', DEFAULT_REDONDEO);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const ejemploBase = 4672;
  const redondeado = data.siempreArriba
    ? Math.ceil(ejemploBase / data.multiplo) * data.multiplo
    : Math.round(ejemploBase / data.multiplo) * data.multiplo;

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-6">
      <SectionHeader
        title="Redondeo"
        subtitle="Reglas de redondeo para precios de venta y costos"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="text-xs font-semibold text-gray-600 block mb-1.5">Múltiplo de redondeo (precios)</label>
          <NumericInput value={data.multiplo} onChange={v => setData(p => ({...p, multiplo: v}))} unit="ARS" min={1} step={1} />
          <p className="text-[10px] text-gray-400 mt-1">Los precios de venta se redondean al múltiplo más cercano.</p>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-600 block mb-1.5">Siempre redondear hacia arriba</label>
          <div className="flex items-center gap-3 mt-2">
            <button
              onClick={() => setData(p => ({...p, siempreArriba: true}))}
              className={cn(
                'flex-1 py-2 rounded-lg text-[12px] font-semibold border transition-colors',
                data.siempreArriba
                  ? 'bg-acqua text-white border-acqua'
                  : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
              )}
            >
              Sí — siempre arriba
            </button>
            <button
              onClick={() => setData(p => ({...p, siempreArriba: false}))}
              className={cn(
                'flex-1 py-2 rounded-lg text-[12px] font-semibold border transition-colors',
                !data.siempreArriba
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
              )}
            >
              No — redondeo normal
            </button>
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-600 block mb-1.5">Precio máximo sin redondeo</label>
          <NumericInput value={data.maxSinRedondeo} onChange={v => setData(p => ({...p, maxSinRedondeo: v}))} unit="ARS" min={0} step={100} />
          <p className="text-[10px] text-gray-400 mt-1">Precios menores a este valor NO se redondean (ej: accesorios baratos).</p>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-600 block mb-1.5">Decimales en costos</label>
          <NumericInput value={data.decimalesCostos} onChange={v => setData(p => ({...p, decimalesCostos: Math.min(4, Math.max(0, v))}))} unit="dec." min={0} max={4} step={1} />
          <p className="text-[10px] text-gray-400 mt-1">Costos, impuestos y comisiones mantienen este número de decimales.</p>
        </div>
      </div>

      {/* Ejemplo en vivo */}
      <div className="mt-6 p-4 bg-gray-50 border border-gray-200 rounded-xl">
        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-3">Ejemplo en vivo</p>
        <div className="flex items-center gap-3 text-sm">
          <div className="text-center">
            <div className="text-lg font-bold text-gray-600">$ {ejemploBase.toLocaleString('es-AR')}</div>
            <div className="text-[10px] text-gray-400">Precio calculado</div>
          </div>
          <ChevronRight className="w-4 h-4 text-gray-400" />
          <div className="text-center">
            <div className="text-lg font-bold text-acqua">$ {redondeado.toLocaleString('es-AR')}</div>
            <div className="text-[10px] text-gray-400">
              {data.siempreArriba ? 'Redondeado arriba' : 'Redondeado'} al múltiplo de ${data.multiplo}
            </div>
          </div>
          <div className="ml-2 px-2.5 py-1 bg-success/10 text-success rounded-lg text-[11px] font-semibold">
            +${(redondeado - ejemploBase).toLocaleString('es-AR')} ({(((redondeado - ejemploBase) / ejemploBase) * 100).toFixed(2)}%)
          </div>
        </div>
      </div>

      <SaveBar onSave={handleSave} onReset={handleReset} saved={saved} />
    </div>
  );
}

// ── Helper: parsea el Excel en el browser y envía JSON al servidor
// Evita el límite de 4.5 MB de Vercel para uploads de archivos
async function callImportExcel(
  file: File,
  params: { type: string; supplierName?: string; supplierSlug?: string; dryRun?: boolean; stockDate?: string },
) {
  const buffer   = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
  const sheets   = workbook.SheetNames.map(name => ({
    name,
    rows: XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, defval: '', blankrows: false }),
  }));
  const res = await fetch('/api/import-excel', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ ...params, sheets }),
  });
  if (!res.ok) {
    // El servidor puede devolver un JSON de error o texto plano
    const text = await res.text();
    try { return JSON.parse(text) as Record<string, unknown>; } catch { throw new Error(text); }
  }
  return res.json() as Promise<Record<string, unknown>>;
}

// ── Componente: Importar productos desde Odoo
type ImportPhase = 'idle' | 'selected' | 'previewing' | 'preview_ok' | 'importing' | 'done' | 'error';

interface ImportPreviewSheet {
  type: string;
  stats: { total: number; imported: number; skipped: number; warnings: string[] };
  detectedCols: Record<string, number>;
  headers: string[];
  sample: unknown[];
}

function ImportProductsSection({ onImported }: { onImported?: () => void }) {
  const [phase,    setPhase]    = useState<ImportPhase>('idle');
  const [dragging, setDragging] = useState(false);
  const [file,     setFile]     = useState<File | null>(null);
  const [preview,  setPreview]  = useState<ImportPreviewSheet | null>(null);
  const [result,   setResult]   = useState<{ imported: number; skipped: number } | null>(null);
  const [error,    setError]    = useState<string | null>(null);
  const fileRef                 = useRef<HTMLInputElement>(null);

  const handleFile = (f: File) => { setFile(f); setPhase('selected'); setError(null); };

  const runPreview = async () => {
    if (!file) return;
    setPhase('previewing');
    try {
      const data = await callImportExcel(file, { type: 'products', dryRun: true }) as { ok: boolean; sheets?: ImportPreviewSheet[]; error?: string };
      if (!data.ok) throw new Error(data.error ?? 'Error');
      setPreview(data.sheets?.[0] ?? null);
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
      const data = await callImportExcel(file, { type: 'products' }) as { ok: boolean; summary?: { stats: { imported: number; skipped: number } }[]; error?: string };
      if (!data.ok) throw new Error(data.error ?? 'Error');
      const stats = data.summary?.[0]?.stats;
      setResult({ imported: stats?.imported ?? 0, skipped: stats?.skipped ?? 0 });
      setPhase('done');
      onImported?.();
    } catch (e) {
      setError(String(e));
      setPhase('error');
    }
  };

  const colLabelMap: Record<string, string> = {
    id: 'ID Odoo', sku: 'Ref. interna', name: 'Nombre', cost: 'Costo',
    price: 'Precio venta', supplierName: 'Proveedor', category: 'Categoría',
  };

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-7 h-7 rounded-lg bg-acqua/10 flex items-center justify-center">
          <Upload className="w-4 h-4 text-acqua" />
        </div>
        <div>
          <p className="text-[13px] font-bold text-gray-900">Importar productos (Excel de Odoo)</p>
          <p className="text-[11px] text-gray-400">Reemplaza COMPLETAMENTE products.json con el archivo que subís</p>
        </div>
      </div>

      {/* Drop zone */}
      {(phase === 'idle' || phase === 'selected') && (
        <>
          <div className="flex items-center gap-2 mb-3">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-lg bg-green-50 text-green-700 border border-green-200">
              <FileSpreadsheet className="w-3 h-3" /> Excel (.xlsx)
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-lg bg-orange-50 text-orange-700 border border-orange-200">
              <FileSpreadsheet className="w-3 h-3" /> CSV
            </span>
          </div>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
            onClick={() => fileRef.current?.click()}
            className={cn(
              'border-2 border-dashed rounded-xl p-6 text-center transition-colors cursor-pointer',
              dragging ? 'border-acqua bg-acqua/5' :
              phase === 'selected' ? 'border-success bg-success/5' :
              'border-gray-200 hover:border-acqua/50 hover:bg-gray-50',
            )}
          >
            {phase === 'selected' ? (
              <>
                <CheckCircle2 className="w-6 h-6 text-success mx-auto mb-1" />
                <p className="text-[12px] font-semibold text-gray-700">{file?.name}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">Click para cambiar</p>
              </>
            ) : (
              <>
                <Upload className="w-6 h-6 text-gray-400 mx-auto mb-1" />
                <p className="text-[12px] font-medium text-gray-600">Arrastrá el Excel de Odoo aquí</p>
                <p className="text-[10px] text-gray-400 mt-0.5">o hacé click para seleccionar</p>
              </>
            )}
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          </div>

          {phase === 'selected' && (
            <div className="flex gap-2 mt-3">
              <button onClick={runPreview}
                className="flex items-center gap-1.5 px-3 py-2 border border-acqua text-acqua text-[12px] font-semibold rounded-lg hover:bg-acqua/5 transition-colors">
                Ver preview
              </button>
              <button onClick={runImport}
                className="flex items-center gap-1.5 px-4 py-2 bg-acqua text-white text-[12px] font-semibold rounded-lg hover:bg-acqua-dark transition-colors">
                <Upload className="w-3.5 h-3.5" /> Importar directo
              </button>
            </div>
          )}
        </>
      )}

      {/* Loading */}
      {(phase === 'previewing' || phase === 'importing') && (
        <div className="flex items-center gap-3 py-4">
          <RefreshCw className="w-5 h-5 text-acqua animate-spin" />
          <p className="text-sm text-gray-600">{phase === 'previewing' ? 'Analizando archivo…' : 'Importando productos…'}</p>
        </div>
      )}

      {/* Preview */}
      {phase === 'preview_ok' && preview && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-acqua/5 border border-acqua/20 rounded-xl p-3 text-center">
              <div className="text-xl font-bold text-acqua">{preview.stats.imported}</div>
              <div className="text-[10px] text-gray-500">Productos detectados</div>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <div className="text-xl font-bold text-gray-400">{preview.stats.skipped}</div>
              <div className="text-[10px] text-gray-500">Filas vacías</div>
            </div>
            <div className={cn('rounded-xl p-3 text-center', preview.stats.warnings.length ? 'bg-warning/5 border border-warning/20' : 'bg-success/5 border border-success/20')}>
              <div className={cn('text-xl font-bold', preview.stats.warnings.length ? 'text-warning' : 'text-success')}>{preview.stats.warnings.length}</div>
              <div className="text-[10px] text-gray-500">Advertencias</div>
            </div>
          </div>

          <div className="bg-gray-50 rounded-xl p-3">
            <p className="text-[10px] font-semibold text-gray-400 uppercase mb-2">Columnas detectadas</p>
            <div className="grid grid-cols-2 gap-1.5">
              {Object.entries(preview.detectedCols).map(([field, idx]) => (
                <div key={field} className="flex items-center gap-1.5">
                  {idx !== -1
                    ? <CheckCircle2 className="w-3 h-3 text-success shrink-0" />
                    : <X className="w-3 h-3 text-gray-400 shrink-0" />}
                  <span className={cn('text-[11px]', idx !== -1 ? 'text-gray-700' : 'text-gray-400')}>
                    {colLabelMap[field] || field}
                    {idx !== -1 && <span className="text-gray-400 font-mono text-[9px] ml-1">(col. {idx + 1})</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {preview.stats.warnings.length > 0 && (
            <div className="bg-warning/5 border border-warning/20 rounded-xl p-3 space-y-0.5">
              {preview.stats.warnings.slice(0, 3).map((w, i) => (
                <p key={i} className="text-[11px] text-warning">{w}</p>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={() => { setPhase('selected'); setPreview(null); }}
              className="px-3 py-2 border border-gray-200 text-gray-500 text-[12px] rounded-lg hover:bg-gray-50">
              Atrás
            </button>
            <button onClick={runImport}
              className="flex items-center gap-1.5 px-4 py-2 bg-acqua text-white text-[12px] font-semibold rounded-lg hover:bg-acqua-dark transition-colors">
              <CheckCircle2 className="w-3.5 h-3.5" /> Confirmar importación
            </button>
          </div>
        </div>
      )}

      {/* Done */}
      {phase === 'done' && result && (
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-6 h-6 text-success" />
            <div>
              <p className="text-[13px] font-bold text-gray-900">
                {result.imported.toLocaleString('es-AR')} productos importados
              </p>
              <p className="text-[11px] text-gray-400">{result.skipped} filas vacías ignoradas</p>
            </div>
          </div>
          <button onClick={() => { setPhase('idle'); setFile(null); setResult(null); }}
            className="ml-auto text-[11px] text-acqua hover:underline font-medium">
            Importar otro
          </button>
        </div>
      )}

      {/* Error */}
      {phase === 'error' && (
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-danger shrink-0" />
          <div>
            <p className="text-[12px] font-bold text-danger">Error al procesar</p>
            <p className="text-[11px] text-gray-500 mt-0.5">{error}</p>
          </div>
          <button onClick={() => { setPhase('selected'); setError(null); }}
            className="ml-auto text-[11px] text-acqua hover:underline font-medium">
            Reintentar
          </button>
        </div>
      )}
    </div>
  );
}

// ── Componente: Importar lista de precios proveedores (product.supplierinfo de Odoo)
function ImportSupplierinfoSection({ onImported }: { onImported?: () => void }) {
  const [phase,    setPhase]    = useState<ImportPhase>('idle');
  const [dragging, setDragging] = useState(false);
  const [file,     setFile]     = useState<File | null>(null);
  const [preview,  setPreview]  = useState<ImportPreviewSheet | null>(null);
  const [result,   setResult]   = useState<{ groups: number; products: number } | null>(null);
  const [error,    setError]    = useState<string | null>(null);
  const fileRef                 = useRef<HTMLInputElement>(null);

  const handleFile = (f: File) => { setFile(f); setPhase('selected'); setError(null); };

  const runPreview = async () => {
    if (!file) return;
    setPhase('previewing');
    try {
      const data = await callImportExcel(file, { type: 'supplierinfo', dryRun: true }) as { ok: boolean; sheets?: (ImportPreviewSheet & { groupCount?: number; groupSample?: { name: string; count: number }[] })[]; error?: string };
      if (!data.ok) throw new Error(data.error ?? 'Error');
      setPreview(data.sheets?.[0] ?? null);
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
      const data = await callImportExcel(file, { type: 'supplierinfo' }) as { ok: boolean; written?: { supplierinfo?: number; supplierinfo_products?: number }; error?: string };
      if (!data.ok) throw new Error(data.error ?? 'Error');
      setResult({ groups: data.written?.supplierinfo ?? 0, products: data.written?.supplierinfo_products ?? 0 });
      setPhase('done');
      onImported?.();
    } catch (e) {
      setError(String(e));
      setPhase('error');
    }
  };

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-7 h-7 rounded-lg bg-orange-50 flex items-center justify-center">
          <Upload className="w-4 h-4 text-orange-600" />
        </div>
        <div>
          <p className="text-[13px] font-bold text-gray-900">Importar listas de proveedor (Odoo supplierinfo)</p>
          <p className="text-[11px] text-gray-400">Export de <code className="bg-gray-100 px-1 rounded text-[10px]">product.supplierinfo</code> — agrupa automáticamente por proveedor</p>
        </div>
      </div>

      {(phase === 'idle' || phase === 'selected') && (
        <>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
            onClick={() => fileRef.current?.click()}
            className={cn(
              'border-2 border-dashed rounded-xl p-6 text-center transition-colors cursor-pointer',
              dragging ? 'border-orange-400 bg-orange-50' :
              phase === 'selected' ? 'border-success bg-success/5' :
              'border-gray-200 hover:border-orange-300 hover:bg-orange-50/40',
            )}
          >
            {phase === 'selected' ? (
              <>
                <CheckCircle2 className="w-6 h-6 text-success mx-auto mb-1" />
                <p className="text-[12px] font-semibold text-gray-700">{file?.name}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">Click para cambiar</p>
              </>
            ) : (
              <>
                <Upload className="w-6 h-6 text-gray-400 mx-auto mb-1" />
                <p className="text-[12px] font-medium text-gray-600">Arrastrá el Excel de supplierinfo</p>
                <p className="text-[10px] text-gray-400 mt-0.5">Lista de precios del proveedor (product.supplierinfo)</p>
              </>
            )}
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          </div>

          {phase === 'selected' && (
            <div className="flex gap-2 mt-3">
              <button onClick={runPreview}
                className="flex items-center gap-1.5 px-3 py-2 border border-orange-300 text-orange-600 text-[12px] font-semibold rounded-lg hover:bg-orange-50 transition-colors">
                Ver preview
              </button>
              <button onClick={runImport}
                className="flex items-center gap-1.5 px-4 py-2 bg-orange-500 text-white text-[12px] font-semibold rounded-lg hover:bg-orange-600 transition-colors">
                <Upload className="w-3.5 h-3.5" /> Importar directo
              </button>
            </div>
          )}
        </>
      )}

      {(phase === 'previewing' || phase === 'importing') && (
        <div className="flex items-center gap-3 py-4">
          <RefreshCw className="w-5 h-5 text-orange-500 animate-spin" />
          <p className="text-sm text-gray-600">{phase === 'previewing' ? 'Analizando archivo…' : 'Importando listas…'}</p>
        </div>
      )}

      {phase === 'preview_ok' && preview && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-orange-50 border border-orange-100 rounded-xl p-3 text-center">
              <div className="text-xl font-bold text-orange-600">{preview.stats.imported}</div>
              <div className="text-[10px] text-gray-500">Líneas de precio</div>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <div className="text-xl font-bold text-gray-400">{preview.stats.skipped}</div>
              <div className="text-[10px] text-gray-500">Filas vacías</div>
            </div>
            <div className={cn('rounded-xl p-3 text-center', preview.stats.warnings.length ? 'bg-warning/5 border border-warning/20' : 'bg-success/5 border border-success/20')}>
              <div className={cn('text-xl font-bold', preview.stats.warnings.length ? 'text-warning' : 'text-success')}>{preview.stats.warnings.length}</div>
              <div className="text-[10px] text-gray-500">Advertencias</div>
            </div>
          </div>
          {preview.stats.warnings.length > 0 && (
            <div className="bg-warning/5 border border-warning/20 rounded-xl p-3 space-y-0.5">
              {preview.stats.warnings.slice(0, 3).map((w, i) => (
                <p key={i} className="text-[11px] text-warning">{w}</p>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={() => { setPhase('selected'); setPreview(null); }}
              className="px-3 py-2 border border-gray-200 text-gray-500 text-[12px] rounded-lg hover:bg-gray-50">
              Atrás
            </button>
            <button onClick={runImport}
              className="flex items-center gap-1.5 px-4 py-2 bg-orange-500 text-white text-[12px] font-semibold rounded-lg hover:bg-orange-600 transition-colors">
              <CheckCircle2 className="w-3.5 h-3.5" /> Confirmar importación
            </button>
          </div>
        </div>
      )}

      {phase === 'done' && result && (
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-6 h-6 text-success" />
            <div>
              <p className="text-[13px] font-bold text-gray-900">
                {result.products.toLocaleString('es-AR')} precios importados
              </p>
              <p className="text-[11px] text-gray-400">{result.groups} proveedores actualizados</p>
            </div>
          </div>
          <button onClick={() => { setPhase('idle'); setFile(null); setResult(null); }}
            className="ml-auto text-[11px] text-orange-600 hover:underline font-medium">
            Importar otro
          </button>
        </div>
      )}

      {phase === 'error' && (
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-danger shrink-0" />
          <div>
            <p className="text-[12px] font-bold text-danger">Error al procesar</p>
            <p className="text-[11px] text-gray-500 mt-0.5">{error}</p>
          </div>
          <button onClick={() => { setPhase('selected'); setError(null); }}
            className="ml-auto text-[11px] text-orange-600 hover:underline font-medium">
            Reintentar
          </button>
        </div>
      )}
    </div>
  );
}

// ── Componente: Importar contactos/proveedores (res.partner de Odoo)
function ImportContactsSection({ onImported }: { onImported?: () => void }) {
  const [phase,    setPhase]    = useState<ImportPhase>('idle');
  const [dragging, setDragging] = useState(false);
  const [file,     setFile]     = useState<File | null>(null);
  const [preview,  setPreview]  = useState<ImportPreviewSheet | null>(null);
  const [result,   setResult]   = useState<number | null>(null);
  const [error,    setError]    = useState<string | null>(null);
  const fileRef                 = useRef<HTMLInputElement>(null);

  const handleFile = (f: File) => { setFile(f); setPhase('selected'); setError(null); };

  const runPreview = async () => {
    if (!file) return;
    setPhase('previewing');
    try {
      const data = await callImportExcel(file, { type: 'contacts', dryRun: true }) as { ok: boolean; sheets?: ImportPreviewSheet[]; error?: string };
      if (!data.ok) throw new Error(data.error ?? 'Error');
      setPreview(data.sheets?.[0] ?? null);
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
      const data = await callImportExcel(file, { type: 'contacts' }) as { ok: boolean; written?: { contacts?: number }; error?: string };
      if (!data.ok) throw new Error(data.error ?? 'Error');
      setResult(data.written?.contacts ?? 0);
      setPhase('done');
      onImported?.();
    } catch (e) {
      setError(String(e));
      setPhase('error');
    }
  };

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-7 h-7 rounded-lg bg-purple-50 flex items-center justify-center">
          <Upload className="w-4 h-4 text-purple-600" />
        </div>
        <div>
          <p className="text-[13px] font-bold text-gray-900">Importar contactos (Odoo res.partner)</p>
          <p className="text-[11px] text-gray-400">Carga el directorio de proveedores con teléfono, etiquetas y condición fiscal</p>
        </div>
      </div>

      {(phase === 'idle' || phase === 'selected') && (
        <>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
            onClick={() => fileRef.current?.click()}
            className={cn(
              'border-2 border-dashed rounded-xl p-6 text-center transition-colors cursor-pointer',
              dragging ? 'border-purple-400 bg-purple-50' :
              phase === 'selected' ? 'border-success bg-success/5' :
              'border-gray-200 hover:border-purple-300 hover:bg-purple-50/40',
            )}
          >
            {phase === 'selected' ? (
              <>
                <CheckCircle2 className="w-6 h-6 text-success mx-auto mb-1" />
                <p className="text-[12px] font-semibold text-gray-700">{file?.name}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">Click para cambiar</p>
              </>
            ) : (
              <>
                <Upload className="w-6 h-6 text-gray-400 mx-auto mb-1" />
                <p className="text-[12px] font-medium text-gray-600">Arrastrá el Excel de contactos</p>
                <p className="text-[10px] text-gray-400 mt-0.5">Contacto (res.partner) desde Odoo</p>
              </>
            )}
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          </div>

          {phase === 'selected' && (
            <div className="flex gap-2 mt-3">
              <button onClick={runPreview}
                className="flex items-center gap-1.5 px-3 py-2 border border-purple-300 text-purple-600 text-[12px] font-semibold rounded-lg hover:bg-purple-50 transition-colors">
                Ver preview
              </button>
              <button onClick={runImport}
                className="flex items-center gap-1.5 px-4 py-2 bg-purple-600 text-white text-[12px] font-semibold rounded-lg hover:bg-purple-700 transition-colors">
                <Upload className="w-3.5 h-3.5" /> Importar directo
              </button>
            </div>
          )}
        </>
      )}

      {(phase === 'previewing' || phase === 'importing') && (
        <div className="flex items-center gap-3 py-4">
          <RefreshCw className="w-5 h-5 text-purple-500 animate-spin" />
          <p className="text-sm text-gray-600">{phase === 'previewing' ? 'Analizando contactos…' : 'Importando contactos…'}</p>
        </div>
      )}

      {phase === 'preview_ok' && preview && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-purple-50 border border-purple-100 rounded-xl p-3 text-center">
              <div className="text-xl font-bold text-purple-600">{preview.stats.imported}</div>
              <div className="text-[10px] text-gray-500">Contactos detectados</div>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <div className="text-xl font-bold text-gray-400">{preview.stats.skipped}</div>
              <div className="text-[10px] text-gray-500">Filas vacías</div>
            </div>
            <div className={cn('rounded-xl p-3 text-center', preview.stats.warnings.length ? 'bg-warning/5 border border-warning/20' : 'bg-success/5 border border-success/20')}>
              <div className={cn('text-xl font-bold', preview.stats.warnings.length ? 'text-warning' : 'text-success')}>{preview.stats.warnings.length}</div>
              <div className="text-[10px] text-gray-500">Advertencias</div>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => { setPhase('selected'); setPreview(null); }}
              className="px-3 py-2 border border-gray-200 text-gray-500 text-[12px] rounded-lg hover:bg-gray-50">
              Atrás
            </button>
            <button onClick={runImport}
              className="flex items-center gap-1.5 px-4 py-2 bg-purple-600 text-white text-[12px] font-semibold rounded-lg hover:bg-purple-700 transition-colors">
              <CheckCircle2 className="w-3.5 h-3.5" /> Confirmar importación
            </button>
          </div>
        </div>
      )}

      {phase === 'done' && result !== null && (
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-6 h-6 text-success" />
            <div>
              <p className="text-[13px] font-bold text-gray-900">
                {result} contactos importados
              </p>
              <p className="text-[11px] text-gray-400">Directorio de proveedores actualizado</p>
            </div>
          </div>
          <button onClick={() => { setPhase('idle'); setFile(null); setResult(null); }}
            className="ml-auto text-[11px] text-purple-600 hover:underline font-medium">
            Importar otro
          </button>
        </div>
      )}

      {phase === 'error' && (
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-danger shrink-0" />
          <div>
            <p className="text-[12px] font-bold text-danger">Error al procesar</p>
            <p className="text-[11px] text-gray-500 mt-0.5">{error}</p>
          </div>
          <button onClick={() => { setPhase('selected'); setError(null); }}
            className="ml-auto text-[11px] text-purple-600 hover:underline font-medium">
            Reintentar
          </button>
        </div>
      )}
    </div>
  );
}

// ── Componente: Importar stock (informe de stock de Odoo)
function ImportStockSection({ onImported }: { onImported?: () => void }) {
  const [phase,    setPhase]    = useState<ImportPhase>('idle');
  const [dragging, setDragging] = useState(false);
  const [file,     setFile]     = useState<File | null>(null);
  const [preview,  setPreview]  = useState<ImportPreviewSheet | null>(null);
  const [result,   setResult]   = useState<number | null>(null);
  const [error,    setError]    = useState<string | null>(null);
  const fileRef                 = useRef<HTMLInputElement>(null);

  const handleFile = (f: File) => { setFile(f); setPhase('selected'); setError(null); };

  const runPreview = async () => {
    if (!file) return;
    setPhase('previewing');
    try {
      const data = await callImportExcel(file, { type: 'stock', dryRun: true }) as { ok: boolean; sheets?: ImportPreviewSheet[]; error?: string };
      if (!data.ok) throw new Error(data.error ?? 'Error');
      setPreview(data.sheets?.[0] ?? null);
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
      const data = await callImportExcel(file, { type: 'stock', stockDate: new Date().toISOString().split('T')[0] }) as { ok: boolean; written?: { stock?: number }; error?: string };
      if (!data.ok) throw new Error(data.error ?? 'Error');
      setResult(data.written?.stock ?? 0);
      setPhase('done');
      onImported?.();
    } catch (e) {
      setError(String(e));
      setPhase('error');
    }
  };

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-7 h-7 rounded-lg bg-teal-50 flex items-center justify-center">
          <Upload className="w-4 h-4 text-teal-600" />
        </div>
        <div>
          <p className="text-[13px] font-bold text-gray-900">Importar stock (informe de stock de Odoo)</p>
          <p className="text-[11px] text-gray-400">
            Exportá desde Odoo → Inventario → Informe de stock · Se actualiza diariamente
          </p>
        </div>
      </div>

      {(phase === 'idle' || phase === 'selected') && (
        <>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
            onClick={() => fileRef.current?.click()}
            className={cn(
              'border-2 border-dashed rounded-xl p-6 text-center transition-colors cursor-pointer',
              dragging ? 'border-teal-400 bg-teal-50' :
              phase === 'selected' ? 'border-success bg-success/5' :
              'border-gray-200 hover:border-teal-300 hover:bg-teal-50/30',
            )}
          >
            {phase === 'selected' ? (
              <>
                <CheckCircle2 className="w-6 h-6 text-success mx-auto mb-1" />
                <p className="text-[12px] font-semibold text-gray-700">{file?.name}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">Click para cambiar</p>
              </>
            ) : (
              <>
                <Upload className="w-6 h-6 text-gray-400 mx-auto mb-1" />
                <p className="text-[12px] font-medium text-gray-600">Arrastrá el Excel de stock</p>
                <p className="text-[10px] text-gray-400 mt-0.5">Odoo → Inventario → Informe de stock actual</p>
              </>
            )}
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          </div>

          {phase === 'selected' && (
            <div className="flex gap-2 mt-3">
              <button onClick={runPreview}
                className="flex items-center gap-1.5 px-3 py-2 border border-teal-300 text-teal-600 text-[12px] font-semibold rounded-lg hover:bg-teal-50 transition-colors">
                Ver preview
              </button>
              <button onClick={runImport}
                className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 text-white text-[12px] font-semibold rounded-lg hover:bg-teal-700 transition-colors">
                <Upload className="w-3.5 h-3.5" /> Importar
              </button>
            </div>
          )}
        </>
      )}

      {(phase === 'previewing' || phase === 'importing') && (
        <div className="flex items-center gap-3 py-4">
          <RefreshCw className="w-5 h-5 text-teal-500 animate-spin" />
          <p className="text-sm text-gray-600">{phase === 'previewing' ? 'Analizando stock…' : 'Importando stock…'}</p>
        </div>
      )}

      {phase === 'preview_ok' && preview && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-teal-50 border border-teal-100 rounded-xl p-3 text-center">
              <div className="text-xl font-bold text-teal-700">{preview.stats.imported}</div>
              <div className="text-[10px] text-gray-500">Líneas de stock</div>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <div className="text-xl font-bold text-gray-400">{preview.stats.skipped}</div>
              <div className="text-[10px] text-gray-500">Filas vacías</div>
            </div>
            <div className={cn('rounded-xl p-3 text-center', preview.stats.warnings.length ? 'bg-warning/5 border border-warning/20' : 'bg-success/5 border border-success/20')}>
              <div className={cn('text-xl font-bold', preview.stats.warnings.length ? 'text-warning' : 'text-success')}>{preview.stats.warnings.length}</div>
              <div className="text-[10px] text-gray-500">Advertencias</div>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => { setPhase('selected'); setPreview(null); }}
              className="px-3 py-2 border border-gray-200 text-gray-500 text-[12px] rounded-lg hover:bg-gray-50">
              Atrás
            </button>
            <button onClick={runImport}
              className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 text-white text-[12px] font-semibold rounded-lg hover:bg-teal-700 transition-colors">
              <CheckCircle2 className="w-3.5 h-3.5" /> Confirmar importación
            </button>
          </div>
        </div>
      )}

      {phase === 'done' && result !== null && (
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-6 h-6 text-success" />
            <div>
              <p className="text-[13px] font-bold text-gray-900">{result} líneas de stock importadas</p>
              <p className="text-[11px] text-gray-400">Snapshot del {new Date().toLocaleDateString('es-AR')}</p>
            </div>
          </div>
          <button onClick={() => { setPhase('idle'); setFile(null); setResult(null); }}
            className="ml-auto text-[11px] text-teal-600 hover:underline font-medium">
            Importar otro
          </button>
        </div>
      )}

      {phase === 'error' && (
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-danger shrink-0" />
          <div>
            <p className="text-[12px] font-bold text-danger">Error al procesar</p>
            <p className="text-[11px] text-gray-500 mt-0.5">{error}</p>
          </div>
          <button onClick={() => { setPhase('selected'); setError(null); }}
            className="ml-auto text-[11px] text-teal-600 hover:underline font-medium">
            Reintentar
          </button>
        </div>
      )}
    </div>
  );
}

// ── Sección: Gestión de datos
interface DataStats {
  products: { total: number; conCosto: number; conPrecio: number; conImagen: number; conProveedor: number };
  suppliers: { total: number };
}

function SeccionDatos() {
  const [stats,      setStats]      = useState<DataStats | null>(null);
  const [loadingSt,  setLoadingSt]  = useState(true);
  const [resetPhase, setResetPhase] = useState<'idle' | 'confirm' | 'loading' | 'done' | 'error'>('idle');
  const [resetMsg,   setResetMsg]   = useState('');

  const fetchStats = () => {
    setLoadingSt(true);
    fetch('/api/data-management')
      .then(r => r.json())
      .then(d => { if (d.ok) setStats(d.stats); })
      .catch(() => {})
      .finally(() => setLoadingSt(false));
  };

  useEffect(() => { fetchStats(); }, []);

  const doReset = async () => {
    setResetPhase('loading');
    try {
      const r = await fetch('/api/data-management', {
        method: 'DELETE',
        headers: { 'X-Confirm': 'RESET_ALL_DATA' },
      });
      const d = await r.json();
      if (d.ok) {
        setResetPhase('done');
        setResetMsg('Base reseteada a cero. Ahora podés importar los datos frescos desde Odoo.');
        setStats(null);
      } else if (d.isVercel) {
        setResetPhase('error');
        setResetMsg('El reset no está disponible en producción (Vercel). Los datos del sistema viven en el bundle del deploy — para actualizar la base, importá los Excel desde la sección de importación de arriba y re-deployá.');
      } else {
        setResetPhase('error');
        setResetMsg(d.error || 'Error al resetear');
      }
    } catch (e) {
      setResetPhase('error');
      setResetMsg(String(e));
    }
  };

  const statItems = stats ? [
    { label: 'Total productos',   value: stats.products.total,       pct: null },
    { label: 'Con costo',         value: stats.products.conCosto,    pct: Math.round(stats.products.conCosto / stats.products.total * 100) },
    { label: 'Con precio',        value: stats.products.conPrecio,   pct: Math.round(stats.products.conPrecio / stats.products.total * 100) },
    { label: 'Con imagen',        value: stats.products.conImagen,   pct: Math.round(stats.products.conImagen / stats.products.total * 100) },
    { label: 'Con proveedor',     value: stats.products.conProveedor,pct: Math.round(stats.products.conProveedor / stats.products.total * 100) },
  ] : [];

  return (
    <div>
      <SectionHeader
        title="Gestión de datos"
        subtitle="Estado actual de la base. Hacé un reset total antes de re-importar desde Odoo — cada subida reemplaza todo."
      />

      {/* Estado de la base */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-5 shadow-sm">
        <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-4">Estado actual de la base</p>
        {loadingSt ? (
          <p className="text-sm text-gray-400">Cargando estadísticas...</p>
        ) : !stats ? (
          <p className="text-sm text-orange-600 font-medium">Base vacía o error al leer. El servidor de Next.js necesita estar corriendo.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {statItems.map(s => (
              <div key={s.label} className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-[10px] text-gray-400 font-bold uppercase mb-1">{s.label}</p>
                <p className="text-xl font-black text-gray-900">{s.value.toLocaleString('es-AR')}</p>
                {s.pct !== null && (
                  <p className={cn('text-[11px] font-semibold mt-0.5', s.pct >= 90 ? 'text-green-600' : s.pct >= 60 ? 'text-orange-500' : 'text-red-500')}>
                    {s.pct}%
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Flujo de importación */}
      <div className="bg-[#0784F2]/5 border border-[#0784F2]/15 rounded-2xl p-5 mb-5">
        <p className="text-[11px] font-bold text-[#0784F2] uppercase tracking-wide mb-3">Flujo correcto de importación</p>
        <div className="space-y-2.5">
          {[
            { n: '1', t: 'Productos (product.template)', d: 'Exportá desde Odoo → Inventario → Productos. Reemplaza todos los productos del sistema.' },
            { n: '2', t: 'Listas de proveedor (product.supplierinfo)', d: 'Exportá desde Odoo → Compras → Listas de precios. Agrupa automáticamente por proveedor.' },
            { n: '3', t: 'Contactos (res.partner)', d: 'Exportá desde Odoo → Contactos. Carga el directorio de proveedores con teléfono y etiquetas.' },
            { n: '4', t: 'Verificá en el sistema', d: 'Revisá estadísticas arriba y abrí el Consultor para ver alertas de datos faltantes.' },
          ].map(step => (
            <div key={step.n} className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-[#0784F2] text-white text-[11px] font-black flex items-center justify-center shrink-0 mt-0.5">
                {step.n}
              </div>
              <div>
                <p className="text-[13px] font-bold text-gray-800">{step.t}</p>
                <p className="text-[11px] text-gray-500">{step.d}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Importadores desde Odoo */}
      <ImportProductsSection onImported={fetchStats} />
      <ImportSupplierinfoSection onImported={fetchStats} />
      <ImportContactsSection onImported={fetchStats} />
      <ImportStockSection onImported={fetchStats} />

      {/* Reset total */}
      <div className="bg-red-50 border border-red-100 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="w-4 h-4 text-red-500" />
          <p className="text-[12px] font-bold text-red-700 uppercase tracking-wide">Reset total de la base</p>
        </div>
        <p className="text-sm text-red-700 mb-4 leading-relaxed">
          Borra <strong>todos los productos y proveedores</strong> del sistema. No se puede deshacer. Hacelo solo antes de una re-importación completa.
        </p>

        {resetPhase === 'idle' && (
          <button
            onClick={() => setResetPhase('confirm')}
            className="flex items-center gap-2 px-4 py-2.5 bg-red-600 text-white rounded-xl text-[13px] font-bold hover:bg-red-700 transition-colors"
          >
            <Trash2 className="w-4 h-4" /> Resetear toda la base
          </button>
        )}

        {resetPhase === 'confirm' && (
          <div className="bg-white border border-red-200 rounded-xl p-4">
            <p className="text-sm font-bold text-red-800 mb-3">⚠️ ¿Estás seguro? Esto borra todo irreversiblemente.</p>
            <div className="flex gap-2">
              <button
                onClick={doReset}
                className="px-4 py-2 bg-red-600 text-white rounded-lg text-[13px] font-bold hover:bg-red-700 transition-colors"
              >
                Sí, resetear todo
              </button>
              <button
                onClick={() => setResetPhase('idle')}
                className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-[13px] font-semibold hover:bg-gray-200 transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {resetPhase === 'loading' && (
          <p className="text-sm text-red-600 font-semibold">Reseteando...</p>
        )}

        {resetPhase === 'done' && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4">
            <p className="text-sm text-green-700 font-semibold">✅ {resetMsg}</p>
            <button onClick={() => { setResetPhase('idle'); fetchStats(); }} className="mt-2 text-[12px] text-green-600 underline">
              Ver estadísticas actualizadas
            </button>
          </div>
        )}

        {resetPhase === 'error' && (
          <div className="bg-red-100 border border-red-200 rounded-xl p-4">
            <p className="text-sm text-red-700 font-semibold">❌ {resetMsg}</p>
            <button onClick={() => setResetPhase('idle')} className="mt-2 text-[12px] text-red-600 underline">
              Intentar de nuevo
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Página principal
// ─────────────────────────────────────────────────────────────────────────────
// SECCIÓN: INTEGRACIÓN ODOO
// ─────────────────────────────────────────────────────────────────────────────

function SeccionOdoo() {
  const { settings, loading, save } = useSettings();
  const [url,       setUrl]       = useState('');
  const [username,  setUsername]  = useState('');
  const [apiKey,    setApiKey]    = useState('');
  const [showKey,   setShowKey]   = useState(false);
  const [saved,     setSaved]     = useState(false);
  const [testing,   setTesting]   = useState(false);
  const [testOk,    setTestOk]    = useState<boolean | null>(null);
  const [syncing,       setSyncing]       = useState(false);
  const [syncResult,    setSyncResult]    = useState<{ ok: boolean; message?: string; error?: string; withStock?: number; matched?: number; unmatched?: number } | null>(null);
  const [syncingProds,  setSyncingProds]  = useState(false);
  const [syncProdsResult, setSyncProdsResult] = useState<{
    ok: boolean; message?: string; error?: string;
    costChanged?: number; priceChanged?: number; matched?: number; unmatched?: number; unmatchedSample?: string[];
  } | null>(null);
  const [syncCost,  setSyncCost]  = useState(true);
  const [syncPrice, setSyncPrice] = useState(false);
  const [syncName,  setSyncName]  = useState(false);

  useEffect(() => {
    if (!loading) {
      setUrl(settings.odooServerUrl ?? '');
      setUsername(settings.odooUsername ?? '');
      setApiKey(settings.odooApiKey ?? '');
    }
  }, [loading, settings]);

  const handleSave = async () => {
    await save({
      odooServerUrl: url.replace(/\/$/, ''),
      odooUsername:  username.trim(),
      odooApiKey:    apiKey.trim(),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleSyncStock = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      // Guardar credenciales antes de sincronizar (por si no hizo click en Guardar)
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          odooServerUrl: url.replace(/\/$/, ''),
          odooUsername:  username.trim(),
          odooApiKey:    apiKey.trim(),
        }),
      });
      const res = await fetch('/api/sync-stock-odoo', { method: 'POST' });
      const data = await res.json() as { ok: boolean; message?: string; error?: string; withStock?: number; matched?: number; unmatched?: number };
      setSyncResult(data);
      if (data.ok) setTimeout(() => setSyncResult(null), 8000);
    } catch (e) {
      setSyncResult({ ok: false, error: String(e) });
    } finally {
      setSyncing(false);
    }
  };

  const handleSyncProducts = async () => {
    setSyncingProds(true);
    setSyncProdsResult(null);
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          odooServerUrl: url.replace(/\/$/, ''),
          odooUsername:  username.trim(),
          odooApiKey:    apiKey.trim(),
        }),
      });
      const res = await fetch('/api/sync-products-odoo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncCost, syncPrice, syncName }),
      });
      const data = await res.json() as typeof syncProdsResult;
      setSyncProdsResult(data);
    } catch (e) {
      setSyncProdsResult({ ok: false, error: String(e) });
    } finally {
      setSyncingProds(false);
    }
  };

  const handleTest = () => {
    if (!url) return;
    setTesting(true);
    setTestOk(null);
    // Intenta cargar una imagen de prueba (logo de Odoo es siempre pública)
    const testUrl = `${url.replace(/\/$/, '')}/web/static/img/favicon.png`;
    const img = new Image();
    img.onload  = () => { setTesting(false); setTestOk(true);  };
    img.onerror = () => { setTesting(false); setTestOk(false); };
    img.src = testUrl;
  };

  return (
    <div>
      <SectionHeader
        title="Integración Odoo"
        subtitle="Configurá la URL de tu servidor Odoo para mostrar imágenes de productos y proveedores automáticamente."
      />

      <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-5 shadow-sm space-y-5">

        {/* Info */}
        <div className="bg-[#0784F2]/5 border border-[#0784F2]/15 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <Globe className="w-4 h-4 text-[#0784F2] mt-0.5 shrink-0" />
            <div>
              <p className="text-[12px] font-semibold text-[#0784F2] mb-1">¿Para qué sirve?</p>
              <p className="text-[12px] text-gray-600 leading-relaxed">
                Las imágenes de Odoo no pueden exportarse por Excel (límite de caracteres).
                Configurando la URL del servidor, el sistema las carga directamente desde Odoo
                usando las URLs públicas del tipo:
                <code className="ml-1 bg-gray-100 px-1 rounded text-[10px] font-mono">
                  /web/image/product.template/[id]/image_1920
                </code>
              </p>
            </div>
          </div>
        </div>

        {/* URL Input */}
        <div>
          <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2">
            URL del servidor Odoo
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="url"
                value={url}
                onChange={e => { setUrl(e.target.value); setTestOk(null); }}
                placeholder="http://192.168.1.x:8069  ó  https://tu-empresa.odoo.com"
                className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0784F2]/30 focus:border-[#0784F2]"
              />
            </div>
            <button
              onClick={handleTest}
              disabled={!url || testing}
              className="px-4 py-2.5 rounded-xl border border-gray-200 text-[12px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors whitespace-nowrap"
            >
              {testing ? 'Probando...' : 'Probar'}
            </button>
          </div>

          {/* Test result */}
          {testOk === true && (
            <p className="mt-2 text-[12px] text-[#16A34A] flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" /> Conexión exitosa — el servidor responde correctamente.
            </p>
          )}
          {testOk === false && (
            <p className="mt-2 text-[12px] text-[#EF4444] flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" /> No se pudo conectar. Verificá la URL y que el servidor esté accesible desde esta red.
            </p>
          )}

          <p className="mt-2 text-[11px] text-gray-400">
            Tip: Si Odoo corre localmente, usá la IP de LAN (ej: <code className="font-mono">http://192.168.1.10:8069</code>).
            Sin puerto si es :80 o :443 estándar.
          </p>
        </div>

        {/* Ejemplos de imagen */}
        {url && testOk === true && (
          <div>
            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2">
              Vista previa — imagen de producto #1513
            </p>
            <div className="w-24 h-24 rounded-xl border border-gray-200 bg-gray-50 overflow-hidden flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`${url.replace(/\/$/, '')}/web/image/product.template/1513/image_1920`}
                alt="preview"
                className="w-full h-full object-contain p-1"
                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            </div>
          </div>
        )}

        {/* ── Credenciales API ── */}
        <div className="pt-4 border-t border-gray-100 space-y-4">
          <div className="flex items-start gap-2">
            <RefreshCw className="w-4 h-4 text-teal-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-[12px] font-semibold text-gray-800">Sync de stock directo desde Odoo</p>
              <p className="text-[11px] text-gray-500 leading-relaxed mt-0.5">
                Con usuario y API Key podés sincronizar el stock sin exportar Excel.
                Generá la API Key en <strong>Odoo → Ajustes → Técnico → Claves API</strong>.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3">
            {/* Usuario */}
            <div>
              <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1.5">
                Usuario (email de Odoo)
              </label>
              <input
                type="email"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="tu@email.com"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0784F2]/30 focus:border-[#0784F2]"
              />
            </div>

            {/* API Key */}
            <div>
              <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1.5">
                API Key
              </label>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder="Pegá la clave generada en Odoo"
                  className="w-full pl-3 pr-10 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0784F2]/30 focus:border-[#0784F2] font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>

          {/* ── Sync Productos (costo / precio) desde Odoo ── */}
          {username && apiKey && (
            <div className="bg-[#714B67]/5 border border-[#714B67]/20 rounded-xl p-4 space-y-3">
              <div>
                <p className="text-[12px] font-black text-[#714B67]">Sincronizar productos desde Odoo</p>
                <p className="text-[11px] text-[#714B67]/70 mt-0.5">
                  Trae Precio Costo, Precio de Venta y Nombre directo desde Odoo usando XML-RPC. Coincide por ID de Odoo primero, luego SKU y nombre.
                </p>
              </div>

              {/* Checkboxes: qué campos sincronizar */}
              <div className="flex flex-wrap gap-3">
                {[
                  { key: 'syncCost',  label: 'Precio Costo',   val: syncCost,  set: setSyncCost,  desc: 'standard_price de Odoo' },
                  { key: 'syncPrice', label: 'Precio de Venta', val: syncPrice, set: setSyncPrice, desc: 'list_price de Odoo' },
                  { key: 'syncName',  label: 'Nombre',          val: syncName,  set: setSyncName,  desc: 'Sobreescribe el nombre local' },
                ].map(opt => (
                  <label key={opt.key} className={cn(
                    'flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer transition-colors text-[11px] font-semibold',
                    opt.val
                      ? 'bg-[#714B67]/10 border-[#714B67]/40 text-[#714B67]'
                      : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300',
                  )}>
                    <input
                      type="checkbox"
                      checked={opt.val}
                      onChange={e => opt.set(e.target.checked)}
                      className="accent-[#714B67] w-3.5 h-3.5"
                    />
                    <span>{opt.label}</span>
                    <span className="text-[9px] font-normal opacity-60">{opt.desc}</span>
                  </label>
                ))}
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleSyncProducts}
                  disabled={syncingProds || (!syncCost && !syncPrice && !syncName)}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2 rounded-xl text-[12px] font-bold whitespace-nowrap transition-all',
                    syncingProds
                      ? 'bg-[#714B67]/40 text-white cursor-wait'
                      : (!syncCost && !syncPrice && !syncName)
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        : 'bg-[#714B67] text-white hover:bg-[#5a3a54]',
                  )}
                >
                  <RefreshCw className={cn('w-3.5 h-3.5', syncingProds && 'animate-spin')} />
                  {syncingProds ? 'Sincronizando...' : 'Sync Productos'}
                </button>
                <p className="text-[10px] text-gray-400">Las fotos no se descargan — se cargan por URL usando el odooId.</p>
              </div>

              {syncProdsResult && (
                <div className={cn(
                  'p-3 rounded-lg text-[12px]',
                  syncProdsResult.ok
                    ? 'bg-green-50 border border-green-200 text-green-800'
                    : 'bg-red-50 border border-red-200 text-red-700',
                )}>
                  {syncProdsResult.ok ? (
                    <div className="space-y-1">
                      <p className="font-bold">✅ {syncProdsResult.message}</p>
                      <div className="flex gap-4 flex-wrap text-[11px] text-green-700">
                        {syncProdsResult.matched !== undefined && (
                          <span>🔗 {syncProdsResult.matched} coincidencias</span>
                        )}
                        {(syncProdsResult.costChanged ?? 0) > 0 && (
                          <span>💰 {syncProdsResult.costChanged} costos actualizados</span>
                        )}
                        {(syncProdsResult.priceChanged ?? 0) > 0 && (
                          <span>🏷 {syncProdsResult.priceChanged} precios actualizados</span>
                        )}
                        {(syncProdsResult.unmatched ?? 0) > 0 && (
                          <span className="text-amber-600">⚠ {syncProdsResult.unmatched} sin coincidencia</span>
                        )}
                      </div>
                      {syncProdsResult.unmatchedSample && syncProdsResult.unmatchedSample.length > 0 && (
                        <p className="text-[10px] text-green-600 mt-1">
                          Sin match: {syncProdsResult.unmatchedSample.slice(0, 4).join(', ')}
                          {syncProdsResult.unmatchedSample.length > 4 ? '…' : ''}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="font-medium">❌ {syncProdsResult.error}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Botón Sync Stock */}
          {username && apiKey && (
            <div className="bg-teal-50 border border-teal-200 rounded-xl p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[12px] font-bold text-teal-800">Sincronizar stock ahora</p>
                  <p className="text-[11px] text-teal-600 mt-0.5">
                    Conecta con Odoo, lee el stock real y actualiza todos los productos.
                  </p>
                </div>
                <button
                  onClick={handleSyncStock}
                  disabled={syncing}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2 rounded-xl text-[12px] font-bold whitespace-nowrap transition-all',
                    syncing
                      ? 'bg-teal-200 text-teal-600 cursor-wait'
                      : 'bg-teal-600 text-white hover:bg-teal-700'
                  )}
                >
                  <RefreshCw className={cn('w-3.5 h-3.5', syncing && 'animate-spin')} />
                  {syncing ? 'Sincronizando...' : 'Sync Stock'}
                </button>
              </div>

              {syncResult && (
                <div className={cn(
                  'mt-3 p-3 rounded-lg text-[12px]',
                  syncResult.ok ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-700'
                )}>
                  {syncResult.ok ? (
                    <>
                      <p className="font-bold">✅ {syncResult.message}</p>
                      {syncResult.unmatched !== undefined && syncResult.unmatched > 0 && (
                        <p className="mt-1 text-green-600">{syncResult.unmatched} productos de Odoo no encontrados en el sistema (sin coincidencia de SKU).</p>
                      )}
                    </>
                  ) : (
                    <p className="font-medium">❌ {syncResult.error}</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Save */}
        <div className="flex items-center justify-between pt-3 border-t border-gray-100">
          <p className="text-[11px] text-gray-400">
            Los cambios aplican inmediatamente en todas las páginas.
          </p>
          <button
            onClick={handleSave}
            disabled={loading}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-xl text-[12px] font-semibold transition-all',
              saved
                ? 'bg-[#16A34A] text-white'
                : 'bg-[#07111F] text-white hover:bg-gray-800',
            )}
          >
            {saved ? <><Check className="w-3.5 h-3.5" /> Guardado</> : <><Save className="w-3.5 h-3.5" /> Guardar</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Sección: MercadoLibre API ─────────────────────────────────────────────────
function SeccionML() {
  const { settings, loading, save } = useSettings();
  const [appId,     setAppId]     = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [site,      setSite]      = useState('MLA');
  const [showSecret, setShowSecret] = useState(false);
  const [saved,     setSaved]     = useState(false);
  const [testing,   setTesting]   = useState(false);
  const [testResult, setTestResult] = useState<'ok' | 'error' | null>(null);

  useEffect(() => {
    if (!loading) {
      setAppId(settings.mlAppId ?? '');
      setAppSecret(settings.mlAppSecret ?? '');
      setSite(settings.mlSite ?? 'MLA');
    }
  }, [loading, settings.mlAppId, settings.mlAppSecret, settings.mlSite]);

  const handleSave = async () => {
    await save({ mlAppId: appId.trim(), mlAppSecret: appSecret.trim(), mlSite: site });
    setSaved(true);
    setTestResult(null);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleTest = async () => {
    if (!appId || !appSecret) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/ml-search?q=cepillo&limit=2`);
      const data = await res.json() as { ok: boolean; error?: string };
      setTestResult(data.ok ? 'ok' : 'error');
    } catch {
      setTestResult('error');
    } finally {
      setTesting(false);
    }
  };

  const configured = !!(appId && appSecret);

  return (
    <div>
      <SectionHeader
        title="MercadoLibre API"
        subtitle="Configurá tu App de MercadoLibre para habilitar el escaneo de competencia en ML Lab."
      />

      <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-5 shadow-sm space-y-5">

        {/* Estado actual */}
        <div className={cn(
          'flex items-center gap-3 px-4 py-3 rounded-xl border',
          configured
            ? 'bg-[#16A34A]/5 border-[#16A34A]/20'
            : 'bg-[#F97316]/5 border-[#F97316]/20',
        )}>
          <div className={cn('w-2.5 h-2.5 rounded-full shrink-0', configured ? 'bg-[#16A34A]' : 'bg-[#F97316]')} />
          <p className={cn('text-[12px] font-semibold', configured ? 'text-[#16A34A]' : 'text-[#F97316]')}>
            {configured ? 'Credenciales configuradas — escaneo activo' : 'Sin credenciales — escaneo deshabilitado'}
          </p>
        </div>

        {/* Cómo obtenerlas */}
        <div className="bg-[#FFE600]/8 border border-[#FFE600]/30 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <ShoppingCart className="w-4 h-4 text-gray-700 mt-0.5 shrink-0" />
            <div className="space-y-1.5">
              <p className="text-[12px] font-bold text-gray-800">¿Cómo obtener las credenciales?</p>
              <ol className="text-[11px] text-gray-600 space-y-1 list-decimal list-inside">
                <li>Ingresá a <strong>developers.mercadolibre.com.ar</strong> con tu cuenta ML</li>
                <li>Creá una nueva app → tipo <strong>Marketplace</strong> → cualquier nombre</li>
                <li>En el detalle de la app copiá el <strong>App ID</strong> y el <strong>Secret Key</strong></li>
                <li>Pegálos acá abajo y guardá</li>
              </ol>
              <a
                href="https://developers.mercadolibre.com.ar/devcenter"
                target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 mt-1 text-[11px] font-bold text-[#3483FA] hover:underline"
              >
                <ExternalLink className="w-3 h-3" />
                Ir al Dev Center de ML
              </a>
            </div>
          </div>
        </div>

        {/* Inputs */}
        <div className="space-y-4">
          {/* App ID */}
          <div>
            <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1.5">
              App ID
            </label>
            <input
              type="text"
              value={appId}
              onChange={e => { setAppId(e.target.value); setTestResult(null); }}
              placeholder="Ej: 1234567890123456"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#3483FA]/30 focus:border-[#3483FA] font-mono"
            />
          </div>

          {/* Secret Key */}
          <div>
            <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1.5">
              Secret Key
            </label>
            <div className="relative">
              <input
                type={showSecret ? 'text' : 'password'}
                value={appSecret}
                onChange={e => { setAppSecret(e.target.value); setTestResult(null); }}
                placeholder="Tu clave secreta de ML"
                className="w-full px-3 py-2.5 pr-10 border border-gray-200 rounded-xl text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#3483FA]/30 focus:border-[#3483FA] font-mono"
              />
              <button
                onClick={() => setShowSecret(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                type="button"
              >
                {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Site */}
          <div>
            <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1.5">
              País / Sitio
            </label>
            <select
              value={site}
              onChange={e => setSite(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#3483FA]/30 focus:border-[#3483FA] bg-white"
            >
              <option value="MLA">Argentina (MLA)</option>
              <option value="MLB">Brasil (MLB)</option>
              <option value="MLC">Chile (MLC)</option>
              <option value="MLM">México (MLM)</option>
              <option value="MLU">Uruguay (MLU)</option>
            </select>
          </div>
        </div>

        {/* Resultado del test */}
        {testResult && (
          <div className={cn(
            'flex items-center gap-2 px-4 py-3 rounded-xl text-[12px] font-semibold',
            testResult === 'ok'
              ? 'bg-[#16A34A]/8 text-[#16A34A] border border-[#16A34A]/20'
              : 'bg-[#EF4444]/8 text-[#EF4444] border border-[#EF4444]/20',
          )}>
            {testResult === 'ok'
              ? '✓ Conexión exitosa — el escaneo está funcionando'
              : '✗ Error de conexión — revisá las credenciales'}
          </div>
        )}

        {/* Botones */}
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={handleSave}
            disabled={!appId || !appSecret}
            className="flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white rounded-xl text-[12px] font-bold hover:bg-gray-800 disabled:opacity-40 transition-colors"
          >
            {saved
              ? <><Check className="w-4 h-4" /> Guardado</>
              : <><Save className="w-4 h-4" /> Guardar credenciales</>}
          </button>
          <button
            onClick={handleTest}
            disabled={!configured || testing}
            className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 rounded-xl text-[12px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
          >
            {testing
              ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Probando...</>
              : <><RefreshCw className="w-3.5 h-3.5" /> Probar conexión</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Sección: Gemini AI ────────────────────────────────────────────────────────
function SeccionGemini() {
  const { settings, loading, save } = useSettings();
  const [apiKey,     setApiKey]     = useState('');
  const [showKey,    setShowKey]    = useState(false);
  const [saved,      setSaved]      = useState(false);
  const [testing,    setTesting]    = useState(false);
  const [testResult, setTestResult] = useState<'ok' | 'error' | null>(null);
  const [testMsg,    setTestMsg]    = useState('');

  useEffect(() => {
    if (!loading) setApiKey(settings.geminiKey ?? '');
  }, [loading, settings.geminiKey]);

  const handleSave = async () => {
    await save({ geminiKey: apiKey.trim() });
    setSaved(true);
    setTestResult(null);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleTest = async () => {
    if (!apiKey.trim()) return;
    setTesting(true);
    setTestResult(null);
    setTestMsg('');
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey.trim()}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Respondé solo "ok"' }] }],
          generationConfig: { maxOutputTokens: 10 },
        }),
      });
      const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      if (res.ok && reply) {
        setTestResult('ok');
        setTestMsg(`Gemini respondió: "${reply.trim()}"`);
      } else {
        setTestResult('error');
        setTestMsg(`Error ${res.status}`);
      }
    } catch (e) {
      setTestResult('error');
      setTestMsg(String(e).slice(0, 80));
    } finally {
      setTesting(false);
    }
  };

  const configured = !!(apiKey.trim());

  return (
    <div>
      <SectionHeader
        title="Gemini AI"
        subtitle="Clave de API para el Consultor IA y el análisis inteligente en ML Lab."
      />

      <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-5 shadow-sm space-y-5">

        {/* Estado */}
        <div className={cn(
          'flex items-center gap-3 px-4 py-3 rounded-xl border',
          configured
            ? 'bg-[#16A34A]/5 border-[#16A34A]/20'
            : 'bg-[#F97316]/5 border-[#F97316]/20',
        )}>
          <div className={cn('w-2.5 h-2.5 rounded-full shrink-0', configured ? 'bg-[#16A34A]' : 'bg-[#F97316]')} />
          <p className={cn('text-[12px] font-semibold', configured ? 'text-[#16A34A]' : 'text-[#F97316]')}>
            {configured ? 'Clave configurada — Consultor IA activo' : 'Sin clave — Consultor en modo básico'}
          </p>
        </div>

        {/* Cómo obtenerla */}
        <div className="bg-purple-50 border border-purple-100 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <Sparkles className="w-4 h-4 text-purple-600 mt-0.5 shrink-0" />
            <div className="space-y-1.5">
              <p className="text-[12px] font-bold text-gray-800">¿Cómo obtener la clave?</p>
              <ol className="text-[11px] text-gray-600 space-y-1 list-decimal list-inside">
                <li>Entrá a <strong>aistudio.google.com</strong> con tu cuenta Google</li>
                <li>Clic en <strong>&ldquo;Get API key&rdquo;</strong> → <strong>&ldquo;Create API key&rdquo;</strong></li>
                <li>Copiá la clave y pegála abajo</li>
              </ol>
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 mt-1 text-[11px] font-bold text-purple-600 hover:underline"
              >
                <ExternalLink className="w-3 h-3" />
                Ir a Google AI Studio
              </a>
            </div>
          </div>
        </div>

        {/* Input */}
        <div>
          <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1.5">
            API Key
          </label>
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={e => { setApiKey(e.target.value); setTestResult(null); }}
              placeholder="AIzaSy..."
              className="w-full px-3 py-2.5 pr-10 border border-gray-200 rounded-xl text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-400/30 focus:border-purple-400 font-mono"
            />
            <button
              onClick={() => setShowKey(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
              type="button"
            >
              {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-gray-400">
            La clave se guarda en el servidor — funciona desde cualquier dispositivo.
          </p>
        </div>

        {/* Resultado test */}
        {testResult && (
          <div className={cn(
            'flex items-start gap-2 px-4 py-3 rounded-xl text-[12px] font-semibold',
            testResult === 'ok'
              ? 'bg-[#16A34A]/8 text-[#16A34A] border border-[#16A34A]/20'
              : 'bg-[#EF4444]/8 text-[#EF4444] border border-[#EF4444]/20',
          )}>
            <span>{testResult === 'ok' ? '✓' : '✗'}</span>
            <span>{testMsg || (testResult === 'ok' ? 'Conexión exitosa' : 'Error — revisá la clave')}</span>
          </div>
        )}

        {/* Botones */}
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={handleSave}
            disabled={!configured}
            className="flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white rounded-xl text-[12px] font-bold hover:bg-gray-800 disabled:opacity-40 transition-colors"
          >
            {saved
              ? <><Check className="w-4 h-4" /> Guardado</>
              : <><Save className="w-4 h-4" /> Guardar clave</>}
          </button>
          <button
            onClick={handleTest}
            disabled={!configured || testing}
            className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 rounded-xl text-[12px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
          >
            {testing
              ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Probando...</>
              : <><Sparkles className="w-3.5 h-3.5" /> Probar Gemini</>}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ParametrosPage() {
  const [activeSection, setActiveSection] = useState('dolar');

  const sections = [
    { key: 'dolar',     label: 'Dólar',           icon: DollarSign,  desc: 'Tipos de cambio' },
    { key: 'impuestos', label: 'IVA / IIBB',       icon: Percent,     desc: 'Impuestos' },
    { key: 'pagos',     label: 'Medios de pago',   icon: CreditCard,  desc: 'Recargos y listas' },
    { key: 'listas',    label: 'Listas de precio', icon: ListOrdered, desc: 'Descuentos y márgenes' },
    { key: 'redondeo',  label: 'Redondeo',         icon: Calculator,  desc: 'Reglas de redondeo' },
    { key: 'datos',     label: 'Datos',            icon: HardDrive,   desc: 'Reset e importación' },
    { key: 'odoo',      label: 'Integración Odoo', icon: Globe,       desc: 'URL e imágenes' },
    { key: 'ml',        label: 'MercadoLibre API', icon: ShoppingCart, desc: 'Escaneo de competencia' },
    { key: 'gemini',    label: 'Gemini AI',        icon: Sparkles,     desc: 'Consultor inteligente' },
  ];

  return (
    <div className="min-h-screen bg-surface">

      {/* Hero */}
      <div className="bg-header border-b border-white/10 px-5 lg:px-8 xl:px-12 py-5">
        <div className="max-w-[1680px] mx-auto">
          <p className="text-white/40 text-[11px] font-semibold uppercase tracking-widest mb-1">Sistema</p>
          <h1 className="text-white font-bold text-2xl">Parámetros</h1>
          <p className="text-white/50 text-sm mt-0.5">
            Reglas del negocio — cambio, impuestos, listas de precio, redondeo
          </p>
        </div>
      </div>

      <div className="max-w-[1680px] mx-auto px-5 lg:px-8 xl:px-12 py-6">
        <div className="flex gap-6">

          {/* Sidebar */}
          <div className="w-56 shrink-0 hidden lg:block">
            <div className="bg-white rounded-xl border border-gray-100 p-2 sticky top-[60px]">
              {sections.map(s => {
                const Icon = s.icon;
                const active = activeSection === s.key;
                return (
                  <button
                    key={s.key}
                    onClick={() => setActiveSection(s.key)}
                    className={cn(
                      'flex items-center gap-2.5 w-full px-3 py-2.5 rounded-lg transition-colors text-left',
                      active ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'
                    )}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <div>
                      <div className={cn('text-[12px] font-semibold', active ? 'text-white' : 'text-gray-700')}>
                        {s.label}
                      </div>
                      <div className={cn('text-[10px]', active ? 'text-white/60' : 'text-gray-400')}>
                        {s.desc}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Info card */}
            <div className="mt-4 bg-acqua/5 border border-acqua/20 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-4 h-4 text-acqua" />
                <span className="text-[11px] font-bold text-acqua">Socio Acqua</span>
              </div>
              <p className="text-[11px] text-gray-600 leading-relaxed">
                Todos los parámetros impactan en los cálculos de costo y precio del sistema.
                Guardá cambios antes de salir.
              </p>
            </div>
          </div>

          {/* Mobile tabs */}
          <div className="lg:hidden w-full mb-4">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {sections.map(s => {
                const Icon = s.icon;
                return (
                  <button
                    key={s.key}
                    onClick={() => setActiveSection(s.key)}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium whitespace-nowrap transition-colors shrink-0',
                      activeSection === s.key ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 border border-gray-200'
                    )}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {activeSection === 'dolar'     && <SeccionDolar />}
            {activeSection === 'impuestos' && <SeccionImpuestos />}
            {activeSection === 'pagos'     && <SeccionPagos />}
            {activeSection === 'listas'    && <SeccionListas />}
            {activeSection === 'redondeo'  && <SeccionRedondeo />}
            {activeSection === 'datos'     && <SeccionDatos />}
            {activeSection === 'odoo'      && <SeccionOdoo />}
            {activeSection === 'ml'        && <SeccionML />}
            {activeSection === 'gemini'    && <SeccionGemini />}
          </div>
        </div>
      </div>
    </div>
  );
}
