// ─────────────────────────────────────────────────────────────────────────────
// ML LAB — Tipos centrales del espejo maestro
// ─────────────────────────────────────────────────────────────────────────────

// ─── Estados de sincronización ───────────────────────────────────────────────
export type MLSyncStatus =
  | 'sincronizado'        // Odoo rule + ML publication matched with confidence ≥ 80
  | 'match_dudoso'        // Matched but confidence 50–79
  | 'sin_publicacion'     // Odoo rule exists, no ML publication found
  | 'sin_regla_odoo'      // ML publication exists, no Odoo rule
  | 'duplicado'           // Multiple ML matches found for same Odoo product
  | 'sin_costo'           // No cost data available
  | 'sin_stock'           // Stock = 0
  | 'precio_desalineado'  // Calculated price differs from ML price > 15%
  | 'error_datos';        // Missing critical data

// ─── Regla de precio Odoo para ML ────────────────────────────────────────────
export interface OdooMLRule {
  productTemplateId?: number;
  sku?: string;
  barcode?: string;
  name: string;
  markup: number;            // % markup sobre el costo (ej: 50 = 50% sobre costo)
  computedPrice?: number;   // precio calculado por la regla (si viene en el archivo)
  category?: string;
  raw: Record<string, unknown>;
}

// ─── Publicación real de MercadoLibre ────────────────────────────────────────
export interface MLPublication {
  mlItemId: string;           // MLA-XXXXXXXXXX
  title: string;
  price: number;
  status: string;             // 'active' | 'paused' | 'closed' | etc
  stock: number;
  sold: number;
  visits?: number;
  freeShipping: boolean;
  hasInstallments: boolean;
  isFull: boolean;
  listingType?: string;
  permalink?: string;
  sku?: string;               // referencia interna del vendedor
  condition?: string;
  thumbnail?: string;
  raw: Record<string, unknown>;
}

// ─── Parámetros de cálculo (globales o por-producto) ─────────────────────────
export interface MLProductParams {
  commission: number;        // % comisión ML por venta (default: 14)
  fixedFee: number;          // cargo fijo ML por unidad ($, default: 0)
  shippingCost: number;      // costo de envío si ofrezco gratis ($)
  iibb: number;              // Ingresos Brutos % (default: 3.5)
  installmentsCost: number;  // costo de cuotas sin interés % (default: 0)
  advertising: number;       // % publicidad ML Ads (default: 0)
  otherCosts: number;        // otros costos fijos por unidad ($)
  minMargin: number;         // margen mínimo aceptable % (default: 25)
  idealMargin: number;       // margen objetivo % (default: 35)
  roundTo: number;           // redondeo de precio a múltiplo de (default: 10)
  isRI: boolean;             // Responsable Inscripto → descuenta IVA del depósito
}

export const DEFAULT_ML_PARAMS: MLProductParams = {
  commission: 14,
  fixedFee: 0,
  shippingCost: 0,
  iibb: 3.5,
  installmentsCost: 0,
  advertising: 0,
  otherCosts: 0,
  minMargin: 25,
  idealMargin: 35,
  roundTo: 10,
  isRI: true,
};

// ─── Resultado del cálculo de rentabilidad ───────────────────────────────────
export interface MLCalcResult {
  price: number;              // precio publicado en ML
  commission: number;         // comisión ML ($)
  fixedFee: number;           // cargo fijo ($)
  shippingCost: number;       // costo envío ($)
  installmentsCost: number;   // costo cuotas ($)
  advertisingCost: number;    // costo publicidad ($)
  depositML: number;          // lo que deposita ML
  ivaDiscounted: number;      // IVA que se descuenta (si RI)
  revenueBeforeTax: number;   // ingreso antes de IIBB (sin IVA)
  iibbCost: number;           // Ingresos Brutos ($)
  otherCosts: number;         // otros costos ($)
  netRevenue: number;         // ingreso neto limpio
  cost: number;               // costo del producto
  grossProfit: number;        // utilidad bruta
  netProfit: number;          // utilidad neta (= netRevenue - cost)
  netMargin: number;          // margen neto % (sobre netRevenue)
  markup: number;             // markup sobre costo para llegar a ese precio (para Odoo)
  odooListMarkup: number;     // Lista Markup en Odoo (precio sin IVA)
  status: 'rentable' | 'bajo_margen' | 'pierde';
}

