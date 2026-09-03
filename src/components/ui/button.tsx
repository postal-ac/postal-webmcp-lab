import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary";
type Size = "compact" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-content text-background-light hover:opacity-90",
  secondary: "bg-neutral-100 text-content hover:bg-neutral-150",
};

const SIZES: Record<Size, string> = {
  compact: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
};

export function Button({
  variant = "primary",
  size = "md",
  isLoading = false,
  loadingText,
  className = "",
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  isLoading?: boolean;
  loadingText?: string;
}) {
  return (
    <button
      {...props}
      disabled={disabled || isLoading}
      className={`inline-flex items-center justify-center gap-2 rounded-full font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
    >
      {isLoading && (
        <span
          aria-hidden="true"
          className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {isLoading ? (loadingText ?? children) : children}
    </button>
  );
}
