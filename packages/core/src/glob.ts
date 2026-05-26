/**
 * Browser-safe glob matcher that supports:
 * - double-star matching zero or more path segments when followed by a slash
 * - double-star matching any characters including slash when not followed by a slash
 * - single-star matching any characters except slash
 * - question-mark matching exactly one character except slash
 * - Other characters match literally (with regex specials escaped).
 *
 * The pattern is anchored at both ends.
 */
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
      // Escape all regex special characters
      regexSource += char.replace(/[\\^$.*+?|()[\]{}]/g, '\\$&');
      i += 1;
    }
  }
  return new RegExp(`^${regexSource}$`).test(path);
}
