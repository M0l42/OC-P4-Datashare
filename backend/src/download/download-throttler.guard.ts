import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
} from '@nestjs/throttler';
import type {
  ThrottlerModuleOptions,
  ThrottlerRequest,
  ThrottlerStorage,
} from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';

// dlTokenPassword protège un secret. Un fichier sans mot de passe passe quand
// même par ce POST (clic sur Télécharger, diagramme 5b) mais n'a rien à
// brute-forcer : lui appliquer le même plafond de 6/2 min pénaliserait une
// reprise légitime (connexion coupée, rechargement) sans rien protéger.
@Injectable()
export class DownloadThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {
    super(options, storageService, reflector);
  }

  protected async handleRequest(
    requestProps: ThrottlerRequest,
  ): Promise<boolean> {
    if (requestProps.throttler.name === 'dlTokenPassword') {
      const { req } = this.getRequestResponse(requestProps.context);
      const token = (req.params as { token?: string }).token;
      const file = token
        ? await this.prisma.file.findUnique({
            where: { downloadToken: token },
            select: { passwordHash: true },
          })
        : null;
      if (!file?.passwordHash) {
        return true;
      }
    }
    return super.handleRequest(requestProps);
  }
}
