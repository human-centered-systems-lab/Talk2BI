import {
  ComposerAddAttachment,
  ComposerAttachments,
  UserMessageAttachments,
} from "@/components/assistant-ui/attachment";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { MessageTiming } from "@/components/assistant-ui/message-timing";
import { useModel } from "@/components/model-provider";
import {
  Reasoning,
  ReasoningContent,
  ReasoningRoot,
  ReasoningText,
  ReasoningTrigger,
} from "@/components/assistant-ui/reasoning";
import {
  ToolGroupContent,
  ToolGroupRoot,
  ToolGroupTrigger,
} from "@/components/assistant-ui/tool-group";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { useProfile } from "@/components/profile-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  ActionBarMorePrimitive,
  ActionBarPrimitive,
  type AssistantState,
  AuiIf,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  groupPartByType,
  MessagePrimitive,
  ThreadPrimitive,
  useAui,
  useAuiState,
} from "@assistant-ui/react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  MicIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RefreshCwIcon,
  SparklesIcon,
  SquareIcon,
  TelescopeIcon,
} from "lucide-react";
import { type FC, useEffect, useMemo, useState } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";

interface ThreadProps {
  threadId?: string;
}

// Startup exposes a loading placeholder thread; treat it as a new chat so the
// composer mounts centered. Loads after startup keep the docked layout.
//
// A route that carries a thread id is always an existing thread, so it opts out
// of the startup allowance entirely: during a direct load the messages have not
// arrived yet and `threads.isLoading` is still true, which would otherwise match
// the new-chat view and flash the centered welcome before jumping to docked.
const makeIsNewChatView = (hasThreadId: boolean) => (s: AssistantState) =>
  !hasThreadId &&
  s.thread.messages.length === 0 &&
  (!s.thread.isLoading || s.threads.isLoading);

