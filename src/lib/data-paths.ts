/**
 * Centralized data file paths.
 *
 * On Railway: set DATA_DIR=/data (mounted persistent volume)
 * Locally:    DATA_DIR is unset → defaults to <cwd>/src/data
 */
import { resolve } from 'path';

const DATA_DIR = process.env.DATA_DIR ?? resolve(process.cwd(), 'src/data');

export function dataPath(filename: string): string {
  return resolve(DATA_DIR, filename);
}

export const PRODUCTS_PATH         = dataPath('products.json');
export const SETTINGS_PATH         = dataPath('settings.json');
export const HISTORY_PATH          = dataPath('change-history.json');
export const STOCK_PATH            = dataPath('stock.json');
export const PARAMS_PATH           = dataPath('params.json');
export const SUPPLIERS_PATH        = dataPath('suppliers.json');
export const ML_LAB_PATH           = dataPath('ml-lab.json');
export const ACTION_LOG_PATH       = dataPath('action-log.jsonl');
export const COMPETITOR_LINKS_PATH = dataPath('competitor-links.json');
export const SEIQ_CATALOG_PATH     = dataPath('seiq-catalog.json');
export const ODOO_SUPPLIERINFO_PATH = dataPath('odoo-supplierinfo.json');
