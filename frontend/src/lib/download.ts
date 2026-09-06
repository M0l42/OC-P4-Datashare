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
  | { kind: 'clickToDownload'; meta: DownloadMetadata }
  | { kind: 'passwordRequired'; meta: DownloadMetadata }
  | { kind: 'scanning'; meta: DownloadMetadata }
  | { kind: 'expired' }
  | { kind: 'invalid' }

export type RequestUrlResult =
  | { kind: 'ready'; downloadUrl: string }
  | { kind: 'wrongPassword' }
  | { kind: 'expired' }
  | { kind: 'invalid' }

// GET never returns a download URL, with or without a password: the URL is
// only ever signed behind the explicit click on Télécharger (requestDownloadUrl
// below), so a link-preview bot or crawler that just loads this page can
// never walk away with a working download.
export async function fetchDownloadMetadata(token: string): Promise<MetadataResult> {
  const res = await fetch(`${API_BASE}/d/${encodeURIComponent(token)}`)
  if (res.status === 410) return { kind: 'expired' }
  if (res.status === 404) return { kind: 'invalid' }

  const body = (await res.json()) as DownloadMetadata
  if (res.status === 202) return { kind: 'scanning', meta: body }
  if (body.passwordRequired) return { kind: 'passwordRequired', meta: body }
  return { kind: 'clickToDownload', meta: body }
}

// The one call that ever signs a URL. `password` is omitted for a
// password-less file (click-to-download); the server ignores it either way
// when the file has no password set.
export async function requestDownloadUrl(
  token: string,
  password?: string,
): Promise<RequestUrlResult> {
  const res = await fetch(`${API_BASE}/d/${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(password ? { password } : {}),
  })
  if (res.status === 401) return { kind: 'wrongPassword' }
  if (res.status === 410) return { kind: 'expired' }
  if (res.status === 404) return { kind: 'invalid' }

  const body = (await res.json()) as { downloadUrl: string }
  return { kind: 'ready', downloadUrl: body.downloadUrl }
}
