import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { DownloadController } from './download.controller';
import { DownloadService } from './download.service';

@Module({
  imports: [StorageModule],
  controllers: [DownloadController],
  providers: [DownloadService],
})
export class DownloadModule {}
