import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject
} from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import type { ChatAgent } from "./server";
import {
  Badge,
  Button,
  Empty,
  InputArea,
  Surface,
  Text
} from "@cloudflare/kumo";
import { Streamdown } from "streamdown";
import { code } from "@streamdown/code";
import {
  PaperPlaneRightIcon,
  StopIcon,
  TrashIcon,
  PlusIcon,
  GearIcon,
  ChatCircleDotsIcon,
  CircleIcon,
  MoonIcon,
  SunIcon,
  BrainIcon,
  CaretDownIcon,
  XIcon,
  PaperclipIcon,
  ImageIcon,
  PencilSimpleIcon,
  CheckIcon,
  ListIcon,
  CalendarBlankIcon,
  AddressBookIcon,
  DatabaseIcon
} from "@phosphor-icons/react";

// Image attachments are optional, but the helper keeps the message format small and predictable.

const CHAT_REVIEW_LIMIT = 30;
const USER_ID_KEY = "workinghelper_user_id";

type ChatReview = {
  id: string;
  title: string;
  updatedAt: number;
};

type GmailStatus = {
  configured: boolean;
  connected: boolean;
  email?: string;
  placeholderEmail?: string;
};

type DemoMessage = {
  id: string;
  title: string;
  body: string;
};

type CalendarEventDraft = {
  summary: string;
  startDateTime: string;
  endDateTime: string;
  timeZone: string;
};

type ApiPayload = {
  success?: boolean;
  data?: unknown;
  error?: {
    message?: string;
  };
};

interface Attachment {
  id: string;
  file: File;
  preview: string;
  mediaType: string;
}

function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function getOrCreateUserId() {
  const existing = localStorage.getItem(USER_ID_KEY);
  if (existing) return existing;

  const userId = createId("local_user");
  localStorage.setItem(USER_ID_KEY, userId);
  return userId;
}

function getReviewStorageKey(userId: string) {
  return `workinghelper_chat_reviews_${userId}`;
}

function createEmptyReview(): ChatReview {
  return {
    id: createId("chat"),
    title: "New chat",
    updatedAt: Date.now()
  };
}

function loadChatReviews(userId: string) {
  const raw = localStorage.getItem(getReviewStorageKey(userId));
  if (!raw) return [createEmptyReview()];

  try {
    const reviews = JSON.parse(raw) as ChatReview[];
    return reviews.length > 0
      ? reviews.slice(0, CHAT_REVIEW_LIMIT)
      : [createEmptyReview()];
  } catch {
    return [createEmptyReview()];
  }
}

function saveChatReviews(userId: string, reviews: ChatReview[]) {
  localStorage.setItem(
    getReviewStorageKey(userId),
    JSON.stringify(reviews.slice(0, CHAT_REVIEW_LIMIT))
  );
}

function createReviewTitle(text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "Image chat";
  return clean.length > 48 ? `${clean.slice(0, 45)}...` : clean;
}

function createAttachment(file: File): Attachment {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    file,
    preview: URL.createObjectURL(file),
    mediaType: file.type || "application/octet-stream"
  };
}

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toDatetimeLocalValue(date: Date) {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function createDefaultCalendarDraft(): CalendarEventDraft {
  const start = new Date();
  start.setHours(start.getHours() + 1, 0, 0, 0);
  const end = new Date(start.getTime() + 30 * 60_000);

  return {
    summary: "WorkingHelper demo event",
    startDateTime: toDatetimeLocalValue(start),
    endDateTime: toDatetimeLocalValue(end),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  };
}

function getTimeZoneOptions(currentTimeZone: string) {
  return Array.from(
    new Set([
      currentTimeZone,
      "UTC",
      "America/New_York",
      "America/Los_Angeles",
      "Asia/Shanghai",
      "Europe/London"
    ])
  );
}

function parseDatetimeLocal(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5])
  };
}

function partsInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);

  const map = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(map.get("year")),
    month: Number(map.get("month")),
    day: Number(map.get("day")),
    hour: Number(map.get("hour")),
    minute: Number(map.get("minute")),
    second: Number(map.get("second"))
  };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = partsInTimeZone(date, timeZone);
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return localAsUtc - date.getTime();
}

function toZonedIso(datetimeLocal: string, timeZone: string) {
  const parts = parseDatetimeLocal(datetimeLocal);
  if (!parts) throw new Error("Choose a valid date and time.");

  const guess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    0
  );
  const first = guess - getTimeZoneOffsetMs(new Date(guess), timeZone);
  const corrected = guess - getTimeZoneOffsetMs(new Date(first), timeZone);
  return new Date(corrected).toISOString();
}

