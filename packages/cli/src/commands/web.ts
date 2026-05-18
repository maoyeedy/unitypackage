import { createServer, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CliError, EXIT } from '../util/exit.js';

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

export async function web(opts: { port?: number } = {}): Promise<void> {
  const port = opts.port ?? 5173;
  // Resolves to packages/cli/assets/web/ at runtime (dist/commands/web.js → ../../assets/web)
  const assetDir = fileURLToPath(new URL('../../assets/web/', import.meta.url));

  try {
    await stat(path.join(assetDir, 'index.html'));
  } catch {
    throw new CliError(
      'Web assets not found at ' + assetDir + '\nBuild first:\n  bun run build:web\n  bun run build:cli',
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
    server.on('error', reject);
    server.listen(port, () => {
      console.log(`Web app running at http://localhost:${port}`);
    });
    process.on('SIGINT', () => server.close(() => resolve()));
  });
}
