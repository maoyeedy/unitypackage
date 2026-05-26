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
});
