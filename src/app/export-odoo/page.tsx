'use client';

import { useState, useMemo } from 'react';
import productsData from '@/data/products.json';
import odooSupData from '@/data/odoo-supplierinfo.json';
import { cn } from '@/lib/utils';
import {
  FileSpreadsheet, Download, Eye,
  CheckCircle2, AlertTriangle, XCircle, RefreshCw,
  Package,
} from 'lucide-react';

// ─── Tipos ────────────────────────────────────────────────────────────────────
interface RealProduct {
  id: string; sku: string | null; name: string;
  cost: number; price: number; margin: number | null;
  supplierName: string | null; supplierCode: string | null;
  odooId: number | null; active: boolean;
}

interface SupplierRow {
  si_id: string; code: string; tmpl_name: string;
  sup_name: string | null; price: number; discount: number; net_price: number;
}

// ─── Data real ────────────────────────────────────────────────────────────────
const products = productsData as unknown as RealProduct[];
const odooSup  = odooSupData  as unknown as Array<{ name: string; slug: string; products: SupplierRow[] }>;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n: number) {
  return n.toFixed(2);
}

function generateProductCSV(rows: RealProduct[]) {
  const header = ['id', 'name', 'standard_price', 'list_price'];
  const lines = [
    header.join(','),
    ...rows.map(p => [
      p.odooId ?? '',
      `"${p.name.replace(/"/g, '""')}"`,
      fmt(p.cost),
      fmt(p.price),
    ].join(',')),
  ];
  return lines.join('\n');
}

function generateSupplierCSV(rows: SupplierRow[]) {
  const header = ['id', 'partner_id', 'product_code', 'price', 'discount'];
  const lines = [
    header.join(','),
    ...rows.map((r, i) => [
      r.si_id || i + 1,
      `"${(r.sup_name ?? '').replace(/"/g, '""')}"`,
      r.code,
      fmt(r.price),
      r.discount,
    ].join(',')),
  ];
  return lines.join('\n');
}

