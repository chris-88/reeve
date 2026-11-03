import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { useMediaQuery } from "@/lib/useMediaQuery";

/**
 * E-6: settings and the long-press menu slide in as sheets with a backdrop
 * that fades, dismissible by drag. A drawer on a phone, a dialog at a desk.
 */
export default function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const isDesktop = useMediaQuery("(min-width: 640px)");

  if (isDesktop) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent
          showCloseButton
          aria-describedby={undefined}
          className="bg-surface flex max-h-[88vh] w-full max-w-md flex-col gap-0 rounded-[20px] border-hair p-0 shadow-none"
        >
          <DialogHeader className="hairline-t border-t-0 border-b px-5 py-4 text-left">
            <DialogTitle className="pr-8 text-[15px] font-medium">{title}</DialogTitle>
          </DialogHeader>
          {children}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer open onOpenChange={(o) => !o && onClose()}>
      <DrawerContent aria-describedby={undefined} className="bg-surface max-h-[92dvh] rounded-t-[20px] border-hair">
        <DrawerHeader className="px-5 pt-2 pb-3 text-left">
          <DrawerTitle className="text-[15px] font-medium">{title}</DrawerTitle>
        </DrawerHeader>
        {children}
      </DrawerContent>
    </Drawer>
  );
}
