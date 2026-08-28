import { useCallback, useEffect, useState } from 'react'
import { Button, Callout, Switch, type SwitchOption } from './ds'
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog'
import { FileActionsSheet } from './FileActionsSheet'
import {
  ArrowRightIcon,
  CloseIcon,
  FileIcon,
  KebabIcon,
  LockIcon,
  LogoutIcon,
  MenuIcon,
  TrashIcon,
  UploadIcon,
} from './icons'
import { ApiError } from '../lib/api'
import { deleteFile, listFiles, type FileHistoryEntry, type HistoryFilter } from '../lib/files'
import { formatFileSize } from '../lib/format'
import { expiryTone } from '../lib/expiryTone'
import { listResumables, removeResumable, type ResumableUpload } from '../lib/resumeStore'
import styles from './MonEspace.module.css'
import fieldStyles from './ds/Field.module.css'

interface MonEspaceProps {
  token: string
  /** displayName, falling back to email at login — feeds the mobile header's avatar and name. */
  userLabel: string
  onUnauthorized: () => void
  onNavigateUpload: () => void
  /** US01-R: hands the interrupted-upload record to the uploader so it can prompt for re-selection. */
  onResume: (entry: ResumableUpload) => void
}

const FILTER_OPTIONS: SwitchOption<HistoryFilter>[] = [
  { value: 'all', label: 'Tous' },
  { value: 'active', label: 'Actifs' },
  { value: 'expired', label: 'Expiré' },
]

type LoadState = { kind: 'loading' } | { kind: 'loaded'; files: FileHistoryEntry[] } | { kind: 'error' }

