import { createBundledHighlighter } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

import type { SyntaxLanguage } from './packageModel';

export interface HighlightedToken {
  content: string;
  color?: string;
  backgroundColor?: string;
  fontStyle?: number;
  htmlStyle?: Record<string, string>;
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
