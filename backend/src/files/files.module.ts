import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { ScanModule } from '../scan/scan.module';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { FileDeletionController } from './file-deletion.controller';
import { FileDeletionService } from './file-deletion.service';

@Module({
  imports: [StorageModule, ScanModule],
  controllers: [FilesController, FileDeletionController],
  providers: [FilesService, FileDeletionService],
  exports: [FileDeletionService],
})
export class FilesModule {}
