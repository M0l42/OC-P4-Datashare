import { useRef, useState } from 'react'
import { apiDelete, apiPost, ApiError } from '../lib/api'

const MAX_FILE_SIZE_BYTES = 1024 * 1024 * 1024 // 1 Gio, refus immédiat côté client
const MAX_PART_ATTEMPTS = 3
const RETRY_DELAYS_MS = [500, 1500, 3000] // attente croissante entre tentatives

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
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// PUT une partie via XMLHttpRequest plutôt que fetch : c'est le seul moyen
// d'obtenir une progression en octets pendant l'envoi (xhr.upload.onprogress).
// fetch n'expose pas cet évènement, seulement la réponse complète.
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

// US01-B/US01-C : découpe le fichier et pousse les parties directement vers le
// stockage (les octets ne traversent ni l'API ni nginx). Reprise après
// rechargement de page (US01-R) reste hors périmètre : ce composant ne gère
// que la résilience PENDANT un envoi en cours (retry par partie, annulation).
export function Uploader({ token }: UploaderProps) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const inputRef = useRef<HTMLInputElement>(null)
  const xhrRef = useRef<XMLHttpRequest | null>(null)
  // "demandée" pilote l'arrêt de la boucle ; "gérée" empêche un double DELETE
  // si l'utilisateur clique Annuler plusieurs fois ou si un abort XHR et le
  // clic se chevauchent.
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
              // Annulation en cours : le nettoyage (DELETE + statut) est géré
              // par handleCancelClick, pas ici.
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
    // Stoppe le transfert en cours immédiatement ; s'il n'y a aucune requête
    // en vol (entre deux parties, ou pendant l'attente d'une nouvelle
    // tentative), c'est un no-op et le DELETE ci-dessous suffit.
    xhrRef.current?.abort()
    void (async () => {
      try {
        await apiDelete(`/files/uploads/${fileId}`, token)
      } catch {
        // Best effort : si le DELETE échoue, la ligne reste `pending` et sera
        // récupérée par le reaper (US10), pas de partie orpheline durable.
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
    <div
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
      style={{ border: '2px dashed #999', padding: '2rem', textAlign: 'center' }}
    >
      <p>Glisser-déposer un fichier ici, ou</p>
      <button type="button" disabled={isUploading} onClick={() => inputRef.current?.click()}>
        Choisir un fichier
      </button>
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

      {status.kind === 'uploading' && (
        <div>
          <progress value={status.bytesSent} max={status.totalBytes} style={{ width: '100%' }} />
          <p>
            {Math.round((status.bytesSent / status.totalBytes) * 100)} % ({status.bytesSent} / {status.totalBytes}{' '}
            octets)
          </p>
          <button type="button" onClick={handleCancelClick}>
            Annuler
          </button>
        </div>
      )}
      {status.kind === 'done' && <p>Envoyé. Jeton : {status.downloadToken}</p>}
      {status.kind === 'cancelled' && <p>Envoi annulé.</p>}
      {status.kind === 'error' && <p role="alert">{status.message}</p>}
    </div>
  )
}
