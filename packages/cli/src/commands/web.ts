import { createServer, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { CliError, EXIT } from '../util/exit.js';

export interface WebOptions {
  port?: number;
  host?: string;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
};

async function serveRequest(assetDir: string, url: string, res: ServerResponse): Promise<void> {
  let urlPath = url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';

  let filePath = path.join(assetDir, urlPath);

  try {
    await stat(filePath);
  } catch {
    filePath = path.join(assetDir, 'index.html');
  }

  try {
    const data = await readFile(filePath);
    const ext = path.extname(filePath);
    const mime = MIME[ext] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

export async function web(opts: WebOptions = {}): Promise<void> {
  const port = opts.port ?? 5173;
  const { host } = opts;
  // Resolves to packages/cli/assets/web/ at runtime (dist/commands/web.js → ../../assets/web)
  const assetDir = path.resolve(import.meta.dirname, '../../assets/web');

  try {
    await stat(path.join(assetDir, 'index.html'));
  } catch {
    throw new CliError(
      'Web assets not found at ' + assetDir + '\nRun from the workspace root: bun run build:cli',
      EXIT.IO,
    );
  }

  const server = createServer((req, res) => {
    serveRequest(assetDir, req.url ?? '/', res).catch((err: unknown) => {
      console.error('Request error:', err);
      res.writeHead(500);
      res.end('Internal server error');
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onSigint = (): void => {
      server.close(() => resolve());
    };
    const onListening = (): void => {
      const address = server.address();
      const actualPort = typeof address === 'object' && address !== null ? address.port : port;
      console.log(`Web app running at http://${formatUrlHost(host ?? 'localhost')}:${actualPort}`);
    };
    server.on('error', err => {
      process.off('SIGINT', onSigint);
      reject(err);
    });
    process.once('SIGINT', onSigint);
    if (host === undefined) server.listen(port, onListening);
    else server.listen(port, host, onListening);
  });
}

function formatUrlHost(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}
