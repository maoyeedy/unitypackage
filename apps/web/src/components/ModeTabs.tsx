import { Download, PackagePlus } from 'lucide-react';
import type { WorkspaceMode } from '../packageModel';

export function ModeTabs({ mode, onModeChange }: { mode: WorkspaceMode; onModeChange: (mode: WorkspaceMode) => void }) {
  return (
    <div className="mode-tabs" aria-label="Workspace mode">
      <button type="button" className={mode === 'extract' ? 'active' : ''} onClick={() => { onModeChange('extract'); }}>
        <Download aria-hidden="true" size={16} />
        <span>Extract</span>
      </button>
      <button type="button" className={mode === 'pack' ? 'active' : ''} onClick={() => { onModeChange('pack'); }}>
        <PackagePlus aria-hidden="true" size={16} />
        <span>Pack</span>
      </button>
    </div>
  );
}
