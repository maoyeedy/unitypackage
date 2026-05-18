import path from 'node:path';
import sanitize from 'sanitize-filename';

export function sanitizePackagePath(rawPath: string): string {
  const components = rawPath.split(/[/\\]/);
  const sanitized = components
    .map(c => sanitize(c))
    .filter(c => c.length > 0);
  let normalized = sanitized.join('/').replace(/^\/+|\/+$/g, '');
  if (normalized.startsWith('./')) normalized = normalized.slice(2);
  return normalized;
}

export function sanitizeFsPath(rawPath: string): string {
  const trimmed = rawPath.trimEnd();
  const segments = trimmed.split(/[\\/]+/);
  const safe = segments.map(seg => sanitize(seg) || '_');
  return safe.join(path.sep);
}

export function isInside(parent: string, child: string): boolean {
  const resolvedParent = path.resolve(parent);
  const resolvedChild = path.resolve(child);
  return resolvedChild === resolvedParent || resolvedChild.startsWith(resolvedParent + path.sep);
}

export function assertInside(parent: string, child: string): void {
  if (!isInside(parent, child)) {
    throw new Error(`Path escape: "${child}" is outside "${parent}"`);
  }
}
