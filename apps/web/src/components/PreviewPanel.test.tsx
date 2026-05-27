// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { PreviewPanel } from './PreviewPanel';
import type { PackageFileRecord } from '../packageModel';

const encoder = new TextEncoder();

function createMockRecord(overrides: Partial<PackageFileRecord>): PackageFileRecord {
  return {
    id: 'test-id',
    guid: 'test-guid-aaaaaaaaaaaaaaaaaaaaaaaa',
    pathname: 'Assets/Test.cs',
    virtualPath: 'Assets/Test.cs',
    fileName: 'Test.cs',
    isUnityPreview: false,
    component: 'asset',
    content: encoder.encode('using System;\nclass Test {}'),
    byteLength: 29,
    extension: 'cs',
    mimeType: 'text/plain',
    previewKind: 'text',
    syntaxLanguage: 'csharp',
    diagnostics: [],
    hasAsset: true,
    hasMeta: false,
    hasPreview: false,
    duplicatePathCount: 0,
    ...overrides,
  };
}

describe('PreviewPanel Syntax Highlighting', () => {
  const onDownload = vi.fn();
  const onRevealInTree = vi.fn();

  it('renders csharp with highlighted tokens', () => {
    const record = createMockRecord({
      syntaxLanguage: 'csharp',
      content: encoder.encode('using System;\npublic class Test {}'),
    });

    const { container } = render(
      <PreviewPanel
        record={record}
        onDownload={onDownload}
        onRevealInTree={onRevealInTree}
      />
    );

    const codeElement = container.querySelector('code');
    expect(codeElement).toBeInTheDocument();

    const spans = codeElement?.querySelectorAll('span');
    expect(spans?.length).toBeGreaterThan(0);
    expect(codeElement?.innerHTML).toContain('<span');
  });

  it('renders text language as plain text without highlights', () => {
    const record = createMockRecord({
      syntaxLanguage: 'text',
      content: encoder.encode('using System;\npublic class Test {}'),
    });

    const { container } = render(
      <PreviewPanel
        record={record}
        onDownload={onDownload}
        onRevealInTree={onRevealInTree}
      />
    );

    const codeElement = container.querySelector('code');
    expect(codeElement).toBeInTheDocument();

    const spans = codeElement?.querySelectorAll('span');
    expect(spans?.length).toBe(0);
    expect(codeElement?.innerHTML).not.toContain('<span');
    expect(codeElement?.textContent).toContain('using System;');
  });

  it('smoke test for yaml highlighting does not crash and alters output', () => {
    const yamlContent = 'title: Test\nversion: 1.0.0\nauthor: John';
    const record = createMockRecord({
      syntaxLanguage: 'yaml',
      pathname: 'Assets/test.yaml',
      virtualPath: 'Assets/test.yaml',
      fileName: 'test.yaml',
      extension: 'yaml',
      content: encoder.encode(yamlContent),
    });

    const { container } = render(
      <PreviewPanel
        record={record}
        onDownload={onDownload}
        onRevealInTree={onRevealInTree}
      />
    );

    const codeElement = container.querySelector('code');
    expect(codeElement).toBeInTheDocument();

    const spans = codeElement?.querySelectorAll('span');
    expect(spans?.length).toBeGreaterThan(0);
    expect(codeElement?.innerHTML).not.toBe(yamlContent);
    expect(codeElement?.textContent).toBe(yamlContent);
  });

  it('smoke test for json highlighting does not crash and alters output', () => {
    const jsonContent = '{"name": "test", "active": true}';
    const record = createMockRecord({
      syntaxLanguage: 'json',
      pathname: 'Assets/test.json',
      virtualPath: 'Assets/test.json',
      fileName: 'test.json',
      extension: 'json',
      content: encoder.encode(jsonContent),
    });

    const { container } = render(
      <PreviewPanel
        record={record}
        onDownload={onDownload}
        onRevealInTree={onRevealInTree}
      />
    );

    const codeElement = container.querySelector('code');
    expect(codeElement).toBeInTheDocument();

    const spans = codeElement?.querySelectorAll('span');
    expect(spans?.length).toBeGreaterThan(0);
    expect(codeElement?.innerHTML).not.toBe(jsonContent);
    expect(codeElement?.textContent).toBe(jsonContent);
  });
});
