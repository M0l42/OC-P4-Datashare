import { useRef, useState } from 'react'
import { apiDelete, apiGet, apiPost, ApiError } from '../lib/api'
import { formatFileSize } from '../lib/format'
import { md5Hex } from '../lib/md5'
import { removeResumable, saveResumable, type ResumableUpload } from '../lib/resumeStore'
import { Button, Callout, FileInfo, Input, PageShell, Select } from './ds'
import { CloseIcon, CopyIcon, UploadIcon } from './icons'
import styles from './Uploader.module.css'
import fieldStyles from './ds/Field.module.css'

const MAX_FILE_SIZE_BYTES = 1024 * 1024 * 1024 // rejected client-side before any request
const MAX_PART_ATTEMPTS = 3
const RETRY_DELAYS_MS = [500, 1500, 3000] // growing backoff between attempts
const SCAN_POLL_INTERVAL_MS = 1500
const SCAN_POLL_MAX_ATTEMPTS = 120 // ~3 minutes before giving up

// Mirrors backend/src/files/upload.constants.ts — duplicated because the
// frontend can't import from the Nest project, but every value here must
// stay in lockstep with the server-side validation it's front-running.
const MIN_DOWNLOAD_PASSWORD_LENGTH = 6
const MAX_TAG_LENGTH = 30
const MAX_TAGS = 20
const DEFAULT_EXPIRY_DAYS = 7
const MAX_EXPIRY_DAYS = 7

const EXPIRY_OPTIONS = Array.from({ length: MAX_EXPIRY_DAYS }, (_, i) => {
  const days = i + 1
  return { value: String(days), label: days === 1 ? '1 jour' : `${days} jours` }
})

interface UploadOptions {
  password?: string
  tags: string[]
  expiresInDays: number
}

interface InitiateResponse {
  fileId: string
  partSize: number
  parts: { partNumber: number; url: string }[]
}

interface CompleteResponse {
  id: string
  state: string
}

interface StatusResponse {
  id: string
  state: string
  originalName: string
  downloadToken?: string
}

interface PartsResponse {
  totalParts: number
  partSize: number
  completedParts: { partNumber: number; etag: string; size: number }[]
  missingParts: { partNumber: number; url: string }[]
}

type Status =
  | { kind: 'idle' }
  | { kind: 'configuring'; file: File }
  | { kind: 'uploading'; fileId: string; bytesSent: number; totalBytes: number }
  | { kind: 'verifying' }
  | { kind: 'scanning' }
  | { kind: 'done'; downloadToken: string }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string }

