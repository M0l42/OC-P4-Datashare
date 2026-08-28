import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageService } from './storage.service';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(),
}));

const CONFIG: Record<string, string> = {
  S3_BUCKET: 'datashare',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY: 'key',
  S3_SECRET_KEY: 'secret',
  S3_ENDPOINT: 'http://minio:9000',
  S3_PUBLIC_ENDPOINT: 'http://localhost:9000',
};

describe('StorageService', () => {
  let service: StorageService;
  let sendSpy: jest.SpyInstance;

  beforeEach(async () => {
    sendSpy = jest.spyOn(S3Client.prototype, 'send');
    (getSignedUrl as jest.Mock).mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        {
          provide: ConfigService,
          useValue: { getOrThrow: (key: string) => CONFIG[key] },
        },
      ],
    }).compile();

    service = module.get<StorageService>(StorageService);
  });

  afterEach(() => {
    sendSpy.mockRestore();
  });

  it('createMultipartUpload returns the UploadId from S3', async () => {
    sendSpy.mockResolvedValue({ UploadId: 'upload-1' });

    const uploadId = await service.createMultipartUpload(
      'uploads/f1',
      'text/plain',
    );

    expect(uploadId).toBe('upload-1');
    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          Bucket: 'datashare',
          Key: 'uploads/f1',
          ContentType: 'text/plain',
        }),
      }),
    );
  });

  it('signPartUrls signs one URL per requested part number', async () => {
    (getSignedUrl as jest.Mock).mockImplementation(
      (_client, command: { input: { PartNumber: number } }) =>
        Promise.resolve(`https://signed.example/${command.input.PartNumber}`),
    );

    const parts = await service.signPartUrls('uploads/f1', 'upload-1', [1, 2, 3]);

    expect(parts).toEqual([
      { partNumber: 1, url: 'https://signed.example/1' },
      { partNumber: 2, url: 'https://signed.example/2' },
      { partNumber: 3, url: 'https://signed.example/3' },
    ]);
  });

  it('listParts maps S3 parts to the UploadedPart shape', async () => {
    sendSpy.mockResolvedValue({
      Parts: [{ PartNumber: 1, ETag: '"etag-1"', Size: 8388608 }],
    });

    const parts = await service.listParts('uploads/f1', 'upload-1');

    expect(parts).toEqual([{ partNumber: 1, etag: '"etag-1"', size: 8388608 }]);
  });

  it('listParts returns an empty array when S3 reports no parts', async () => {
    sendSpy.mockResolvedValue({});

    await expect(service.listParts('uploads/f1', 'upload-1')).resolves.toEqual(
      [],
    );
  });

  it('completeMultipartUpload sends the parts in the shape S3 expects', async () => {
    sendSpy.mockResolvedValue({});

    await service.completeMultipartUpload('uploads/f1', 'upload-1', [
      { partNumber: 1, etag: '"etag-1"' },
    ]);

    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          MultipartUpload: { Parts: [{ PartNumber: 1, ETag: '"etag-1"' }] },
        }),
      }),
    );
  });

  it('getObjectRange requests only the declared byte range', async () => {
    sendSpy.mockResolvedValue({
      Body: { transformToByteArray: () => Promise.resolve(new Uint8Array([1, 2, 3])) },
    });

    const buffer = await service.getObjectRange('uploads/f1', 63);

    expect(buffer).toEqual(Buffer.from([1, 2, 3]));
    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ Range: 'bytes=0-63' }),
      }),
    );
  });

  it('getObjectFull returns the whole object as a Buffer', async () => {
    sendSpy.mockResolvedValue({
      Body: { transformToByteArray: () => Promise.resolve(new Uint8Array([9, 9])) },
    });

    await expect(service.getObjectFull('uploads/f1')).resolves.toEqual(
      Buffer.from([9, 9]),
    );
  });

  it('headObject defaults contentLength to 0 when S3 omits it', async () => {
    sendSpy.mockResolvedValue({});

    await expect(service.headObject('uploads/f1')).resolves.toEqual({
      contentLength: 0,
    });
  });

  it('headObject returns the real ContentLength when present', async () => {
    sendSpy.mockResolvedValue({ ContentLength: 12345 });

    await expect(service.headObject('uploads/f1')).resolves.toEqual({
      contentLength: 12345,
    });
  });

  it('abortMultipartUpload and deleteObject issue the matching S3 commands', async () => {
    sendSpy.mockResolvedValue({});

    await service.abortMultipartUpload('uploads/f1', 'upload-1');
    await service.deleteObject('uploads/f1');

    expect(sendSpy).toHaveBeenCalledTimes(2);
  });

  it('signDownloadUrl forces attachment disposition and strips quote/CRLF injection from the filename', async () => {
    (getSignedUrl as jest.Mock).mockResolvedValue('https://signed.example/download');

    const url = await service.signDownloadUrl(
      'uploads/f1',
      'evil".pdf\r\nX-Injected: 1',
    );

    expect(url).toBe('https://signed.example/download');
    const [, command] = (getSignedUrl as jest.Mock).mock.calls[0] as [
      unknown,
      { input: { ResponseContentDisposition: string } },
    ];
    expect(command.input.ResponseContentDisposition).toBe(
      'attachment; filename="evil.pdfX-Injected: 1"',
    );
  });
});
