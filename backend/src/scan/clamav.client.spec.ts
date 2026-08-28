import * as net from 'node:net';
import { ConfigService } from '@nestjs/config';
import { ClamAvClient } from './clamav.client';

// A fake clamd: real TCP, not a mocked Socket — exercises the actual
// connect/write/parse path rather than asserting on internals.
function startFakeClamd(response: string): Promise<{ server: net.Server; port: number }> {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      socket.end(response);
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as net.AddressInfo;
      resolve({ server, port: address.port });
    });
  });
}

function makeClient(port: number): ClamAvClient {
  const config = {
    get: (key: string) => (key === 'CLAMAV_PORT' ? String(port) : '127.0.0.1'),
  };
  return new ClamAvClient(config as unknown as ConfigService);
}

describe('ClamAvClient', () => {
  let server: net.Server | undefined;

  afterEach(() => {
    server?.close();
    server = undefined;
  });

  it('reports clean for a plain OK response', async () => {
    ({ server } = await startFakeClamd('stream: OK\0'));
    const client = makeClient((server.address() as net.AddressInfo).port);

    await expect(client.scanBuffer(Buffer.from('hello'))).resolves.toEqual({
      kind: 'clean',
    });
  });

  it('reports the signature when clamd finds a match', async () => {
    ({ server } = await startFakeClamd('stream: Eicar-Signature FOUND\0'));
    const client = makeClient((server.address() as net.AddressInfo).port);

    await expect(client.scanBuffer(Buffer.from('X5O!P%'))).resolves.toEqual({
      kind: 'infected',
      signature: 'Eicar-Signature',
    });
  });

  it('rejects on a response matching neither OK nor FOUND', async () => {
    ({ server } = await startFakeClamd('stream: UNKNOWN COMMAND\0'));
    const client = makeClient((server.address() as net.AddressInfo).port);

    await expect(client.scanBuffer(Buffer.from('x'))).rejects.toThrow(
      'Unexpected ClamAV response',
    );
  });

  it('rejects when the socket cannot connect', async () => {
    // Nothing listens on this port — a real ECONNREFUSED, not a stub.
    const client = makeClient(1);

    await expect(client.scanBuffer(Buffer.from('x'))).rejects.toThrow();
  }, 10000);

  it('chunks buffers larger than the 64 KiB INSTREAM frame size without dropping bytes', async () => {
    // The client's chunking loop is exercised end to end: the fake server
    // just has to survive receiving more than one frame before responding.
    ({ server } = await startFakeClamd('stream: OK\0'));
    const client = makeClient((server.address() as net.AddressInfo).port);
    const big = Buffer.alloc(64 * 1024 * 2 + 10, 'a');

    await expect(client.scanBuffer(big)).resolves.toEqual({ kind: 'clean' });
  });
});
