'use client';

import { useMemo, useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import productsData from '@/data/products.json';
import odooSuppliersRaw from '@/data/odoo-supplierinfo.json';
import { cn } from '@/lib/utils';

// ── Mapa nombre → slug para links directos a proveedor
type OdooSupplierIndex = { name: string; slug: string; count: number };
const odooSuppliersIndex = odooSuppliersRaw as unknown as Array<OdooSupplierIndex & { products: unknown[] }>;
const supplierSlugMap = new Map(odooSuppliersIndex.map(s => [s.name, s.slug]));

function getSupplierHref(name: string, filterSuffix?: string): string {
  const slug = supplierSlugMap.get(name);
  if (slug) return `/proveedores/${slug}`;
  return `/productos?supplier=${encodeURIComponent(name)}${filterSuffix ? `&filter=${filterSuffix}` : ''}`;
}
import suppliersContactsRaw from '@/data/suppliers.json';
import {
  Send, ArrowRight, DollarSign, Camera, TrendingDown,
  AlertTriangle, CheckCircle2, Zap, Package, Users,
  Lightbulb, RefreshCw, ChevronRight, Upload, HardDrive,
  ListChecks,
} from 'lucide-react';

// Cuántos contactos/proveedores hay importados
const contactCount = (suppliersContactsRaw as unknown[]).length;

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface Product {
  id: string; sku: string | null; name: string;
  cost: number; price: number; margin: number | null;
  image: string | null; supplierName: string | null;
  category: string | null; status: string;
}

const products = productsData as unknown as Product[];

// ─────────────────────────────────────────────────────────────────────────────
// DATA ENGINE — analiza products.json en vivo
// ─────────────────────────────────────────────────────────────────────────────

function useDataAnalysis() {
  return useMemo(() => {
    const sinCosto     = products.filter(p => !p.cost || p.cost === 0);
    const sinPrecio    = products.filter(p => !p.price || p.price === 0);
    const sinImagen    = products.filter(p => !p.image);
    const sinProveedor = products.filter(p => !p.supplierName);
    const margenNeg    = products.filter(p => p.margin !== null && p.margin < 0);
    const margenBajo   = products.filter(p => p.margin !== null && p.margin >= 0 && p.margin < 30);
    const margenNull   = products.filter(p => p.margin === null);

    // Agrupar por proveedor
    const supMap = new Map<string, { name: string; count: number; sinCosto: number; sinImagen: number }>();
    products.forEach(p => {
      if (!p.supplierName) return;
      if (!supMap.has(p.supplierName)) supMap.set(p.supplierName, { name: p.supplierName, count: 0, sinCosto: 0, sinImagen: 0 });
      const s = supMap.get(p.supplierName)!;
      s.count++;
      if (!p.cost || p.cost === 0) s.sinCosto++;
      if (!p.image) s.sinImagen++;
    });
    const suppliers = Array.from(supMap.values()).sort((a, b) => b.count - a.count);
    const supsConProblemas = suppliers.filter(s => s.sinCosto > 0);
    const totalUrgencias = sinCosto.length + margenNeg.length;
    const pctConImagen = Math.round(((products.length - sinImagen.length) / products.length) * 100);

    return {
      total: products.length, sinCosto, sinPrecio, sinImagen,
      sinProveedor, margenNeg, margenBajo, margenNull,
      suppliers, supsConProblemas, totalUrgencias, pctConImagen,
    };
  }, []);
}

// ─────────────────────────────────────────────────────────────────────────────
// RESPONSE ENGINE — genera respuestas a partir de datos reales
// ─────────────────────────────────────────────────────────────────────────────

type Finding = { label: string; count?: number; href: string; urgent?: boolean; dimmed?: boolean };
type SocioMsg = {
  text: string;
  findings?: Finding[];
  tip?: string;
  followUp?: string[];
};

function buildResponse(query: string, d: ReturnType<typeof useDataAnalysis>): SocioMsg {
  const q = query.toLowerCase();

  // ── Modo setup (base vacía) ──
  if (d.total === 0) {
    if (/\b(inventario|producto|products|product\.template)\b/.test(q)) {
      return {
        text: `Para importar el inventario, exportá desde Odoo → Inventario → Productos y bajá el archivo Excel. La columna clave es "Nombre" — el sistema detecta automáticamente las demás.`,
        findings: [
          { label: 'Ir a Parámetros → Importar productos', href: '/parametros' },
        ],
        tip: `Exportá con todas las columnas activadas: incluye standard_price (costo), list_price (precio venta), seller_ids (proveedores). Son los datos que el Socio Acqua necesita para analizar.`,
        followUp: ['Importar listas de proveedores', 'Importar contactos', 'Ir a importar'],
      };
    }
    if (/\b(lista|listas|supplierinfo|product\.supplierinfo|proveedor|proveedores)\b/.test(q)) {
      return {
        text: `Para importar las listas de precios, exportá desde Odoo → Compras → Lista de precios del proveedor.`,
        findings: [
          { label: 'Ir a Parámetros → Importar listas de proveedor', href: '/parametros' },
        ],
        tip: `El archivo tiene columnas: partner_id (proveedor), product_tmpl_id, product_code, price, discount. El sistema agrupa automáticamente por proveedor — no hace falta separar por proveedor.`,
        followUp: ['Importar inventario primero', 'Importar contactos', 'Ir a importar'],
      };
    }
    if (/\b(contacto|contactos|res\.partner|directorio)\b/.test(q)) {
      return {
        text: `Para importar el directorio de proveedores, exportá desde Odoo → Contactos, filtrado por "Proveedor".`,
        findings: [
          { label: 'Ir a Parámetros → Importar contactos', href: '/parametros' },
        ],
        tip: `El archivo incluye: nombre, teléfono, category_id (tags del rubro) y condición fiscal AFIP. Eso es todo lo que necesitás para armar las fichas de proveedores.`,
        followUp: ['Importar inventario primero', 'Importar listas', 'Ir a importar'],
      };
    }
    if (/\b(stock|stok|cantidad|disponible)\b/.test(q)) {
      return {
        text: `El módulo de stock está disponible. Exportá desde Odoo → Inventario → Informe de stock y subí el Excel.`,
        findings: [
          { label: 'Ir a Parámetros → Importar stock', href: '/parametros' },
        ],
        tip: `Importá primero el inventario de productos — el stock se cruza con los productos por nombre o SKU. Sin productos cargados, el stock no puede vincularse.`,
        followUp: ['Importar inventario primero', 'Por dónde empiezo'],
      };
    }
    // Default en modo setup
    return {
      text: `La base está vacía. Para que pueda analizarte el negocio, necesito que cargués los datos desde Odoo. Te muestro el orden:`,
      findings: [
        { label: '1 — Inventario/Productos  (product.template)',         href: '/parametros', urgent: false },
        { label: '2 — Listas de proveedores  (product.supplierinfo)',    href: '/parametros', urgent: false },
        { label: '3 — Contactos/Proveedores  (res.partner)',             href: '/parametros', urgent: false },
        { label: '4 — Stock  (informe de stock de Odoo)',                href: '/parametros', urgent: false },
      ],
      tip: `Empezá por el inventario — es la base de todo. Una vez que tenés los productos cargados, el resto de los módulos cobra vida.`,
      followUp: ['Cómo exporto desde Odoo', 'Importar inventario', 'Importar listas de proveedores'],
    };
  }

  // ── Controlar / situación general ──
  if (/\b(controlar?|revisar?|situaci|c[oó]mo\s*estamos|general|resumen|todo|estado|hoy)\b/.test(q)) {
    return {
      text: `Dale, te doy el barrido completo de los ${d.total} productos:`,
      findings: [
        d.sinCosto.length    ? { label: `Sin costo cargado`,                   count: d.sinCosto.length,    href: '/costos?filter=noCost',       urgent: true  } : null,
        d.margenNeg.length   ? { label: `Margen negativo — vendés a pérdida`,  count: d.margenNeg.length,   href: '/rentabilidad?filter=negMargin', urgent: true } : null,
        d.sinPrecio.length   ? { label: `Sin precio de venta`,                  count: d.sinPrecio.length,   href: '/productos?filter=noPrice',   urgent: true  } : null,
        d.margenBajo.length  ? { label: `Margen bajo (menos del 30%)`,          count: d.margenBajo.length,  href: '/rentabilidad?filter=lowMargin'              } : null,
        d.sinImagen.length   ? { label: `Sin imagen de producto`,               count: d.sinImagen.length,   href: '/productos?filter=noImage'                   } : null,
        d.supsConProblemas.length ? { label: `Proveedores con productos sin costo`, count: d.supsConProblemas.length, href: '/proveedores?filter=issues' } : null,
      ].filter(Boolean) as Finding[],
      tip: d.totalUrgencias > 0
        ? `Arrancá por las urgencias — hay ${d.totalUrgencias} casos que afectan directamente el margen y lo que exportás a Odoo.`
        : `Todo bastante limpio. Fijate en los márgenes bajos antes de armar promos, que a veces se pasan por alto.`,
      followUp: ['Ver costos', 'Ver márgenes', 'Cuáles proveedores tienen problemas', 'Cómo reseteo la base'],
    };
  }

  // ── Costos ──
  if (/\b(costo|costos|coste)\b/.test(q)) {
    if (!d.sinCosto.length) return {
      text: `Todos los ${d.total} productos tienen costo cargado. Eso está perfecto — podés calcular margen y exportar tranquilo.`,
      followUp: ['Ver márgenes', 'Qué más revisar'],
    };
    return {
      text: `Tenés ${d.sinCosto.length} productos sin costo. Sin ese dato no podés calcular margen ni exportar bien a Odoo.`,
      findings: [
        { label: 'Sin costo cargado', count: d.sinCosto.length, href: '/costos?filter=noCost', urgent: true },
        ...d.supsConProblemas.slice(0, 4).map(s => ({
          label: `${s.name} — ${s.sinCosto} sin costo`,
          count: s.sinCosto,
          href: getSupplierHref(s.name, 'noCost'),
        })),
      ],
      tip: 'Lo más rápido: subí la lista del proveedor y actualizá masivamente. Acordate que cada proveedor tiene su propio formato de Excel.',
      followUp: ['Ver proveedores con problemas', 'Cómo importo la lista de un proveedor'],
    };
  }

  // ── Imágenes / fotos ──
  if (/\b(imagen|imágenes|imagenes|foto|fotos)\b/.test(q)) {
    return {
      text: `El ${d.pctConImagen}% del catálogo tiene imagen. Los restantes ${d.sinImagen.length} productos están sin foto.`,
      findings: [
        { label: `Sin imagen`, count: d.sinImagen.length, href: '/productos?filter=noImage' },
      ],
      tip: `Podés subir imágenes masivamente desde Odoo: exportás el Excel con la columna image_1920 y corrés el script de importación. Después del reset de base, cada subida reemplaza lo anterior — no se mezcla.`,
      followUp: ['Cómo hago el reset de base', 'Ver productos sin imagen'],
    };
  }

  // ── Margen / rentabilidad ──
  if (/\b(margen|márgenes|margenes|rentabilidad|ganancia|ganar)\b/.test(q)) {
    return {
      text: `Panorama de márgenes en los ${d.total} productos:`,
      findings: [
        d.margenNeg.length  ? { label: 'Margen negativo — cada venta pierde',         count: d.margenNeg.length,  href: '/rentabilidad?filter=negMargin', urgent: true } : null,
        d.margenBajo.length ? { label: 'Margen bajo (0–30%)',                           count: d.margenBajo.length, href: '/rentabilidad?filter=lowMargin'              } : null,
        d.margenNull.length ? { label: 'Sin margen calculado (falta costo)',            count: d.margenNull.length, href: '/costos?filter=noCost',          urgent: !!d.margenNeg.length } : null,
      ].filter(Boolean) as Finding[],
      tip: d.margenNeg.length
        ? `Los ${d.margenNeg.length} con margen negativo son los más urgentes — puede ser costo desactualizado o precio muy bajo. Revisalos antes de vender más.`
        : `Los márgenes bajos hay que vigilarlos antes de armar promos. Una promo sobre un producto de 15% de margen te puede hacer perder.`,
      followUp: ['Qué proveedores tienen productos con margen malo', 'Ver costos primero'],
    };
  }

  // ── Proveedores ──
  if (/\b(proveedor|proveedores|lista|listas|supplier)\b/.test(q)) {
    return {
      text: `Tenés ${d.suppliers.length} proveedores en el sistema. Los que más productos tienen:`,
      findings: d.suppliers.slice(0, 6).map(s => ({
        label: `${s.name} — ${s.count} productos${s.sinCosto > 0 ? `, ⚠️ ${s.sinCosto} sin costo` : ''}`,
        count: s.count,
        href:  getSupplierHref(s.name),
        urgent: s.sinCosto > 0,
      })),
      tip: `Para actualizar la lista de un proveedor: vas a Proveedores, lo seleccionás y subís el Excel. Ojo — cada proveedor tiene su propio formato de columnas, hay que mapearlas bien.`,
      followUp: ['Ver los que tienen problemas', 'Cómo importo una lista nueva'],
    };
  }

  // ── Exportar / Odoo ──
  if (/\b(export|exportar|odoo)\b/.test(q)) {
    const bloq = d.sinCosto.length + d.margenNeg.length;
    return {
      text: bloq > 0
        ? `Hay ${bloq} cosas que te van a dar problemas si exportás ahora:`
        : `No veo bloqueantes. Podés exportar a Odoo sin problema.`,
      findings: [
        d.sinCosto.length   ? { label: 'Sin costo — margen incorrecto en Odoo',       count: d.sinCosto.length,   href: '/costos?filter=noCost',         urgent: true } : null,
        d.margenNeg.length  ? { label: 'Margen negativo — precios mal calculados',     count: d.margenNeg.length,  href: '/rentabilidad?filter=negMargin', urgent: true } : null,
      ].filter(Boolean) as Finding[],
      tip: bloq > 0
        ? 'Si exportás con estos problemas, Odoo va a quedar con datos incorrectos. Resolvé primero los costos y márgenes negativos.'
        : 'Vas bien. Acordate de siempre revisar antes de exportar — es más fácil corregir acá que en Odoo.',
      followUp: ['Ir a Export Odoo', 'Ver costos pendientes'],
    };
  }

  // ── Exportar desde Odoo (setup guide) ──
  if (/\b(exporto|export[ao]r?\s+desde|odoo\s+export|como\s+export|qué\s+excel|que\s+excel)\b/.test(q)) {
    return {
      text: `Te explico qué exportar de Odoo para cada tipo de carga:`,
      findings: [
        { label: 'Inventario → Inventario → Productos (product.template)',                 href: '/parametros' },
        { label: 'Listas → Compras → Lista de precios del proveedor (product.supplierinfo)', href: '/parametros' },
        { label: 'Contactos → Contactos (filtrado por Proveedor) (res.partner)',           href: '/parametros' },
        { label: 'Stock → Inventario → Informe de stock actual',                          href: '/parametros' },
      ],
      tip: `En Odoo, usá siempre el botón "Exportar" (ícono de flecha en la lista) y elegí formato Excel (.xlsx). Asegurate de exportar con todas las columnas visibles — el sistema las detecta automáticamente.`,
      followUp: ['Ir a importar', 'Qué hago primero', 'Cómo reseteo la base'],
    };
  }

  // ── Reset / base / importar ──
  if (/\b(reset|resetear|limpiar|vaciar|base|importar|carga|cargar)\b/.test(q)) {
    return {
      text: `Para hacer el reset y re-importar todo limpio, el flujo es este:`,
      findings: [
        { label: 'Paso 1 — Ir a Parámetros → Gestión de datos → Reset total', href: '/parametros?tab=datos' },
        { label: 'Paso 2 — Exportar Excel completo desde Odoo', href: '/export-odoo' },
        { label: 'Paso 3 — Importar: solo lo que subís queda, el resto se borra', href: '/parametros?tab=datos' },
      ],
      tip: 'Después del reset, cada importación reemplaza todo — si un producto no está en el Excel que subís, no existe en el sistema. Así se mantiene la base limpia y sin basura.',
      followUp: ['Ver parámetros', 'Qué datos se pueden resetear'],
    };
  }

  // ── Sin foto / sin imagen ──
  if (/\b(sin foto|sin imagen|faltan imagen|faltan foto)\b/.test(q)) {
    return {
      text: `${d.sinImagen.length} productos sin imagen. Te los muestro filtrados:`,
      findings: [{ label: `Productos sin imagen`, count: d.sinImagen.length, href: '/productos?filter=noImage' }],
      tip: `Podés subir imágenes en masa desde Odoo exportando la columna image_1920. El script de importación las asigna automáticamente por ID.`,
      followUp: ['Cómo importo imágenes', 'Ver costos primero'],
    };
  }

  // ── Default ──
  return {
    text: `Puedo ayudarte a revisar cualquier área del negocio. ¿Qué querés ver?`,
    followUp: ['Controlar todo', 'Ver costos', 'Ver proveedores', 'Ver márgenes', 'Cómo reseteo la base'],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// QUICK CHIPS
// ─────────────────────────────────────────────────────────────────────────────

const QUICK = [
  { label: 'Controlar todo',           icon: Zap },
  { label: 'Ver costos',               icon: DollarSign },
  { label: 'Ver proveedores',          icon: Users },
  { label: 'Ver márgenes',             icon: TrendingDown },
  { label: 'Ver imágenes faltantes',   icon: Camera },
  { label: 'Cómo reseteo la base',     icon: RefreshCw },
];

const QUICK_SETUP = [
  { label: 'Por dónde empiezo',                 icon: Zap },
  { label: 'Importar inventario',               icon: Package },
  { label: 'Importar listas de proveedores',    icon: ListChecks },
  { label: 'Importar contactos',                icon: Users },
  { label: 'Cómo exporto desde Odoo',           icon: HardDrive },
];

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

type Msg = { role: 'user' | 'socio'; text: string; response?: SocioMsg };

export default function ConsultorPage() {
  const data      = useDataAnalysis();
  const isEmpty   = data.total === 0;
  const [msgs,    setMsgs]   = useState<Msg[]>([]);
  const [input,   setInput]  = useState('');
  const bottomRef             = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs]);

  const send = (query: string) => {
    if (!query.trim()) return;
    const response = buildResponse(query, data);
    setMsgs(prev => [
      ...prev,
      { role: 'user',  text: query },
      { role: 'socio', text: response.text, response },
    ]);
    setInput('');
  };

  // Chips de alerta (solo cuando hay datos)
  const urgencias = isEmpty ? [] : [
    data.sinCosto.length    && { label: `${data.sinCosto.length} sin costo`,        href: '/costos?filter=noCost',         color: 'bg-red-50 border-red-200 text-red-700',          dot: 'bg-red-500'    },
    data.margenNeg.length   && { label: `${data.margenNeg.length} margen negativo`, href: '/rentabilidad?filter=negMargin', color: 'bg-red-50 border-red-200 text-red-700',          dot: 'bg-red-500'    },
    data.sinPrecio.length   && { label: `${data.sinPrecio.length} sin precio`,      href: '/productos?filter=noPrice',      color: 'bg-orange-50 border-orange-200 text-orange-700', dot: 'bg-orange-500' },
    data.margenBajo.length  && { label: `${data.margenBajo.length} margen bajo`,    href: '/rentabilidad?filter=lowMargin', color: 'bg-yellow-50 border-yellow-200 text-yellow-700', dot: 'bg-yellow-500' },
    data.sinImagen.length   && { label: `${data.sinImagen.length} sin foto`,        href: '/productos?filter=noImage',      color: 'bg-gray-50 border-gray-200 text-gray-600',       dot: 'bg-gray-400'   },
  ].filter(Boolean) as { label: string; href: string; color: string; dot: string }[];

  const allOk = !isEmpty && urgencias.length === 0;

  // Estado del setup (cuántos pasos completados)
  const setupSteps = isEmpty ? [
    { done: false, label: 'Inventario/Productos',        detail: 'product.template'    },
    { done: false, label: 'Listas de proveedores',       detail: 'product.supplierinfo' },
    { done: contactCount > 0, label: 'Contactos',        detail: 'res.partner'         },
    { done: false, label: 'Stock',                       detail: 'informe de stock'    },
  ] : [];

  return (
    <div className="min-h-screen bg-[#F4F7FA] flex flex-col">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="bg-[#07111F] px-5 lg:px-8 py-5 shrink-0">
        <div className="max-w-4xl mx-auto flex items-center gap-4">
          <div className="w-11 h-11 rounded-full bg-[#0784F2]/20 border-2 border-[#0784F2]/40 flex items-center justify-center shrink-0">
            <span className="text-[#0784F2] font-black text-sm">SA</span>
          </div>
          <div>
            <p className="text-white/40 text-[11px] font-semibold uppercase tracking-widest">Tu socio de gestión</p>
            <h1 className="text-white font-bold text-xl leading-tight">Socio Acqua</h1>
            <p className="text-white/40 text-xs mt-0.5">Analiza datos reales · Habla directo · Te lleva al problema</p>
          </div>
          <div className="ml-auto text-right">
            <p className="text-white/30 text-[11px]">Base actual</p>
            <p className={cn('font-bold text-lg', isEmpty ? 'text-orange-400' : 'text-white')}>
              {isEmpty ? 'Vacía' : data.total.toLocaleString('es-AR')}
            </p>
            <p className="text-white/30 text-[10px]">{isEmpty ? 'sin datos' : 'productos'}</p>
          </div>
        </div>
      </div>

      {/* ── Barra de estado ────────────────────────────────────────────────── */}
      <div className={cn('border-b px-5 lg:px-8 py-3 shrink-0', isEmpty ? 'bg-orange-950/60 border-orange-800/30' : 'bg-white border-gray-100')}>
        <div className="max-w-4xl mx-auto">
          {isEmpty ? (
            /* Setup progress */
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-[11px] font-bold text-orange-300 uppercase tracking-wide mr-1">Configuración inicial:</span>
              {setupSteps.map((step, i) => (
                <Link key={i} href="/parametros"
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1 rounded-full border text-[12px] font-semibold transition-opacity hover:opacity-80',
                    step.done
                      ? 'bg-green-900/40 border-green-600/40 text-green-400'
                      : 'bg-orange-900/30 border-orange-500/30 text-orange-300',
                  )}>
                  {step.done
                    ? <CheckCircle2 className="w-3 h-3" />
                    : <span className="w-4 h-4 rounded-full border border-orange-400/60 text-[10px] flex items-center justify-center font-black">{i + 1}</span>}
                  {step.label}
                </Link>
              ))}
              <Link href="/parametros"
                className="ml-auto flex items-center gap-1 text-[11px] font-bold text-orange-300 hover:text-orange-200 transition-colors">
                <Upload className="w-3 h-3" /> Importar ahora
              </Link>
            </div>
          ) : (
            /* Alert chips (datos cargados) */
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mr-1">Alertas:</span>
              {allOk ? (
                <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-50 border border-green-200 text-green-700 text-[12px] font-semibold">
                  <CheckCircle2 className="w-3 h-3" /> Todo en orden
                </span>
              ) : (
                urgencias.map((u, i) => (
                  <Link key={i} href={u.href}
                    className={cn('flex items-center gap-1.5 px-3 py-1 rounded-full border text-[12px] font-semibold transition-opacity hover:opacity-80', u.color)}>
                    <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', u.dot)} />
                    {u.label}
                    <ChevronRight className="w-3 h-3" />
                  </Link>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Conversación ────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-5 lg:px-8 py-6">
        <div className="max-w-4xl mx-auto space-y-6">

          {/* Mensaje de bienvenida cuando no hay conversación */}
          {msgs.length === 0 && (
            <div className="flex gap-3">
              <div className="w-9 h-9 rounded-full bg-[#07111F] border-2 border-[#0784F2]/40 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-[#0784F2] font-black text-xs">SA</span>
              </div>
              <div className="flex-1">
                {isEmpty ? (
                  /* ── Modo setup: base vacía ── */
                  <>
                    <div className="bg-white rounded-2xl rounded-tl-none border border-gray-100 p-5 shadow-sm max-w-2xl">
                      <p className="text-[15px] font-semibold text-gray-900 mb-1">Buenas, Enrico.</p>
                      <p className="text-sm text-gray-600 leading-relaxed mb-4">
                        La base está vacía — todavía no tengo datos para analizar.
                        Para que el Socio Acqua funcione necesitás cargar los datos desde Odoo.
                        Te guío en el orden correcto:
                      </p>
                      <div className="space-y-2.5">
                        {[
                          { n: 1, done: false, title: 'Inventario / Productos',       sub: 'Odoo → Inventario → Productos → Exportar', path: 'product.template' },
                          { n: 2, done: false, title: 'Listas de proveedores',        sub: 'Odoo → Compras → Lista de precios del proveedor → Exportar', path: 'product.supplierinfo' },
                          { n: 3, done: contactCount > 0, title: 'Contactos / Proveedores', sub: 'Odoo → Contactos → Exportar', path: 'res.partner' },
                          { n: 4, done: false, title: 'Stock',                        sub: 'Odoo → Inventario → Informe de stock → Exportar', path: 'stock' },
                        ].map(step => (
                          <div key={step.n} className={cn(
                            'flex items-center gap-3 p-3 rounded-xl border',
                            step.done ? 'bg-green-50 border-green-100' : 'bg-gray-50 border-gray-100',
                          )}>
                            <div className={cn(
                              'w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-black shrink-0',
                              step.done ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-500',
                            )}>
                              {step.done ? <CheckCircle2 className="w-4 h-4" /> : step.n}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={cn('text-[13px] font-bold', step.done ? 'text-green-700' : 'text-gray-800')}>{step.title}</p>
                              <p className="text-[10px] text-gray-400 truncate">{step.sub}</p>
                            </div>
                            {!step.done && (
                              <Link href="/parametros"
                                className="flex items-center gap-1 px-2.5 py-1 bg-[#0784F2] text-white text-[11px] font-bold rounded-lg hover:bg-[#0660c4] transition-colors shrink-0">
                                <Upload className="w-3 h-3" /> Importar
                              </Link>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-3">
                      {QUICK_SETUP.map(({ label, icon: Icon }) => (
                        <button key={label} onClick={() => send(label)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-gray-200 text-[12px] font-medium text-gray-600 hover:bg-[#0784F2]/5 hover:border-[#0784F2]/30 hover:text-[#0784F2] transition-all shadow-sm">
                          <Icon className="w-3 h-3" />
                          {label}
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  /* ── Modo normal: hay datos ── */
                  <>
                    <div className="bg-white rounded-2xl rounded-tl-none border border-gray-100 p-5 shadow-sm max-w-2xl">
                      <p className="text-[15px] font-semibold text-gray-900 mb-1">Buenas, Enrico.</p>
                      <p className="text-sm text-gray-600 leading-relaxed">
                        Estoy mirando la base — tenés{' '}
                        <span className="font-bold text-gray-900">{data.total} productos</span>.{' '}
                        {data.totalUrgencias > 0 ? (
                          <>Hay <span className="font-bold text-red-600">{data.totalUrgencias} urgencias</span> que conviene resolver antes de exportar a Odoo.</>
                        ) : (
                          <>No veo urgencias críticas. Podés revisar los detalles cuando quieras.</>
                        )}
                      </p>
                      <p className="text-sm text-gray-500 mt-3">
                        Preguntame lo que necesites — uso datos reales del sistema, no invento nada.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-3">
                      {QUICK.map(({ label, icon: Icon }) => (
                        <button key={label} onClick={() => send(label)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-gray-200 text-[12px] font-medium text-gray-600 hover:bg-[#0784F2]/5 hover:border-[#0784F2]/30 hover:text-[#0784F2] transition-all shadow-sm">
                          <Icon className="w-3 h-3" />
                          {label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Mensajes */}
          {msgs.map((msg, i) => (
            <div key={i}>
              {msg.role === 'user' ? (
                <div className="flex justify-end">
                  <div className="bg-[#07111F] text-white rounded-2xl rounded-tr-none px-5 py-3 max-w-lg text-sm font-medium shadow-sm">
                    {msg.text}
                  </div>
                </div>
              ) : (
                <div className="flex gap-3">
                  <div className="w-9 h-9 rounded-full bg-[#07111F] border-2 border-[#0784F2]/40 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-[#0784F2] font-black text-xs">SA</span>
                  </div>
                  <div className="flex-1 max-w-2xl">
                    <div className="bg-white rounded-2xl rounded-tl-none border border-gray-100 p-5 shadow-sm">
                      {/* Texto principal */}
                      <p className="text-[14px] text-gray-800 font-medium mb-4 leading-relaxed">{msg.text}</p>

                      {/* Findings / alertas clicables */}
                      {msg.response?.findings && msg.response.findings.length > 0 && (
                        <div className="space-y-2 mb-4">
                          {msg.response.findings.map((f, j) => (
                            <Link
                              key={j}
                              href={f.href}
                              className={cn(
                                'flex items-center justify-between gap-3 px-4 py-3 rounded-xl border transition-all hover:shadow-sm group',
                                f.urgent
                                  ? 'bg-red-50 border-red-100 hover:border-red-300'
                                  : 'bg-gray-50 border-gray-100 hover:border-[#0784F2]/30 hover:bg-[#0784F2]/3',
                              )}
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                {f.urgent && <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />}
                                <span className={cn(
                                  'text-[13px] font-semibold truncate',
                                  f.urgent ? 'text-red-700' : 'text-gray-700',
                                )}>
                                  {f.label}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {f.count !== undefined && f.count > 0 && (
                                  <span className={cn(
                                    'text-[12px] font-black px-2.5 py-0.5 rounded-lg',
                                    f.urgent ? 'bg-red-100 text-red-700' : 'bg-gray-200 text-gray-700',
                                  )}>
                                    {f.count.toLocaleString('es-AR')}
                                  </span>
                                )}
                                <span className={cn(
                                  'text-[11px] font-semibold flex items-center gap-0.5 transition-colors',
                                  f.urgent ? 'text-red-400 group-hover:text-red-600' : 'text-gray-400 group-hover:text-[#0784F2]',
                                )}>
                                  Ver <ArrowRight className="w-3 h-3" />
                                </span>
                              </div>
                            </Link>
                          ))}
                        </div>
                      )}

                      {/* Tip / recomendación */}
                      {msg.response?.tip && (
                        <div className="flex gap-2 bg-[#0784F2]/5 border border-[#0784F2]/15 rounded-xl px-4 py-3 mb-4">
                          <Lightbulb className="w-4 h-4 text-[#0784F2] shrink-0 mt-0.5" />
                          <p className="text-[12px] text-gray-700 leading-relaxed">{msg.response.tip}</p>
                        </div>
                      )}

                      {/* Follow-up chips */}
                      {msg.response?.followUp && msg.response.followUp.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {msg.response.followUp.map((fq, j) => (
                            <button
                              key={j}
                              onClick={() => send(fq)}
                              className="px-3 py-1.5 rounded-lg bg-gray-50 border border-gray-200 text-[11px] font-semibold text-gray-600 hover:bg-[#0784F2]/5 hover:border-[#0784F2]/30 hover:text-[#0784F2] transition-all"
                            >
                              {fq}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* ── Input ───────────────────────────────────────────────────────────── */}
      <div className="bg-white border-t border-gray-100 px-5 lg:px-8 py-4 shrink-0">
        <div className="max-w-4xl mx-auto">
          {/* Quick chips si ya hay conversación */}
          {msgs.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {(isEmpty ? QUICK_SETUP : QUICK).slice(0, 4).map(({ label }) => (
                <button key={label} onClick={() => send(label)}
                  className="px-2.5 py-1 rounded-lg bg-gray-50 border border-gray-200 text-[11px] font-medium text-gray-500 hover:bg-[#0784F2]/5 hover:border-[#0784F2]/30 hover:text-[#0784F2] transition-all">
                  {label}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 bg-[#F4F7FA] rounded-xl border border-gray-200 px-4 py-2 focus-within:ring-2 focus-within:ring-[#0784F2]/20 focus-within:border-[#0784F2] transition-all">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && send(input)}
              placeholder="Preguntame lo que necesites — revisar costos, ver proveedores, controlar margen..."
              className="flex-1 py-2 text-sm bg-transparent focus:outline-none text-gray-800 placeholder:text-gray-400"
            />
            <button
              onClick={() => send(input)}
              disabled={!input.trim()}
              className="w-9 h-9 rounded-lg bg-[#0784F2] text-white flex items-center justify-center hover:bg-[#0660c4] disabled:opacity-30 transition-colors shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          <p className="text-[10px] text-gray-400 text-center mt-2">
            Socio Acqua lee datos reales de tu sistema — no inventa números
          </p>
        </div>
      </div>

    </div>
  );
}
