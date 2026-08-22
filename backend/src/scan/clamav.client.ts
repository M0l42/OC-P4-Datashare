import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Socket } from 'node:net';

export type ClamAvVerdict =
  { kind: 'clean' } | { kind: 'infected'; signature: string };

const INSTREAM_CHUNK_SIZE = 64 * 1024;
const SOCKET_TIMEOUT_MS = 60_000;

// Client INSTREAM écrit à la main plutôt qu'une dépendance : le protocole
// tient en quelques lignes (zINSTREAM\0, puis des morceaux préfixés de leur
// taille en uint32 big-endian, puis un morceau de taille 0 pour terminer), et
// il vaut mieux 40 lignes qu'on sait expliquer qu'un paquet qu'on ne peut pas
// auditer. La réponse est `stream: OK`, `stream: <signature> FOUND` ou une
// erreur.
@Injectable()
export class ClamAvClient {
  private readonly logger = new Logger(ClamAvClient.name);
  private readonly host: string;
  private readonly port: number;

  constructor(config: ConfigService) {
    this.host = config.get<string>('CLAMAV_HOST') ?? 'clamav';
    this.port = Number(config.get<string>('CLAMAV_PORT') ?? 3310);
  }

  async scanBuffer(buffer: Buffer): Promise<ClamAvVerdict> {
    const response = await this.instream(buffer);
    // `zINSTREAM` (préfixe z) demande à clamd de terminer sa réponse par
    // un octet NUL. `String.trim()` ne retire PAS `\0` : sans ce nettoyage
    // explicite, `stream: OK\0` ne se termine pas par « OK » et tout
    // fichier sain part en erreur.
    const trimmed = response.replace(/\0/g, '').trim();

    if (trimmed.endsWith('OK') && !trimmed.includes('FOUND')) {
      return { kind: 'clean' };
    }
    if (trimmed.includes('FOUND')) {
      // Format : `stream: Eicar-Signature FOUND`
      const signature = trimmed
        .replace(/^stream:\s*/, '')
        .replace(/\s*FOUND$/, '');
      return { kind: 'infected', signature };
    }
    throw new Error(`Unexpected ClamAV response: ${trimmed}`);
  }

  private instream(buffer: Buffer): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = new Socket();
      const chunks: Buffer[] = [];
      let settled = false;

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(error);
      };

      socket.setTimeout(SOCKET_TIMEOUT_MS);
      socket.on('timeout', () => fail(new Error('ClamAV socket timed out')));
      socket.on('error', fail);
      socket.on('data', (chunk) => chunks.push(chunk));
      socket.on('close', () => {
        if (settled) return;
        settled = true;
        resolve(Buffer.concat(chunks).toString('utf8'));
      });

      socket.connect(this.port, this.host, () => {
        socket.write('zINSTREAM\0');
        for (
          let offset = 0;
          offset < buffer.length;
          offset += INSTREAM_CHUNK_SIZE
        ) {
          const slice = buffer.subarray(offset, offset + INSTREAM_CHUNK_SIZE);
          const header = Buffer.alloc(4);
          header.writeUInt32BE(slice.length, 0);
          socket.write(header);
          socket.write(slice);
        }
        // Morceau de taille zéro : fin du flux.
        const terminator = Buffer.alloc(4);
        terminator.writeUInt32BE(0, 0);
        socket.write(terminator);
      });
    });
  }
}
