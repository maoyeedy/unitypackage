import http from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { web } from './web.js';

describe('web command', () => {
  it('listens on the requested host and logs the actual URL', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      const running = web({ port: 0, host: '127.0.0.1' });

      await vi.waitFor(() => {
        expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/^Web app running at http:\/\/127\.0\.0\.1:\d+$/));
      });

      process.emit('SIGINT');
      await running;
    } finally {
      logSpy.mockRestore();
    }
  });

  it('does not serve files outside the bundled web assets', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      const running = web({ port: 0, host: '127.0.0.1' });
      let url = '';

      await vi.waitFor(() => {
        const call = logSpy.mock.calls.find(candidate => /^Web app running at /.test(String(candidate[0])));
        expect(call).toBeDefined();
        url = String(call?.[0]).replace('Web app running at ', '');
      });

      await expect(readStatus(url, '/%2e%2e/%2e%2e/README.md')).resolves.toBe(404);
      await expect(readStatus(url, '/nested/app/route')).resolves.toBe(200);

      process.emit('SIGINT');
      await running;
    } finally {
      logSpy.mockRestore();
    }
  });
});

async function readStatus(baseUrl: string, requestPath: string): Promise<number | undefined> {
  const parsedUrl = new URL(baseUrl);
  return await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: requestPath,
    }, res => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
}
