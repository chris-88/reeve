import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * E-4: a card is a decision. Same width as a bubble, a hairline border, a
 * title line, the content you are deciding on, one or two buttons. The accent
 * edge says "this needs you" and goes once it does not.
 */
export function Card({
  title,
  needsYou,
  children,
  actions,
  onPress,
  className,
}: {
  title: ReactNode;
  needsYou?: boolean;
  children?: ReactNode;
  actions?: ReactNode;
  onPress?: () => void;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      layout={!reduce}
      whileTap={onPress ? { scale: 0.995 } : undefined}
      onClick={onPress}
      className={cn(
        "bg-surface hairline relative max-w-[92%] overflow-hidden rounded-[14px] border",
        needsYou && "border-l-brand border-l-[3px]",
        onPress && "cursor-pointer",
        className,
      )}
    >
      <div className="px-4 pt-3 pb-1 text-[15px] leading-[22px] font-medium">{title}</div>
      {children && <div className="text-text px-4 pb-3 text-[15px] leading-[22px]">{children}</div>}
      {actions && <div className="hairline-t flex items-center gap-2 border-t px-2 py-2">{actions}</div>}
    </motion.div>
  );
}

/** A card's button. `primary` is the accent; everything else is quiet. */
export function CardButton({
  children,
  onClick,
  primary,
  disabled,
  ariaLabel,
}: {
  children: ReactNode;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <motion.button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      transition={{ duration: 0.12 }}
      className={cn(
        "inline-flex h-10 min-w-[44px] items-center justify-center gap-1.5 rounded-full px-4 text-[14px] font-medium transition-colors disabled:opacity-50",
        primary ? "bg-brand text-brand-ink" : "text-text hover:bg-surface-2",
      )}
    >
      {children}
    </motion.button>
  );
}

/** E-6: Approve draws a check (240ms). */
export function CheckDraw({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  return (
    <svg viewBox="0 0 20 20" className={cn("size-4", className)} fill="none" aria-hidden>
      <motion.path
        d="M4 10.5 8.2 14.5 16 6"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reduce ? { pathLength: 1 } : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.24, ease: "easeOut" }}
      />
    </svg>
  );
}
