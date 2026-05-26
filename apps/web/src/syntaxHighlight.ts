import { createBundledHighlighter } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

import type { SyntaxLanguage } from './packageModel';

export interface HighlightedToken {
  content: string;
  color?: string;
  backgroundColor?: string;
  fontStyle?: number;
  htmlStyle?: Record<string, string>;
  isMatch?: boolean;
  isActiveMatch?: boolean;
}

export interface HighlightedCode {
  lines: HighlightedToken[][];
  foreground?: string;
  background?: string;
}

export type SyntaxThemeMode = 'light' | 'dark';

const languageLoaders = {
  yaml: () => import('@shikijs/langs/yaml'),
  json: () => import('@shikijs/langs/json'),
  xml: () => import('@shikijs/langs/xml'),
  css: () => import('@shikijs/langs/css'),
  csharp: () => import('@shikijs/langs/csharp'),
  shaderlab: () => import('@shikijs/langs/shaderlab'),
  hlsl: () => import('@shikijs/langs/hlsl'),
  glsl: () => import('@shikijs/langs/glsl'),
  typescript: () => import('@shikijs/langs/typescript'),
  javascript: () => import('@shikijs/langs/javascript'),
  markdown: () => import('@shikijs/langs/markdown'),
  html: () => import('@shikijs/langs/html'),
};

const themeLoaders = {
  'github-light': () => import('@shikijs/themes/github-light'),
  'github-dark': () => import('@shikijs/themes/github-dark'),
};

const createUnityHighlighter = createBundledHighlighter({
  langs: languageLoaders,
  themes: themeLoaders,
  engine: () => createJavaScriptRegexEngine(),
});

type UnityHighlighter = Awaited<ReturnType<typeof createUnityHighlighter>>;

let highlighterPromise: Promise<UnityHighlighter> | null = null;

export async function highlightCode(code: string, language: SyntaxLanguage, mode: SyntaxThemeMode): Promise<HighlightedCode> {
  const highlighter = await getHighlighter();
  const theme = mode === 'dark' ? 'github-dark' : 'github-light';
  const lang = language === 'text' ? 'text' : language;
  const result = highlighter.codeToTokens(code, {
    lang,
    theme,
    tokenizeMaxLineLength: 500,
  });

  return {
    lines: result.tokens.map(line => line.map(token => ({
      content: token.content,
      color: token.color,
      backgroundColor: token.bgColor,
      fontStyle: token.fontStyle,
      htmlStyle: token.htmlStyle,
    }))),
    foreground: result.fg,
    background: result.bg,
  };
}

function getHighlighter(): Promise<UnityHighlighter> {
  highlighterPromise ??= createUnityHighlighter({
    langs: Object.keys(languageLoaders),
    themes: Object.keys(themeLoaders),
  });
  return highlighterPromise;
}

export interface FindMatch {
  lineIndex: number;
  indexInLine: number;
  length: number;
  globalIndex: number;
}

export function findQueryMatches(lines: string[], query: string): FindMatch[] {
  if (!query) return [];
  const matches: FindMatch[] = [];
  let globalIndex = 0;
  const lowerQuery = query.toLowerCase();
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const lineText = lines[lineIndex];
    const lowerLineText = lineText.toLowerCase();
    let index = lowerLineText.indexOf(lowerQuery);
    while (index !== -1) {
      matches.push({
        lineIndex,
        indexInLine: index,
        length: query.length,
        globalIndex,
      });
      globalIndex++;
      index = lowerLineText.indexOf(lowerQuery, index + query.length);
    }
  }
  return matches;
}

export function splitLineTokensForMatches(
  tokens: HighlightedToken[],
  lineMatches: { indexInLine: number; length: number; globalIndex: number }[],
  activeGlobalIndex: number | null
): HighlightedToken[] {
  if (lineMatches.length === 0) return tokens;

  const result: HighlightedToken[] = [];
  let tokenStart = 0;

  for (const token of tokens) {
    const tokenEnd = tokenStart + token.content.length;
    let currentPos = tokenStart;

    // Find all matches that overlap with this token
    const overlapping = lineMatches.filter(m => {
      const matchStart = m.indexInLine;
      const matchEnd = m.indexInLine + m.length;
      return matchStart < tokenEnd && matchEnd > tokenStart;
    });

    if (overlapping.length === 0) {
      result.push(token);
      tokenStart = tokenEnd;
      continue;
    }

    // Sort overlapping matches by start index
    overlapping.sort((a, b) => a.indexInLine - b.indexInLine);

    for (const match of overlapping) {
      const matchStart = match.indexInLine;
      const matchEnd = match.indexInLine + match.length;

      // 1. Text before match (if any)
      if (currentPos < matchStart) {
        result.push({
          ...token,
          content: token.content.slice(currentPos - tokenStart, matchStart - tokenStart),
        });
        currentPos = matchStart;
      }

      // 2. Matching text
      const overlapStart = Math.max(currentPos, matchStart);
      const overlapEnd = Math.min(tokenEnd, matchEnd);
      if (overlapStart < overlapEnd) {
        result.push({
          ...token,
          content: token.content.slice(overlapStart - tokenStart, overlapEnd - tokenStart),
          isMatch: true,
          isActiveMatch: match.globalIndex === activeGlobalIndex,
        });
        currentPos = overlapEnd;
      }
    }

    // 3. Text after all matches (if any)
    if (currentPos < tokenEnd) {
      result.push({
        ...token,
        content: token.content.slice(currentPos - tokenStart, tokenEnd - tokenStart),
      });
    }

    tokenStart = tokenEnd;
  }

  return result;
}
