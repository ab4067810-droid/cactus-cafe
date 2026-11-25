import "../styles/AdminLoadingSkeleton.css";

function AdminLoadingSkeleton({
  label = "Loading workspace",
  stats = 4,
  rows = 5,
  compact = false,
}) {
  return (
    <div
      className={`admin-loading-skeleton${compact ? " is-compact" : ""}`}
      role="status"
      aria-label={label}
    >
      {!compact && (
        <>
          <div className="admin-skeleton-toolbar" aria-hidden="true">
            <span className="admin-skeleton-shape admin-skeleton-heading" />
            <span className="admin-skeleton-shape admin-skeleton-action" />
          </div>

          {stats > 0 && (
            <div className="admin-skeleton-stats" aria-hidden="true">
              {Array.from({ length: stats }, (_, index) => (
                <div className="admin-skeleton-stat" key={index}>
                  <span className="admin-skeleton-shape admin-skeleton-label" />
                  <span className="admin-skeleton-shape admin-skeleton-value" />
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="admin-skeleton-panel" aria-hidden="true">
        {!compact && (
          <div className="admin-skeleton-panel-heading">
            <span className="admin-skeleton-shape admin-skeleton-heading" />
            <span className="admin-skeleton-shape admin-skeleton-action" />
          </div>
        )}
        <div className="admin-skeleton-rows">
          {Array.from({ length: rows }, (_, index) => (
            <div className="admin-skeleton-row" key={index}>
              <span className="admin-skeleton-shape admin-skeleton-cell admin-skeleton-cell-primary" />
              <span className="admin-skeleton-shape admin-skeleton-cell" />
              {!compact && (
                <>
                  <span className="admin-skeleton-shape admin-skeleton-cell" />
                  <span className="admin-skeleton-shape admin-skeleton-cell admin-skeleton-cell-action" />
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default AdminLoadingSkeleton;
