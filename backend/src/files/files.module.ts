import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { ScanModule } from '../scan/scan.module';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';

@Module({
  imports: [StorageModule, ScanModule],
  controllers: [FilesController],
  providers: [FilesService],
})
export class FilesModule {}
