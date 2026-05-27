// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
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
    expect(codeElement?.textContent).toBe(shaderlabContent);
  });


  it('does not show a meta preview switch when no sidecar exists', () => {
    const record = createMockRecord({});

    const { queryByRole } = render(
      <PreviewPanel
        record={record}
        onDownload={onDownload}
        onRevealInTree={onRevealInTree}
      />
    );

    expect(queryByRole('group', { name: 'Preview source' })).not.toBeInTheDocument();
  });

  it('can switch to the hidden meta sidecar preview without showing generic details', () => {
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
      hasMeta: true,
    });

    const { container, getByRole, queryByText } = render(
      <PreviewPanel
        record={asset}
        metaSidecar={meta}
        onDownload={onDownload}
        onRevealInTree={onRevealInTree}
      />
    );

    expect(getByRole('group', { name: 'Preview source' })).toBeInTheDocument();
    fireEvent.click(getByRole('button', { name: '.meta' }));

    // Click the "Load preview" button since .meta is deferred.
    fireEvent.click(getByRole('button', { name: 'Load preview' }));

    expect(container.querySelector('code')?.textContent).toContain('MonoImporter');
    expect(queryByText('Details')).not.toBeInTheDocument();
  });

  it('renders deferred preview for Unity-generated assets and resets on selection change', () => {
    const asset1 = createMockRecord({
      id: 'asset-1',
      extension: 'prefab',
      previewKind: 'text',
      content: encoder.encode('prefab content 1'),
    });
    const asset2 = createMockRecord({
      id: 'asset-2',
      extension: 'prefab',
      previewKind: 'text',
      content: encoder.encode('prefab content 2'),
    });

    const { getByRole, container, rerender } = render(
      <PreviewPanel
        record={asset1}
        onDownload={onDownload}
        onRevealInTree={onRevealInTree}
      />
    );

    // Should show the load button, not the code preview content
    expect(getByRole('button', { name: 'Load preview' })).toBeInTheDocument();
    expect(container.querySelector('code')).not.toBeInTheDocument();

    // Click load
    fireEvent.click(getByRole('button', { name: 'Load preview' }));

    // Code preview should be visible now
    expect(container.querySelector('code')?.textContent).toBe('prefab content 1');

    // Rerender with asset2
    rerender(
      <PreviewPanel
        record={asset2}
        onDownload={onDownload}
        onRevealInTree={onRevealInTree}
      />
    );

    // Selection changed: state should reset back to deferred (showing load button, no code content)
    expect(getByRole('button', { name: 'Load preview' })).toBeInTheDocument();
    expect(container.querySelector('code')).not.toBeInTheDocument();
  });

  it('collapses preview body entirely (returns null) for unsupported preview kind', () => {
    const record = createMockRecord({
      previewKind: 'unsupported',
      content: encoder.encode(''),
    });

    const { container } = render(
      <PreviewPanel
        record={record}
        onDownload={onDownload}
        onRevealInTree={onRevealInTree}
      />
    );

    // It should not render any preview-frame container
    expect(container.querySelector('.preview-frame')).not.toBeInTheDocument();
  });

  it('does not render MIME in the header and does not render Type or MIME in the metadata details', () => {
    const record = createMockRecord({
      byteLength: 1024,
      mimeType: 'text/plain',
      extension: 'cs',
    });

    const { queryByText, getByText, getAllByText } = render(
      <PreviewPanel
        record={record}
        onDownload={onDownload}
        onRevealInTree={onRevealInTree}
      />
    );

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
});
