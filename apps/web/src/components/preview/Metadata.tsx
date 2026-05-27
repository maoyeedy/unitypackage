import { useMemo } from 'react';
import { Locate } from 'lucide-react';
import {
  formatBytes,
  getDeclaredMetaInfoForRecord,
  type PackageFileRecord,
  type SidecarSelectableRecord,
} from '../../packageModel';
import { useContent } from '../../contexts/ContentContext';
import { Breadcrumb } from './Breadcrumb';

interface MetadataProps {
  record: PackageFileRecord;
  metaSidecar?: PackageFileRecord;
  onRevealInTree: (recordId: string) => void;
  selectableRecords?: readonly SidecarSelectableRecord[];
}

export function Metadata({
  record,
  metaSidecar,
  onRevealInTree,
  selectableRecords,
}: MetadataProps) {
  const getContent = useContent();
  const declaredMetaInfo = useMemo(
    () => getDeclaredMetaInfoForRecord(metaSidecar ? [record, metaSidecar] : [record], record, getContent, selectableRecords),
    [metaSidecar, record, getContent, selectableRecords],
  );
  const rows: [string, string][] = [
    ['GUID', record.guid],
    ['Size', formatBytes(record.byteLength)],
  ];

  if (declaredMetaInfo.guid) {
    rows.push(['Meta GUID', declaredMetaInfo.guid]);
  }
  if (declaredMetaInfo.importer) {
    rows.push(['Importer', declaredMetaInfo.importer]);
  }

  return (
    <section className="metadata" aria-label="File metadata">
      <div className="metadata-heading">
        <h3>Details</h3>
        <button
          type="button"
          className="btn btn--icon btn--sm"
          aria-label="Reveal in tree"
          title="Reveal in tree"
          onClick={() => { onRevealInTree(record.id); }}
        >
          <Locate aria-hidden="true" size={13} />
        </button>
      </div>
      <dl>
        <div>
          <dt>Path</dt>
          <dd>
            <Breadcrumb virtualPath={record.virtualPath} onRevealInTree={onRevealInTree} />
          </dd>
        </div>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
