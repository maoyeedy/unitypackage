import type { PackageFileRecord } from '../packageModel';
import { formatBytes } from '../packageModel';

interface StatsProps {
  records: PackageFileRecord[];
  filteredCount: number;
  totalBytes: number;
}

export function Stats({ records, filteredCount, totalBytes }: StatsProps) {
  const assetCount = records.filter(record => record.extension !== 'meta').length;

  return (
    <div className="statusbar-stats" aria-label="Package summary">
      <span><strong>{filteredCount.toString()}</strong>/{records.length.toString()} files</span>
      <span><strong>{assetCount.toString()}</strong> assets</span>
      <span><strong>{formatBytes(totalBytes)}</strong></span>
    </div>
  );
}
