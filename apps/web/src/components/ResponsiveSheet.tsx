import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { useMediaQuery } from "@/lib/useMediaQuery";

/**
 * UI-10: a phone expects swipe-down to dismiss; a full-screen Dialog only
 * offers a small × in the corner. Drawer below sm, Dialog above, which is
 * shadcn's documented responsive pattern.
 *
 * Shared because the Due view needs the identical treatment, and two copies
 * would drift on exactly the details — max height, safe areas, the described-by
 * opt-out — that were expensive to get right the first time.
 */
export default function ResponsiveSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const isDesktop = useMediaQuery("(min-width: 640px)");

  if (isDesktop) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent
          showCloseButton
          // The title and body are the description; Radix only needs to be
          // told this is deliberate rather than an omission.
          aria-describedby={undefined}
          className="flex max-h-[88vh] w-full max-w-lg flex-col gap-0 rounded-2xl p-0"
        >
          <DialogHeader className="border-border/60 shrink-0 border-b px-6 py-4 text-left">
            <DialogTitle className="pr-8 font-serif text-[1.35rem] leading-snug font-normal">
              {title}
            </DialogTitle>
          </DialogHeader>
          {children}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer open onOpenChange={(o) => !o && onClose()}>
      <DrawerContent aria-describedby={undefined} className="max-h-[92dvh]">
        <DrawerHeader className="border-border/60 shrink-0 border-b px-6 py-3 text-left">
          <DrawerTitle className="font-serif text-[1.35rem] leading-snug font-normal">
            {title}
          </DrawerTitle>
        </DrawerHeader>
        {children}
      </DrawerContent>
    </Drawer>
  );
}
