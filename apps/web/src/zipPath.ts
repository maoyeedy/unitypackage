export function uniqueZipPath(path: string, usedNames: Map<string, number>): string {
  const safePath = path.replace(/^\/+/, '') || 'file';
  const seen = usedNames.get(safePath) ?? 0;
  usedNames.set(safePath, seen + 1);
  if (seen === 0) return safePath;

  const slashIndex = safePath.lastIndexOf('/');
  const directory = slashIndex === -1 ? '' : safePath.slice(0, slashIndex + 1);
  const name = slashIndex === -1 ? safePath : safePath.slice(slashIndex + 1);
  const dotIndex = name.lastIndexOf('.');
  const stem = dotIndex > 0 ? name.slice(0, dotIndex) : name;
  const ext = dotIndex > 0 ? name.slice(dotIndex) : '';
  return `${directory}${stem} (${seen + 1})${ext}`;
}
