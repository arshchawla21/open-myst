interface PendingEditsBannerProps {
  count: number;
  onClearAll: () => void;
}

export function PendingEditsBanner({ count, onClearAll }: PendingEditsBannerProps): JSX.Element | null {
  if (count === 0) return null;

  const showClearAll = count > 3;
  const label =
    count === 1
      ? '1 pending edit — accept or reject to continue editing'
      : `${count} pending edits — accept or reject each to continue editing`;

  return (
    <div className="pending-banner">
      <span className="pending-banner-dot" />
      <span className="pending-banner-label">{label}</span>
      {showClearAll && (
        <button
          type="button"
          className="pending-banner-clear"
          onClick={onClearAll}
          title="Reject all pending edits"
        >
          Reject all
        </button>
      )}
    </div>
  );
}
