import { useHeadings } from '../store/headings';

export function TableOfContents(): JSX.Element {
  const { headings, requestScroll } = useHeadings();

  if (headings.length === 0) {
    return (
      <div className="toc-panel">
        <h2>Outline</h2>
        <p className="muted toc-empty">Add headings to see an outline.</p>
      </div>
    );
  }

  return (
    <div className="toc-panel">
      <h2>Outline</h2>
      <nav className="toc-list">
        {headings.map((h, i) => (
          <button
            key={`${h.pos}-${i}`}
            type="button"
            className={`toc-item toc-level-${h.level}`}
            onClick={() => requestScroll(h.pos)}
          >
            {h.text}
          </button>
        ))}
      </nav>
    </div>
  );
}
