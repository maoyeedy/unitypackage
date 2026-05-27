interface BreadcrumbProps {
  virtualPath: string;
  onRevealInTree: (path: string) => void;
}

export function Breadcrumb({
  virtualPath,
  onRevealInTree,
}: BreadcrumbProps) {
  const parts = virtualPath.split('/').filter(Boolean);
  return (
    <div className="breadcrumb" aria-label="File path">
      {parts.map((part, index) => {
        const path = parts.slice(0, index + 1).join('/');
        const isLast = index === parts.length - 1;
        return (
          <span key={path} className="breadcrumb-part">
            {index > 0 ? <span className="breadcrumb-separator">/</span> : null}
            {isLast ? (
              <span>{part}</span>
            ) : (
              <button type="button" onClick={() => { onRevealInTree(path); }}>
                {part}
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}
