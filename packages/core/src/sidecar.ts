import { metaSidecarPathForAsset } from './pathname';

export type SidecarSelectableKind = 'asset' | 'meta' | 'preview';

export interface SidecarSelectableRecord {
  id: string;
  guid: string;
  pathname: string;
  kind: SidecarSelectableKind;
}

export interface ResolveMetaSidecarsResult {
  ids: string[];
  explicitIds: string[];
  implicitMetaIds: string[];
  missingMetaForAssetIds: string[];
}

const keyForGuidPathname = (guid: string, pathname: string): string => `${guid}\0${pathname}`;

export function resolveMetaSidecarSelection(
  records: readonly SidecarSelectableRecord[],
  selectedIds: readonly string[],
): ResolveMetaSidecarsResult {
  const recordById = new Map<string, SidecarSelectableRecord>();
  const metaByGuidPathname = new Map<string, SidecarSelectableRecord>();
  const metaByPathname = new Map<string, SidecarSelectableRecord[]>();

  for (const record of records) {
    if (!recordById.has(record.id)) {
      recordById.set(record.id, record);
    }

    if (record.kind !== 'meta') {
      continue;
    }

    const guidPathnameKey = keyForGuidPathname(record.guid, record.pathname);
    if (!metaByGuidPathname.has(guidPathnameKey)) {
      metaByGuidPathname.set(guidPathnameKey, record);
    }

    const existing = metaByPathname.get(record.pathname);
    if (existing === undefined) {
      metaByPathname.set(record.pathname, [record]);
    } else {
      existing.push(record);
    }
  }

  const ids = new Set<string>();
  const explicitIds: string[] = [];
  for (const selectedId of selectedIds) {
    if (!ids.has(selectedId)) {
      ids.add(selectedId);
      explicitIds.push(selectedId);
    }
  }

  const implicitMetaIds: string[] = [];
  const missingMetaForAssetIds: string[] = [];

  for (const selectedId of explicitIds) {
    const record = recordById.get(selectedId);
    if (record?.kind !== 'asset') {
      continue;
    }

    const metaPathname = metaSidecarPathForAsset(record.pathname);
    const sameGuidMeta = metaByGuidPathname.get(keyForGuidPathname(record.guid, metaPathname));
    const fallbackCandidates = metaByPathname.get(metaPathname);
    const fallbackMeta =
      fallbackCandidates?.length === 1 ? fallbackCandidates[0] : undefined;
    const meta = sameGuidMeta ?? fallbackMeta;

    if (meta === undefined) {
      missingMetaForAssetIds.push(record.id);
      continue;
    }

    if (!ids.has(meta.id)) {
      ids.add(meta.id);
      implicitMetaIds.push(meta.id);
    }
  }

  return {
    ids: [...explicitIds, ...implicitMetaIds],
    explicitIds,
    implicitMetaIds,
    missingMetaForAssetIds,
  };
}
