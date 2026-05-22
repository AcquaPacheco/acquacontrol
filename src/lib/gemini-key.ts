'use client';

// ── Gemini key — guardada en settings.json (servidor) ─────────────────────────
// Las funciones sync son legacy/fallback. Usar las async cuando sea posible.

const LS_KEY = 'acqua_ai_cfg';

// ── Async (servidor) ──────────────────────────────────────────────────────────

/** Lee la key desde el servidor (settings.json). */
export async function loadGeminiKeyAsync(): Promise<string> {
  try {
    const res = await fetch('/api/settings');
    if (!res.ok) return loadGeminiKey(); // fallback localStorage
    const data = await res.json() as { geminiKey?: string };
    return data.geminiKey ?? loadGeminiKey();
  } catch {
    return loadGeminiKey(); // fallback localStorage
  }
}

/** Guarda la key en el servidor Y en localStorage como backup. */
export async function saveGeminiKeyAsync(key: string): Promise<void> {
  saveGeminiKey(key); // guardar local inmediatamente (UX rápida)
  try {
    await fetch('/api/settings', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ geminiKey: key }),
    });
  } catch { /* no bloquear si falla el server */ }
}

// ── Sync legacy (localStorage) — mantener para compatibilidad ─────────────────

/** Guarda la key con obfuscación básica (base64). */
export function saveGeminiKey(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LS_KEY, btoa(unescape(encodeURIComponent(key))));
  } catch { /* quota */ }
}

/** Lee la key del localStorage. Devuelve '' si no hay ninguna. */
export function loadGeminiKey(): string {
  if (typeof window === 'undefined') return '';
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return '';
    return decodeURIComponent(escape(atob(raw)));
  } catch { return ''; }
}

/** Elimina la key guardada (localStorage + servidor). */
export function clearGeminiKey(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(LS_KEY);
  fetch('/api/settings', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ geminiKey: '' }),
  }).catch(() => {});
}