interface UploaderProps {
  token: string
  onUnauthorized: () => void
  onNavigateHistory: () => void
  /** Set when the user clicked "Reprendre" on an interrupted upload in Mon espace. */
  resumeTarget: ResumableUpload | null
  /** Called once a resume attempt starts (success or failure) — App drops resumeTarget so a later fresh visit to the uploader doesn't re-prompt. */
  onResumeConsumed: () => void
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// /complete never carries a link (diagramme 4, étape 16 : « pas encore de
// lien ») — the worker still has to run ClamAV + magic-byte checks. Poll
// /status until it settles on `ready` (link available) or `rejected`.
async function pollUntilScanned(fileId: string, token: string): Promise<string> {
  for (let attempt = 0; attempt < SCAN_POLL_MAX_ATTEMPTS; attempt++) {
    const status = await apiGet<StatusResponse>(`/files/uploads/${fileId}/status`, token)
    if (status.state === 'ready' && status.downloadToken) {
      return status.downloadToken
    }
    if (status.state === 'rejected') {
      throw new Error('Fichier refusé par l’analyse de sécurité.')
    }
    await sleep(SCAN_POLL_INTERVAL_MS)
  }
  throw new Error('Analyse du fichier trop longue, réessaie plus tard.')
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

// Shared by a fresh upload and a resumed one: signs+retries+reports progress
// for whichever parts still need sending. `bytesAlreadySent` seeds the
// progress total with bytes S3 already has (0 for a fresh upload, the sum of
// verified completed parts when resuming). Byte offsets come from
// `partNumber`, not array position, since a resume's `parts` list only holds
// the gaps and isn't necessarily a contiguous prefix.
async function uploadParts(
  file: File,
  parts: { partNumber: number; url: string }[],
  partSize: number,
  bytesAlreadySent: number,
  setStatus: (updater: (prev: Status) => Status) => void,
  xhrRef: { current: XMLHttpRequest | null },
  cancelRequestedRef: { current: boolean },
): Promise<{ partNumber: number; etag: string }[] | 'cancelled'> {
  const completedParts: { partNumber: number; etag: string }[] = []
  let sessionBytesSent = 0

  for (const part of parts) {
    if (cancelRequestedRef.current) {
      return 'cancelled'
    }

    const start = (part.partNumber - 1) * partSize
    const chunk = file.slice(start, start + partSize)
    const bytesBeforeThisPart = bytesAlreadySent + sessionBytesSent

    let etag: string | null = null
    let lastError: unknown = null

    for (let attempt = 0; attempt < MAX_PART_ATTEMPTS; attempt++) {
      try {
        etag = await putPart(
          part.url,
          chunk,
          bytesBeforeThisPart,
          (bytesSentTotal) => {
            setStatus((prev) => (prev.kind === 'uploading' ? { ...prev, bytesSent: bytesSentTotal } : prev))
          },
          xhrRef,
        )
        break
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return 'cancelled'
        }
        lastError = err
        if (attempt < MAX_PART_ATTEMPTS - 1) {
          await sleep(RETRY_DELAYS_MS[attempt])
          if (cancelRequestedRef.current) {
            return 'cancelled'
          }
        }
      }
    }

    if (!etag) {
      throw lastError instanceof Error ? lastError : new Error(`Échec de l'envoi de la partie ${part.partNumber}`)
    }

    completedParts.push({ partNumber: part.partNumber, etag })
    sessionBytesSent += chunk.size
    setStatus((prev) =>
      prev.kind === 'uploading' ? { ...prev, bytesSent: bytesAlreadySent + sessionBytesSent } : prev,
    )
  }

  return completedParts
}

// Verifies a sample of parts S3 already has (first, last, one random middle —
// not all of them, which would hash hundreds of MB on the main thread) against
// the re-selected file. Without this, re-selecting a *different* file of the
// same declared name/size/lastModified would complete successfully and hand
// back a link to a silently corrupted object.
async function verifyCompletedParts(
  file: File,
  partSize: number,
  completed: { partNumber: number; etag: string; size: number }[],
): Promise<boolean> {
  if (completed.length === 0) {
    return true
  }
  const sorted = [...completed].sort((a, b) => a.partNumber - b.partNumber)
  const sampleIndexes = new Set<number>([0, sorted.length - 1])
  if (sorted.length > 2) {
    sampleIndexes.add(1 + Math.floor(Math.random() * (sorted.length - 2)))
  }

  for (const index of sampleIndexes) {
    const part = sorted[index]
    const start = (part.partNumber - 1) * partSize
    const chunk = file.slice(start, start + part.size)
    const computed = md5Hex(await chunk.arrayBuffer())
    const expected = part.etag.replace(/"/g, '')
    if (computed !== expected) {
      return false
    }
  }
  return true
}

// Slices the file and pushes parts straight to storage — the bytes never
// cross the API or nginx. Handles resilience during a send (per-part retry,
// cancel) and, since US01-R, resuming an upload interrupted by a reload.
export function Uploader({ token, onUnauthorized, onNavigateHistory, resumeTarget, onResumeConsumed }: UploaderProps) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  // Kept alongside `status` so the file row (icon, name, size) stays visible
  // through uploading → scanning → done, not just while progress is known.
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const xhrRef = useRef<XMLHttpRequest | null>(null)
  // "requested" stops the loop; "handled" prevents a second DELETE if cancel
  // is clicked twice, or if an XHR abort and the click overlap.
  const cancelRequestedRef = useRef(false)
  const cancelHandledRef = useRef(false)

  // US08/US09 options, live only while status is 'configuring'.
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [expiresInDays, setExpiresInDays] = useState(DEFAULT_EXPIRY_DAYS)
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [tagError, setTagError] = useState<string | null>(null)

  // File chosen, not resuming: show the options screen the mockups draw
  // (mot de passe, expiration) instead of uploading immediately. The actual
  // send only starts once the user confirms via handleConfirmUpload.
  function handleFile(file: File) {
    if (status.kind === 'uploading' || status.kind === 'verifying') {
      return
    }
    if (resumeTarget) {
      void handleResumeFile(file, resumeTarget)
      return
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setStatus({ kind: 'error', message: 'Fichier trop volumineux : 1 Gio maximum.' })
      return
    }

    // "Changer" re-enters here with status already 'configuring' — keep
    // whatever password/expiry/tags the user already set. They're swapping
    // the file, not starting over; only a genuinely fresh selection resets.
    if (status.kind !== 'configuring') {
      setPassword('')
      setPasswordError(null)
      setExpiresInDays(DEFAULT_EXPIRY_DAYS)
      setTags([])
      setTagInput('')
      setTagError(null)
    }
    setStatus({ kind: 'configuring', file })
  }

  function handleTagInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') {
      return
    }
    event.preventDefault()
    const value = tagInput.trim()
    if (!value) {
      return
    }
    if (value.length > MAX_TAG_LENGTH) {
      setTagError(`${MAX_TAG_LENGTH} caractères maximum par tag.`)
      return
    }
    if (tags.some((tag) => tag.toLowerCase() === value.toLowerCase())) {
      setTagError('Ce tag est déjà ajouté.')
      return
    }
    if (tags.length >= MAX_TAGS) {
      setTagError(`${MAX_TAGS} tags maximum.`)
      return
    }
    setTags((prev) => [...prev, value])
    setTagInput('')
    setTagError(null)
  }

  function handleRemoveTag(tag: string) {
    setTags((prev) => prev.filter((existing) => existing !== tag))
  }

  function handleConfirmUpload() {
    if (status.kind !== 'configuring') {
      return
    }
    if (password && password.length < MIN_DOWNLOAD_PASSWORD_LENGTH) {
      setPasswordError(`${MIN_DOWNLOAD_PASSWORD_LENGTH} caractères minimum.`)
      return
    }
    setPasswordError(null)
    void startFreshUpload(status.file, { password: password || undefined, tags, expiresInDays })
  }

  async function startFreshUpload(file: File, options: UploadOptions) {
    cancelRequestedRef.current = false
    cancelHandledRef.current = false
    setSelectedFile(file)

    try {
      const initiate = await apiPost<InitiateResponse>(
        '/files/uploads',
        {
          originalName: file.name,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
          password: options.password,
          tags: options.tags,
          expiresInDays: options.expiresInDays,
        },
        token,
      )

      if (cancelRequestedRef.current) {
        return
      }
      setStatus({ kind: 'uploading', fileId: initiate.fileId, bytesSent: 0, totalBytes: file.size })
      // Persisted before the first byte goes out: a reload one second later
      // still needs to be able to offer "Reprendre".
      await saveResumable({
        fileId: initiate.fileId,
        originalName: file.name,
        sizeBytes: file.size,
        lastModified: file.lastModified,
        mimeType: file.type || 'application/octet-stream',
        createdAt: Date.now(),
      })

      const result = await uploadParts(file, initiate.parts, initiate.partSize, 0, setStatus, xhrRef, cancelRequestedRef)
      if (result === 'cancelled') {
        return
      }

      if (cancelRequestedRef.current) {
        return
      }

      await apiPost<CompleteResponse>(`/files/uploads/${initiate.fileId}/complete`, { parts: result }, token)
      await removeResumable(initiate.fileId)
      setStatus({ kind: 'scanning' })
      const downloadToken = await pollUntilScanned(initiate.fileId, token)
      setStatus({ kind: 'done', downloadToken })
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

  // US01-R: the user re-selected a file for an upload interrupted by a
  // reload. Refuse on any mismatch, verify a sample of what S3 already has
  // against the re-selected file, then finish sending only the missing parts.
  async function handleResumeFile(file: File, target: ResumableUpload) {
    if (
      file.name !== target.originalName ||
      file.size !== target.sizeBytes ||
      file.lastModified !== target.lastModified
    ) {
      setStatus({
        kind: 'error',
        message: "Ce fichier ne correspond pas à l'envoi interrompu. Sélectionne exactement le même fichier.",
      })
      return
    }

    cancelRequestedRef.current = false
    cancelHandledRef.current = false
    setSelectedFile(file)
    setStatus({ kind: 'verifying' })

    try {
      const parts = await apiGet<PartsResponse>(`/files/uploads/${target.fileId}/parts`, token)

      const verified = await verifyCompletedParts(file, parts.partSize, parts.completedParts)
      if (!verified) {
        // Not removed from the resume store: this is a wrong-file mistake,
        // not a dead upload — the interrupted row is still there to retry
        // with the right one from Mon espace.
        setStatus({
          kind: 'error',
          message: "Ce fichier ne correspond pas exactement à l'envoi interrompu. Recommence l'envoi.",
        })
        return
      }

      const bytesAlreadySent = parts.completedParts.reduce((sum, part) => sum + part.size, 0)
      setStatus({ kind: 'uploading', fileId: target.fileId, bytesSent: bytesAlreadySent, totalBytes: file.size })

      const result = await uploadParts(
        file,
        parts.missingParts,
        parts.partSize,
        bytesAlreadySent,
        setStatus,
        xhrRef,
        cancelRequestedRef,
      )
      if (result === 'cancelled') {
        return
      }
      if (cancelRequestedRef.current) {
        return
      }

      const allParts = [...parts.completedParts.map(({ partNumber, etag }) => ({ partNumber, etag })), ...result].sort(
        (a, b) => a.partNumber - b.partNumber,
      )

      await apiPost<CompleteResponse>(`/files/uploads/${target.fileId}/complete`, { parts: allParts }, token)
      await removeResumable(target.fileId)
      onResumeConsumed()
      setStatus({ kind: 'scanning' })
      const downloadToken = await pollUntilScanned(target.fileId, token)
      setStatus({ kind: 'done', downloadToken })
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onUnauthorized()
        return
      }
      if (err instanceof ApiError && [404, 409, 410].includes(err.status)) {
        // Row gone (reaper collected it), no longer pending, or MinIO already
        // dropped the multipart upload — none of these are resumable.
        await removeResumable(target.fileId)
        onResumeConsumed()
        setStatus({
          kind: 'error',
          message: "Cet envoi n'est plus disponible (trop ancien ou déjà terminé). Recommence depuis le début.",
        })
        return
      }
      if (!cancelRequestedRef.current) {
        setStatus({
          kind: 'error',
          message: err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Reprise échouée',
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
      await removeResumable(fileId)
      // No-op if this wasn't a resume in progress; if it was, that attempt is
      // over — the row and the local record are both gone.
      onResumeConsumed()
      setStatus({ kind: 'cancelled' })
    })()
  }

  const isUploading = status.kind === 'uploading' || status.kind === 'verifying'

  function onDrop(event: React.DragEvent) {
    event.preventDefault()
    if (isUploading) {
      return
    }
    const file = event.dataTransfer.files[0]
    if (file) void handleFile(file)
  }

  // A pending resumeTarget turns the empty idle screen into a re-selection
  // prompt — enough extra content (file info, explanation, two buttons) that
  // it needs the card treatment the bare idle screen deliberately skips.
  const showResumePrompt = status.kind === 'idle' && resumeTarget !== null
  const showCard = status.kind !== 'idle' || showResumePrompt
  const cardTitle = showResumePrompt ? "Reprendre l'envoi" : showCard ? 'Ajouter un fichier' : undefined

  const fileInput = (
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
  )

  return (
    <PageShell title={cardTitle} card={showCard} loggedIn onHeaderAction={onNavigateHistory}>
      {status.kind === 'idle' && resumeTarget && (
        <div className={styles.dropZone}>
          <FileInfo name={resumeTarget.originalName} size={formatFileSize(resumeTarget.sizeBytes)} />
          <Callout variant="info">
            Cet envoi a été interrompu. Sélectionne à nouveau exactement le même fichier pour continuer sans tout
            renvoyer.
          </Callout>
          <Button variant="secondary" onClick={() => inputRef.current?.click()}>
            Choisir le fichier
          </Button>
          <Button variant="tertiary" onClick={onResumeConsumed}>
            Annuler la reprise
          </Button>
          {fileInput}
        </div>
      )}

      {status.kind === 'idle' && !resumeTarget && (
        // Matches the idle mockup exactly: no card, no dashed dropzone — just
        // the prompt and the round upload button on the gradient.
        <div className={styles.idle} onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
          <p className={styles.idleText}>Tu veux partager un fichier ?</p>
          <button
            type="button"
            className={styles.idleButtonHalo}
            aria-label="Choisir un fichier"
            onClick={() => inputRef.current?.click()}
          >
            <span className={styles.idleButton}>
              <UploadIcon />
            </span>
          </button>
          {fileInput}
        </div>
      )}

      {status.kind === 'configuring' && (
        <div className={styles.configForm}>
          <div className={styles.configFileRow}>
            <FileInfo name={status.file.name} size={formatFileSize(status.file.size)} />
            {/* Medium, not Small: this row has no desktop/mobile split (unlike
                Mon espace's row actions), and Small sits under the 44px
                mobile touch-target minimum (UI-04). */}
            <Button variant="secondary" onClick={() => inputRef.current?.click()}>
              Changer
            </Button>
          </div>

          <Input
            label="Mot de passe"
            type="password"
            placeholder="Optionnel"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              setPasswordError(null)
            }}
            error={passwordError ?? undefined}
          />

          <Select
            label="Expiration"
            value={String(expiresInDays)}
            onChange={(e) => setExpiresInDays(Number(e.target.value))}
            options={EXPIRY_OPTIONS}
          />

          <div className={fieldStyles.field}>
            <label className={fieldStyles.label} htmlFor="upload-tag-input">
              Tags
            </label>
            <input
              id="upload-tag-input"
              className={fieldStyles.control}
              type="text"
              placeholder="Ajouter un tag et appuyer sur Entrée"
              value={tagInput}
              maxLength={MAX_TAG_LENGTH}
              onChange={(e) => {
                setTagInput(e.target.value)
                setTagError(null)
              }}
              onKeyDown={handleTagInputKeyDown}
            />
            {tags.length > 0 && (
              <ul className={styles.tagList}>
                {tags.map((tag) => (
                  <li key={tag} className={styles.tagChip}>
                    {tag}
                    <button
                      type="button"
                      className={styles.tagRemove}
                      aria-label={`Retirer le tag ${tag}`}
                      onClick={() => handleRemoveTag(tag)}
                    >
                      <CloseIcon />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {tagError && (
              <span className={fieldStyles.error} role="alert">
                {tagError}
              </span>
            )}
          </div>

          <Button variant="primary" fullWidth icon={<UploadIcon />} onClick={handleConfirmUpload}>
            Téléverser
          </Button>
          {fileInput}
        </div>
      )}

      {(status.kind === 'cancelled' || status.kind === 'error') && (
        <div className={styles.dropZone} onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
          <p className={styles.dropHint}>Glisse-dépose un fichier ici, ou</p>
          <Button variant="secondary" onClick={() => inputRef.current?.click()}>
            Choisir un fichier
          </Button>
          {fileInput}
        </div>
      )}

      {status.kind === 'uploading' && (
        <div className={styles.progressBlock}>
          {selectedFile && <FileInfo name={selectedFile.name} size={formatFileSize(selectedFile.size)} />}
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

      {status.kind === 'verifying' && (
        <div className={styles.done}>
          {selectedFile && <FileInfo name={selectedFile.name} size={formatFileSize(selectedFile.size)} />}
          <Callout variant="info">Vérification du fichier…</Callout>
        </div>
      )}

      {status.kind === 'scanning' && (
        <div className={styles.done}>
          {selectedFile && <FileInfo name={selectedFile.name} size={formatFileSize(selectedFile.size)} />}
          <Callout variant="info">Analyse de sécurité en cours…</Callout>
        </div>
      )}

      {status.kind === 'done' && (
        <div className={styles.done}>
          {selectedFile && <FileInfo name={selectedFile.name} size={formatFileSize(selectedFile.size)} />}
          <p className={styles.doneText}>Félicitations, ton fichier est prêt à être partagé !</p>
          <a className={styles.token} href={downloadLink(status.downloadToken)}>
            {downloadLink(status.downloadToken)}
          </a>
          <Button
            className={styles.doneAction}
            icon={<CopyIcon />}
            onClick={() => navigator.clipboard.writeText(downloadLink(status.downloadToken))}
          >
            Copier le lien
          </Button>
        </div>
      )}
      {status.kind === 'cancelled' && <Callout variant="alert">Envoi annulé.</Callout>}
      {status.kind === 'error' && <Callout variant="error">{status.message}</Callout>}
    </PageShell>
  )
}

function downloadLink(token: string): string {
  return `${window.location.origin}/d/${token}`
}
