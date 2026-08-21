import { useRef, useState } from 'react'
import { apiPost, ApiError } from '../lib/api'

const MAX_FILE_SIZE_BYTES = 1024 * 1024 * 1024 // 1 Gio, refus immédiat côté client

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
  | { kind: 'uploading'; part: number; total: number }
  | { kind: 'done'; downloadToken: string }
  | { kind: 'error'; message: string }

interface UploaderProps {
  token: string
}

// US01-B : découpe le fichier et pousse les parties directement vers le
// stockage (les octets ne traversent ni l'API ni nginx). Progression fine,
// reprise de partie et annulation sont US01-C, pas ce composant : l'envoi
// est ici strictement séquentiel et sans nouvelle tentative.
export function Uploader({ token }: UploaderProps) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    if (status.kind === 'uploading') {
      return
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setStatus({ kind: 'error', message: 'Fichier trop volumineux : 1 Gio maximum.' })
      return
    }

    try {
      const initiate = await apiPost<InitiateResponse>(
        '/files/uploads',
        { originalName: file.name, mimeType: file.type || 'application/octet-stream', sizeBytes: file.size },
        token,
      )

      const completedParts: { partNumber: number; etag: string }[] = []
      for (const part of initiate.parts) {
        setStatus({ kind: 'uploading', part: part.partNumber, total: initiate.parts.length })

        const start = (part.partNumber - 1) * initiate.partSize
        const chunk = file.slice(start, start + initiate.partSize)

        const response = await fetch(part.url, { method: 'PUT', body: chunk })
        if (!response.ok) {
          throw new Error(`Échec de l'envoi de la partie ${part.partNumber}`)
        }
        const etag = response.headers.get('ETag')
        if (!etag) {
          throw new Error(
            `Partie ${part.partNumber} envoyée mais ETag illisible (règle CORS ExposeHeaders manquante ?)`,
          )
        }
        completedParts.push({ partNumber: part.partNumber, etag })
      }

      const complete = await apiPost<CompleteResponse>(
        `/files/uploads/${initiate.fileId}/complete`,
        { parts: completedParts },
        token,
      )
      setStatus({ kind: 'done', downloadToken: complete.downloadToken })
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Envoi échoué',
      })
    }
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
        <p>
          Envoi de la partie {status.part} / {status.total}…
        </p>
      )}
      {status.kind === 'done' && <p>Envoyé. Jeton : {status.downloadToken}</p>}
      {status.kind === 'error' && <p role="alert">{status.message}</p>}
    </div>
  )
}
