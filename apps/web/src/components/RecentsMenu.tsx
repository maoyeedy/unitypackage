import { useEffect, useRef } from 'react';
import { FolderOpen } from 'lucide-react';
import type { RecentPackage } from '../packageModel';
import { formatBytes } from '../packageModel';

interface RecentsMenuProps {
  recents: RecentPackage[];
  isOpen: boolean;
  onToggle: () => void;
  onOpen: (recent: RecentPackage) => void;
  onRemove: (key: string, event: React.MouseEvent) => void;
  onClearAll: () => void;
  onClose: () => void;
}

export function RecentsMenu({
  recents,
  isOpen,
  onToggle,
  onOpen,
  onRemove,
  onClearAll,
  onClose,
}: RecentsMenuProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  return (
    <div className="recents-menu-container" ref={containerRef}>
      <button
        type="button"
        className="recents-menu-btn"
        aria-label="Recent packages"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        onClick={onToggle}
      >
        <FolderOpen aria-hidden="true" size={16} />
        <span>Recent</span>
      </button>
      {isOpen && (
        <div className="recents-menu-dropdown" role="dialog" aria-label="Recent packages">
          {recents.length === 0 ? (
            <p className="recents-empty">No recent packages</p>
          ) : (
            <ul className="recents-list recents-menu" role="menu">
              {recents.map(recent => (
                <li
                  key={recent.key}
                  className="recent-item"
                  role="menuitem"
                  onClick={() => {
                    onOpen(recent);
                    onClose();
                  }}
                  title={recent.name}
                >
                  <div className="recent-item-info">
                    <span className="recent-name">{recent.name}</span>
                    <span className="recent-meta">{formatBytes(recent.size)}</span>
                  </div>
                  <button
                    type="button"
                    className="recent-remove-btn"
                    onClick={(e) => onRemove(recent.key, e)}
                    title="Remove from recents"
                    aria-label={`Remove ${recent.name} from recents`}
                  >
                    &times;
                  </button>
                </li>
              ))}
            </ul>
          )}
          {recents.length > 0 && (
            <div className="recents-menu-footer">
              <button
                type="button"
                className="recents-clear-btn"
                onClick={() => {
                  onClearAll();
                  onClose();
                }}
              >
                Clear recents
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
