import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * The app is dark-only — `dark` is hardcoded on <html> and there is no theme
 * switcher — so the theme is pinned rather than read from a provider.
 *
 * The custom properties below must use the `--color-` prefixed names.
 * Tailwind v4's `@theme` block emits variables exactly as declared and does
 * not also emit unprefixed aliases, so `var(--popover)` resolved to nothing
 * and sonner fell back to a transparent, borderless card.
 */
const Toaster = ({ ...props }: ToasterProps) => (
  <Sonner
    theme="dark"
    className="toaster group"
    style={
      {
        "--normal-bg": "var(--color-popover)",
        "--normal-text": "var(--color-popover-foreground)",
        "--normal-border": "var(--color-border)",
        "--border-radius": "var(--radius)",
      } as React.CSSProperties
    }
    {...props}
  />
);

export { Toaster };
