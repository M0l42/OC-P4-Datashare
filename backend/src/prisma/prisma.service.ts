import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// Étend PrismaClient directement : injecter PrismaService donne accès à
// this.prisma.user, this.prisma.file, etc. onModuleInit force la connexion
// au démarrage plutôt qu'à la première requête.
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
  }
}
