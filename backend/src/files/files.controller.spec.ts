import { Test, TestingModule } from '@nestjs/testing';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';

describe('FilesController', () => {
  let controller: FilesController;
  let mockFilesService: {
    initiateUpload: jest.Mock;
    getUploadParts: jest.Mock;
    getUploadStatus: jest.Mock;
    completeUpload: jest.Mock;
    abortUpload: jest.Mock;
  };

  const ownerId = 'owner-1';
  const fileId = 'file-1';
  const req = { user: { userId: ownerId } } as never;

  beforeEach(async () => {
    mockFilesService = {
      initiateUpload: jest.fn(),
      getUploadParts: jest.fn(),
      getUploadStatus: jest.fn(),
      completeUpload: jest.fn(),
      abortUpload: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FilesController],
      providers: [{ provide: FilesService, useValue: mockFilesService }],
    }).compile();

    controller = module.get<FilesController>(FilesController);
  });

  it('initiate delegates to the service with the authenticated owner', () => {
    const dto = { originalName: 'report.pdf', mimeType: 'application/pdf', sizeBytes: 10 };
    controller.initiate(req, dto as never);
    expect(mockFilesService.initiateUpload).toHaveBeenCalledWith(ownerId, dto);
  });

  it('getParts delegates the owner and file id', () => {
    controller.getParts(req, fileId);
    expect(mockFilesService.getUploadParts).toHaveBeenCalledWith(ownerId, fileId);
  });

  it('getStatus delegates the owner and file id', () => {
    controller.getStatus(req, fileId);
    expect(mockFilesService.getUploadStatus).toHaveBeenCalledWith(ownerId, fileId);
  });

  it('complete delegates the owner, file id and parts', () => {
    const dto = { parts: [{ partNumber: 1, etag: 'etag-1' }] };
    controller.complete(req, fileId, dto as never);
    expect(mockFilesService.completeUpload).toHaveBeenCalledWith(ownerId, fileId, dto);
  });

  it('abort delegates the owner and file id', () => {
    controller.abort(req, fileId);
    expect(mockFilesService.abortUpload).toHaveBeenCalledWith(ownerId, fileId);
  });
});
