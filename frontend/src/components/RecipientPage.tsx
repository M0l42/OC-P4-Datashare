import { useCallback, useEffect, useState } from 'react'
import { Callout } from './Callout'
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

// UI-01 : les 4 états que les maquettes ne couvrent pas (attente de scan,
// mot de passe erroné, jeton invalide, fichier refusé — ces deux derniers
// rendus à l'identique) posés sur les 4 états qu'elles couvrent (mot de passe
// requis, prêt + Info, prêt + Alert, expiré). Aucune page destinataire
// n'existait avant ce ticket ; la mise en page suit les maquettes
// (`design/figma/telechargement/`), le style détaillé (police, tokens de
// couleur) reste à câbler par UI-02.
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

  // Re-consulte GET tant que l'état est `scanning`. « Ce fichier est en
  // cours de vérification. Réessayez dans quelques instants. » resterait un
  // mensonge si personne ne réessayait jamais.
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
        // Compteur purement côté client, pour l'UX seulement : aucune
        // limitation n'est appliquée côté serveur (voir SECURITY.md,
        // « à venir »). Ne jamais présenter ceci comme un vrai verrou.
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
    return <main><p>Chargement…</p></main>;
  }

  if (phase.kind === 'invalid') {
    return (
      <main>
        <h1>Télécharger un fichier</h1>
        <Callout variant="error">Ce lien n'est pas valide.</Callout>
      </main>
    );
  }

  if (phase.kind === 'expired') {
    return (
      <main>
        <h1>Télécharger un fichier</h1>
        <Callout variant="error">Ce fichier n'est plus disponible en téléchargement car il a expiré.</Callout>
      </main>
    );
  }

  if (phase.kind === 'error') {
    return (
      <main>
        <h1>Télécharger un fichier</h1>
        <Callout variant="error">Une erreur est survenue. Réessayez plus tard.</Callout>
      </main>
    );
  }

  if (phase.kind === 'timedOut') {
    return (
      <main>
        <h1>Télécharger un fichier</h1>
        <Callout variant="error">
          La vérification de ce fichier prend plus de temps que prévu. Réessayez plus tard.
        </Callout>
      </main>
    );
  }

  // scanning, passwordRequired, ready partagent tous l'en-tête fichier.
  const { meta } = phase;

  return (
    <main>
      <h1>Télécharger un fichier</h1>
      <p>
        {meta.originalName} — {formatFileSize(meta.sizeBytes)}
      </p>
      {meta.senderName && <p>Envoyé par {meta.senderName}</p>}

      {phase.kind === 'scanning' && (
        <Callout variant="info">
          Ce fichier est en cours de vérification. Réessayez dans quelques instants.
        </Callout>
      )}

      {phase.kind === 'ready' && (
        <>
          <Callout variant={expiryTone(meta.expiresAt)}>{expiryMessage(meta.expiresAt)}</Callout>
          <p>
            <a href={phase.downloadUrl}>Télécharger</a>
          </p>
        </>
      )}

      {phase.kind === 'passwordRequired' && (
        <form onSubmit={handlePasswordSubmit}>
          <Callout variant={expiryTone(meta.expiresAt)}>{expiryMessage(meta.expiresAt)}</Callout>
          {passwordError && (
            <Callout variant="error">
              {passwordError}
              <br />
              <small>Tentative {attempts}</small>
            </Callout>
          )}
          <p>
            <label>
              Mot de passe
              <br />
              <input
                type="password"
                placeholder="Saisissez le mot de passe…"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
          </p>
          <button type="submit" disabled={submitting || password.length === 0}>
            Télécharger
          </button>
        </form>
      )}

      {phase.kind === 'scanning' && <button type="button" disabled>Télécharger</button>}
    </main>
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