// ─── Alerta ──────────────────────────────────────────────────────────────────
export interface MLAlert {
  type: 'danger' | 'warning' | 'info' | 'success';
  code: string;
  message: string;
  priority: number;           // 1 = highest
}

// ─── Escenario ───────────────────────────────────────────────────────────────
export type ScenarioKey =
  | 'actual' | 'envio_gratis' | 'cuotas_6x' | 'envio_cuotas'
  | 'pack_x2' | 'pack_x3' | 'precio_agresivo' | 'precio_rentable'
  | 'precio_premium' | 'promocion_5pct';

export interface MLScenario {
  key: ScenarioKey;
  label: string;
  description: string;
  calc: MLCalcResult | null;
  recommendedMarkup: number | null;
  vsActualMargin: number | null;  // difference vs current margin
  competitiveness: 'alta' | 'media' | 'baja';
  risk: 'alto' | 'medio' | 'bajo';
  recommended: boolean;
}

// ─── Reporte del Consultor ────────────────────────────────────────────────────
export interface MLConsultantReport {
  diagnosis: string;
  marketSituation: string;
  publicationProblem: string;
  conditionAdvice: string;
  recommendedPrice: number;
  recommendedMarkup: number;
  estimatedMargin: number;
  risk: string;
  riskLevel: 'alto' | 'medio' | 'bajo';
  trialAction: string;
  whatToMeasure: string;
  strategy: 'mantener' | 'subir_markup' | 'bajar_markup' | 'activar_cuotas'
    | 'activar_envio_gratis' | 'pack' | 'pausar' | 'mejorar_publicacion';
  strategyLabel: string;
  overallScore: number;  // 0-100 health score
}

// ─── Producto maestro del ML Lab ─────────────────────────────────────────────
export interface MLLabProduct {
  id: string;

  // ── Odoo / Inventario ────────────────────────────────────────────
  odooId?: number;
  sku?: string;
  barcode?: string;
  name: string;
  cost: number;
  markup: number;            // markup Odoo actual (%)
  odooPrice: number;         // precio calculado por markup (sin IVA)
  odooListML: number;        // Lista ML = odooPrice × 1.21 (precio con IVA)
  stock: number;
  category?: string;
  supplier?: string;
  image?: string;

  // ── MercadoLibre ─────────────────────────────────────────────────
  mlItemId?: string;
  mlTitle?: string;
  mlPrice?: number;
  mlStatus?: string;
  mlStock?: number;
  mlSold?: number;
  mlVisits?: number;
  mlFreeShipping?: boolean;
  mlHasInstallments?: boolean;
  mlIsFull?: boolean;
  mlListingType?: string;
  mlPermalink?: string;
  mlCondition?: string;
  mlThumbnail?: string;

  // ── Sincronización ───────────────────────────────────────────────
  syncStatus: MLSyncStatus;
  matchConfidence: number;   // 0-100
  matchMethod?: string;      // 'sku' | 'barcode' | 'nombre' | 'id'

  // ── Configuración por producto (override de globales) ────────────
  params?: Partial<MLProductParams>;

  // ── Rentabilidad calculada ────────────────────────────────────────
  calc?: MLCalcResult;       // cálculo con precio ML actual
  calcIdeal?: MLCalcResult;  // cálculo apuntando al margen ideal

  // ── Alertas ──────────────────────────────────────────────────────
  alerts: MLAlert[];

  // ── Meta ─────────────────────────────────────────────────────────
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Estado global del store ─────────────────────────────────────────────────
export interface MLLabState {
  products: MLLabProduct[];
  globalParams: MLProductParams;
  lastImportAt?: string;
  odooFileName?: string;
  mlFileName?: string;
  version: number;  // for future migrations
}
