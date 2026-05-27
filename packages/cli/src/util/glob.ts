export function matchGlob(pattern: string, path: string): boolean {
  let regexSource = '';
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') {
        regexSource += '(?:.+/)?';
        i += 3;
      } else {
        regexSource += '.*';
        i += 2;
      }
    } else if (pattern[i] === '*') {
      regexSource += '[^/]*';
      i += 1;
    } else if (pattern[i] === '?') {
      regexSource += '[^/]';
      i += 1;
    } else {
      const char = pattern[i] ?? '';
      regexSource += char.replace(/[\\^$.*+?|()[\]{}]/g, '\\$&');
      i += 1;
    }
  }
  return new RegExp(`^${regexSource}$`).test(path);
}
