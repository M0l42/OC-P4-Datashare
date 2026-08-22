import { API_BASE } from './api'

export interface DownloadMetadata {
  originalName: string
  sizeBytes: number
  mimeType: string
  expiresAt: string
  passwordRequired: boolean
  senderName?: string
}

export type MetadataResult =
  | { kind: 'ready'; meta: DownloadMetadata; downloadUrl: string }
  | { kind: 'passwordRequired'; meta: DownloadMetadata }
  | { kind: 'scanning'; meta: DownloadMetadata }
  | { kind: 'expired' }
  | { kind: 'invalid' }

export type VerifyResult =
  | { kind: 'ready'; downloadUrl: string }
  | { kind: 'wrongPassword' }
  | { kind: 'expired' }
  | { kind: 'invalid' }

// Deux appels HTTP bruts plutôt que le helper `apiGet` générique de api.ts :
// `scanning` (202) et `passwordRequired` (200) renvoient un corps JSON de
// forme identique (mêmes champs de métadonnées, jamais `downloadUrl`) — seul
// le code de statut HTTP les distingue, et `apiGet` ne l'expose pas.
export async function fetchDownloadMetadata(token: string): Promise<MetadataResult> {
  const res = await fetch(`${API_BASE}/d/${encodeURIComponent(token)}`)
  if (res.status === 410) return { kind: 'expired' }
  if (res.status === 404) return { kind: 'invalid' }

  const body = (await res.json()) as DownloadMetadata & { downloadUrl?: string }
  if (res.status === 202) return { kind: 'scanning', meta: body }
  if (body.downloadUrl) return { kind: 'ready', meta: body, downloadUrl: body.downloadUrl }
  return { kind: 'passwordRequired', meta: body }
}

export async function verifyDownloadPassword(token: string, password: string): Promise<VerifyResult> {
  const res = await fetch(`${API_BASE}/d/${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (res.status === 401) return { kind: 'wrongPassword' }
  if (res.status === 410) return { kind: 'expired' }
  if (res.status === 404) return { kind: 'invalid' }

  const body = (await res.json()) as { downloadUrl: string }
  return { kind: 'ready', downloadUrl: body.downloadUrl }
}