export const Thread: FC<ThreadProps> = ({ threadId }) => {
  const [mounted, setMounted] = useState(false);
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();
  const aui = useAui();

  // Use threadId from props first, then fall back to URL params
  const resolvedThreadId = threadId ?? (params?.threadId as string);

  const isNewChatView = useMemo(
    () => makeIsNewChatView(Boolean(resolvedThreadId)),
    [resolvedThreadId],
  );

  const isEmpty = useAuiState(isNewChatView);
  const threadsLoading = useAuiState((s) => s.threads.isLoading);
  const activeRemoteId = useAuiState((s) => s.threadListItem.remoteId);
  const hasUserMessage = useAuiState((s) =>
    s.thread.messages.some((message) => message.role === "user"),
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  // Keep the assistant-ui runtime aligned with the URL-backed route.
  // Wait for thread list to load so switchToThread recognizes existing threads
  useEffect(() => {
    if (resolvedThreadId && !threadsLoading) {
      aui.threads().switchToThread(resolvedThreadId);
    }
  }, [resolvedThreadId, threadsLoading, aui]);

  useEffect(() => {
    if (
      !resolvedThreadId &&
      pathname === "/chat" &&
      activeRemoteId &&
      hasUserMessage
    ) {
      router.replace(`/chat/${activeRemoteId}`);
    }
  }, [resolvedThreadId, pathname, activeRemoteId, hasUserMessage, router]);

  if (!mounted) {
    return (
      <div
        className="aui-root aui-thread-root bg-background @container flex h-full flex-col"
        style={{
          ["--thread-max-width" as string]: "46rem",
          ["--composer-bg" as string]:
            "color-mix(in oklab, var(--color-muted) 30%, var(--color-background))",
          ["--composer-radius" as string]: "1.5rem",
          ["--composer-padding" as string]: "8px",
        }}
      />
    );
  }

  return (
    <ThreadPrimitive.Root
      className="aui-root aui-thread-root bg-background @container flex h-full flex-col"
      style={{
        ["--thread-max-width" as string]: "46rem",
        ["--composer-bg" as string]:
          "color-mix(in oklab, var(--color-muted) 30%, var(--color-background))",
        ["--composer-radius" as string]: "1.5rem",
        ["--composer-padding" as string]: "8px",
      }}
    >
      <ThreadPrimitive.Viewport
        turnAnchor="top"
        data-slot="aui_thread-viewport"
        className={cn(
          "relative flex flex-1 flex-col overflow-x-auto overflow-y-scroll scroll-smooth px-4 pt-4",
          isEmpty && "justify-center",
        )}
      >
        <AuiIf condition={isNewChatView}>
          <ThreadWelcome />
        </AuiIf>

        <div
          data-slot="aui_message-group"
          className="mb-14 flex flex-col gap-y-6 empty:hidden"
        >
          <ThreadPrimitive.Messages>
            {({ message }) => {
              if (message.composer.isEditing) return <EditComposer />;
              if (message.role === "user") return <UserMessage />;
              return <AssistantMessage />;
            }}
          </ThreadPrimitive.Messages>
        </div>

        <ThreadPrimitive.ViewportFooter
          className={cn(
            "aui-thread-viewport-footer bg-background mx-auto flex w-full max-w-(--thread-max-width) flex-col gap-4 overflow-visible",
            isEmpty ? "pb-4 md:pb-6" : "pb-1 md:pb-2",
            !isEmpty && "sticky bottom-0 mt-auto rounded-t-(--composer-radius)",
          )}
        >
          <ThreadScrollToBottom />
          <Composer />
          <AuiIf condition={(s) => !isNewChatView(s)}>
            <ComposerDisclaimer />
          </AuiIf>
          <AuiIf condition={isNewChatView}>
            <div className="aui-thread-welcome-suggestions-shell">
              <AuiIf condition={(s) => s.composer.isEmpty}>
                <ThreadSuggestions />
              </AuiIf>
            </div>
          </AuiIf>
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
};

const ThreadScrollToBottom: FC = () => {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <TooltipIconButton
        tooltip="Scroll to bottom"
        variant="outline"
        className="aui-thread-scroll-to-bottom dark:border-border dark:bg-background dark:hover:bg-accent absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible"
      >
        <ArrowDownIcon />
      </TooltipIconButton>
    </ThreadPrimitive.ScrollToBottom>
  );
};

const ComposerDisclaimer: FC = () => {
  return (
    <p className="-mt-2 px-4 text-center text-[11px] leading-none text-muted-foreground">
      Talk2BI can make mistakes. Check important results.
    </p>
  );
};

const ThreadWelcome: FC = () => {
  const { loading, name } = useProfile();

  if (loading) {
    return (
      <div className="aui-thread-welcome-root mx-auto mb-12  flex w-full max-w-(--thread-max-width) flex-col items-center px-4 text-center">
        <h1 className="invisible text-2xl font-semibold">Loading</h1>
      </div>
    );
  }

  return (
    <div className="aui-thread-welcome-root mx-auto mb-12  flex w-full max-w-(--thread-max-width) flex-col items-center px-4 text-center">
      <h1 className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-2xl font-semibold duration-200">
        <span className="shimmer shimmer-speed-120 text-foreground/80">
          {name ? `Hi ${name}, let's talk.` : "Hi, let's talk."}
        </span>
      </h1>
    </div>
  );
};

type StoredSuggestion = {
  id: string;
  category: string;
  label: string;
  prompt: string;
};

type SuggestionGroup = {
  label: string;
  options: StoredSuggestion[];
};

const suggestionChipClass =
  "aui-thread-welcome-suggestion text-foreground hover:bg-muted border-border/60 h-auto gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-normal whitespace-nowrap transition-colors [&_svg]:size-4";

const ThreadSuggestions: FC = () => {
  const aui = useAui();
  const [groups, setGroups] = useState<SuggestionGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedLabel, setExpandedLabel] = useState<string | null>(null);
  const expandedGroup = groups.find(
    (group) => group.label === expandedLabel,
  );

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/graph/suggestions", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load suggestions");
        return response.json() as Promise<{ suggestions: StoredSuggestion[] }>;
      })
      .then(({ suggestions }) => {
        const grouped = new Map<string, StoredSuggestion[]>();
        suggestions.forEach((suggestion) => {
          const options = grouped.get(suggestion.category) ?? [];
          options.push(suggestion);
          grouped.set(suggestion.category, options);
        });
        setGroups(
          Array.from(grouped, ([label, options]) => ({ label, options })),
        );
        setLoading(false);
      })
      .catch((error: Error) => {
        if (error.name !== "AbortError") {
          setGroups([]);
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, []);

  const sendPrompt = (prompt: string) => {
    if (aui.thread().getState().isRunning) return;
    aui.thread().append({
      content: [{ type: "text", text: prompt }],
      runConfig: aui.composer().getState().runConfig,
    });
  };

  if (loading) {
    return (
      <div
        className="aui-thread-welcome-suggestions-loading flex min-h-18 w-full flex-col items-center justify-center gap-2 overflow-hidden px-4"
        role="status"
        aria-label="Loading suggestions"
      >
        {[[5.5, 7, 6.25], [5.75]].map((row, rowIndex) => (
          <div key={rowIndex} className="flex items-center justify-center gap-2">
            {row.map((width, itemIndex) => (
              <div
                key={width}
                className="border-border/50 bg-muted/60 flex h-8 animate-pulse items-center gap-2 rounded-full border px-3"
                style={{
                  width: `${width}rem`,
                  animationDelay: `${(rowIndex * 3 + itemIndex) * 90}ms`,
                }}
              >
                <SparklesIcon className="size-3.5 text-muted-foreground/45" />
                <span className="bg-muted-foreground/15 h-1.5 flex-1 rounded-full" />
              </div>
            ))}
          </div>
        ))}
        <span className="sr-only">Loading suggestions</span>
      </div>
    );
  }

  if (groups.length === 0) return null;

  return (
    <div className="aui-thread-welcome-suggestions fade-in animate-in flex w-full flex-col gap-2 px-4 duration-150">
      <div className="flex w-full flex-col items-center gap-2">
        {chunkItems(groups, 3).map((row, rowIndex) => (
          <div key={rowIndex} className="flex items-center justify-center gap-2">
            {row.map((group) => (
              <Button
                key={group.label}
                variant="ghost"
                className={cn(
                  suggestionChipClass,
                  group.label === expandedLabel && "bg-muted",
                )}
                onClick={() =>
                  setExpandedLabel(
                    group.label === expandedLabel ? null : group.label,
                  )
                }
              >
                <SparklesIcon />
                {group.label}
              </Button>
            ))}
          </div>
        ))}
      </div>
      {expandedGroup && (
        <div
          key={expandedGroup.label}
          className="fade-in slide-in-from-top-1 animate-in flex w-full flex-col items-center gap-2 duration-200"
        >
          {chunkItems(expandedGroup.options, 3).map((row, rowIndex) => (
            <div key={rowIndex} className="flex items-center justify-center gap-2">
              {row.map((option) => (
                <Button
                  key={option.id}
                  variant="ghost"
                  className={suggestionChipClass}
                  onClick={() => sendPrompt(option.prompt)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

function chunkItems<T>(items: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, index * size + size),
  );
}

const Composer: FC = () => {
  return (
    <ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col">
      <ComposerPrimitive.AttachmentDropzone asChild>
        <div
          data-slot="aui_composer-shell"
          className="border-border/60 data-[dragging=true]:border-ring focus-within:border-border dark:border-muted-foreground/15 dark:focus-within:border-muted-foreground/30 flex w-full flex-col gap-2 rounded-(--composer-radius) border bg-(--composer-bg) p-(--composer-padding) shadow-[0_4px_16px_-8px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] transition-[border-color,box-shadow] focus-within:shadow-[0_6px_24px_-8px_rgba(0,0,0,0.12),0_1px_2px_rgba(0,0,0,0.05)] data-[dragging=true]:border-dashed data-[dragging=true]:bg-[color-mix(in_oklab,var(--color-accent)_50%,var(--color-background))] dark:shadow-none"
        >
          <ComposerAttachments />
          <ComposerPrimitive.Input
            placeholder="Send a message..."
            className="aui-composer-input placeholder:text-muted-foreground/80 max-h-32 min-h-8 w-full resize-none bg-transparent px-2.5 py-1 text-base outline-none"
            rows={1}
            autoFocus
            aria-label="Message input"
          />
          <ComposerAction />
        </div>
      </ComposerPrimitive.AttachmentDropzone>
    </ComposerPrimitive.Root>
  );
};

const ComposerAction: FC = () => {
  const aui = useAui();
  const { model, models, setModel } = useModel();

  useEffect(() => {
    if (!model) return;
    const composer = aui.composer();
    const runConfig = composer.getState().runConfig;
    composer.setRunConfig({
      ...runConfig,
      custom: {
        ...runConfig.custom,
        model,
      },
    });
  }, [aui, model]);

  const selectedModel = models.find((option) => option.id === model);

  return (
    <div className="aui-composer-action-wrapper relative flex items-center justify-between">
      <ComposerAddAttachment />
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <DropdownMenuTrigger asChild>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 max-w-40 gap-1 rounded-full border-0 bg-transparent px-2 text-xs shadow-none hover:bg-muted data-[state=open]:bg-muted"
                    aria-label={
                      model ? `Current model: ${model}` : "Current model"
                    }
                    disabled={!model}
                  >
                    <ModelIcon
                      option={selectedModel}
                      className="size-3.5 shrink-0 opacity-70"
                    />
                    <span className="truncate">
                      {model ?? "Loading model..."}
                    </span>
                    <ChevronDownIcon className="size-3.5 shrink-0 opacity-60" />
                  </Button>
                </TooltipTrigger>
              </DropdownMenuTrigger>
              <TooltipContent side="bottom">
                {`Current model is ${model ?? "loading..."}`}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <DropdownMenuContent align="end" side="top" className="w-56">
            <DropdownMenuRadioGroup
              value={model ?? ""}
              onValueChange={setModel}
            >
              {models.map((option) => (
                <DropdownMenuRadioItem
                  key={option.id}
                  value={option.id}
                  className="gap-2"
                >
                  <ModelIcon
                    option={option}
                    className="size-4 shrink-0 opacity-70"
                  />
                  <span className="truncate">{option.id}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <AuiIf condition={(s) => s.thread.capabilities.dictation}>
          <AuiIf condition={(s) => s.composer.dictation == null}>
            <ComposerPrimitive.Dictate asChild>
              <TooltipIconButton
                tooltip="Voice input"
                side="bottom"
                type="button"
                variant="ghost"
                size="icon"
                className="aui-composer-dictate size-7 rounded-full"
                aria-label="Start voice input"
              >
                <MicIcon className="aui-composer-dictate-icon size-4" />
              </TooltipIconButton>
            </ComposerPrimitive.Dictate>
          </AuiIf>
          <AuiIf condition={(s) => s.composer.dictation != null}>
            <ComposerPrimitive.StopDictation asChild>
              <TooltipIconButton
                tooltip="Stop dictation"
                side="bottom"
                type="button"
                variant="ghost"
                size="icon"
                className="aui-composer-stop-dictation text-destructive size-7 rounded-full"
                aria-label="Stop voice input"
              >
                <SquareIcon className="aui-composer-stop-dictation-icon size-3.5 animate-pulse fill-current" />
              </TooltipIconButton>
            </ComposerPrimitive.StopDictation>
          </AuiIf>
        </AuiIf>
        <AuiIf condition={(s) => !s.thread.isRunning}>
          <ComposerPrimitive.Send asChild>
            <TooltipIconButton
              tooltip="Send message"
              side="bottom"
              type="button"
              variant="default"
              size="icon"
              className="aui-composer-send size-7 rounded-full"
              aria-label="Send message"
            >
              <ArrowUpIcon className="aui-composer-send-icon size-4.5" />
            </TooltipIconButton>
          </ComposerPrimitive.Send>
        </AuiIf>
        <AuiIf condition={(s) => s.thread.isRunning}>
          <ComposerPrimitive.Cancel asChild>
            <Button
              type="button"
              variant="default"
              size="icon"
              className="aui-composer-cancel size-7 rounded-full"
              aria-label="Stop generating"
            >
              <SquareIcon className="aui-composer-cancel-icon size-3.5 fill-current" />
            </Button>
          </ComposerPrimitive.Cancel>
        </AuiIf>
      </div>
    </div>
  );
};

type ModelOption = {
  id: string;
  iconUrl?: string;
  invertIconInDarkMode?: boolean;
};

const ModelIcon: FC<{ option?: ModelOption; className?: string }> = ({
  option,
  className,
}) => {
  if (option?.iconUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={option.iconUrl}
        alt=""
        className={cn(
          "object-contain",
          option.invertIconInDarkMode && "dark:invert",
          className,
        )}
      />
    );
  }

  return <TelescopeIcon className={className} />;
};

const MessageError: FC = () => {
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className="aui-message-error-root border-destructive bg-destructive/10 text-destructive dark:bg-destructive/5 mt-2 rounded-md border p-3 text-sm dark:text-red-200">
        <ErrorPrimitive.Message className="aui-message-error-message line-clamp-2" />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  );
};

const AssistantMessage: FC = () => {
  // reserves space for action bar and compensates with `-mb` for consistent msg spacing
  // keeps hovered action bar from shifting layout (autohide doesn't support absolute positioning well)
  // for pt-[n] use -mb-[n + 6] & min-h-[n + 6] to preserve compensation
  const ACTION_BAR_PT = "pt-1.5";
  const ACTION_BAR_HEIGHT = `-mb-7.5 min-h-7.5 ${ACTION_BAR_PT}`;

  return (
    <MessagePrimitive.Root
      data-slot="aui_assistant-message-root"
      data-role="assistant"
      className="fade-in slide-in-from-bottom-1 animate-in relative mx-auto w-full max-w-(--thread-max-width) duration-150"
    >
      <div
        data-slot="aui_assistant-message-content"
        // [contain-intrinsic-size:auto_24px] fixes issue #4104, don't change without checking for regressions
        className="text-foreground px-2 leading-relaxed wrap-break-word [contain-intrinsic-size:auto_24px] [content-visibility:auto]"
      >
        <MessagePrimitive.GroupedParts
          groupBy={(part) => {
            return groupPartByType({
              reasoning: ["group-chainOfThought", "group-reasoning"],
              "tool-call": ["group-chainOfThought", "group-tool"],
              "standalone-tool-call": [],
            })(part);
          }}
        >
          {({ part, children }) => {
            switch (part.type) {
              case "group-chainOfThought":
                return <div data-slot="aui_chain-of-thought">{children}</div>;
              case "group-reasoning": {
                const running = part.status.type === "running";
                return (
                  <ReasoningRoot defaultOpen={running}>
                    <ReasoningTrigger active={running} />
                    <ReasoningContent aria-busy={running}>
                      <ReasoningText>{children}</ReasoningText>
                    </ReasoningContent>
                  </ReasoningRoot>
                );
              }
              case "group-tool":
                return (
                  <ToolGroupRoot>
                    <ToolGroupTrigger
                      count={part.indices.length}
                      active={part.status.type === "running"}
                    />
                    <ToolGroupContent>{children}</ToolGroupContent>
                  </ToolGroupRoot>
                );
              case "text":
                return <MarkdownText />;
              case "reasoning":
                return <Reasoning {...part} />;
              case "tool-call":
                return part.toolUI ?? <ToolFallback {...part} />;
              case "indicator":
                return (
                  <span
                    data-slot="aui_assistant-message-indicator"
                    className="animate-pulse font-sans"
                    aria-label="Assistant is working"
                  >
                    {"●"}
                  </span>
                );
              case "data":
                return part.dataRendererUI;
              default:
                return null;
            }
          }}
        </MessagePrimitive.GroupedParts>
        <MessageError />
      </div>

      <div
        data-slot="aui_assistant-message-footer"
        className={cn("ms-2 flex items-center", ACTION_BAR_HEIGHT)}
      >
        <BranchPicker />
        <AssistantActionBar />
      </div>
    </MessagePrimitive.Root>
  );
};

const AssistantActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-assistant-action-bar-root text-muted-foreground col-start-3 row-start-2 -ms-1 flex gap-1"
    >
      <ActionBarPrimitive.Copy asChild>
        <TooltipIconButton tooltip="Copy">
          <AuiIf condition={(s) => s.message.isCopied}>
            <CheckIcon />
          </AuiIf>
          <AuiIf condition={(s) => !s.message.isCopied}>
            <CopyIcon />
          </AuiIf>
        </TooltipIconButton>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload asChild>
        <TooltipIconButton tooltip="Refresh">
          <RefreshCwIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Reload>
      <ActionBarMorePrimitive.Root>
        <ActionBarMorePrimitive.Trigger asChild>
          <TooltipIconButton
            tooltip="More"
            className="data-[state=open]:bg-accent"
          >
            <MoreHorizontalIcon />
          </TooltipIconButton>
        </ActionBarMorePrimitive.Trigger>
        <ActionBarMorePrimitive.Content
          side="bottom"
          align="start"
          className="aui-action-bar-more-content bg-popover text-popover-foreground z-50 min-w-32 overflow-hidden rounded-md border p-1 shadow-md"
        >
          <ActionBarPrimitive.ExportMarkdown asChild>
            <ActionBarMorePrimitive.Item className="aui-action-bar-more-item hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none">
              <DownloadIcon className="size-4" />
              Export as Markdown
            </ActionBarMorePrimitive.Item>
          </ActionBarPrimitive.ExportMarkdown>
        </ActionBarMorePrimitive.Content>
      </ActionBarMorePrimitive.Root>
      <MessageTiming />
    </ActionBarPrimitive.Root>
  );
};

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root
      data-slot="aui_user-message-root"
      className="fade-in slide-in-from-bottom-1 animate-in mx-auto grid w-full max-w-(--thread-max-width) auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 duration-150 [contain-intrinsic-size:auto_60px] [content-visibility:auto] [&:where(>*)]:col-start-2"
      data-role="user"
    >
      <UserMessageAttachments />

      <div className="aui-user-message-content-wrapper relative col-start-2 min-w-0">
        <div className="aui-user-message-content peer bg-muted text-foreground rounded-2xl px-4 py-2.5 wrap-break-word empty:hidden">
          <MessagePrimitive.Parts />
        </div>
        <div className="aui-user-action-bar-wrapper absolute start-0 top-1/2 -translate-x-full -translate-y-1/2 pe-2 peer-empty:hidden rtl:translate-x-full">
          <UserActionBar />
        </div>
      </div>

      <BranchPicker
        data-slot="aui_user-branch-picker"
        className="col-span-full col-start-1 row-start-3 -me-1 justify-end"
      />
    </MessagePrimitive.Root>
  );
};

const UserActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-user-action-bar-root flex flex-col items-end"
    >
      <ActionBarPrimitive.Edit asChild>
        <TooltipIconButton tooltip="Edit" className="aui-user-action-edit p-4">
          <PencilIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  );
};

const EditComposer: FC = () => {
  return (
    <MessagePrimitive.Root
      data-slot="aui_edit-composer-wrapper"
      className="mx-auto flex w-full max-w-(--thread-max-width) flex-col px-2"
    >
      <ComposerPrimitive.Root className="aui-edit-composer-root border-border/60 dark:border-muted-foreground/15 ms-auto flex w-full max-w-[85%] flex-col rounded-(--composer-radius) border bg-(--composer-bg) shadow-[0_4px_16px_-8px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] dark:shadow-none">
        <ComposerPrimitive.Input
          className="aui-edit-composer-input text-foreground min-h-14 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-base outline-none"
          autoFocus
        />
        <div className="aui-edit-composer-footer mx-2.5 mb-2.5 flex items-center gap-1.5 self-end">
          <ComposerPrimitive.Cancel asChild>
            <Button variant="ghost" size="sm" className="h-8 rounded-full px-3.5">
              Cancel
            </Button>
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send asChild>
            <Button size="sm" className="h-8 rounded-full px-3.5">
              Update
            </Button>
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
};

const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({
  className,
  ...rest
}) => {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn(
        "aui-branch-picker-root text-muted-foreground -ms-2 me-2 inline-flex items-center text-xs",
        className,
      )}
      {...rest}
    >
      <BranchPickerPrimitive.Previous asChild>
        <TooltipIconButton tooltip="Previous">
          <ChevronLeftIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Previous>
      <span className="aui-branch-picker-state font-medium">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <TooltipIconButton tooltip="Next">
          <ChevronRightIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
};
