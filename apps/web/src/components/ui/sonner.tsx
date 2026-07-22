import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * The app is dark-only: `dark` is hardcoded on <html> and there is no theme
 * switcher. shadcn's default wires this to next-themes, but with no provider
 * mounted useTheme() returned undefined and the theme was decided by chance.
 * Pinned explicitly instead, and the dependency dropped.
 */
const Toaster = ({ ...props }: ToasterProps) => (
  <Sonner
    theme="dark"
    className="toaster group"
    style={
      {
        "--normal-bg": "var(--popover)",
        "--normal-text": "var(--popover-foreground)",
        "--normal-border": "var(--border)",
      } as React.CSSProperties
    }
    {...props}
  />
);

export { Toaster };
