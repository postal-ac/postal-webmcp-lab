import type { SVGProps } from "react";

/**
 * The handful of line icons the Lab's chrome uses, drawn in-house so the
 * page needs no icon dependency. All take `className` for sizing and follow
 * currentColor.
 */
type IconProps = SVGProps<SVGSVGElement>;

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export function CheckIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" {...stroke} strokeWidth={1.8} {...props}>
      <path d="M2.5 6.3 5 8.7l4.5-5.2" />
    </svg>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" {...stroke} strokeWidth={1.8} {...props}>
      <path d="M6 2.8v3.6" />
      <circle cx="6" cy="9" r="0.7" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" {...stroke} {...props}>
      <path d="M3 3l6 6M9 3l-6 6" />
    </svg>
  );
}

export function ChevronIcon({ up = false, className = "", ...props }: IconProps & { up?: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      {...stroke}
      className={`${up ? "rotate-180" : ""} ${className}`}
      {...props}
    >
      <path d="M2.5 4.5 6 8l3.5-3.5" />
    </svg>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" fill="currentColor" {...props}>
      <path d="M3 1.8v8.4a.6.6 0 0 0 .9.52l7-4.2a.6.6 0 0 0 0-1.04l-7-4.2A.6.6 0 0 0 3 1.8z" />
    </svg>
  );
}

export function PauseIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" fill="currentColor" {...props}>
      <rect x="2" y="1.5" width="3" height="9" rx="0.75" />
      <rect x="7" y="1.5" width="3" height="9" rx="0.75" />
    </svg>
  );
}

export function NoteIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" {...stroke} {...props}>
      <path d="M4.5 9.5V2.8l5-1.1v6.6" />
      <circle cx="3" cy="9.5" r="1.5" />
      <circle cx="8" cy="8.3" r="1.5" />
    </svg>
  );
}

export function LinkIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" {...stroke} {...props}>
      <path d="M5 7a2.2 2.2 0 0 0 3.1 0l1.5-1.5a2.2 2.2 0 0 0-3.1-3.1L5.8 3.1" />
      <path d="M7 5a2.2 2.2 0 0 0-3.1 0L2.4 6.5a2.2 2.2 0 0 0 3.1 3.1l.7-.7" />
    </svg>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" {...stroke} {...props}>
      <rect x="4" y="4" width="6" height="6" rx="1.2" />
      <path d="M8 4V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h1" />
    </svg>
  );
}

export function ExternalIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" {...stroke} {...props}>
      <path d="M5 2.5H3a.5.5 0 0 0-.5.5v6a.5.5 0 0 0 .5.5h6a.5.5 0 0 0 .5-.5V7" />
      <path d="M7 2.5h2.5V5M9.5 2.5 5.5 6.5" />
    </svg>
  );
}

/** Small filled status circle with a glyph — success, error, or pulsing "busy". */
export function StatusDot({
  state,
  className = "",
}: {
  state: "success" | "error" | "busy" | "paused";
  className?: string;
}) {
  const base = `flex size-4 shrink-0 items-center justify-center rounded-full ${className}`;
  if (state === "success") {
    return (
      <span aria-hidden="true" className={`${base} bg-success text-white`}>
        <CheckIcon className="size-2.5" />
      </span>
    );
  }
  if (state === "error") {
    return (
      <span aria-hidden="true" className={`${base} bg-danger text-white`}>
        <AlertIcon className="size-2.5" />
      </span>
    );
  }
  return (
    <span aria-hidden="true" className={`${base} ${state === "paused" ? "bg-accent-muted" : ""}`}>
      <span
        className={`size-2 animate-pulse rounded-full ${state === "paused" ? "bg-accent" : "bg-info"}`}
      />
    </span>
  );
}

/** Round, borderless icon button used in panel headers. */
export function IconButton({
  label,
  onClick,
  className = "",
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex size-7 shrink-0 items-center justify-center rounded-full text-content-subtle transition hover:bg-neutral-100 hover:text-content ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
