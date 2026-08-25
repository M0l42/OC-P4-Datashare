import { useCallback, useEffect, useState } from 'react'
import { Button, Callout, FileInfo, Input, PageShell } from './ds'
import { DownloadIcon } from './icons'
import styles from './RecipientPage.module.css'
import { fetchDownloadMetadata, verifyDownloadPassword, type DownloadMetadata } from '../lib/download'
import { expiryTone } from '../lib/expiryTone'
import { usePollUntil } from '../lib/usePollUntil'
import { formatFileSize } from '../lib/format'

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; meta: DownloadMetadata; downloadUrl: string }
  | { kind: 'passwordRequired'; meta: DownloadMetadata }
  | { kind: 'scanning'; meta: DownloadMetadata }
  | { kind: 'expired' }
  | { kind: 'invalid' }
  | { kind: 'timedOut' }
  | { kind: 'error' }

interface RecipientPageProps {
  token: string
}

// The recipient view, covering every state a link can resolve to. Unknown
// tokens and rejected files render identically on purpose — telling them
// apart would let someone probe for which tokens ever existed.
export function RecipientPage({ token }: RecipientPageProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await fetchDownloadMetadata(token);
      switch (result.kind) {
        case 'ready':
          setPhase({ kind: 'ready', meta: result.meta, downloadUrl: result.downloadUrl });
          break;
        case 'passwordRequired':
          setPhase({ kind: 'passwordRequired', meta: result.meta });
          break;
        case 'scanning':
          setPhase({ kind: 'scanning', meta: result.meta });
          break;
        case 'expired':
          setPhase({ kind: 'expired' });
          break;
        case 'invalid':
          setPhase({ kind: 'invalid' });
          break;
      }
    } catch {
      setPhase({ kind: 'error' });
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  // "Réessayez dans quelques instants" would be a lie if nothing ever
  // retried, so poll while the file is still being checked.
  const { timedOut } = usePollUntil(() => void load(), phase.kind === 'scanning');

  useEffect(() => {
    if (timedOut) {
      setPhase({ kind: 'timedOut' });
    }
  }, [timedOut]);

  async function handlePasswordSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (phase.kind !== 'passwordRequired') {
      return;
    }
    setSubmitting(true);
    setPasswordError(null);
    try {
      const result = await verifyDownloadPassword(token, password);
      if (result.kind === 'ready') {
        setPhase({ kind: 'ready', meta: phase.meta, downloadUrl: result.downloadUrl });
      } else if (result.kind === 'wrongPassword') {
        setAttempts((n) => n + 1);
        // Cosmetic only — nothing throttles attempts server-side yet, so a
        // reload resets this. Don't present it as a lockout.
        setPasswordError('Ce mot de passe est incorrect.');
      } else if (result.kind === 'expired') {
        setPhase({ kind: 'expired' });
      } else {
        setPhase({ kind: 'invalid' });
      }
    } catch {
      setPhase({ kind: 'error' });
    } finally {
      setSubmitting(false);
    }
  }

  if (phase.kind === 'loading') {
    return (
      <PageShell title="Télécharger un fichier">
        <p>Chargement…</p>
      </PageShell>
    );
  }

  if (phase.kind === 'invalid') {
    return (
      <PageShell title="Télécharger un fichier">
        <Callout variant="error">Ce lien n'est pas valide.</Callout>
      </PageShell>
    );
  }

  if (phase.kind === 'expired') {
    return (
      <PageShell title="Télécharger un fichier">
        <Callout variant="error">
          Ce fichier n'est plus disponible en téléchargement car il a expiré.
        </Callout>
      </PageShell>
    );
  }

  if (phase.kind === 'error') {
    return (
      <PageShell title="Télécharger un fichier">
        <Callout variant="error">Une erreur est survenue. Réessayez plus tard.</Callout>
      </PageShell>
    );
  }

  if (phase.kind === 'timedOut') {
    return (
      <PageShell title="Télécharger un fichier">
        <Callout variant="error">
          La vérification de ce fichier prend plus de temps que prévu. Réessayez plus tard.
        </Callout>
      </PageShell>
    );
  }

  // scanning, passwordRequired and ready all share the file header.
  const { meta } = phase;

  return (
    <PageShell title="Télécharger un fichier">
      <FileInfo name={meta.originalName} size={formatFileSize(meta.sizeBytes)} />
      {meta.senderName && <p>Envoyé par {meta.senderName}</p>}

      {phase.kind === 'scanning' && (
        <>
          <Callout variant="info">
            Ce fichier est en cours de vérification. Réessayez dans quelques instants.
          </Callout>
          <Button variant="primary" fullWidth icon={<DownloadIcon />} disabled>
            Télécharger
          </Button>
        </>
      )}

      {phase.kind === 'ready' && (
        <>
          <Callout variant={expiryTone(meta.expiresAt)}>{expiryMessage(meta.expiresAt)}</Callout>
          <Button
            variant="primary"
            fullWidth
            icon={<DownloadIcon />}
            onClick={() => (window.location.href = phase.downloadUrl)}
          >
            Télécharger
          </Button>
        </>
      )}

      {phase.kind === 'passwordRequired' && (
        <form onSubmit={handlePasswordSubmit} className={styles.form}>
          <Callout variant={expiryTone(meta.expiresAt)}>{expiryMessage(meta.expiresAt)}</Callout>
          {passwordError && (
            <Callout variant="error">
              {passwordError} Tentative {attempts}.
            </Callout>
          )}
          <Input
            label="Mot de passe"
            type="password"
            placeholder="Saisissez le mot de passe…"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <Button
            type="submit"
            variant="primary"
            fullWidth
            icon={<DownloadIcon />}
            disabled={submitting || password.length === 0}
          >
            Télécharger
          </Button>
        </form>
      )}
    </PageShell>
  );
}

function expiryMessage(expiresAt: string): string {
  const tone = expiryTone(expiresAt);
  if (tone === 'error') {
    return 'Ce fichier a expiré.';
  }
  if (tone === 'alert') {
    return 'Ce fichier expirera demain.';
  }
  const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  return `Ce fichier expirera dans ${days} jours.`;
}
