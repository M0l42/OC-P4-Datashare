import { apiDelete, apiGet } from './api'

// DELETE /files/:id — object + row if one still exists in storage, row only
// for an already-expired/rejected tombstone. See backend
// FileDeletionService for the dispatch logic.
export function deleteFile(fileId: string, token: string): Promise<void> {
  return apiDelete(`/files/${encodeURIComponent(fileId)}`, token)
}

export type HistoryFilter = 'all' | 'active' | 'expired'
export type FileHistoryState = 'ready' | 'expired' | 'rejected'

export interface FileHistoryEntry {
  id: string
  originalName: string
  sizeBytes: number
  createdAt: string
  expiresAt: string
  state: FileHistoryState
  hasPassword: boolean
  /** Only present when `state === 'ready'` — same anti-oracle rule as the uploader's status poll. */
  downloadToken?: string
}

// GET /files?filter=... — Mon espace history. `active` narrows to ready,
// `expired` to expired; `all` also includes rejected, which has no tab of
// its own.
export function listFiles(filter: HistoryFilter, token: string): Promise<FileHistoryEntry[]> {
  return apiGet(`/files?filter=${filter}`, token)
}
