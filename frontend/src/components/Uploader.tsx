import { useRef, useState } from 'react'
import { apiDelete, apiPost, ApiError } from '../lib/api'
import { formatFileSize } from '../lib/format'
import { Button, Callout, PageShell } from './ds'
import styles from './Uploader.module.css'

const MAX_FILE_SIZE_BYTES = 1024 * 1024 * 1024 // rejected client-side before any request
const MAX_PART_ATTEMPTS = 3
const RETRY_DELAYS_MS = [500, 1500, 3000] // growing backoff between attempts

interface InitiateResponse {
  fileId: string
  partSize: number
  parts: { partNumber: number; url: string }[]
}

interface CompleteResponse {
  id: string
  state: string
  downloadToken: string
}

type Status =
  | { kind: 'idle' }
  | { kind: 'uploading'; fileId: string; bytesSent: number; totalBytes: number }
  | { kind: 'done'; downloadToken: string }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string }

interface UploaderProps {
  token: string
  onUnauthorized: () => void
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// XMLHttpRequest rather than fetch: xhr.upload.onprogress is the only way to
// get byte-level progress during the send. fetch only resolves at the end.
function putPart(
  url: string,
  blob: Blob,
  bytesBeforeThisPart: number,
  onProgress: (bytesSentTotal: number) => void,
  xhrRef: { current: XMLHttpRequest | null },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhrRef.current = xhr
    xhr.open('PUT', url)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(bytesBeforeThisPart + e.loaded)
      }
    }
    xhr.onload = () => {
      xhrRef.current = null
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader('ETag')
        if (!etag) {
          reject(new Error('ETag illisible (règle CORS ExposeHeaders manquante ?)'))
          return
        }
        resolve(etag)
      } else {
        reject(new Error(`HTTP ${xhr.status}`))
      }
    }
    xhr.onerror = () => {
      xhrRef.current = null
      reject(new Error('Erreur réseau'))
    }
    xhr.onabort = () => {
      xhrRef.current = null
      reject(new DOMException('Annulé', 'AbortError'))
    }
    xhr.send(blob)
  })
}

