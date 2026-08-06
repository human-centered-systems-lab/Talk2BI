"use client";

import type { ReactNode } from "react";
import { useMemo, Suspense } from "react";
import {
  AssistantRuntimeProvider,
  useRemoteThreadListRuntime,
  RuntimeAdapterProvider,
  useAui,
  type RemoteThreadListAdapter,
  type ThreadHistoryAdapter,
} from "@assistant-ui/react";
import {
  useChatRuntime,
  AssistantChatTransport,
} from "@assistant-ui/react-ai-sdk";
import { createAssistantStream } from "assistant-stream";

// Remote thread list adapter: talks to server-side SQLite-backed API routes.
const remoteThreadListAdapter: RemoteThreadListAdapter = {
  async list() {
    const res = await fetch("/api/threads", { cache: "no-store" });
    if (!res.ok) {
      return { threads: [] };
    }

    const threads = (await res.json()) as Array<{
      id: string;
      title: string;
      archived: boolean;
    }>;

    return {
      threads: threads.map((t) => ({
        status: t.archived ? "archived" : "regular",
        remoteId: t.id,
        title: t.title,
      })),
    };
  },

  async initialize(threadId) {
    const res = await fetch("/api/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: threadId }),
    });

    if (!res.ok) {
      throw new Error("Failed to initialize thread");
    }

    const thread = (await res.json()) as { id: string };

    // RemoteThreadInitializeResponse requires both remoteId and externalId.
    // We don't use externalId in this project, so we return undefined.
    return { remoteId: thread.id, externalId: undefined };
  },

  async rename(remoteId, newTitle) {
    await fetch(`/api/threads/${remoteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTitle }),
    });
  },

  async archive(remoteId) {
    await fetch(`/api/threads/${remoteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });
  },

  async unarchive(remoteId) {
    await fetch(`/api/threads/${remoteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: false }),
    });
  },

  async delete(remoteId) {
    await fetch(`/api/threads/${remoteId}`, { method: "DELETE" });
  },

  async generateTitle(remoteId, messages) {
    const res = await fetch(`/api/threads/${remoteId}/title`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    });

    if (!res.ok) {
      // Fallback to a generic title stream
      return createAssistantStream((controller) => {
        controller.appendText("Chat");
        controller.close();
      });
    }

    const { title } = (await res.json()) as { title: string };

    return createAssistantStream((controller) => {
      controller.appendText(title);
      controller.close();
    });
  },

  // Fetch metadata for a single thread. For our current use case, the
  // runtime only needs status/remoteId/title, which we can derive from the
  // existing /api/threads endpoint.
  async fetch(threadId) {
    const res = await fetch("/api/threads", { cache: "no-store" });
    if (!res.ok) {
      throw new Error("Failed to fetch thread metadata");
    }

    const threads = (await res.json()) as Array<{
      id: string;
      title: string;
      archived: boolean;
    }>;

    const thread = threads.find((t) => t.id === threadId);
    if (!thread) {
      // If the thread is missing, return a stub; the runtime mainly relies
      // on list() for the full set.
      return {
        status: "regular" as const,
        remoteId: threadId,
        externalId: undefined,
        title: "Chat",
      };
    }

    return {
      status: thread.archived ? ("archived" as const) : ("regular" as const),
      remoteId: thread.id,
      externalId: undefined,
      title: thread.title,
    };
  },
};

function ThreadProvider({ children }: { children?: ReactNode }) {
  const aui = useAui();

  const history = useMemo<ThreadHistoryAdapter>(
    () => ({
      // These base methods are only used by the legacy runtime. Our AI SDK
      // integration goes through `withFormat`, so we keep them as safe
      // no-ops/empty loads.
      async load() {
        return { messages: [] };
      },

      async append() {
        // no-op: AI SDK history goes through withFormat()
      },

      // withFormat is what `useExternalHistory` (used by useAISDKRuntime)
      // actually calls. Here we store the adapter-specific storage format
      // in SQLite via our /api/threads/[id]/messages API routes.
      withFormat(formatAdapter) {
        return {
          async load() {
            // Ensure the thread is initialized so we always have a stable remoteId.
            const { remoteId } = await aui.threadListItem().initialize();
            if (!remoteId) {
              return { headId: null, messages: [] };
            }

            const res = await fetch(`/api/threads/${remoteId}/messages`, {
              cache: "no-store",
            });
            if (!res.ok) {
              return { headId: null, messages: [] };
            }

            const rows = (await res.json()) as Array<{
              id: string;
              role: "user" | "assistant" | "system";
              content: unknown;
              createdAt: string;
            }>;

            // Each row.content is a MessageStorageEntry<TStorageFormat> that
            // was previously stored by append(). We decode it back into the
            // adapter's message format.
            const decodedMessages = rows
              .map((row) => {
                const stored = row.content as any; // MessageStorageEntry<unknown>

                // If the stored entry doesn't match this adapter's format,
                // just skip it to avoid runtime errors.
                if (!stored || stored.format !== formatAdapter.format) {
                  return null;
                }

                try {
                  return formatAdapter.decode(stored);
                } catch (err) {
                  // Be defensive against malformed legacy entries so they
                  // don't break the entire thread.
                  if (typeof console !== "undefined" && console.warn) {
                    console.warn(
                      "[ThreadHistoryAdapter] Failed to decode stored message; skipping",
                      err,
                      stored,
                    );
                  }
                  return null;
                }
              })
              .filter((m): m is NonNullable<typeof m> => m !== null);

            // Some legacy data may contain messages that reference a parent
            // which is missing from the dataset. Assistant UI's
            // MessageRepository complains when a parent is missing. Instead
            // of dropping those messages (which would lose assistant
            // replies), we keep them but strip the invalid parent
            // reference so they are treated as root messages.
            const ids = new Set(
              decodedMessages
                .map((m: any) => m && (m.id ?? m.messageId ?? m.message?.id))
                .filter((id) => typeof id === "string"),
            );

            const messages = decodedMessages.map((m: any) => {
              const parentId =
                m?.parentId ?? m?.parent_id ?? m?.message?.parentId;

              if (parentId && !ids.has(parentId)) {
                // Mutate a shallow copy so we don't accidentally affect any
                // shared references.
                const copy: any = { ...m };

                if (copy.parentId) copy.parentId = undefined;
                if (copy.parent_id) copy.parent_id = undefined;
                if (copy.message && copy.message.parentId) {
                  copy.message = { ...copy.message, parentId: undefined };
                }

                return copy;
              }

              return m;
            });

            return {
              headId: null,
              messages,
            };
          },

          async append(item) {
            // Ensure the thread is initialized and we have a remoteId
            const { remoteId } = await aui.threadListItem().initialize();
            if (!remoteId) return;

            // In newer versions of Assistant UI, `append` may be called with
            // either `{ message, parentId }` objects or directly with the
            // message. We normalize here to avoid runtime errors when
            // `item.message` is undefined.
            const hasMessageProp =
              item && typeof item === "object" && "message" in (item as any);

            const messageAny = hasMessageProp
              ? (item as any).message
              : (item as any);

            // If for some reason we still don't have a message, skip
            // persisting this append instead of throwing.
            if (!messageAny) {
              if (typeof console !== "undefined" && console.warn) {
                console.warn(
                  "[ThreadHistoryAdapter] append called without message; skipping persistence",
                  item,
                );
              }
              return;
            }

            // Build a MessageStorageEntry using the adapter's encode/getId
            const storageEntry = {
              id: formatAdapter.getId(messageAny as any),
              parent_id: hasMessageProp ? (item as any).parentId : undefined,
              format: formatAdapter.format,
              content: formatAdapter.encode(
                (hasMessageProp ? item : messageAny) as any,
              ),
            };

            await fetch(`/api/threads/${remoteId}/messages`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id: storageEntry.id,
                role: (messageAny.role ?? "assistant") as
                  | "user"
                  | "assistant"
                  | "system",
                content: storageEntry,
                createdAt:
                  (messageAny.createdAt instanceof Date
                    ? messageAny.createdAt
                    : new Date()
                  ).toISOString(),
              }),
            });
          },
        };
      },
    }),
    [aui],
  );

  const adapters = useMemo(() => ({ history }), [history]);

  return (
    <RuntimeAdapterProvider adapters={adapters}>
      {children}
    </RuntimeAdapterProvider>
  );
}

export function AlfredRuntimeProvider({ children }: { children: ReactNode }) {
  const runtime = useRemoteThreadListRuntime({
    runtimeHook: () =>
      useChatRuntime({
        transport: new AssistantChatTransport({ api: "/api/chat" }),
        adapters: {
        },
      }),
    adapter: {
      ...remoteThreadListAdapter,
      unstable_Provider: ThreadProvider,
    },
  });

  return (
    <Suspense fallback={null}>
      <AssistantRuntimeProvider runtime={runtime}>
        {children}
      </AssistantRuntimeProvider>
    </Suspense>
  );
}
