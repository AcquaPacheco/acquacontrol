'use client';

import { useState } from 'react';
import { StatusBadge } from '@/components/shared/status-badge';
import { cn } from '@/lib/utils';
import {
  ShoppingCart,
  TrendingUp,
  Package,
  DollarSign,
  Truck,
  CreditCard,
  BarChart3,
  Zap,
  Calculator,
  ArrowRight,
  Star,
  Eye,
} from 'lucide-react';

const mockMLListings = [
  {
    id: 'ml-001', itemId: 'MLA-1234567890', title: 'Cloro Triple Acción x 5kg - Pileta Piscina',
    price: 24990, stock: 15, status: 'active' as const, freeShipping: true, listingType: 'gold_pro',
    fee: 13, sold30d: 42, category: 'Piletas', costAcqua: 9800, image: null,
  },
  {
    id: 'ml-002', itemId: 'MLA-1234567891', title: 'Kit Decantador Completo Pileta - Tratamiento Agua',
    price: 39990, stock: 6, status: 'active' as const, freeShipping: true, listingType: 'gold_pro',
    fee: 13, sold30d: 18, category: 'Piletas', costAcqua: 15000, image: null,
  },
  {
    id: 'ml-003', itemId: 'MLA-1234567892', title: 'Sahumerio Saphirus Lavanda Pack x 6 Unidades',
    price: 2490, stock: 85, status: 'active' as const, freeShipping: false, listingType: 'gold_special',
    fee: 11, sold30d: 156, category: 'Perfumería', costAcqua: 900, image: null,
  },
  {
    id: 'ml-004', itemId: 'MLA-1234567893', title: 'pH Menos Granulado x 2kg - Corrector pH Pileta',
    price: 15990, stock: 12, status: 'paused' as const, freeShipping: true, listingType: 'gold_pro',
    fee: 13, sold30d: 8, category: 'Piletas', costAcqua: 6500, image: null,
  },
  {
    id: 'ml-005', itemId: 'MLA-1234567894', title: 'Manguera de Riego 15m Reforzada - Jardín',
    price: 29990, stock: 14, status: 'active' as const, freeShipping: true, listingType: 'gold_pro',
    fee: 13, sold30d: 23, category: 'Jardín', costAcqua: 12000, image: null,
  },
];

