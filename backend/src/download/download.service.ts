import {
  GoneException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { FileState } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

// Message identique quel que soit le motif : jeton inconnu, fichier refusé
// par le scan ou upload jamais terminé. Distinguer les trois transformerait
// la page en oracle permettant de sonder des jetons. Voir diagramme 5.
const INVALID_LINK_MESSAGE = 'This link is not valid';

// États pour lesquels la page destinataire affiche quelque chose : soit le
// fichier est prêt, soit il est en cours de validation. Tout le reste est
// indistinguable d'un jeton inconnu.
const RESOLVABLE_STATES: FileState[] = [
  FileState.uploaded,
  FileState.scanning,
  FileState.ready,
];

interface FileMetadata {
  originalName: string;
  sizeBytes: number;
  mimeType: string;
  expiresAt: Date;
  passwordRequired: boolean;
  senderName?: string | null;
}

@Injectable()
export class DownloadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async getMetadata(token: string): Promise<{
    status: 'ready' | 'scanning';
    metadata: FileMetadata;
    downloadUrl?: string;
  }> {
    const file = await this.resolveToken(token);

    if (file.state !== FileState.ready) {
      // `uploaded` (en attente de prise en charge) et `scanning` (analyse en
      // cours) sont indistinguables pour le destinataire : dans les deux cas
      // le fichier existe et n'est pas encore téléchargeable.
      return { status: 'scanning', metadata: this.toMetadata(file) };
    }

    const metadata = this.toMetadata(file);
    if (!file.passwordHash) {
      const downloadUrl = await this.storage.signDownloadUrl(
        file.storageKey!,
        file.originalName,
      );
      return { status: 'ready', metadata, downloadUrl };
    }
    return { status: 'ready', metadata };
  }

  async verifyPasswordAndGetUrl(
    token: string,
    password: string | undefined,
  ): Promise<{ downloadUrl: string }> {
    const file = await this.resolveToken(token);

    if (file.state !== FileState.ready) {
      // Pas d'URL possible tant que l'analyse n'est pas terminée ; le
      // client est censé re-consulter GET avant d'appeler POST, mais on
      // ne fait pas confiance à l'ordre des appels côté client.
      throw new GoneException('This file is still being scanned');
    }

    if (file.passwordHash) {
      const valid = password
        ? await bcrypt.compare(password, file.passwordHash)
        : false;
      if (!valid) {
        throw new UnauthorizedException('Incorrect password');
      }
    }

    const downloadUrl = await this.storage.signDownloadUrl(
      file.storageKey!,
      file.originalName,
    );
    return { downloadUrl };
  }

  // Résout le jeton et applique la barrière de sécurité du produit : un
  // lien ne résout que dans l'état `ready` (et pas encore expiré). Tout le
  // reste (jeton inconnu, pending/rejected/abandoned, ou expiré par la date
  // même si la purge quotidienne n'est pas encore passée) renvoie la même
  // réponse générique, sauf `expired` (le destinataire avait déjà le lien,
  // donc le dire ne révèle rien).
  //
  // `uploaded` compte comme « analyse en cours » au même titre que
  // `scanning`, et ce n'est pas cosmétique : depuis SOC-05, il existe une
  // vraie fenêtre entre `complete` et la prise en charge du job par le
  // worker. Un destinataire qui ouvre le lien pendant cette fenêtre verrait
  // sinon « ce lien n'est pas valide » — définitivement, puisque la page
  // n'interroge plus après un 404 — pour un fichier parfaitement sain.
  // Avant SOC-05, `uploaded` n'existait jamais au repos, donc le cas ne se
  // produisait pas.
  private async resolveToken(token: string) {
    const file = await this.prisma.file.findUnique({
      where: { downloadToken: token },
      include: { owner: { select: { displayName: true } } },
    });

    if (!file || !RESOLVABLE_STATES.includes(file.state)) {
      if (file?.state === FileState.expired) {
        throw new GoneException(
          'This file is no longer available: it has expired',
        );
      }
      throw new NotFoundException(INVALID_LINK_MESSAGE);
    }

    if (
      file.state === FileState.ready &&
      file.expiresAt.getTime() < Date.now()
    ) {
      throw new GoneException(
        'This file is no longer available: it has expired',
      );
    }

    return file;
  }

  private toMetadata(file: {
    originalName: string;
    sizeBytes: number;
    mimeType: string;
    expiresAt: Date;
    passwordHash: string | null;
    showSender: boolean;
    owner: { displayName: string | null };
  }): FileMetadata {
    return {
      originalName: file.originalName,
      sizeBytes: file.sizeBytes,
      mimeType: file.mimeType,
      expiresAt: file.expiresAt,
      passwordRequired: !!file.passwordHash,
      senderName: file.showSender ? file.owner.displayName : undefined,
    };
  }
}
