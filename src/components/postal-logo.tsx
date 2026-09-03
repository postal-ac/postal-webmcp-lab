/**
 * Postal's mark: three circles, the same shape as the product's app icon.
 * Rendered in currentColor so it follows the surrounding text colour.
 */
export function PostalMark({ size = 22, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 236.46 236.32"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <circle cx="54.08" cy="182.24" r="54.08" />
      <circle cx="54.22" cy="54.08" r="54.08" />
      <circle cx="182.38" cy="54.08" r="54.08" />
    </svg>
  );
}

/** Mark + wordmark, as used in the page header. */
export function PostalLogo({ size = 22 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2 text-content">
      <PostalMark size={size} />
      <span className="text-[15px] font-semibold tracking-tight">Postal</span>
    </span>
  );
}
