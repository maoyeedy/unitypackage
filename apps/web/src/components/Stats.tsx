import type { PackageFileRecord } from '../packageModel';
import { formatBytes } from '../packageModel';

export function Stats({
  records,
  filteredCount,
  totalBytes,
}: {
  records: PackageFileRecord[];
  filteredCount: number;
  totalBytes: number;
}) {
  const assetCount = records.filter(record => record.extension !== 'meta').length;
  const metaCount = records.filter(record => record.extension === 'meta').length;

  return (
    <dl className="stats-grid">
      <div>
        <dt>Visible</dt>
        <dd>{filteredCount.toString()}</dd>
      </div>
      <div>
        <dt>Total</dt>
        <dd>{records.length.toString()}</dd>
      </div>
      <div>
        <dt>Assets</dt>
        <dd>{assetCount.toString()}</dd>
      </div>
      <div>
        <dt>Meta</dt>
        <dd>{metaCount.toString()}</dd>
      </div>
      <div>
        <dt>Bytes</dt>
        <dd>{formatBytes(totalBytes)}</dd>
      </div>
    </dl>
  );
}
