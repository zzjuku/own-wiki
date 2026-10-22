// The family tree icon (sidebar header, page header).
/** A small family tree: one box above two. */
export function TreeIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <rect x="5.5" y="1.5" width="5" height="4" rx="1" className="stroke" />
      <rect x="1.5" y="10.5" width="5" height="4" rx="1" className="stroke" />
      <rect x="9.5" y="10.5" width="5" height="4" rx="1" className="stroke" />
      <path d="M8 5.5V8M4 10.5V8h8v2.5" className="stroke" />
    </svg>
  );
}
