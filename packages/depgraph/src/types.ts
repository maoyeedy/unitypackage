/** GUID -> relative asset path (e.g. 51763ba... -> Assets/Scripts/MouseLook.cs) */
export type GuidIndex = Map<string, string>;

/** Result of scanning a single file for GUID references */
export interface ScanResult {
  fileGuid: string | null;
  references: Set<string>;
  skipped: boolean;
  skipReason?: string;
}

/** Directed edge in the dependency graph */
export interface DepEdge {
  from: string;
  to: string;
  fromPath: string;
  toPath: string;
}

export interface ResolveOptions {
  explicitPaths: string[];
  depRoot: string;
  index: GuidIndex;
  maxDepth?: number;
}

export interface ResolveResult {
  explicitGuids: Set<string>;
  transitiveGuids: Set<string>;
  edges: DepEdge[];
  stats: {
    scanned: number;
    skipped: number;
    maxDepthReached: number;
    elapsedMs: number;
  };
}
