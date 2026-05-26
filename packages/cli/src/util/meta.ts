import { readMetaGuid } from 'unitypackage-core';

export interface Meta {
  guid: string;
}

export function parseMeta(content: string): Meta | null {
  const guid = readMetaGuid(content);
  return guid === null ? null : { guid };
}