function downloadCSV(content: string, filename: string) {
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function ExportOdooPage() {
  const [activeExport, setActiveExport] = useState<'product' | 'supplierinfo'>('product');

  // Classify products
  const { exportable, issues, noOdoo } = useMemo(() => {
    const exportable: RealProduct[] = [];
    const issues:     RealProduct[] = [];
    const noOdoo:     RealProduct[] = [];

    for (const p of products) {
      if (!p.odooId) { noOdoo.push(p); continue; }
      if (!p.cost || p.cost === 0 || !p.price || p.price === 0) { issues.push(p); continue; }
      exportable.push(p);
    }
    return { exportable, issues, noOdoo };
  }, []);

  // All supplier rows (from odoo-supplierinfo.json)
  const supplierRows = useMemo(() =>
    odooSup.flatMap(s => s.products),
  []);

  const handleDownload = () => {
    const filename = `acqua-export-${activeExport}-${new Date().toISOString().slice(0,10)}.csv`;
    if (activeExport === 'product') {
      downloadCSV(generateProductCSV(exportable), filename);
    } else {
      downloadCSV(generateSupplierCSV(supplierRows), filename);
    }
  };

  const previewRows = activeExport === 'product' ? exportable : [];

  return (
    <div className="min-h-screen max-w-[1680px] mx-auto">

      {/* Header */}
      <div className="px-4 lg:px-8 pt-6 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg odoo-gradient flex items-center justify-center">
            <FileSpreadsheet className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Export Odoo</h1>
            <p className="text-sm text-gray-500">Zona de salida — genera los CSVs para importar en Odoo</p>
          </div>
        </div>
      </div>

      {/* Stats reales */}
      <div className="px-4 lg:px-8">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-white rounded-xl border border-gray-100 p-4 flex items-center gap-3">
            <CheckCircle2 className="w-8 h-8 text-success shrink-0" />
            <div>
              <div className="text-xl font-bold text-gray-900">{exportable.length}</div>
              <div className="text-xs text-gray-500">Listos para export</div>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 p-4 flex items-center gap-3">
            <AlertTriangle className="w-8 h-8 text-warning shrink-0" />
            <div>
              <div className="text-xl font-bold text-gray-900">{issues.length}</div>
              <div className="text-xs text-gray-500">Sin costo o precio</div>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 p-4 flex items-center gap-3">
            <XCircle className="w-8 h-8 text-danger shrink-0" />
            <div>
              <div className="text-xl font-bold text-gray-900">{noOdoo.length}</div>
              <div className="text-xs text-gray-500">Sin ID Odoo</div>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 p-4 flex items-center gap-3">
            <RefreshCw className="w-8 h-8 text-acqua shrink-0" />
            <div>
              <div className="text-xl font-bold text-gray-900">{supplierRows.length}</div>
              <div className="text-xs text-gray-500">Artículos en supplierinfo</div>
            </div>
          </div>
        </div>
      </div>

      {/* Export type selector */}
      <div className="px-4 lg:px-8 mt-6">
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setActiveExport('product')}
            className={cn(
              'px-5 py-3 rounded-xl border-2 text-sm font-semibold transition-all text-left',
              activeExport === 'product'
                ? 'border-odoo bg-odoo/5 text-odoo'
                : 'border-gray-200 text-gray-500 hover:border-gray-300'
            )}
          >
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4" />
              product.template
            </div>
            <div className="text-[10px] text-gray-400 mt-0.5">{exportable.length} registros — id, name, standard_price, list_price</div>
          </button>
          <button
            onClick={() => setActiveExport('supplierinfo')}
            className={cn(
              'px-5 py-3 rounded-xl border-2 text-sm font-semibold transition-all text-left',
              activeExport === 'supplierinfo'
                ? 'border-odoo bg-odoo/5 text-odoo'
                : 'border-gray-200 text-gray-500 hover:border-gray-300'
            )}
          >
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4" />
              product.supplierinfo
            </div>
            <div className="text-[10px] text-gray-400 mt-0.5">{supplierRows.length} artículos — id, partner_id, price, discount</div>
          </button>
        </div>
      </div>

      {/* Preview table */}
      <div className="px-4 lg:px-8 mt-4 mb-8">
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-odoo" />
              <h3 className="text-sm font-bold text-gray-900">
                Preview — {activeExport === 'product' ? 'product.template' : 'product.supplierinfo'}
              </h3>
              <span className="text-xs text-gray-400">
                ({activeExport === 'product' ? exportable.length : supplierRows.length} registros)
              </span>
            </div>
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg odoo-gradient text-white text-sm font-semibold hover:opacity-90 transition-opacity"
            >
              <Download className="w-4 h-4" />
              Descargar .csv
            </button>
          </div>

          {/* product.template preview */}
          {activeExport === 'product' && (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 text-[11px] text-gray-600 font-bold uppercase tracking-wider border-b border-gray-200">
                    <th className="text-center px-2 py-2 w-8 border-r border-gray-200 text-gray-400">#</th>
                    <th className="text-left px-4 py-2 border-r border-gray-200">id (Odoo)</th>
                    <th className="text-left px-4 py-2 border-r border-gray-200">name</th>
                    <th className="text-right px-4 py-2 border-r border-gray-200">standard_price</th>
                    <th className="text-right px-4 py-2 border-r border-gray-200">list_price</th>
                    <th className="text-center px-3 py-2">Margen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 font-mono text-sm">
                  {previewRows.slice(0, 100).map((p, i) => (
                    <tr key={p.id} className="hover:bg-blue-50/30 transition-colors">
                      <td className="text-center px-2 py-2.5 text-xs text-gray-400 border-r border-gray-100">{i + 1}</td>
                      <td className="px-4 py-2.5 text-gray-700 border-r border-gray-100">{p.odooId}</td>
                      <td className="px-4 py-2.5 text-gray-900 border-r border-gray-100 max-w-[300px] truncate">{p.name}</td>
                      <td className="px-4 py-2.5 text-right text-gray-700 border-r border-gray-100">
                        {fmt(p.cost)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-900 font-semibold border-r border-gray-100">
                        {fmt(p.price)}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {p.margin !== null ? (
                          <span className={cn(
                            'text-[11px] font-bold',
                            p.margin >= 45 ? 'text-success' :
                            p.margin >= 35 ? 'text-warning' : 'text-danger'
                          )}>
                            {p.margin.toFixed(1)}%
                          </span>
                        ) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {previewRows.length > 100 && (
                <div className="px-5 py-2 text-xs text-gray-400 bg-gray-50 border-t border-gray-100">
                  Mostrando 100 de {previewRows.length}. El export descargará todos.
                </div>
              )}
            </div>
          )}

          {/* supplierinfo preview */}
          {activeExport === 'supplierinfo' && (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 text-[11px] text-gray-600 font-bold uppercase tracking-wider border-b border-gray-200">
                    <th className="text-center px-2 py-2 w-8 border-r border-gray-200 text-gray-400">#</th>
                    <th className="text-left px-4 py-2 border-r border-gray-200">partner_id</th>
                    <th className="text-left px-4 py-2 border-r border-gray-200">product_code</th>
                    <th className="text-left px-4 py-2 border-r border-gray-200">tmpl_name</th>
                    <th className="text-right px-4 py-2 border-r border-gray-200">price</th>
                    <th className="text-right px-4 py-2">discount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 font-mono text-sm">
                  {supplierRows.slice(0, 100).map((r, i) => (
                    <tr key={`${r.si_id}-${i}`} className="hover:bg-blue-50/30 transition-colors">
                      <td className="text-center px-2 py-2.5 text-xs text-gray-400 border-r border-gray-100">{i + 1}</td>
                      <td className="px-4 py-2.5 text-gray-700 border-r border-gray-100 truncate max-w-[180px]">{r.sup_name || '—'}</td>
                      <td className="px-4 py-2.5 text-gray-600 border-r border-gray-100">{r.code}</td>
                      <td className="px-4 py-2.5 text-gray-900 border-r border-gray-100 truncate max-w-[250px]">{r.tmpl_name}</td>
                      <td className="px-4 py-2.5 text-right text-gray-700 border-r border-gray-100">{fmt(r.price)}</td>
                      <td className="px-4 py-2.5 text-right text-gray-600">{r.discount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {supplierRows.length > 100 && (
                <div className="px-5 py-2 text-xs text-gray-400 bg-gray-50 border-t border-gray-100">
                  Mostrando 100 de {supplierRows.length}. El export descargará todos.
                </div>
              )}
            </div>
          )}

          <div className="px-5 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between text-xs text-gray-500">
            <span>
              {activeExport === 'product'
                ? `${exportable.length} registros con ID Odoo, costo y precio`
                : `${supplierRows.length} artículos de ${odooSup.length} proveedores`}
            </span>
            <span>Formato: CSV UTF-8 con BOM, compatible con Odoo import</span>
          </div>
        </div>

        {/* Issues section */}
        {issues.length > 0 && activeExport === 'product' && (
          <div className="mt-4 bg-warning/5 border border-warning/20 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-5 h-5 text-warning" />
              <h3 className="text-sm font-bold text-warning">Sin costo o precio ({issues.length})</h3>
              <span className="text-xs text-gray-400 ml-1">No se incluyen en el export</span>
            </div>
            <div className="space-y-2">
              {issues.slice(0, 5).map((p) => (
                <div key={p.id} className="flex items-center justify-between bg-white rounded-lg px-4 py-2.5 border border-warning/10">
                  <div className="flex items-center gap-2 min-w-0">
                    <Package className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                    <span className="text-sm font-medium text-gray-900 truncate">{p.name}</span>
                  </div>
                  <span className="text-xs text-warning font-semibold ml-2 shrink-0">
                    {!p.cost || p.cost === 0 ? 'Sin costo' : 'Sin precio'}
                  </span>
                </div>
              ))}
              {issues.length > 5 && (
                <p className="text-xs text-gray-400 pl-1">...y {issues.length - 5} más</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
