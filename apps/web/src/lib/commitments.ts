import { enqueueCommitmentPatch } from "@/lib/outbox";

/**
 * The two decisions a due item takes (E-4): done, or dropped. Through the
 * outbox, because the acceptance criterion that earned it still stands —
 * marking something done with no signal has to work.
 */
export async function completeCommitment(id: string, userId: string): Promise<void> {
  await enqueueCommitmentPatch(id, userId, { status: "done", completed_at: new Date().toISOString() });
}

export async function reopenCommitment(id: string, userId: string): Promise<void> {
  await enqueueCommitmentPatch(id, userId, { status: "open", completed_at: null });
}

export async function dropCommitment(id: string, userId: string): Promise<void> {
  await enqueueCommitmentPatch(id, userId, { status: "dropped" });
}