export default function MercadoLibrePage() {
  const [tab, setTab] = useState<'resumen' | 'publicaciones' | 'simulador'>('resumen');

  const totalVentas30d = mockMLListings.reduce((acc, l) => acc + (l.sold30d * l.price), 0);
  const avgMargin = 34.5;

  return (
    <div className="min-h-screen bg-[#EBEBEB] max-w-[1680px] mx-auto">
      {/* ML Header */}
      <div className="bg-meli">
        <div className="px-4 lg:px-8 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center">
              <ShoppingCart className="w-6 h-6 text-meli-dark" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-meli-dark tracking-tight">MercadoLibre Lab</h1>
              <p className="text-sm text-meli-dark/70">Asesor experto diario — Vendé sin perder rentabilidad</p>
            </div>
          </div>

          {/* ML Tabs */}
          <div className="flex items-center gap-1 mt-4">
            {[
              { key: 'resumen', label: 'Resumen ML' },
              { key: 'publicaciones', label: 'Publicaciones' },
              { key: 'simulador', label: 'Simulador ML' },
            ].map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key as typeof tab)}
                className={cn(
                  'px-4 py-2 rounded-t-lg text-sm font-semibold transition-colors',
                  tab === t.key
                    ? 'bg-white text-meli-dark'
                    : 'text-meli-dark/60 hover:text-meli-dark hover:bg-white/30'
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="px-4 lg:px-8 py-6">
        {tab === 'resumen' && (
          <div className="space-y-4">
            {/* KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <MLMetricCard
                icon={DollarSign}
                label="Ventas 30d"
                value={`$${(totalVentas30d / 1000000).toFixed(1)}M`}
                sub="+12% vs mes anterior"
                color="text-meli-blue"
              />
              <MLMetricCard
                icon={TrendingUp}
                label="Margen promedio"
                value={`${avgMargin}%`}
                sub="Sobre neto recibido"
                color="text-green-600"
              />
              <MLMetricCard
                icon={Package}
                label="Publicaciones activas"
                value={mockMLListings.filter(l => l.status === 'active').length.toString()}
                sub={`${mockMLListings.length} total`}
                color="text-meli-blue"
              />
              <MLMetricCard
                icon={Truck}
                label="Con envío gratis"
                value={mockMLListings.filter(l => l.freeShipping).length.toString()}
                sub="Mercado Envíos"
                color="text-green-600"
              />
            </div>

            {/* Top sold */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-sm font-bold text-gray-900 mb-4">Más vendidos (30 días)</h3>
              <div className="space-y-3">
                {[...mockMLListings].sort((a, b) => b.sold30d - a.sold30d).slice(0, 5).map((l, i) => (
                  <div key={l.id} className="flex items-center gap-4 p-3 rounded-lg hover:bg-gray-50 transition-colors">
                    <span className="text-lg font-bold text-gray-400 w-6 text-center">#{i + 1}</span>
                    <div className="w-12 h-12 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center shrink-0">
                      <Package className="w-5 h-5 text-gray-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-meli-blue truncate">{l.title}</div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-lg font-bold text-gray-900">${l.price.toLocaleString('es-AR')}</span>
                        {l.freeShipping && (
                          <span className="text-[10px] font-bold text-green-600 bg-green-50 px-1.5 py-0.5 rounded">
                            Envío gratis
                          </span>
                        )}
                        <span className="text-[10px] font-medium text-gray-400">
                          {l.listingType === 'gold_pro' ? 'Premium' : 'Clásica'}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold text-gray-900">{l.sold30d}</div>
                      <div className="text-[10px] text-gray-400">vendidos</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === 'publicaciones' && (
          <div className="space-y-3">
            {mockMLListings.map((l) => {
              const priceNoIVA = l.price / 1.21;
              const feeAmount = l.price * (l.fee / 100);
              const netReceived = l.price - feeAmount;
              const netNoIVA = netReceived / 1.21;
              const marginReal = ((netNoIVA - l.costAcqua) / netNoIVA * 100);

              return (
                <div key={l.id} className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md transition-shadow">
                  <div className="flex gap-4">
                    {/* Image placeholder */}
                    <div className="w-24 h-24 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center shrink-0">
                      <Package className="w-8 h-8 text-gray-400" />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="text-sm text-meli-blue font-medium hover:underline cursor-pointer">{l.title}</div>
                          <div className="text-[10px] text-gray-400 mt-0.5">{l.itemId} • {l.category}</div>
                        </div>
                        <StatusBadge
                          status={l.status === 'active' ? 'activo' : l.status === 'paused' ? 'pendiente' : 'archivado'}
                          label={l.status === 'active' ? 'Activa' : l.status === 'paused' ? 'Pausada' : 'Cerrada'}
                        />
                      </div>

                      <div className="flex items-end gap-6 mt-3">
                        <div>
                          <div className="text-2xl font-bold text-gray-900">${l.price.toLocaleString('es-AR')}</div>
                          <div className="flex items-center gap-2 mt-0.5">
                            {l.freeShipping && (
                              <span className="text-[10px] font-bold text-green-600 bg-green-50 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                                <Truck className="w-3 h-3" /> Envío gratis
                              </span>
                            )}
                            <span className="text-[10px] text-gray-400">
                              {l.listingType === 'gold_pro' ? '⭐ Premium' : 'Clásica'}
                            </span>
                            <span className="text-[10px] text-gray-400">• Comisión {l.fee}%</span>
                          </div>
                        </div>

                        <div className="flex gap-4">
                          <div className="text-center">
                            <div className="text-sm font-bold text-gray-900">{l.stock}</div>
                            <div className="text-[10px] text-gray-400">stock</div>
                          </div>
                          <div className="text-center">
                            <div className="text-sm font-bold text-gray-900">{l.sold30d}</div>
                            <div className="text-[10px] text-gray-400">vendidos/mes</div>
                          </div>
                          <div className="text-center">
                            <div className={cn(
                              'text-sm font-bold',
                              marginReal >= 25 ? 'text-green-600' : marginReal >= 15 ? 'text-yellow-600' : 'text-red-600'
                            )}>
                              {marginReal.toFixed(1)}%
                            </div>
                            <div className="text-[10px] text-gray-400">margen real</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === 'simulador' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-lg">
            <div className="flex items-center gap-2 mb-4">
              <Calculator className="w-5 h-5 text-meli-blue" />
              <h2 className="text-lg font-bold text-gray-900">Simulador MercadoLibre</h2>
            </div>
            <p className="text-sm text-gray-500 mb-6">&quot;Qué pasa si lo publico a...&quot;</p>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-600">Precio publicado (c/IVA)</label>
                <input type="number" placeholder="24990" className="w-full mt-1 px-4 py-3 rounded-lg border border-gray-200 text-lg font-mono focus:outline-none focus:ring-2 focus:ring-meli/50" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600">Costo Acqua (s/IVA)</label>
                <input type="number" placeholder="9800" className="w-full mt-1 px-4 py-3 rounded-lg border border-gray-200 text-lg font-mono focus:outline-none focus:ring-2 focus:ring-meli/50" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-600">Tipo publicación</label>
                  <select className="w-full mt-1 px-3 py-3 rounded-lg border border-gray-200 text-sm">
                    <option>Premium (13%)</option>
                    <option>Clásica (11%)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600">Envío</label>
                  <select className="w-full mt-1 px-3 py-3 rounded-lg border border-gray-200 text-sm">
                    <option>Gratis (Mercado Envíos)</option>
                    <option>A cargo del comprador</option>
                    <option>A cargo de Acqua</option>
                  </select>
                </div>
              </div>

              <button className="w-full py-3 rounded-lg bg-meli-blue text-white font-bold text-sm hover:bg-blue-600 transition-colors">
                Calcular rentabilidad ML
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MLMetricCard({ icon: Icon, label, value, sub, color }: {
  icon: typeof DollarSign;
  label: string;
  value: string;
  sub: string;
  color: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={cn('w-4 h-4', color)} />
        <span className="text-xs font-semibold text-gray-500 uppercase">{label}</span>
      </div>
      <div className={cn('text-2xl font-bold', color)}>{value}</div>
      <div className="text-[10px] text-gray-400 mt-0.5">{sub}</div>
    </div>
  );
}
