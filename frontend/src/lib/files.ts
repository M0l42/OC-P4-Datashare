import { apiDelete } from './api'

// DELETE /files/:id — object + row if one still exists in storage, row only
// for an already-expired/rejected tombstone. See backend
// FileDeletionService for the dispatch logic.
export function deleteFile(fileId: string, token: string): Promise<void> {
  return apiDelete(`/files/${encodeURIComponent(fileId)}`, token)
}
