import path from 'node:path';

const windowsReservedName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function sanitizeFilename(name: string): string {
  const sanitized = name
    .replace(/[<>:"|?*\x00-\x1F\x80-\x9F]/g, '')
    .replace(/[. ]+$/g, '')
    .trim();

  if (sanitized === '.' || sanitized === '..' || windowsReservedName.test(sanitized)) {
    return '';
  }

  return sanitized;
}

export function sanitizePackagePath(rawPath: string): string {
  const components = rawPath.split(/[/\\]/);
  const sanitized = components
    .map(c => sanitizeFilename(c))
    .filter(c => c.length > 0);
  let normalized = sanitized.join('/').replace(/^\/+|\/+$/g, '');
  if (normalized.startsWith('./')) normalized = normalized.slice(2);
  return normalized;
}

export function sanitizeFsPath(rawPath: string): string {
  const trimmed = rawPath.trimEnd();
  const segments = trimmed.split(/[\\/]+/);
  const safe = segments.map(seg => sanitizeFilename(seg) || '_');
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
