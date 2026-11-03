import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * E-4: a bubble is talk. Yours sit right in Geist; Reeve's sit left in
 * Newsreader. No border, no buttons.
 */
export function Bubble({
  from,
  children,
  quiet,
  className,
  ...rest
}: {
  from: "you" | "reeve";
  children: ReactNode;
  /** A notice or a pending message: muted. */
  quiet?: boolean;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "children">) {
  const you = from === "you";
  return (
    <div className={cn("flex", you ? "justify-end" : "justify-start")} {...rest}>
      <div
        className={cn(
          "max-w-[86%] whitespace-pre-wrap",
          you
            ? "bg-you text-text rounded-[18px] rounded-br-[6px] px-4 py-2.5 text-[15px] leading-[22px]"
            : "voice text-text py-1 pr-6",
          quiet && "text-muted",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** "On it." — three dots breathing (E-6). */
export function Dots({ label = "Working" }: { label?: string }) {
  return (
    <span className="dots text-muted inline-flex items-center" role="status" aria-label={label}>
      <span />
      <span />
      <span />
    </span>
  );
}