// Slices the file and pushes parts straight to storage — the bytes never
// cross the API or nginx. Handles resilience during a send (per-part retry,
// cancel); surviving a page reload is a separate job.
export function Uploader({ token, onUnauthorized }: UploaderProps) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const inputRef = useRef<HTMLInputElement>(null)
  const xhrRef = useRef<XMLHttpRequest | null>(null)
  // "requested" stops the loop; "handled" prevents a second DELETE if cancel
  // is clicked twice, or if an XHR abort and the click overlap.
  const cancelRequestedRef = useRef(false)
  const cancelHandledRef = useRef(false)

  async function handleFile(file: File) {
    if (status.kind === 'uploading') {
      return
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setStatus({ kind: 'error', message: 'Fichier trop volumineux : 1 Gio maximum.' })
      return
    }

    cancelRequestedRef.current = false
    cancelHandledRef.current = false

    try {
      const initiate = await apiPost<InitiateResponse>(
        '/files/uploads',
        { originalName: file.name, mimeType: file.type || 'application/octet-stream', sizeBytes: file.size },
        token,
      )

      if (cancelRequestedRef.current) {
        return
      }
      setStatus({ kind: 'uploading', fileId: initiate.fileId, bytesSent: 0, totalBytes: file.size })

      const completedParts: { partNumber: number; etag: string }[] = []
      let bytesBeforeCurrentPart = 0

      for (const part of initiate.parts) {
        if (cancelRequestedRef.current) {
          return
        }

        const start = (part.partNumber - 1) * initiate.partSize
        const chunk = file.slice(start, start + initiate.partSize)
        const partBytesStart = bytesBeforeCurrentPart

        let etag: string | null = null
        let lastError: unknown = null

        for (let attempt = 0; attempt < MAX_PART_ATTEMPTS; attempt++) {
          try {
            etag = await putPart(
              part.url,
              chunk,
              partBytesStart,
              (bytesSentTotal) => {
                setStatus((prev) => (prev.kind === 'uploading' ? { ...prev, bytesSent: bytesSentTotal } : prev))
              },
              xhrRef,
            )
            break
          } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') {
              // Cancelling: handleCancelClick owns the cleanup, not this.
              return
            }
            lastError = err
            if (attempt < MAX_PART_ATTEMPTS - 1) {
              await sleep(RETRY_DELAYS_MS[attempt])
              if (cancelRequestedRef.current) {
                return
              }
            }
          }
        }

        if (!etag) {
          throw lastError instanceof Error ? lastError : new Error(`Échec de l'envoi de la partie ${part.partNumber}`)
        }

        completedParts.push({ partNumber: part.partNumber, etag })
        bytesBeforeCurrentPart += chunk.size
        setStatus((prev) => (prev.kind === 'uploading' ? { ...prev, bytesSent: bytesBeforeCurrentPart } : prev))
      }

      if (cancelRequestedRef.current) {
        return
      }

      const complete = await apiPost<CompleteResponse>(
        `/files/uploads/${initiate.fileId}/complete`,
        { parts: completedParts },
        token,
      )
      setStatus({ kind: 'done', downloadToken: complete.downloadToken })
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onUnauthorized()
        return
      }
      if (!cancelRequestedRef.current) {
        setStatus({
          kind: 'error',
          message: err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Envoi échoué',
        })
      }
    }
  }

  function handleCancelClick() {
    if (status.kind !== 'uploading' || cancelHandledRef.current) {
      return
    }
    cancelHandledRef.current = true
    cancelRequestedRef.current = true
    const fileId = status.fileId
    // Stops the in-flight transfer at once. Between parts, or during a retry
    // backoff, there is nothing to abort and the DELETE below is enough.
    xhrRef.current?.abort()
    void (async () => {
      try {
        await apiDelete(`/files/uploads/${fileId}`, token)
      } catch {
        // Best effort: if this fails the row stays pending and the scheduled
        // reaper collects it, so nothing is orphaned for long.
      }
      setStatus({ kind: 'cancelled' })
    })()
  }

  const isUploading = status.kind === 'uploading'

  function onDrop(event: React.DragEvent) {
    event.preventDefault()
    if (isUploading) {
      return
    }
    const file = event.dataTransfer.files[0]
    if (file) void handleFile(file)
  }

  return (
    <PageShell title="Envoyer un fichier" loggedIn onHeaderAction={onUnauthorized}>
      <div className={styles.dropZone} onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
        <p className={styles.dropHint}>Glisse-dépose un fichier ici, ou</p>
        <Button
          variant="secondary"
          disabled={isUploading}
          onClick={() => inputRef.current?.click()}
        >
          Choisir un fichier
        </Button>
        <input
          ref={inputRef}
          type="file"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleFile(file)
            e.target.value = ''
          }}
        />
      </div>

      {status.kind === 'uploading' && (
        <div className={styles.progressBlock}>
          <progress
            className={styles.progress}
            value={status.bytesSent}
            max={status.totalBytes}
          />
          {/* aria-live so the percentage is announced as it moves, not just
              painted. */}
          <p className={styles.progressLabel} aria-live="polite">
            {Math.round((status.bytesSent / status.totalBytes) * 100)} % —{' '}
            {formatFileSize(status.bytesSent)} sur {formatFileSize(status.totalBytes)}
          </p>
          <Button variant="tertiary" onClick={handleCancelClick}>
            Annuler
          </Button>
        </div>
      )}

      {status.kind === 'done' && (
        <>
          <Callout variant="info">Envoi terminé. Ton lien est prêt à être partagé.</Callout>
          <p className={styles.token}>{downloadLink(status.downloadToken)}</p>
        </>
      )}
      {status.kind === 'cancelled' && <Callout variant="alert">Envoi annulé.</Callout>}
      {status.kind === 'error' && <Callout variant="error">{status.message}</Callout>}
    </PageShell>
  )
}

function downloadLink(token: string): string {
  return `${window.location.origin}/d/${token}`
}
