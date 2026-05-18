'use client';

const STORAGE_KEY = 'acqua_ai_cfg';

/** Guarda la key con obfuscación básica (base64). */
export function saveGeminiKey(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, btoa(unescape(encodeURIComponent(key))));
  } catch { /* quota */ }
}

/** Lee la key del localStorage. Devuelve '' si no hay ninguna. */
export function loadGeminiKey(): string {
  if (typeof window === 'undefined') return '';
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return '';
    return decodeURIComponent(escape(atob(raw)));
  } catch { return ''; }
}

/** Elimina la key guardada. */
export function clearGeminiKey(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}
