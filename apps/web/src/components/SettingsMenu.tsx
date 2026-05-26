import { useEffect, useRef } from 'react';
import { Settings } from 'lucide-react';

interface SettingsMenuProps {
  isOpen: boolean;
  onToggle: () => void;
  onResetSettings: () => void;
  onClose: () => void;
}

export function SettingsMenu({
  isOpen,
  onToggle,
  onResetSettings,
  onClose,
}: SettingsMenuProps) {
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
    <div className="settings-menu-container" ref={containerRef}>
      <button
        type="button"
        className="icon-button settings-menu-btn"
        aria-label="Settings"
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        title="Settings"
        onClick={onToggle}
      >
        <Settings aria-hidden="true" size={16} />
      </button>
      {isOpen && (
        <div className="settings-menu-dropdown" role="dialog" aria-label="Settings">
          <div className="settings-menu-footer">
            <button
              type="button"
              className="settings-reset-btn"
              onClick={() => {
                onResetSettings();
                onClose();
              }}
            >
              Reset settings
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
