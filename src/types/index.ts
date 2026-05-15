// ============================================================
// ACQUA CONTROL OS — Core Types
// ============================================================

// --- Enums & Literals ---

export type SupplierStatus =
  | 'actualizado'
  | 'lista_cargada'
  | 'cambios_detectados'
  | 'falta_actualizar'
  | 'falta_supplierinfo'
  | 'falta_producto_odoo'
  | 'lista_vencida'
  | 'revisar_errores'
  | 'pendiente'
  | 'atencion';

export type CostStatus =
  | 'sin_cambios'
  | 'aumento_leve'
  | 'aumento_fuerte'
  | 'baja_costo'
  | 'oportunidad'
  | 'critico'
  | 'revisar_precio'
  | 'no_encontrado'
  | 'nuevo'
  | 'conflicto'
  | 'editado_manual'
  | 'aprobado'
  | 'excluido'
  | 'esperar';

export type ProductStatus =
  | 'activo'
  | 'pendiente'
  | 'sin_stock'
  | 'stock_bajo'
  | 'rentable'
  | 'critico'
  | 'revisar'
  | 'archivado'
  | 'nuevo';

export type ExportStatus =
  | 'pendiente'
  | 'listo'
  | 'exportado'
  | 'error'
  | 'alerta';

export type TaskStatus =
  | 'pendiente'
  | 'en_revision'
  | 'esperando_proveedor'
  | 'listo_odoo'
  | 'exportado'
  | 'hecho'
  | 'descartado';

export type TaskPriority = 'alta' | 'media' | 'baja';

export type NotificationStatus =
  | 'nueva'
  | 'vista'
  | 'pospuesta'
  | 'convertida'
  | 'ignorada'
  | 'resuelta'
  | 'vencida';

export type MatchConfidence = 'alta' | 'media' | 'baja' | 'sin_match';

export type Currency = 'ARS' | 'USD';

export type PaymentMethod =
  | 'efectivo'
  | 'transferencia'
  | 'debito_nave'
  | 'credito_nave'
  | 'qr_nave'
  | 'mercadopago'
  | 'mercadolibre';

export type PriceList = 'A' | 'B' | 'C' | 'profesional' | 'consorcio' | 'mercadolibre' | 'mayorista';

// --- Core Entities ---

export interface SupplierProduct {
  si_id: string;           // supplierinfo ID en Odoo (ej: "17527")
  tmpl_id: string | null;  // product.template ID en Odoo (ej: "1257")
  tmpl_name: string;       // Nombre del producto en Odoo
  sup_name: string | null; // Nombre que usa el proveedor
  code: string;            // Código del proveedor
  min_qty: number;
  price: number;           // Precio base s/IVA
  discount: number;        // % descuento
  net_price: number;       // price * (1 - discount/100)
  status?: 'en_sistema' | 'no_figura' | 'sin_costo' | 'nuevo';
  updated_at?: string;
}

