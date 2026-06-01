import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { SETTINGS_PATH } from '@/lib/data-paths';

// ─── OAuth endpoints de MercadoLibre Argentina ───────────────────────────────
const ML_TOKEN_URL = 'https://api.mercadolibre.com/oauth/token';
const ML_AUTH_URL  = 'https://auth.mercadolibre.com.ar/authorization';

type Settings = Record<string, unknown>;

function readSettings(): Settings {
  try {
    if (!existsSync(SETTINGS_PATH)) return {};
    return JSON.parse(readFileSync(SETTINGS_PATH, 'utf8')) as Settings;
  } catch { return {}; }
}

function saveSettings(updates: Settings): void {
  const current = readSettings();
  writeFileSync(SETTINGS_PATH, JSON.stringify({ ...current, ...updates }, null, 2), 'utf8');
}

/**
 * GET /api/ml-oauth?action=status   → estado de conexión
 * GET /api/ml-oauth?action=url      → URL de autorización ML (para redirigir desde el browser)
 * GET /api/ml-oauth?action=callback → intercambia code por tokens (redirige a /mercadolibre)
 */
export async function GET(req: NextRequest) {
  const action   = req.nextUrl.searchParams.get('action') ?? '';
  const settings = readSettings();

  // ── Status ────────────────────────────────────────────────────────────────
  if (action === 'status') {
    const connected = !!(settings.mlAccessToken && settings.mlRefreshToken);
    const expired   = connected && typeof settings.mlTokenExpiry === 'number'
      ? Date.now() > (settings.mlTokenExpiry as number)
      : false;
    return NextResponse.json({
      connected,
      expired,
      userId:   settings.mlUserId,
      nickname: settings.mlNickname ?? '',
      expiresAt: settings.mlTokenExpiry,
    });
  }

  // ── Build authorization URL ───────────────────────────────────────────────
  if (action === 'url') {
    const appId = (settings.mlAppId as string | undefined) ?? '';
    if (!appId) {
      return NextResponse.json(
        { ok: false, error: 'Configurá el ML App ID en Parámetros globales primero' },
        { status: 400 },
      );
    }
    const redirectUri = `${req.nextUrl.origin}/api/ml-oauth?action=callback`;
    const authUrl = `${ML_AUTH_URL}?response_type=code&client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}`;
    return NextResponse.json({ ok: true, url: authUrl, redirectUri });
  }

  // ── OAuth callback (ML redirige acá con ?code=XXX) ────────────────────────
  if (action === 'callback') {
    const code  = req.nextUrl.searchParams.get('code');
    const error = req.nextUrl.searchParams.get('error');
    const base  = req.nextUrl.origin;

    if (error || !code) {
      return NextResponse.redirect(
        `${base}/mercadolibre?ml_auth=error&reason=${encodeURIComponent(error ?? 'no_code')}`,
      );
    }

    const appId     = (settings.mlAppId     as string | undefined) ?? '';
    const appSecret = (settings.mlAppSecret as string | undefined) ?? '';
    if (!appId || !appSecret) {
      return NextResponse.redirect(`${base}/mercadolibre?ml_auth=error&reason=no_credentials`);
    }

    const redirectUri = `${base}/api/ml-oauth?action=callback`;

    try {
      const res = await fetch(ML_TOKEN_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body:    new URLSearchParams({
          grant_type:    'authorization_code',
          client_id:     appId,
          client_secret: appSecret,
          code,
          redirect_uri:  redirectUri,
        }).toString(),
        cache: 'no-store',
      });

      if (!res.ok) {
        const err = await res.text().catch(() => res.statusText);
        console.error('[ml-oauth] token exchange error:', res.status, err);
        return NextResponse.redirect(`${base}/mercadolibre?ml_auth=error&reason=token_exchange`);
      }

      const tok = await res.json() as {
        access_token: string; refresh_token: string; expires_in: number; user_id: number;
      };

      // Fetch nickname
      let nickname = '';
      try {
        const u = await fetch(`https://api.mercadolibre.com/users/${tok.user_id}`, {
          headers: { Authorization: `Bearer ${tok.access_token}` },
        });
        if (u.ok) nickname = ((await u.json()) as { nickname?: string }).nickname ?? '';
      } catch { /* ignore */ }

      saveSettings({
        mlAccessToken:  tok.access_token,
        mlRefreshToken: tok.refresh_token,
        mlTokenExpiry:  Date.now() + tok.expires_in * 1000,
        mlUserId:       tok.user_id,
        mlNickname:     nickname,
      });

      return NextResponse.redirect(
        `${base}/mercadolibre?ml_auth=ok&user=${encodeURIComponent(nickname)}`,
      );
    } catch (e) {
      console.error('[ml-oauth] callback fatal:', e);
      return NextResponse.redirect(`${base}/mercadolibre?ml_auth=error&reason=unknown`);
    }
  }

  return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
}

/**
 * POST /api/ml-oauth?action=disconnect → borra tokens
 */
export async function POST(req: NextRequest) {
  const action = req.nextUrl.searchParams.get('action') ?? '';

  if (action === 'disconnect') {
    saveSettings({
      mlAccessToken:  '',
      mlRefreshToken: '',
      mlTokenExpiry:  0,
      mlUserId:       null,
      mlNickname:     '',
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
}
