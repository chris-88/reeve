import { toast } from "sonner";
import { Card, CardButton } from "@/components/Card";
import { enablePush } from "@/lib/push";
import { snoozePushAsk } from "@/lib/pushAsk";

/**
 * E-3c / PN-4: the permission ask is a Reeve message after your first Hand to
 * Reeve. "Not now" rests it for a week. Local only; never a row.
 */
export default function PushAskCard({ userId, onDone }: { userId: string; onDone: () => void }) {
  return (
    <div className="flex justify-start">
      <Card
        title="Want me to tell you when it's done?"
        actions={
          <>
            <CardButton
              primary
              onClick={() => {
                onDone();
                // WP-F4.4: requestPermission() only from this tap.
                void enablePush(userId).then((state) => {
                  if (state === "enabled") toast("I'll let you know.");
                });
              }}
            >
              Yes
            </CardButton>
            <CardButton
              onClick={() => {
                snoozePushAsk();
                onDone();
              }}
            >
              Not now
            </CardButton>
          </>
        }
      >
        <p className="voice">A notification when a result is ready, and nothing else.</p>
      </Card>
    </div>
  );
}
