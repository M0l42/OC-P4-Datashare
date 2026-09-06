// Metadata-only persistence for US01-R: a File handle doesn't survive a
// reload and a 1 GB Blob doesn't belong in IndexedDB, so this stores just
// enough to offer "Reprendre" and validate a re-selected file — the actual
// completed-parts/ETag list is fetched fresh from GET /files/uploads/:id/parts
// when the user resumes, not duplicated here.

const DB_NAME = 'datashare-resume'
const DB_VERSION = 1
const STORE_NAME = 'pending-uploads'

export interface ResumableUpload {
  fileId: string
  originalName: string
  sizeBytes: number
  lastModified: number
  mimeType: string
  createdAt: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: 'fileId' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function saveResumable(entry: ResumableUpload): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(entry)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function removeResumable(fileId: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(fileId)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function listResumables(): Promise<ResumableUpload[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const request = tx.objectStore(STORE_NAME).getAll()
    request.onsuccess = () => resolve(request.result as ResumableUpload[])
    request.onerror = () => reject(request.error)
  })
}