function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function ThemeToggle() {
  const [dark, setDark] = useState(
    () => document.documentElement.getAttribute("data-mode") === "dark"
  );

  const toggle = useCallback(() => {
    const next = !dark;
    setDark(next);
    const mode = next ? "dark" : "light";
    document.documentElement.setAttribute("data-mode", mode);
    document.documentElement.style.colorScheme = mode;
    localStorage.setItem("theme", mode);
  }, [dark]);

  return (
    <Button
      variant="secondary"
      shape="square"
      icon={dark ? <SunIcon size={16} /> : <MoonIcon size={16} />}
      onClick={toggle}
      aria-label="Toggle theme"
    />
  );
}

function ToolPartView({ part }: { part: UIMessage["parts"][number] }) {
  if (!isToolUIPart(part)) return null;
  const toolName = getToolName(part);

  // Show the raw tool result while Week 1 is still focused on understanding the data flow.
  if (part.state === "output-available") {
    return (
      <div className="flex justify-start">
        <Surface className="max-w-[85%] px-4 py-2.5 rounded-xl ring ring-kumo-line">
          <div className="flex items-center gap-2 mb-1">
            <GearIcon size={14} className="text-kumo-inactive" />
            <Text size="xs" variant="secondary" bold>
              {toolName}
            </Text>
            <Badge variant="secondary">Done</Badge>
          </div>
          <div className="font-mono">
            <Text size="xs" variant="secondary">
              {JSON.stringify(part.output, null, 2)}
            </Text>
          </div>
        </Surface>
      </div>
    );
  }

  if (part.state === "input-available" || part.state === "input-streaming") {
    return (
      <div className="flex justify-start">
        <Surface className="max-w-[85%] px-4 py-2.5 rounded-xl ring ring-kumo-line">
          <div className="flex items-center gap-2">
            <GearIcon size={14} className="text-kumo-inactive animate-spin" />
            <Text size="xs" variant="secondary">
              Running {toolName}...
            </Text>
          </div>
        </Surface>
      </div>
    );
  }

  return null;
}

