// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { PreviewPanel } from './PreviewPanel';
import type { PackageFileRecord, SidecarSelectableRecord } from '../packageModel';
import hljs from 'highlight.js/lib/core';

const encoder = new TextEncoder();

type MockRecord = PackageFileRecord & { content: Uint8Array<ArrayBuffer> };

function createMockRecord(overrides: Partial<MockRecord>): MockRecord {
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

function renderPreviewPanel(
  record: MockRecord | null,
  onDownload: (record: PackageFileRecord) => void,
  onRevealInTree: (recordId: string) => void,
  metaSidecar?: MockRecord,
  selectableRecords?: readonly SidecarSelectableRecord[],
  getContentOverride?: (id: string) => Uint8Array<ArrayBuffer> | undefined,
) {
  const defaultGetContent = (id: string) => {
    if (metaSidecar?.id === id) return metaSidecar.content;
    if (record?.id === id) return record.content;
    return undefined;
  };
  return render(
    <PreviewPanel
      record={record}
      metaSidecar={metaSidecar}
      onDownload={onDownload}
      onRevealInTree={onRevealInTree}
      selectableRecords={selectableRecords}
      getContent={getContentOverride ?? defaultGetContent}
    />
  );
}

describe('PreviewPanel Syntax Highlighting', () => {
  const onDownload = vi.fn();
  const onRevealInTree = vi.fn();

  it('renders csharp with highlighted tokens', () => {
    const record = createMockRecord({
      syntaxLanguage: 'csharp',
      content: encoder.encode('using System;\npublic class Test {}'),
    });

    const { container } = renderPreviewPanel(record, onDownload, onRevealInTree);

    const codeElement = container.querySelector('code');
    expect(codeElement).toBeInTheDocument();

    const spans = codeElement?.querySelectorAll('span');
    expect(spans?.length).toBeGreaterThan(0);
    expect(codeElement?.innerHTML).toContain('<span');
  });

  it('falls back to plain text when hljs.highlight throws an error', () => {
    const record = createMockRecord({
      syntaxLanguage: 'csharp',
      content: encoder.encode('using System;\npublic class Test {}'),
    });

    const highlightSpy = vi.spyOn(hljs, 'highlight').mockImplementation(() => {
      throw new Error('Highlighting failed');
    });

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { container } = renderPreviewPanel(record, onDownload, onRevealInTree);

    const codeElement = container.querySelector('code');
    expect(codeElement).toBeInTheDocument();

    const spans = codeElement?.querySelectorAll('span');
    expect(spans?.length).toBe(0);
    expect(codeElement?.innerHTML).not.toContain('<span');
    expect(codeElement?.textContent).toBe('using System;\npublic class Test {}');

    highlightSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('renders text language as plain text without highlights', () => {
    const record = createMockRecord({
      syntaxLanguage: 'text',
      content: encoder.encode('using System;\npublic class Test {}'),
    });

    const { container } = renderPreviewPanel(record, onDownload, onRevealInTree);

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

    const { container } = renderPreviewPanel(record, onDownload, onRevealInTree);

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

    const { container } = renderPreviewPanel(record, onDownload, onRevealInTree);

    const codeElement = container.querySelector('code');
    expect(codeElement).toBeInTheDocument();

    const spans = codeElement?.querySelectorAll('span');
    expect(spans?.length).toBeGreaterThan(0);
    expect(codeElement?.innerHTML).not.toBe(jsonContent);
    expect(codeElement?.textContent).toBe(jsonContent);
  });

  it('smoke test for css highlighting does not crash and alters output', () => {
    const cssContent = '.button { color: red; }';
    const record = createMockRecord({
      syntaxLanguage: 'css',
      pathname: 'Assets/style.css',
      virtualPath: 'Assets/style.css',
      fileName: 'style.css',
      extension: 'css',
      content: encoder.encode(cssContent),
    });

    const { container } = renderPreviewPanel(record, onDownload, onRevealInTree);

    const codeElement = container.querySelector('code');
    expect(codeElement).toBeInTheDocument();

    const spans = codeElement?.querySelectorAll('span');
    expect(spans?.length).toBeGreaterThan(0);
    expect(codeElement?.innerHTML).not.toBe(cssContent);
    expect(codeElement?.textContent).toBe(cssContent);
  });

  it('smoke test for hlsl highlighting does not crash and alters output', () => {
    const hlslContent = 'void main() { gl_Position = vec4(1.0); }';
    const record = createMockRecord({
      syntaxLanguage: 'hlsl',
      pathname: 'Assets/shader.compute',
      virtualPath: 'Assets/shader.compute',
      fileName: 'shader.compute',
      extension: 'compute',
      content: encoder.encode(hlslContent),
    });

    const { container } = renderPreviewPanel(record, onDownload, onRevealInTree);

    const codeElement = container.querySelector('code');
    expect(codeElement).toBeInTheDocument();

    const spans = codeElement?.querySelectorAll('span');
    expect(spans?.length).toBeGreaterThan(0);
    expect(codeElement?.innerHTML).not.toBe(hlslContent);
    expect(codeElement?.textContent).toBe(hlslContent);
  });

  it('renders unregistered shaderlab language as plain text without highlights', () => {
    const shaderlabContent = 'Shader "Custom/Test" { SubShader { Pass {} } }';
    const record = createMockRecord({
      syntaxLanguage: 'shaderlab',
      pathname: 'Assets/test.shader',
      virtualPath: 'Assets/test.shader',
      fileName: 'test.shader',
      extension: 'shader',
      content: encoder.encode(shaderlabContent),
    });

    const { container } = renderPreviewPanel(record, onDownload, onRevealInTree);

    const codeElement = container.querySelector('code');
    expect(codeElement).toBeInTheDocument();

    const spans = codeElement?.querySelectorAll('span');
    expect(spans?.length).toBe(0);
    expect(codeElement?.innerHTML).not.toContain('<span');
    expect(codeElement?.textContent).toBe(shaderlabContent);
  });


  it('does not show a meta preview switch when no sidecar exists', () => {
    const record = createMockRecord({});

    const { queryByRole } = renderPreviewPanel(record, onDownload, onRevealInTree);

    expect(queryByRole('group', { name: 'Preview source' })).not.toBeInTheDocument();
  });

  it('can switch to the meta sidecar preview without showing generic details', () => {
    const asset = createMockRecord({});
    const meta = createMockRecord({
      id: 'meta-id',
      pathname: 'Assets/Test.cs.meta',
      virtualPath: 'Assets/Test.cs.meta',
      fileName: 'Test.cs.meta',
      component: 'meta',
      content: encoder.encode('fileFormatVersion: 2\nguid: test-guid-aaaaaaaaaaaaaaaaaaaaaaaa\nMonoImporter:\n'),
      byteLength: 76,
      extension: 'meta',
      mimeType: 'text/plain;charset=utf-8',
      syntaxLanguage: 'yaml',
      previewKind: 'text',
      hasMeta: true,
    });

    const { container, getByRole, queryByText } = renderPreviewPanel(asset, onDownload, onRevealInTree, meta);

    expect(getByRole('group', { name: 'Preview source' })).toBeInTheDocument();
    fireEvent.click(getByRole('button', { name: '.meta' }));

    // Meta is now immediate text preview (no deferred "Load preview" button)
    expect(container.querySelector('code')?.textContent).toContain('MonoImporter');
    expect(queryByText('Details')).not.toBeInTheDocument();
  });

  it('collapses preview body for Unity-generated YAML extensions (now unsupported)', () => {
    const asset = createMockRecord({
      extension: 'prefab',
      previewKind: 'unsupported',
      content: encoder.encode('prefab content'),
    });

    const { container } = renderPreviewPanel(asset, onDownload, onRevealInTree);

    // Should not render any preview-frame container (no deferred button)
    expect(container.querySelector('.preview-frame')).not.toBeInTheDocument();
  });

  it('collapses preview body entirely (returns null) for unsupported preview kind', () => {
    const record = createMockRecord({
      previewKind: 'unsupported',
      content: encoder.encode(''),
    });

    const { container } = renderPreviewPanel(record, onDownload, onRevealInTree);

    // It should not render any preview-frame container
    expect(container.querySelector('.preview-frame')).not.toBeInTheDocument();
  });

  it('does not render MIME in the header and does not render Type or MIME in the metadata details', () => {
    const record = createMockRecord({
      byteLength: 1024,
      mimeType: 'text/plain',
      extension: 'cs',
    });

    const { queryByText, getByText, getAllByText } = renderPreviewPanel(record, onDownload, onRevealInTree);

    // Byte size is formatted as "1.0 KB" and should appear in the header and the details list
    const sizeElements = getAllByText(/1\.0 KB/);
    expect(sizeElements.length).toBe(2);

    // Header should not contain MIME type "text/plain"
    expect(queryByText(/text\/plain/)).not.toBeInTheDocument();

    // Metadata table details should show details but not Type or MIME
    expect(getByText('Details')).toBeInTheDocument();
    expect(queryByText('Type')).not.toBeInTheDocument();
    expect(queryByText('MIME')).not.toBeInTheDocument();
  });

  it('resets preview mode to asset when record.id changes without remounting', () => {
    const recordA = createMockRecord({
      id: 'record-a',
      pathname: 'Assets/A.cs',
      virtualPath: 'Assets/A.cs',
      fileName: 'A.cs',
      content: encoder.encode('A code'),
      extension: 'cs',
      hasMeta: true,
    });
    const metaA = createMockRecord({
      id: 'meta-a',
      pathname: 'Assets/A.cs.meta',
      virtualPath: 'Assets/A.cs.meta',
      fileName: 'A.cs.meta',
      content: encoder.encode('guid: guid-a'),
      extension: 'meta',
    });

    const recordB = createMockRecord({
      id: 'record-b',
      pathname: 'Assets/B.cs',
      virtualPath: 'Assets/B.cs',
      fileName: 'B.cs',
      content: encoder.encode('B code'),
      extension: 'cs',
      hasMeta: true,
    });
    const metaB = createMockRecord({
      id: 'meta-b',
      pathname: 'Assets/B.cs.meta',
      virtualPath: 'Assets/B.cs.meta',
      fileName: 'B.cs.meta',
      content: encoder.encode('guid: guid-b'),
      extension: 'meta',
    });

    const { getByRole, queryByText, rerender } = renderPreviewPanel(recordA, onDownload, onRevealInTree, metaA);

    // Should initially be in asset mode, displaying Details
    expect(getByRole('button', { name: 'Asset' })).toHaveClass('active');
    expect(queryByText('Details')).toBeInTheDocument();

    // Toggle to meta mode
    fireEvent.click(getByRole('button', { name: '.meta' }));
    expect(getByRole('button', { name: '.meta' })).toHaveClass('active');
    expect(queryByText('Details')).not.toBeInTheDocument();

    // Re-render with record B
    rerender(
      <PreviewPanel
        record={recordB}
        metaSidecar={metaB}
        onDownload={onDownload}
        onRevealInTree={onRevealInTree}
        getContent={(id) => id === metaB.id ? metaB.content : recordB.content}
      />
    );

    // Should automatically reset back to asset mode
    expect(getByRole('button', { name: 'Asset' })).toHaveClass('active');
    expect(queryByText('Details')).toBeInTheDocument();
  });
});
