import { isValidGuid } from './guid.js';
import { textDecoder } from './tar.js';

// ---------------------------------------------------------------------------
// Minimal meta YAML generator
// ---------------------------------------------------------------------------

/**
 * Discriminates the YAML importer block written into a `.meta` file.
 * - `DefaultImporter`       -- generic asset (binary, texture, etc.)
 * - `DefaultImporterFolder` -- folder entry (`folderAsset: yes` variant)
 * - `TextScriptImporter`    -- plain-text / shader-like assets
 * - `MonoImporter`          -- C# script assets
 */
export type MetaImporterType =
  | 'DefaultImporter'
  | 'DefaultImporterFolder'
  | 'TextScriptImporter'
  | 'MonoImporter';

export type DeclaredMetaImporter =
  | { kind: 'known'; type: MetaImporterType }
  | { kind: 'unknown'; name: string };

const KNOWN_IMPORTER_NAMES = new Set<MetaImporterType>([
  'DefaultImporter',
  'DefaultImporterFolder',
  'TextScriptImporter',
  'MonoImporter',
]);

const IMPORTER_LINE_PATTERN = /^([A-Za-z][A-Za-z0-9_]*Importer):\s*(?:#.*)?$/;
const GUID_LINE_PATTERN = /^guid:\s*([0-9a-fA-F]{32})\s*(?:#.*)?$/;
const FOLDER_ASSET_LINE_PATTERN = /^folderAsset:\s*yes\s*(?:#.*)?$/;

function metaToString(meta: Uint8Array | string): string {
  return typeof meta === 'string' ? meta : textDecoder.decode(meta);
}

export function readMetaGuid(meta: Uint8Array | string): string | null {
  const text = metaToString(meta);
  for (const rawLine of text.split(/\r?\n/)) {
    const match = GUID_LINE_PATTERN.exec(rawLine.trim());
    if (match) return match[1].toLowerCase();
  }
  return null;
}

export function writeMetaGuid(meta: Uint8Array, newGuid: string): Uint8Array {
  if (!isValidGuid(newGuid)) {
    throw new Error(`writeMetaGuid: invalid GUID "${newGuid}" -- must be exactly 32 lowercase hexadecimal characters`);
  }
  const lowerGuid = newGuid.toLowerCase();
  const text = textDecoder.decode(meta);
  const lines = text.split('\n');
  let found = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (GUID_LINE_PATTERN.test(trimmed)) {
      const matchIndent = /^\s*/.exec(line);
      const indent = matchIndent ? matchIndent[0] : '';
      const hasCR = line.endsWith('\r');
      lines[i] = `${indent}guid: ${lowerGuid}${hasCR ? '\r' : ''}`;
      found = true;
      break;
    }
  }

  const updatedText = found ? lines.join('\n') : `guid: ${lowerGuid}\n` + text;
  return new TextEncoder().encode(updatedText);
}


export function readDeclaredMetaImporter(meta: Uint8Array | string): DeclaredMetaImporter | null {
  const text = metaToString(meta);
  let importerName: string | null = null;
  let isFolderAsset = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (FOLDER_ASSET_LINE_PATTERN.test(line)) {
      isFolderAsset = true;
      continue;
    }

    const match = IMPORTER_LINE_PATTERN.exec(line);
    if (match) {
      importerName ??= match[1];
    }
  }

  if (isFolderAsset && importerName === 'DefaultImporter') {
    return { kind: 'known', type: 'DefaultImporterFolder' };
  }

  if (importerName === null) {
    return null;
  }

  if (KNOWN_IMPORTER_NAMES.has(importerName as MetaImporterType)) {
    return { kind: 'known', type: importerName as MetaImporterType };
  }

  return { kind: 'unknown', name: importerName };
}

function defaultImporterFolderTemplate(guid: string): string {
  return `fileFormatVersion: 2\nguid: ${guid}\nDefaultImporter:\n  externalObjects: {}\n  userData:\n  assetBundleName:\n  assetBundleVariant:\nfolderAsset: yes\n`;
}

function textScriptImporterTemplate(guid: string): string {
  return `fileFormatVersion: 2\nguid: ${guid}\nTextScriptImporter:\n  externalObjects: {}\n  userData:\n  assetBundleName:\n  assetBundleVariant:\n`;
}

function monoImporterTemplate(guid: string): string {
  return `fileFormatVersion: 2\nguid: ${guid}\nMonoImporter:\n  externalObjects: {}\n  serializedVersion: 2\n  defaultReferences: []\n  executionOrder: 0\n  icon: {instanceID: 0}\n  userData:\n  assetBundleName:\n  assetBundleVariant:\n`;
}

// Text-script extensions that map to TextScriptImporter
const TEXT_SCRIPT_EXTENSIONS = new Set([
  'json', 'bytes', 'csv', 'pb', 'txt', 'xml', 'proto', 'md', 'asmdef',
]);

// YAML extensions that map to DefaultImporter (not TextScriptImporter)
const YAML_EXTENSIONS = new Set(['yaml', 'yml']);

/**
 * Detects the Unity `.meta` importer type for a given pathname.
 *
 * Priority order:
 * 1. `isDir === true`  -> `DefaultImporterFolder`
 * 2. `.cs` extension   -> `MonoImporter`
 * 3. TEXT_SCRIPT_EXTENSIONS (.json, .bytes, .csv, .pb, .txt, .xml, .proto, .md, .asmdef) -> `TextScriptImporter`
 * 4. `LICENSE` basename (no extension) -> `TextScriptImporter`
 * 5. YAML_EXTENSIONS (.yaml, .yml) -> `DefaultImporter`
 * 6. No extension (not LICENSE) -> `DefaultImporterFolder`
 * 7. Everything else -> `DefaultImporter`
 *
 * Browser-safe; no `node:*` imports.
 */
function detectMetaImporterType(pathname: string, isDir?: boolean): MetaImporterType {
  if (isDir === true) {
    return 'DefaultImporterFolder';
  }

  // Extract extension: find the last dot after the last slash
  const lastSlash = pathname.lastIndexOf('/');
  const basename = lastSlash === -1 ? pathname : pathname.slice(lastSlash + 1);
  const dotIndex = basename.lastIndexOf('.');
  const ext = dotIndex > 0 ? basename.slice(dotIndex + 1).toLowerCase() : '';

  if (ext === 'cs') {
    return 'MonoImporter';
  }

  if (TEXT_SCRIPT_EXTENSIONS.has(ext)) {
    return 'TextScriptImporter';
  }

  // No extension
  if (ext === '') {
    if (basename === 'LICENSE') {
      return 'TextScriptImporter';
    }
    return 'DefaultImporterFolder';
  }

  if (YAML_EXTENSIONS.has(ext)) {
    return 'DefaultImporter';
  }

  return 'DefaultImporter';
}

/**
 * Generates a Unity-compatible minimal `.meta` YAML string for the given GUID
 * and pathname, using the appropriate importer type for the file extension.
 *
 * Pass `isDir: true` to produce a folder meta regardless of the pathname's
 * extension. Validates the GUID with `isValidGuid`; throws on failure.
 *
 * Browser-safe; no `node:*` imports.
 */
export function createMinimalMetaFor(guid: string, pathname: string, isDir?: boolean): string {
  if (!isValidGuid(guid)) {
    throw new Error(`createMinimalMetaFor: invalid GUID "${guid}" -- must be exactly 32 lowercase hexadecimal characters`);
  }
  const lowerGuid = guid.toLowerCase();
  const type = detectMetaImporterType(pathname, isDir);
  switch (type) {
    case 'DefaultImporterFolder': return defaultImporterFolderTemplate(lowerGuid);
    case 'TextScriptImporter':    return textScriptImporterTemplate(lowerGuid);
    case 'MonoImporter':          return monoImporterTemplate(lowerGuid);
    default:                      return `fileFormatVersion: 2\nguid: ${lowerGuid}\nDefaultImporter:\n  externalObjects: {}\n  userData:\n  assetBundleName:\n  assetBundleVariant:\n`;
  }
}


