import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Search, Settings2, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * E-3: "Reeve", a search icon, a settings icon, and a small count chip that
 * appears only when something needs you. Tapping the chip jumps to the oldest
 * message still waiting.
 */
export default function Header({
  count,
  searching,
  onToggleSearch,
  onSettings,
  onJump,
}: {
  count: number;
  searching: boolean;
  onToggleSearch: () => void;
  onSettings: () => void;
  onJump: () => void;
}) {
  return (
    <header className="pt-safe shrink-0">
      <div className="flex h-12 items-center gap-2 px-4">
        <h1 className="font-serif text-[22px] leading-none font-normal tracking-[-0.01em]">Reeve</h1>
        <CountChip count={count} onClick={onJump} />
        <span className="flex-1" />
        <IconButton label={searching ? "Close search" : "Search"} onClick={onToggleSearch} active={searching}>
          {searching ? <X className="size-5" strokeWidth={1.5} aria-hidden /> : <Search className="size-5" strokeWidth={1.5} aria-hidden />}
        </IconButton>
        <IconButton label="Settings" onClick={onSettings}>
          <Settings2 className="size-5" strokeWidth={1.5} aria-hidden />
        </IconButton>
      </div>
    </header>
  );
}

export function IconButton({
  label,
  onClick,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      whileTap={{ scale: 0.92 }}
      className={cn(
        "text-muted hover:text-text grid size-11 place-items-center rounded-full transition-colors",
        active && "text-text",
      )}
    >
      {children}
    </motion.button>
  );
}

/** E-6: the digit rolls vertically when it changes and the chip fades out at zero. */
export function CountChip({ count, onClick }: { count: number; onClick: () => void }) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {count > 0 && (
        <motion.button
          key="chip"
          type="button"
          onClick={onClick}
          aria-label={`${count} need you. Jump to the oldest.`}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.2 }}
          whileTap={{ scale: 0.95 }}
          className="bg-brand text-brand-ink ml-1 flex h-6 items-center gap-1 rounded-full px-2.5 text-[12px] font-medium tabular-nums"
        >
          <span className="relative block h-4 w-[1.2ch] overflow-hidden">
            <AnimatePresence initial={false} mode="popLayout">
              <motion.span
                key={count}
                initial={reduce ? false : { y: 12, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={reduce ? undefined : { y: -12, opacity: 0 }}
                transition={{ type: "spring", stiffness: 500, damping: 32 }}
                className="absolute inset-0 grid place-items-center"
              >
                {count}
              </motion.span>
            </AnimatePresence>
          </span>
          <span>need{count === 1 ? "s" : ""} you</span>
        </motion.button>
      )}
    </AnimatePresence>
  );
}
