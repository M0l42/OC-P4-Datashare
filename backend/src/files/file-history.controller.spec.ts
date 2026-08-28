import { Test, TestingModule } from '@nestjs/testing';
import { FileHistoryController } from './file-history.controller';
import { FilesService } from './files.service';

describe('FileHistoryController', () => {
  let controller: FileHistoryController;
  let mockFilesService: { listFiles: jest.Mock };

  const ownerId = 'owner-1';
  const req = { user: { userId: ownerId } } as never;

  beforeEach(async () => {
    mockFilesService = { listFiles: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FileHistoryController],
      providers: [{ provide: FilesService, useValue: mockFilesService }],
    }).compile();

    controller = module.get<FileHistoryController>(FileHistoryController);
  });

  it('list delegates the owner and the requested filter', () => {
    controller.list(req, { filter: 'active' });

    expect(mockFilesService.listFiles).toHaveBeenCalledWith(
      ownerId,
      'active',
    );
  });

  it('list passes undefined through when no filter is given, letting the service default it', () => {
    controller.list(req, {});

    expect(mockFilesService.listFiles).toHaveBeenCalledWith(
      ownerId,
      undefined,
    );
  });
});
