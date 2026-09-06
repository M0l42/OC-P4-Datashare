import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { DownloadController } from './download.controller';
import { DownloadService } from './download.service';
import { DownloadThrottlerGuard } from './download-throttler.guard';

@Module({
  imports: [StorageModule],
  controllers: [DownloadController],
  providers: [DownloadService, DownloadThrottlerGuard],
})
export class DownloadModule {}