export interface Supplier {
  id: string;              // slug (ej: "vulcano-s-a")
  name: string;            // Nombre Odoo exacto
  odooName?: string;
  odooId?: string;
  externalId?: string;
  cuit?: string;
  logo?: string;
  headerColor?: string;    // CSS gradient class para la card
  rubro: string;           // Rubro comercial
  contact?: string;
  whatsapp?: string;
  email?: string;
  seller?: string;
  fiscalCondition?: string;
  currency: Currency;
  dollarRate?: number;
  discount1?: number;
  discount2?: number;
  discount3?: number;
  equivalentDiscount?: number;
  appliesToIVA: boolean;
  invoices: boolean;
  paymentMethod?: string;
  paymentDays?: number;
  minOrder?: number;
  freight?: string;
  deliveryDays?: number;
  notes?: string;
  status: SupplierStatus;
  lastListDate?: string;
  productCount: number;
  avgMargin?: number;
  pendingProducts?: number;
  alertProducts?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: string;
  odooId?: string;
  name: string;
  sku?: string;
  barcode?: string;
  supplierCode?: string;
  supplierId: string;
  supplierName: string;
  altSupplierIds?: string[];
  category: string;
  tags?: string[];
  image?: string;
  brand?: string;
  presentation?: string;
  unitOfMeasure?: string;
  bulkPack?: number;
  costOdoo: number;
  priceOdoo: number;
  costNew?: number;
  costFinal?: number;
  costApproved?: number;
  priceListA?: number;
  priceListB?: number;
  priceListC?: number;
  priceProfessional?: number;
  priceConsorcio?: number;
  priceSuggested?: number;
  priceApproved?: number;
  margin: number;
  utility: number;
  markup: number;
  stockCurrent: number;
  stockMin?: number;
  stockMax?: number;
  reorderPoint?: number;
  activeInOdoo: boolean;
  sellable: boolean;
  availablePOS: boolean;
  availableOnline: boolean;
  publishedML: boolean;
  aptoProfessional: boolean;
  aptoMayorista: 'apto' | 'revisar' | 'no_apto';
  status: ProductStatus;
  exportStatus: ExportStatus;
  costStatus?: CostStatus;
  errors?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SupplierList {
  id: string;
  supplierId: string;
  supplierName: string;
  fileName: string;
  uploadDate: string;
  status: 'recibida' | 'procesada' | 'activa' | 'reemplazada' | 'error';
  itemCount: number;
  matchedCount: number;
  newCount: number;
  errorCount: number;
  items: SupplierListItem[];
}

export interface SupplierListItem {
  id: string;
  listId: string;
  code?: string;
  name: string;
  price: number;
  currency: Currency;
  unit?: string;
  bulk?: number;
  discount?: number;
  matchedProductId?: string;
  matchConfidence: MatchConfidence;
  status: 'vinculado' | 'nuevo' | 'posible_match' | 'duplicado' | 'excluido' | 'pendiente' | 'aprobado';
}

export interface CostUpdate {
  id: string;
  productId: string;
  productName: string;
  supplierId: string;
  supplierName: string;
  costOdoo: number;
  costNew: number;
  costFinal: number;
  variation: number;
  variationPercent: number;
  marginImpact: number;
  status: CostStatus;
  suggestion: string;
  approvedAt?: string;
  createdAt: string;
}

export interface PricingDecision {
  id: string;
  productId: string;
  productName: string;
  costFinal: number;
  priceListA: number;
  priceListB: number;
  priceListC: number;
  priceProfessional: number;
  priceConsorcio: number;
  margin: number;
  utility: number;
  markup: number;
  status: 'pendiente' | 'aprobado' | 'rechazado' | 'exportado';
  recommendation: string;
  createdAt: string;
}

export interface OdooExportRecord {
  id: string;
  type: 'product' | 'supplierinfo';
  odooId: string;
  name: string;
  standardPrice?: number;
  listPrice?: number;
  partnerId?: string;
  productName?: string;
  productCode?: string;
  minQty?: number;
  price?: number;
  discount?: number;
  status: ExportStatus;
  errors?: string[];
}

export interface MercadoLibreListing {
  id: string;
  itemId?: string;
  familyId?: string;
  productNumber?: string;
  variationId?: string;
  sku?: string;
  title: string;
  variations?: string;
  quantity: number;
  price: number;
  vat?: number;
  currencyId: string;
  condition?: string;
  description?: string;
  shippingMethod?: string;
  status: 'active' | 'paused' | 'closed' | 'under_review';
  category?: string;
  feePerSale?: number;
  listingType?: string;
  financingCost?: number;
  productId?: string;
  costAcqua?: number;
  marginReal?: number;
  netReceived?: number;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  priority: TaskPriority;
  status: TaskStatus;
  module?: string;
  productId?: string;
  supplierId?: string;
  dueDate?: string;
  createdAt: string;
  completedAt?: string;
}

export interface Notification {
  id: string;
  title: string;
  description: string;
  dataDuro?: string;
  interpretation?: string;
  suggestedAction?: string;
  priority: TaskPriority;
  module: string;
  productId?: string;
  supplierId?: string;
  status: NotificationStatus;
  createdAt: string;
  expiresAt?: string;
}

export interface HistoryEvent {
  id: string;
  type: string;
  description: string;
  module: string;
  productId?: string;
  supplierId?: string;
  oldValue?: string;
  newValue?: string;
  createdAt: string;
  userId?: string;
}

export interface AppParameters {
  dollarBNA: number;
  dollarOperative: number;
  ivaCompra: number;
  ivaVenta: number;
  iibb: number;
  listBDiscount: number;
  listCDiscount: number;
  professionalDiscount: number;
  consorcioMarkup: number;
  roundingTarget: number;
  marginMin: number;
  marginTarget: number;
}

// --- Dashboard ---

export interface DashboardMetric {
  label: string;
  value: string | number;
  change?: number;
  changeLabel?: string;
  icon: string;
  color: string;
  href?: string;
}

export interface DailyRecommendation {
  id: string;
  title: string;
  dataDuro: string;
  interpretation: string;
  suggestedAction: string;
  priority: TaskPriority;
  module: string;
  productId?: string;
  supplierId?: string;
}
