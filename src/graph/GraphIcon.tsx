// The graph icon: three linked dots (sidebar header, the page's local graph button).
/** Three linked dots (the Graph screen). */
export function GraphIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M4.2 11.2 7.4 5M8.6 5l3.2 5.6M5 12.4h6" className="stroke" />
      <circle cx="8" cy="3.6" r="1.8" className="stroke" />
      <circle cx="3.6" cy="12.4" r="1.8" className="stroke" />
      <circle cx="12.4" cy="12.4" r="1.8" className="stroke" />
    </svg>
  );
}