export function MonEspace({ token, userLabel, onUnauthorized, onNavigateUpload, onResume }: MonEspaceProps) {
  const [filter, setFilter] = useState<HistoryFilter>('all')
  const [tagFilter, setTagFilter] = useState('')
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [sheetTarget, setSheetTarget] = useState<FileHistoryEntry | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<FileHistoryEntry | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [resumables, setResumables] = useState<ResumableUpload[]>([])
  const [abandonError, setAbandonError] = useState<string | null>(null)

  useEffect(() => {
    if (!drawerOpen) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setDrawerOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [drawerOpen])

  const load = useCallback(async () => {
    setState({ kind: 'loading' })
    try {
      const files = await listFiles(filter, token)
      setState({ kind: 'loaded', files })
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onUnauthorized()
        return
      }
      setState({ kind: 'error' })
    }
  }, [filter, token, onUnauthorized])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void listResumables().then(setResumables)
  }, [])

  async function handleDelete() {
    if (!deleteTarget) return
    await deleteFile(deleteTarget.id, token)
    setDeleteTarget(null)
    await load()
  }

  async function handleAbandonResume(entry: ResumableUpload) {
    setAbandonError(null)
    try {
      await deleteFile(entry.fileId, token)
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onUnauthorized()
        return
      }
      if (!(error instanceof ApiError && error.status === 404)) {
        setAbandonError("Impossible d'annuler cet envoi pour l'instant. Réessaie.")
        return
      }
      // 404: already gone (reaper, or resumed+completed from another tab).
    }
    await removeResumable(entry.fileId)
    setResumables((prev) => prev.filter((item) => item.fileId !== entry.fileId))
  }

  function handleAccess(file: FileHistoryEntry) {
    if (!file.downloadToken) return
    window.open(`/d/${file.downloadToken}`, '_blank', 'noopener')
  }

  const availableTags =
    state.kind === 'loaded'
      ? Array.from(new Set(state.files.flatMap((file) => file.tags))).sort((a, b) => a.localeCompare(b))
      : []
  const activeTagFilter = availableTags.includes(tagFilter) ? tagFilter : ''
  const visibleFiles =
    state.kind === 'loaded'
      ? activeTagFilter
        ? state.files.filter((file) => file.tags.includes(activeTagFilter))
        : state.files
      : []

  return (
    <div className={styles.page}>
      <aside className={styles.sidebar}>
        <a className={styles.brand} href="/">
          DataShare
        </a>
        <span className={styles.navItem}>Mes fichiers</span>
        <p className={styles.sidebarFooter}>Copyright DataShare© 2026</p>
      </aside>

      <main className={styles.main}>
        <div className={styles.headerBar}>
          <button
            type="button"
            className={styles.menuButton}
            aria-label="Ouvrir le menu"
            onClick={() => setDrawerOpen(true)}
          >
            <MenuIcon />
          </button>

          <div className={styles.headerActions}>
            <Button variant="dark" icon={<UploadIcon />} onClick={onNavigateUpload}>
              Ajouter des fichiers
            </Button>
            <Button variant="tertiary" icon={<LogoutIcon />} onClick={onUnauthorized}>
              Déconnexion
            </Button>
          </div>

          <div className={styles.profile}>
            <span className={styles.avatar} aria-hidden="true">
              {initials(userLabel)}
            </span>
            <span className={styles.profileName}>{userLabel}</span>
          </div>
        </div>

        <div className={styles.content}>
          <h1 className={styles.title}>Mes fichiers</h1>

          {resumables.length > 0 && (
            <div className={styles.resumeSection}>
              <h2 className={styles.resumeSectionTitle}>Envois interrompus</h2>
              {abandonError && <Callout variant="error">{abandonError}</Callout>}
              <ul className={styles.list}>
                {resumables.map((entry) => (
                  <li key={entry.fileId} className={styles.row}>
                    <div className={styles.rowLeft}>
                      <span className={styles.rowIcon}>
                        <FileIcon />
                      </span>
                      <div className={styles.rowText}>
                        <p className={styles.rowName}>{entry.originalName}</p>
                        <p className={styles.rowStatus}>{formatFileSize(entry.sizeBytes)} — envoi interrompu</p>
                      </div>
                    </div>
                    <div className={styles.resumeActions}>
                      <Button variant="secondary" size="medium" onClick={() => onResume(entry)}>
                        Reprendre
                      </Button>
                      <Button
                        variant="tertiary"
                        size="medium"
                        icon={<TrashIcon />}
                        onClick={() => void handleAbandonResume(entry)}
                      >
                        Annuler
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className={styles.filterRow}>
            <Switch
              options={FILTER_OPTIONS}
              value={filter}
              onChange={(value) => {
                setFilter(value)
                setTagFilter('')
              }}
              label="Filtrer l'historique"
            />

            {availableTags.length > 0 && (
              <select
                className={`${fieldStyles.control} ${styles.tagFilterSelect}`}
                aria-label="Filtrer par tag"
                value={activeTagFilter}
                onChange={(e) => setTagFilter(e.target.value)}
              >
                <option value="">Tous les tags</option>
                {availableTags.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>
            )}
          </div>

          {state.kind === 'loading' && (
            <div className={styles.list} aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className={styles.skeletonRow} />
              ))}
            </div>
          )}

          {state.kind === 'error' && (
            <Callout variant="error">Impossible de charger tes fichiers. Réessaie plus tard.</Callout>
          )}

          {state.kind === 'loaded' && state.files.length === 0 && (
            <div className={styles.empty}>
              <p>{emptyMessage(filter)}</p>
              {filter === 'all' && (
                <Button variant="primary" icon={<UploadIcon />} onClick={onNavigateUpload}>
                  Ajouter un fichier
                </Button>
              )}
            </div>
          )}

          {state.kind === 'loaded' && state.files.length > 0 && visibleFiles.length === 0 && (
            <div className={styles.empty}>
              <p>Aucun fichier avec le tag « {activeTagFilter} ».</p>
            </div>
          )}

          {state.kind === 'loaded' && visibleFiles.length > 0 && (
            <ul className={styles.list}>
              {visibleFiles.map((file) => (
                <li key={file.id} className={styles.row}>
                  <div className={styles.rowLeft}>
                    <span className={styles.rowIcon}>
                      <FileIcon />
                    </span>
                    <div className={styles.rowText}>
                      <p className={styles.rowName}>{file.originalName}</p>
                      <p className={`${styles.rowStatus} ${file.state === 'expired' ? styles.rowStatusExpired : ''}`}>
                        {statusLabel(file)}
                      </p>
                      {file.tags.length > 0 && (
                        <ul className={styles.rowTags}>
                          {file.tags.map((tag) => (
                            <li key={tag} className={styles.rowTagChip}>
                              {tag}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>

                  <div className={styles.rowRight}>
                    {file.state !== 'ready' && <span className={styles.explain}>{explainText(file)}</span>}
                    {file.state === 'ready' && file.hasPassword && (
                      <span className={styles.lock} aria-label="Protégé par mot de passe">
                        <LockIcon />
                      </span>
                    )}

                    <div className={styles.desktopActions}>
                      <Button variant="secondary" size="small" icon={<TrashIcon />} onClick={() => setDeleteTarget(file)}>
                        Supprimer
                      </Button>
                      {file.state === 'ready' && (
                        <Button
                          variant="secondary"
                          size="small"
                          icon={<ArrowRightIcon />}
                          onClick={() => handleAccess(file)}
                        >
                          Accéder
                        </Button>
                      )}
                    </div>

                    <button
                      type="button"
                      className={styles.kebabButton}
                      aria-label={`Actions pour ${file.originalName}`}
                      onClick={() => setSheetTarget(file)}
                    >
                      <KebabIcon />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>

      {drawerOpen && (
        <div className={styles.drawerOverlay} onClick={() => setDrawerOpen(false)}>
          <div
            className={styles.drawer}
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.drawerHeader}>
              <a className={styles.brand} href="/">
                DataShare
              </a>
              <button
                type="button"
                className={styles.drawerClose}
                aria-label="Fermer le menu"
                onClick={() => setDrawerOpen(false)}
              >
                <CloseIcon />
              </button>
            </div>
            <span className={styles.navItem}>Mes fichiers</span>
            <button type="button" className={styles.drawerLink} onClick={onNavigateUpload}>
              Ajouter des fichiers
            </button>
            <button type="button" className={styles.drawerLink} onClick={onUnauthorized}>
              Déconnexion
            </button>
            <p className={styles.sidebarFooter}>Copyright DataShare© 2026</p>
          </div>
        </div>
      )}

      {sheetTarget && (
        <FileActionsSheet
          fileName={sheetTarget.originalName}
          onAccess={
            sheetTarget.state === 'ready'
              ? () => {
                  handleAccess(sheetTarget)
                  setSheetTarget(null)
                }
              : undefined
          }
          onDelete={() => {
            setDeleteTarget(sheetTarget)
            setSheetTarget(null)
          }}
          onClose={() => setSheetTarget(null)}
        />
      )}

      {deleteTarget && (
        <ConfirmDeleteDialog
          fileName={deleteTarget.originalName}
          fileSize={formatFileSize(deleteTarget.sizeBytes)}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}

function initials(label: string): string {
  const letters = label
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('')
  return letters || '?'
}

function statusLabel(file: FileHistoryEntry): string {
  if (file.state === 'expired') return 'Expiré'
  if (file.state === 'rejected') return 'Refusé'
  const tone = expiryTone(file.expiresAt)
  if (tone === 'alert') return 'Expire demain'
  const days = Math.ceil((new Date(file.expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
  return `Expire dans ${days} jours`
}

function explainText(file: FileHistoryEntry): string | null {
  if (file.state === 'expired') return "Ce fichier a expiré, il n'est plus stocké chez nous"
  if (file.state === 'rejected') return "Refusé par l'analyse de sécurité, il n'est plus stocké chez nous"
  return null
}

function emptyMessage(filter: HistoryFilter): string {
  if (filter === 'active') return 'Aucun fichier actif. Bascule sur Tous pour voir les fichiers expirés.'
  if (filter === 'expired') return 'Aucun fichier expiré. Bascule sur Tous pour voir tes fichiers actifs.'
  return "Rien ici pour l'instant. Les fichiers que tu envoies apparaissent ici avec leur lien et leur date d'expiration."
}
