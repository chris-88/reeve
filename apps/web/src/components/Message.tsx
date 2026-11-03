import { useQueryClient } from "@tanstack/react-query";
import type { Area } from "@reeve/shared";
import ActionCard from "@/components/ActionCard";
import { Bubble } from "@/components/Bubble";
import CaptureBubble from "@/components/CaptureBubble";
import { Card, CardButton } from "@/components/Card";
import DueCard from "@/components/DueCard";
import { retryTriage } from "@/lib/captures";
import { dueLabel } from "@/lib/format";
import type { Message as M } from "@/lib/thread";

/**
 * E-4: the one switch from a message to its bubble or card. Reeve speaks in
 * the first person, one to three short sentences, never with headings.
 */
export default function Message({
  m,
  userId,
  areas,
  titles,
  onHanded,
  onJump,
}: {
  m: M;
  userId: string;
  areas: Area[];
  /** Capture titles by id, for the long-press menu on your own message. */
  titles: Map<string, string | null>;
  onHanded: () => void;
  onJump: (messageId: string) => void;
}) {
  const qc = useQueryClient();
  const areaById = (id: string | null | undefined) => (id ? areas.find((a) => a.id === id) : undefined);

  switch (m.type) {
    case "capture":
      return <CaptureBubble m={m} areas={areas} title={titles.get(m.captureId) ?? null} />;

    case "filed": {
      const area = areaById(m.domain);
      const reminders = m.commitments.filter((c) => c.status === "open");
      return (
        <Bubble from="reeve">
          Filed{area ? ` under ${area.label}` : ""}
          {m.title ? `: ${m.title}.` : "."}
          {reminders.length > 0 && (
            <>
              {" "}
              {reminders.map((c, i) => (
                <span key={c.id}>
                  {i === 0 ? "I'll remind you" : " and"} {c.due_at ? dueLabel(c.due_at) : c.due_text ? `(${c.due_text})` : "when it's time"}: {lower(c.text)}
                  {i === reminders.length - 1 ? "." : ""}
                </span>
              ))}
            </>
          )}
          {m.filedPath && <span className="text-muted-dim mt-1 block font-sans text-[12px]">{m.filedPath}</span>}
        </Bubble>
      );
    }

    case "capture_failed":
      return (
        <div className="flex justify-start">
          <Card
            title="I couldn't file this"
            needsYou
            actions={
              <CardButton primary onClick={() => void retryTriage(qc, m.captureId)}>
                Try again
              </CardButton>
            }
          >
            <p className="voice">{m.error ? m.error : "Something went wrong on my side. Your words are safe."}</p>
          </Card>
        </div>
      );

    case "action":
      return <ActionCard m={m} userId={userId} area={areaById(m.domain)} onHanded={onHanded} onJump={onJump} />;

    case "redo_note":
      return <Bubble from="you">{m.text}</Bubble>;

    case "brief":
      return (
        <Bubble from="reeve">
          <span className="text-muted-dim mb-1 block font-sans text-[12px] font-medium tracking-wide uppercase">Today</span>
          {m.body}
        </Bubble>
      );

    case "due":
      return <DueCard m={m} userId={userId} />;

    case "notice":
      return (
        <Bubble from="reeve" quiet>
          {m.body}
          {m.actionId && (
            <button type="button" onClick={() => onJump(`action:${m.actionId}`)} className="text-text mt-1 block font-sans text-[13px] underline-offset-4 hover:underline">
              Show it
            </button>
          )}
        </Bubble>
      );
  }
}

function lower(s: string) {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}
