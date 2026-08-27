import { Injectable, NotFoundException } from '@nestjs/common';
import { FileState } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class FileDeletionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  // Owner-facing entry point for `DELETE /files/:id`. Ownership is checked
  // here, once, before anything touches storage — every other method in this
  // service is reusable by system jobs (US10) that have no owner to check.
  async deleteOwnedFile(ownerId: string, fileId: string): Promise<void> {
    const file = await this.prisma.file.findFirst({
      where: { id: fileId, ownerId },
    });
    if (!file) {
      throw new NotFoundException('File not found');
    }

    // Dispatch on whether a storage object can still exist, not on the state
    // name: `expired` and `rejected` both null `storageKey` (the former at
    // expiry, the latter in validation.service.ts on scan failure), and both
    // must go through the row-only path so this can never issue a
    // DeleteObject against a key that has already been emptied.
    if (file.storageKey === null) {
      await this.purgeTombstone(file.id);
    } else {
      await this.deleteFileCompletely(file.id);
    }
  }

  // Object + row. Safe to call on `pending` (aborts the multipart instead of
  // deleting an object that was never completed), and on `uploaded` /
  // `scanning` / `ready` / `rejected`-with-a-stale-key (deletes the object).
  //
  // Deletion is deliberately allowed while a file is `scanning`: the object
  // still exists and ClamAV/magic-bytes may be reading it. Accepted trade-off
  // (documented in docs/journal-ia.md) rather than touching the scan worker:
  // worst case the in-flight validation job fails once against a vanished
  // object or row, and BullMQ's existing `attempts: 3` retry (scan-queue
  // .service.ts) re-runs it — the retry's initial lookup in
  // validation.service.ts#validate finds no row and returns `skipped`
  // cleanly. Self-resolving with zero changes outside US06's boundary.
  async deleteFileCompletely(fileId: string): Promise<void> {
    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!file) {
      return;
    }

    if (file.uploadId && file.state === FileState.pending) {
      try {
        await this.storage.abortMultipartUpload(
          file.storageKey!,
          file.uploadId,
        );
      } catch (error) {
        // A concurrent delete may have aborted it first; abort is not
        // naturally idempotent at the S3 API the way DeleteObject is.
        if (!isNoSuchUpload(error)) {
          throw error;
        }
      }
    } else if (file.storageKey) {
      await this.storage.deleteObject(file.storageKey);
    }

    await this.deleteRow(fileId);
  }

  // Row only, never storage. This is the one method US10's ghost-row purge
  // and the manual delete of an already-expired/rejected row are both
  // allowed to call, and the reason it exists separately: a tombstone's
  // `storageKey` is already null, so nothing here can ever construct a
  // DeleteObject call against it.
  async purgeTombstone(fileId: string): Promise<void> {
    await this.deleteRow(fileId);
  }

  private async deleteRow(fileId: string): Promise<void> {
    try {
      await this.prisma.file.delete({ where: { id: fileId } });
    } catch (error) {
      if (!isRecordNotFound(error)) {
        throw error;
      }
      // Already gone — a concurrent delete (double-click, or a system purge)
      // won the race. The caller asked for the file to not exist, and it
      // doesn't; that is success, not a 404-worthy failure.
    }
  }
}

function isNoSuchUpload(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'NoSuchUpload'
  );
}

function isRecordNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2025'
  );
}
