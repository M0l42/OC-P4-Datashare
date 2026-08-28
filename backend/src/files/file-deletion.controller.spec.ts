import { Test, TestingModule } from '@nestjs/testing';
import { FileDeletionController } from './file-deletion.controller';
import { FileDeletionService } from './file-deletion.service';

describe('FileDeletionController', () => {
  let controller: FileDeletionController;
  let mockFileDeletionService: { deleteOwnedFile: jest.Mock };

  const ownerId = 'owner-1';
  const fileId = 'file-1';
  const req = { user: { userId: ownerId } } as never;

  beforeEach(async () => {
    mockFileDeletionService = { deleteOwnedFile: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FileDeletionController],
      providers: [
        { provide: FileDeletionService, useValue: mockFileDeletionService },
      ],
    }).compile();

    controller = module.get<FileDeletionController>(FileDeletionController);
  });

  it('remove delegates to the service with the authenticated owner, never a client-supplied one', () => {
    controller.remove(req, fileId);

    expect(mockFileDeletionService.deleteOwnedFile).toHaveBeenCalledWith(
      ownerId,
      fileId,
    );
  });
});