function Chat({
  agentName,
  userId,
  onMessageSent,
  onOpenSidebar,
  demoMessages,
  onClearDemoMessages
}: {
  agentName: string;
  userId: string;
  onMessageSent: (text: string) => void;
  onOpenSidebar: () => void;
  demoMessages: DemoMessage[];
  onClearDemoMessages: () => void;
}) {
  const [connected, setConnected] = useState(false);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const agent = useAgent<ChatAgent>({
    agent: "ChatAgent",
    name: agentName,
    onOpen: useCallback(() => setConnected(true), []),
    onClose: useCallback(() => setConnected(false), []),
    onError: useCallback(
      (error: Event) => console.error("WebSocket error:", error),
      []
    )
  });

  const { messages, sendMessage, clearHistory, stop, status } = useAgentChat({
    agent,
    experimental_throttle: 100
  });

  const isStreaming = status === "streaming" || status === "submitted";

  const syncAgentAuth = useCallback(async () => {
    try {
      await fetch(
        `/api/agent/auth-sync?name=${encodeURIComponent(agentName)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ memoryOwnerName: userId })
        }
      );
    } catch (error) {
      console.error("Failed to sync agent auth:", error);
    }
  }, [agentName, userId]);

  const sendTextPrompt = useCallback(
    async (text: string) => {
      if (isStreaming) return;
      await syncAgentAuth();
      sendMessage({
        role: "user",
        parts: [{ type: "text", text }]
      });
      onMessageSent(text);
    },
    [isStreaming, onMessageSent, sendMessage, syncAgentAuth]
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Re-focus the input after streaming ends
  useEffect(() => {
    if (!isStreaming && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isStreaming]);

  const addFiles = useCallback((files: FileList | File[]) => {
    const images = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    setAttachments((prev) => [...prev, ...images.map(createAttachment)]);
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const att = prev.find((a) => a.id === id);
      if (att) URL.revokeObjectURL(att.preview);
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes("Files")) setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === e.target) setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
    },
    [addFiles]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const item of items) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        addFiles(files);
      }
    },
    [addFiles]
  );

  const send = useCallback(async () => {
    const text = input.trim();
    if ((!text && attachments.length === 0) || isStreaming) return;
    setInput("");

    const parts: Array<
      | { type: "text"; text: string }
      | { type: "file"; mediaType: string; url: string }
    > = [];
    if (text) parts.push({ type: "text", text });

    for (const att of attachments) {
      const dataUri = await fileToDataUri(att.file);
      parts.push({ type: "file", mediaType: att.mediaType, url: dataUri });
    }

    for (const att of attachments) URL.revokeObjectURL(att.preview);
    setAttachments([]);

    await syncAgentAuth();
    sendMessage({ role: "user", parts });
    onMessageSent(text);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [
    input,
    attachments,
    isStreaming,
    sendMessage,
    onMessageSent,
    syncAgentAuth
  ]);

  return (
    <div
      className="flex flex-col h-screen bg-kumo-elevated relative min-w-0 flex-1"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-kumo-elevated/80 backdrop-blur-sm border-2 border-dashed border-kumo-brand rounded-xl m-2 pointer-events-none">
          <div className="flex flex-col items-center gap-2 text-kumo-brand">
            <ImageIcon size={40} />
            <Text variant="heading3" as="span">
              Drop images here
            </Text>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="px-3 py-3 sm:px-5 sm:py-4 bg-kumo-base border-b border-kumo-line">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Button
              variant="ghost"
              shape="square"
              aria-label="Open chat sidebar"
              icon={<ListIcon size={18} />}
              onClick={onOpenSidebar}
              className="md:hidden shrink-0"
            />
            <h1 className="text-base sm:text-lg font-semibold text-kumo-default truncate">
              WorkingHelper
            </h1>
            <Badge variant="secondary" className="hidden sm:inline-flex">
              <ChatCircleDotsIcon size={12} weight="bold" className="mr-1" />
              AI Chat
            </Badge>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            <div className="hidden sm:flex items-center gap-1.5">
              <CircleIcon
                size={8}
                weight="fill"
                className={connected ? "text-kumo-success" : "text-kumo-danger"}
              />
              <Text size="xs" variant="secondary">
                {connected ? "Connected" : "Disconnected"}
              </Text>
            </div>
            <ThemeToggle />
            <Button
              variant="secondary"
              icon={<TrashIcon size={16} />}
              onClick={() => {
                clearHistory();
                onClearDemoMessages();
              }}
              className="hidden sm:inline-flex"
            >
              Clear
            </Button>
            <Button
              variant="secondary"
              shape="square"
              aria-label="Clear chat"
              icon={<TrashIcon size={16} />}
              onClick={() => {
                clearHistory();
                onClearDemoMessages();
              }}
              className="sm:hidden"
            />
          </div>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-3 sm:px-5 py-5 sm:py-6 space-y-5">
          {messages.length === 0 && (
            <Empty
              icon={<ChatCircleDotsIcon size={32} />}
              title="Start a conversation"
              contents={
                <div className="flex flex-wrap justify-center gap-2 max-w-full">
                  {[
                    "Find frontend engineer jobs in New York",
                    "Search remote software engineer internships",
                    "Find data analyst jobs in San Francisco",
                    "Look for product manager roles in Seattle"
                  ].map((prompt) => (
                    <Button
                      key={prompt}
                      variant="outline"
                      size="sm"
                      disabled={isStreaming}
                      onClick={() => sendTextPrompt(prompt)}
                    >
                      {prompt}
                    </Button>
                  ))}
                </div>
              }
            />
          )}

          {messages.map((message: UIMessage, index: number) => {
            const isUser = message.role === "user";
            const isLastAssistant =
              message.role === "assistant" && index === messages.length - 1;

            return (
              <div key={message.id} className="space-y-2">
                {message.parts.filter(isToolUIPart).map((part) => (
                  <ToolPartView key={part.toolCallId} part={part} />
                ))}

                {/* Reasoning parts */}
                {message.parts
                  .filter(
                    (part) =>
                      part.type === "reasoning" &&
                      (part as { text?: string }).text?.trim()
                  )
                  .map((part, i) => {
                    const reasoning = part as {
                      type: "reasoning";
                      text: string;
                      state?: "streaming" | "done";
                    };
                    const isDone = reasoning.state === "done" || !isStreaming;
                    return (
                      <div key={i} className="flex justify-start">
                        <details className="max-w-[85%] w-full" open={!isDone}>
                          <summary className="flex items-center gap-2 cursor-pointer px-3 py-2 rounded-lg bg-purple-500/10 border border-purple-500/20 text-sm select-none">
                            <BrainIcon size={14} className="text-purple-400" />
                            <span className="font-medium text-kumo-default">
                              Reasoning
                            </span>
                            {isDone ? (
                              <span className="text-xs text-kumo-success">
                                Complete
                              </span>
                            ) : (
                              <span className="text-xs text-kumo-brand">
                                Thinking...
                              </span>
                            )}
                            <CaretDownIcon
                              size={14}
                              className="ml-auto text-kumo-inactive"
                            />
                          </summary>
                          <pre className="mt-2 px-3 py-2 rounded-lg bg-kumo-control text-xs text-kumo-default whitespace-pre-wrap overflow-auto max-h-64">
                            {reasoning.text}
                          </pre>
                        </details>
                      </div>
                    );
                  })}

                {/* Image parts */}
                {message.parts
                  .filter(
                    (part): part is Extract<typeof part, { type: "file" }> =>
                      part.type === "file" &&
                      (part as { mediaType?: string }).mediaType?.startsWith(
                        "image/"
                      ) === true
                  )
                  .map((part, i) => (
                    <div
                      key={`file-${i}`}
                      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                    >
                      <img
                        src={part.url}
                        alt="Attachment"
                        className="max-h-64 rounded-xl border border-kumo-line object-contain"
                      />
                    </div>
                  ))}

                {/* Text parts */}
                {message.parts
                  .filter((part) => part.type === "text")
                  .map((part, i) => {
                    const text = (part as { type: "text"; text: string }).text;
                    if (!text) return null;

                    if (isUser) {
                      return (
                        <div key={i} className="flex justify-end">
                          <div className="max-w-[85%] px-4 py-2.5 rounded-2xl rounded-br-md bg-kumo-contrast text-kumo-inverse leading-relaxed">
                            {text}
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div key={i} className="flex justify-start">
                        <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-kumo-base text-kumo-default leading-relaxed">
                          <Streamdown
                            className="sd-theme rounded-2xl rounded-bl-md p-3"
                            plugins={{ code }}
                            controls={false}
                            isAnimating={isLastAssistant && isStreaming}
                          >
                            {text}
                          </Streamdown>
                        </div>
                      </div>
                    );
                  })}
              </div>
            );
          })}

          {demoMessages.map((message) => (
            <div key={message.id} className="flex justify-start">
              <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-kumo-base text-kumo-default leading-relaxed">
                <div className="rounded-2xl rounded-bl-md p-3">
                  <Text size="sm" bold>
                    {message.title}
                  </Text>
                  <pre className="mt-2 whitespace-pre-wrap text-sm font-sans text-kumo-default">
                    {message.body}
                  </pre>
                </div>
              </div>
            </div>
          ))}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-kumo-line bg-kumo-base">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="max-w-3xl mx-auto px-3 sm:px-5 py-4"
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            aria-label="Upload image attachments"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />

          {attachments.length > 0 && (
            <div className="flex gap-2 mb-2 flex-wrap">
              {attachments.map((att) => (
                <div
                  key={att.id}
                  className="relative group rounded-lg border border-kumo-line bg-kumo-control overflow-hidden"
                >
                  <img
                    src={att.preview}
                    alt={att.file.name}
                    className="h-16 w-16 object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeAttachment(att.id)}
                    className="absolute top-0.5 right-0.5 rounded-full bg-kumo-contrast/80 text-kumo-inverse p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-label={`Remove ${att.file.name}`}
                  >
                    <XIcon size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-end gap-3 rounded-xl border border-kumo-line bg-kumo-base p-3 shadow-sm focus-within:ring-2 focus-within:ring-kumo-ring focus-within:border-transparent transition-shadow">
            <Button
              type="button"
              variant="ghost"
              shape="square"
              aria-label="Attach images"
              icon={<PaperclipIcon size={18} />}
              onClick={() => fileInputRef.current?.click()}
              disabled={!connected || isStreaming}
              className="mb-0.5"
            />
            <InputArea
              ref={textareaRef}
              value={input}
              onValueChange={setInput}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = `${el.scrollHeight}px`;
              }}
              onPaste={handlePaste}
              placeholder={
                attachments.length > 0
                  ? "Add a message or send images..."
                  : "Ask for jobs by role and location..."
              }
              disabled={!connected || isStreaming}
              rows={1}
              className="flex-1 ring-0! focus:ring-0! shadow-none! bg-transparent! outline-none! resize-none max-h-40"
            />
            {isStreaming ? (
              <Button
                type="button"
                variant="secondary"
                shape="square"
                aria-label="Stop generation"
                icon={<StopIcon size={18} />}
                onClick={stop}
                className="mb-0.5"
              />
            ) : (
              <Button
                type="submit"
                variant="primary"
                shape="square"
                aria-label="Send message"
                disabled={
                  (!input.trim() && attachments.length === 0) || !connected
                }
                icon={<PaperPlaneRightIcon size={18} />}
                className="mb-0.5"
              />
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

type SidebarContentProps = {
  reviews: ChatReview[];
  activeChatId: string;
  gmailStatus: GmailStatus;
  userId: string;
  editingChatId: string | null;
  editingTitle: string;
  editInputRef: RefObject<HTMLInputElement | null>;
  calendarDraft: CalendarEventDraft;
  updateCalendarDraft: (patch: Partial<CalendarEventDraft>) => void;
  setEditingTitle: (title: string) => void;
  createNewChat: () => void;
  selectChat: (chatId: string) => void;
  startEditingReview: (review: ChatReview) => void;
  saveEditingReview: () => void;
  cancelEditingReview: () => void;
  deleteReview: (reviewId: string) => void;
  disconnectGmail: () => void;
  runCalendarTodayDemo: () => void;
  runCreateCalendarEventDemo: () => void;
  runContactsSearchDemo: () => void;
  runMemoryDemo: () => void;
};

function SidebarContent({
  reviews,
  activeChatId,
  gmailStatus,
  userId,
  editingChatId,
  editingTitle,
  editInputRef,
  calendarDraft,
  updateCalendarDraft,
  setEditingTitle,
  createNewChat,
  selectChat,
  startEditingReview,
  saveEditingReview,
  cancelEditingReview,
  deleteReview,
  disconnectGmail,
  runCalendarTodayDemo,
  runCreateCalendarEventDemo,
  runContactsSearchDemo,
  runMemoryDemo
}: SidebarContentProps) {
  return (
    <>
      <div className="p-4 border-b border-kumo-line">
        <Button
          variant="primary"
          icon={<PlusIcon size={16} />}
          onClick={createNewChat}
          className="w-full justify-center"
        >
          New chat
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-1">
        {reviews.map((review) => {
          const isActive = review.id === activeChatId;
          const isEditing = review.id === editingChatId;

          return (
            <div
              key={review.id}
              className={`group flex items-center gap-1 rounded-lg border px-2 py-2 transition-colors ${
                isActive
                  ? "border-kumo-brand bg-kumo-control"
                  : "border-transparent hover:bg-kumo-control"
              }`}
            >
              {isEditing ? (
                <input
                  ref={editInputRef}
                  value={editingTitle}
                  onChange={(event) => setEditingTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") saveEditingReview();
                    if (event.key === "Escape") cancelEditingReview();
                  }}
                  aria-label="Edit chat name"
                  className="min-w-0 flex-1 rounded-md border border-kumo-line bg-kumo-base px-2 py-1 text-sm font-medium text-kumo-default outline-none focus:border-kumo-brand"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => selectChat(review.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-sm font-medium text-kumo-default">
                    {review.title}
                  </span>
                  <span className="block text-xs text-kumo-subtle mt-0.5">
                    {new Date(review.updatedAt).toLocaleDateString()}
                  </span>
                </button>
              )}

              <div className="flex shrink-0 items-center gap-0.5 opacity-100 md:opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                {isEditing ? (
                  <>
                    <button
                      type="button"
                      onClick={saveEditingReview}
                      className="rounded-md p-1 text-kumo-subtle hover:bg-kumo-base hover:text-kumo-default"
                      aria-label="Save chat name"
                      title="Save"
                    >
                      <CheckIcon size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={cancelEditingReview}
                      className="rounded-md p-1 text-kumo-subtle hover:bg-kumo-base hover:text-kumo-default"
                      aria-label="Cancel editing"
                      title="Cancel"
                    >
                      <XIcon size={14} />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => startEditingReview(review)}
                      className="rounded-md p-1 text-kumo-subtle hover:bg-kumo-base hover:text-kumo-default"
                      aria-label={`Rename ${review.title}`}
                      title="Rename"
                    >
                      <PencilSimpleIcon size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteReview(review.id)}
                      className="rounded-md p-1 text-kumo-subtle hover:bg-kumo-base hover:text-kumo-danger"
                      aria-label={`Delete ${review.title}`}
                      title="Delete"
                    >
                      <TrashIcon size={14} />
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="p-3 border-t border-kumo-line">
        <div className="mb-3 space-y-2">
          <Text size="xs" variant="secondary" bold>
            Week 3 API demos
          </Text>
          <Button
            variant="secondary"
            icon={<CalendarBlankIcon size={16} />}
            onClick={runCalendarTodayDemo}
            className="w-full justify-center"
          >
            Today calendar
          </Button>
          <Button
            variant="secondary"
            icon={<CalendarBlankIcon size={16} />}
            onClick={runCreateCalendarEventDemo}
            className="w-full justify-center"
          >
            Create event
          </Button>
          <div className="space-y-2 rounded-lg border border-kumo-line p-2">
            <label className="block text-xs font-medium text-kumo-subtle">
              Event title
              <input
                value={calendarDraft.summary}
                onChange={(event) =>
                  updateCalendarDraft({ summary: event.target.value })
                }
                className="mt-1 w-full rounded-md border border-kumo-line bg-kumo-base px-2 py-1.5 text-sm text-kumo-default outline-none focus:border-kumo-brand"
              />
            </label>
            <label className="block text-xs font-medium text-kumo-subtle">
              Start
              <input
                type="datetime-local"
                value={calendarDraft.startDateTime}
                onChange={(event) =>
                  updateCalendarDraft({ startDateTime: event.target.value })
                }
                className="mt-1 w-full rounded-md border border-kumo-line bg-kumo-base px-2 py-1.5 text-sm text-kumo-default outline-none focus:border-kumo-brand"
              />
            </label>
            <label className="block text-xs font-medium text-kumo-subtle">
              End
              <input
                type="datetime-local"
                value={calendarDraft.endDateTime}
                onChange={(event) =>
                  updateCalendarDraft({ endDateTime: event.target.value })
                }
                className="mt-1 w-full rounded-md border border-kumo-line bg-kumo-base px-2 py-1.5 text-sm text-kumo-default outline-none focus:border-kumo-brand"
              />
            </label>
            <label className="block text-xs font-medium text-kumo-subtle">
              Time zone
              <select
                value={calendarDraft.timeZone}
                onChange={(event) =>
                  updateCalendarDraft({ timeZone: event.target.value })
                }
                className="mt-1 w-full rounded-md border border-kumo-line bg-kumo-base px-2 py-1.5 text-sm text-kumo-default outline-none focus:border-kumo-brand"
              >
                {getTimeZoneOptions(calendarDraft.timeZone).map((timeZone) => (
                  <option key={timeZone} value={timeZone}>
                    {timeZone}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <Button
            variant="secondary"
            icon={<AddressBookIcon size={16} />}
            onClick={runContactsSearchDemo}
            className="w-full justify-center"
          >
            Search contacts
          </Button>
          <Button
            variant="secondary"
            icon={<DatabaseIcon size={16} />}
            onClick={runMemoryDemo}
            className="w-full justify-center"
          >
            Save memory
          </Button>
        </div>

        <Button
          variant="secondary"
          onClick={() => {
            window.location.href = "/auth/google";
          }}
          className="w-full justify-center mb-3"
        >
          {gmailStatus.connected ? "Switch Gmail" : "Connect Gmail"}
        </Button>
        {gmailStatus.connected && (
          <Button
            variant="ghost"
            onClick={disconnectGmail}
            className="w-full justify-center mb-3"
          >
            Disconnect Gmail
          </Button>
        )}
        <div className="space-y-1">
          <Text size="xs" variant="secondary">
            Local user: {userId.slice(-8)}
          </Text>
          <Text size="xs" variant="secondary">
            Gmail: {gmailStatus.email || "Not connected"}
          </Text>
        </div>
      </div>
    </>
  );
}

export default function App() {
  const [userId] = useState(getOrCreateUserId);
  const [reviews, setReviews] = useState(() => loadChatReviews(userId));
  const [activeChatId, setActiveChatId] = useState(() => reviews[0].id);
  const [demoMessages, setDemoMessages] = useState<DemoMessage[]>([]);
  const [calendarDraft, setCalendarDraft] = useState(
    createDefaultCalendarDraft
  );
  const [gmailStatus, setGmailStatus] = useState<GmailStatus>({
    configured: false,
    connected: false
  });
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    saveChatReviews(userId, reviews);
  }, [userId, reviews]);

  useEffect(() => {
    setDemoMessages([]);
  }, [activeChatId]);

  const refreshGmailStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/gmail/status");
      if (!response.ok) return;
      setGmailStatus((await response.json()) as GmailStatus);
    } catch (error) {
      console.error("Failed to load Gmail status:", error);
    }
  }, []);

  useEffect(() => {
    refreshGmailStatus();
  }, [refreshGmailStatus]);

  useEffect(() => {
    if (editingChatId) {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [editingChatId]);

  const disconnectGmail = useCallback(async () => {
    await fetch("/auth/google/logout");
    setGmailStatus((current) => ({
      ...current,
      connected: false,
      email: undefined
    }));
  }, []);

  const createNewChat = useCallback(() => {
    const review = createEmptyReview();
    setReviews((current) => [review, ...current].slice(0, CHAT_REVIEW_LIMIT));
    setActiveChatId(review.id);
    setEditingChatId(null);
    setMobileSidebarOpen(false);
  }, []);

  const selectChat = useCallback((chatId: string) => {
    setActiveChatId(chatId);
    setMobileSidebarOpen(false);
  }, []);

  const startEditingReview = useCallback((review: ChatReview) => {
    setEditingChatId(review.id);
    setEditingTitle(review.title);
  }, []);

  const cancelEditingReview = useCallback(() => {
    setEditingChatId(null);
    setEditingTitle("");
  }, []);

  const saveEditingReview = useCallback(() => {
    if (!editingChatId) return;

    const title = editingTitle.replace(/\s+/g, " ").trim();
    if (!title) {
      cancelEditingReview();
      return;
    }

    setReviews((current) =>
      current.map((review) =>
        review.id === editingChatId
          ? { ...review, title, updatedAt: Date.now() }
          : review
      )
    );
    cancelEditingReview();
  }, [cancelEditingReview, editingChatId, editingTitle]);

  const deleteReview = useCallback(
    (reviewId: string) => {
      setReviews((current) => {
        const remaining = current.filter((review) => review.id !== reviewId);

        if (remaining.length === 0) {
          const replacement = createEmptyReview();
          setActiveChatId(replacement.id);
          return [replacement];
        }

        if (reviewId === activeChatId) {
          setActiveChatId(remaining[0].id);
        }

        return remaining;
      });

      if (editingChatId === reviewId) {
        cancelEditingReview();
      }
    },
    [activeChatId, cancelEditingReview, editingChatId]
  );

  const updateActiveReview = useCallback(
    (text: string) => {
      setReviews((current) => {
        const now = Date.now();
        const title = createReviewTitle(text);
        const existing = current.find((review) => review.id === activeChatId);
        const updated = {
          id: activeChatId,
          title:
            existing?.title === "New chat" ? title : existing?.title || title,
          updatedAt: now
        };

        return [
          updated,
          ...current.filter((review) => review.id !== activeChatId)
        ].slice(0, CHAT_REVIEW_LIMIT);
      });
    },
    [activeChatId]
  );

  const addDemoMessage = useCallback(
    (title: string, body: string) => {
      setDemoMessages((current) => [
        ...current,
        { id: createId("demo"), title, body }
      ]);
      updateActiveReview(title);
      setMobileSidebarOpen(false);
    },
    [updateActiveReview]
  );

  const readApiResponse = useCallback(async (response: Response) => {
    const payload = (await response.json()) as ApiPayload;
    if (!response.ok || payload.success === false) {
      const message =
        payload.error?.message ||
        "The API request failed. Try reconnecting Google first.";
      throw new Error(message);
    }
    return payload.data;
  }, []);

  const updateCalendarDraft = useCallback(
    (patch: Partial<CalendarEventDraft>) => {
      setCalendarDraft((current) => ({ ...current, ...patch }));
    },
    []
  );

  const runCalendarTodayDemo = useCallback(async () => {
    try {
      const timeZone =
        Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const data = await readApiResponse(
        await fetch(
          `/api/calendar/today?timeZone=${encodeURIComponent(timeZone)}&maxResults=10`
        )
      );
      const events =
        isRecord(data) && Array.isArray(data.events) ? data.events : [];
      const body =
        events.length === 0
          ? `No events found today.\n\nRaw response:\n${formatJson(data)}`
          : events
              .map(
                (event: { summary?: string; start?: string; end?: string }) =>
                  `- ${event.summary || "(No title)"}\n  ${event.start || "No start"} → ${event.end || "No end"}`
              )
              .join("\n\n");
      addDemoMessage("Calendar: today's events", body);
    } catch (error) {
      addDemoMessage("Calendar demo failed", (error as Error).message);
    }
  }, [addDemoMessage, readApiResponse]);

  const runCreateCalendarEventDemo = useCallback(async () => {
    try {
      const summary = calendarDraft.summary.replace(/\s+/g, " ").trim();
      if (!summary) throw new Error("Enter an event title.");

      const startDateTime = toZonedIso(
        calendarDraft.startDateTime,
        calendarDraft.timeZone
      );
      const endDateTime = toZonedIso(
        calendarDraft.endDateTime,
        calendarDraft.timeZone
      );
      const data = await readApiResponse(
        await fetch("/api/calendar/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            summary,
            startDateTime,
            endDateTime,
            timeZone: calendarDraft.timeZone,
            sendUpdates: "none"
          })
        })
      );
      addDemoMessage("Calendar: event created", formatJson(data));
    } catch (error) {
      addDemoMessage("Create event failed", (error as Error).message);
    }
  }, [addDemoMessage, calendarDraft, readApiResponse]);

  const runContactsSearchDemo = useCallback(async () => {
    const query = window.prompt("Contact keyword", "Jonas");
    if (!query) return;

    try {
      const data = await readApiResponse(
        await fetch(
          `/api/contacts/search?q=${encodeURIComponent(query)}&pageSize=10`
        )
      );
      addDemoMessage("Contacts search result", formatJson(data));
    } catch (error) {
      addDemoMessage("Contacts demo failed", (error as Error).message);
    }
  }, [addDemoMessage, readApiResponse]);

  const runMemoryDemo = useCallback(async () => {
    const key = window.prompt("Memory key", "job_search_goal");
    if (!key) return;
    const value = window.prompt("Memory value", "Frontend roles in New York");
    if (!value) return;

    try {
      const data = await readApiResponse(
        await fetch("/api/memory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, value })
        })
      );
      addDemoMessage("Memory saved", formatJson(data));
    } catch (error) {
      addDemoMessage("Memory demo failed", (error as Error).message);
    }
  }, [addDemoMessage, readApiResponse]);

  const agentName = `${userId}:${activeChatId}`;
  const gmailConnectionKey = gmailStatus.connected
    ? gmailStatus.email || "gmail-connected"
    : "gmail-disconnected";

  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-screen text-kumo-inactive">
          Loading...
        </div>
      }
    >
      <div className="flex h-screen w-full overflow-hidden bg-kumo-elevated">
        {mobileSidebarOpen && (
          <div className="fixed inset-0 z-50 md:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-black/35"
              aria-label="Close chat sidebar"
              onClick={() => setMobileSidebarOpen(false)}
            />
            <aside className="relative flex h-full w-[82vw] max-w-80 flex-col border-r border-kumo-line bg-kumo-base shadow-xl">
              <div className="flex items-center justify-between border-b border-kumo-line px-4 py-3">
                <Text bold as="span">
                  Chats
                </Text>
                <Button
                  variant="ghost"
                  shape="square"
                  aria-label="Close chat sidebar"
                  icon={<XIcon size={18} />}
                  onClick={() => setMobileSidebarOpen(false)}
                />
              </div>
              <SidebarContent
                reviews={reviews}
                activeChatId={activeChatId}
                gmailStatus={gmailStatus}
                userId={userId}
                editingChatId={editingChatId}
                editingTitle={editingTitle}
                editInputRef={editInputRef}
                calendarDraft={calendarDraft}
                updateCalendarDraft={updateCalendarDraft}
                setEditingTitle={setEditingTitle}
                createNewChat={createNewChat}
                selectChat={selectChat}
                startEditingReview={startEditingReview}
                saveEditingReview={saveEditingReview}
                cancelEditingReview={cancelEditingReview}
                deleteReview={deleteReview}
                disconnectGmail={disconnectGmail}
                runCalendarTodayDemo={runCalendarTodayDemo}
                runCreateCalendarEventDemo={runCreateCalendarEventDemo}
                runContactsSearchDemo={runContactsSearchDemo}
                runMemoryDemo={runMemoryDemo}
              />
            </aside>
          </div>
        )}

        <aside className="hidden md:flex w-72 shrink-0 flex-col border-r border-kumo-line bg-kumo-base">
          <SidebarContent
            reviews={reviews}
            activeChatId={activeChatId}
            gmailStatus={gmailStatus}
            userId={userId}
            editingChatId={editingChatId}
            editingTitle={editingTitle}
            editInputRef={editInputRef}
            calendarDraft={calendarDraft}
            updateCalendarDraft={updateCalendarDraft}
            setEditingTitle={setEditingTitle}
            createNewChat={createNewChat}
            selectChat={selectChat}
            startEditingReview={startEditingReview}
            saveEditingReview={saveEditingReview}
            cancelEditingReview={cancelEditingReview}
            deleteReview={deleteReview}
            disconnectGmail={disconnectGmail}
            runCalendarTodayDemo={runCalendarTodayDemo}
            runCreateCalendarEventDemo={runCreateCalendarEventDemo}
            runContactsSearchDemo={runContactsSearchDemo}
            runMemoryDemo={runMemoryDemo}
          />
        </aside>

        <Chat
          key={`${activeChatId}:${gmailConnectionKey}`}
          agentName={agentName}
          userId={userId}
          onMessageSent={updateActiveReview}
          onOpenSidebar={() => setMobileSidebarOpen(true)}
          demoMessages={demoMessages}
          onClearDemoMessages={() => setDemoMessages([])}
        />
      </div>
    </Suspense>
  );
}
