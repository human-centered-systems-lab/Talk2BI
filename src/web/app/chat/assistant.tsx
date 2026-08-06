"use client";

import { Thread } from "@/components/assistant-ui/thread";

export function Assistant({
  threadId,
}: {
  threadId?: string;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      <Thread threadId={threadId} />
    </div>
  );
}
