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
  XIcon,
  PaperclipIcon,
  ImageIcon,
  PencilSimpleIcon,
  CheckIcon,
  ListIcon,
  BriefcaseIcon,
  CalendarBlankIcon,
  ArrowRightIcon
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

function WelcomeScreen({
  onLogin,
  onAnonymousLogin
}: {
  onLogin: () => void;
  onAnonymousLogin: () => void;
}) {
  return (
    <main className="welcome-shell">
      <div className="welcome-glow welcome-glow-one" aria-hidden="true" />
      <div className="welcome-glow welcome-glow-two" aria-hidden="true" />
      <section className="welcome-panel" aria-labelledby="welcome-title">
        <div className="welcome-panel-inner">
          <div className="welcome-mark" aria-hidden="true">
            <ChatCircleDotsIcon size={22} weight="fill" />
          </div>
          <Badge variant="secondary">AitherPath AI Assistant Agent</Badge>
          <h1 id="welcome-title" className="welcome-title">
            All work, in one.
          </h1>
          <p className="welcome-subtitle">
            Find opportunities, manage communication, and keep your next move
            organized with an AI assistant that can take action for you.
          </p>

          <div
            className="welcome-features"
            aria-label="What the assistant can do"
          >
            <div className="welcome-feature">
              <ChatCircleDotsIcon size={20} />
              <div>
                <strong>AI chat</strong>
                <span>
                  Ask naturally and keep context across conversations.
                </span>
              </div>
            </div>
            <div className="welcome-feature">
              <PaperPlaneRightIcon size={20} />
              <div>
                <strong>Automate email</strong>
                <span>Draft and send Gmail messages with your approval.</span>
              </div>
            </div>
            <div className="welcome-feature">
              <BriefcaseIcon size={20} />
              <div>
                <strong>Find jobs</strong>
                <span>
                  Search roles by title, location, and your preferences.
                </span>
              </div>
            </div>
            <div className="welcome-feature">
              <CalendarBlankIcon size={20} />
              <div>
                <strong>Plan your calendar</strong>
                <span>
                  Check availability and schedule meetings with Google Calendar.
                </span>
              </div>
            </div>
          </div>

          <div className="welcome-actions">
            <button type="button" className="welcome-primary" onClick={onLogin}>
              Log in with Google
              <ArrowRightIcon size={18} />
            </button>
            <button
              type="button"
              className="welcome-secondary"
              onClick={onAnonymousLogin}
            >
              Anonymous login
            </button>
          </div>
          <p className="welcome-footnote">
            Log in to keep your profile memory across chats and devices.
            Anonymous mode is for quick testing.
          </p>
        </div>
      </section>
    </main>
  );
}

function getConfirmationPreview(
  toolName: string,
  input: unknown
): Array<[string, unknown]> {
  const values = (input || {}) as Record<string, unknown>;
  if (toolName === "sendGmailEmail") {
    return [
      ["Recipient", values.to],
      ["Subject", values.subject],
      ["Body", values.body]
    ];
  }
  if (toolName === "createCalendarEvent") {
    return [
      ["Event", values.summary],
      ["Start", values.startDateTime],
      ["End", values.endDateTime],
      ["Time zone", values.timeZone],
      ["Location", values.location],
      ["Attendees", (values.attendeeEmails as string[] | undefined)?.join(", ")]
    ];
  }
  return Object.entries(values);
}

function ToolPartView({
  part,
  disabled,
  onApproval
}: {
  part: UIMessage["parts"][number];
  disabled: boolean;
  onApproval: (id: string, approved: boolean) => void;
}) {
  if (!isToolUIPart(part)) return null;
  const toolName = getToolName(part);

  if (part.state === "approval-requested") {
    return (
      <div className="flex justify-start">
        <Surface className="max-w-[92%] px-4 py-3 rounded-xl ring ring-kumo-line">
          <div className="flex items-center gap-2 mb-3">
            <GearIcon size={14} className="text-kumo-brand" />
            <Text size="sm" bold>
              Confirm{" "}
              {toolName === "sendGmailEmail" ? "email" : "calendar event"}
            </Text>
            <Badge variant="secondary">Approval required</Badge>
          </div>
          <dl className="space-y-2 text-sm">
            {getConfirmationPreview(toolName, part.input)
              .filter(([, value]) => value !== undefined && value !== "")
              .map(([label, value]) => (
                <div key={label} className="grid grid-cols-[5.5rem_1fr] gap-2">
                  <dt className="text-kumo-inactive">{label}</dt>
                  <dd className="text-kumo-default whitespace-pre-wrap break-words">
                    {String(value)}
                  </dd>
                </div>
              ))}
          </dl>
          <div className="flex flex-wrap gap-2 mt-4">
            <button
              type="button"
              disabled={disabled}
              onClick={() => onApproval(part.approval.id, true)}
              className="rounded-lg bg-kumo-brand px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              aria-label={`Confirm ${toolName}`}
            >
              Confirm action
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onApproval(part.approval.id, false)}
              className="rounded-lg border border-kumo-line px-3 py-2 text-sm font-medium text-kumo-default disabled:opacity-50"
              aria-label={`Cancel ${toolName}`}
            >
              Cancel
            </button>
          </div>
        </Surface>
      </div>
    );
  }

  if (part.state === "approval-responded") {
    return (
      <div className="flex justify-start">
        <Surface className="max-w-[85%] px-4 py-2.5 rounded-xl ring ring-kumo-line">
          <Text size="sm" variant="secondary">
            {part.approval.approved
              ? "Action approved. Executing once…"
              : "Action cancelled. No external change was made."}
          </Text>
        </Surface>
      </div>
    );
  }

  if (part.state === "output-denied") {
    return (
      <div className="flex justify-start">
        <Surface className="max-w-[85%] px-4 py-2.5 rounded-xl ring ring-kumo-line">
          <Text size="sm" variant="secondary">
            Action cancelled. No external change was made.
          </Text>
        </Surface>
      </div>
    );
  }

  if (part.state === "output-error") {
    return (
      <div className="flex justify-start">
        <Surface className="max-w-[85%] px-4 py-2.5 rounded-xl ring ring-kumo-line">
          <Text size="sm" variant="secondary">
            {part.errorText || "The tool could not complete this request."}
          </Text>
        </Surface>
      </div>
    );
  }

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
  onMessageSent,
  onOpenSidebar
}: {
  agentName: string;
  onMessageSent: (text: string) => void;
  onOpenSidebar: () => void;
}) {
  const [connected, setConnected] = useState(false);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const dragDepthRef = useRef(0);
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

  const {
    messages,
    sendMessage,
    clearHistory,
    stop,
    status,
    error,
    addToolApprovalResponse
  } = useAgentChat({ agent, experimental_throttle: 100 });

  const isStreaming = status === "streaming" || status === "submitted";

  const syncAgentAuth = useCallback(async () => {
    try {
      await fetch(
        `/api/agent/auth-sync?name=${encodeURIComponent(agentName)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({})
        }
      );
    } catch (error) {
      console.error("Failed to sync agent auth:", error);
    }
  }, [agentName]);

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

  const respondToApproval = useCallback(
    async (id: string, approved: boolean) => {
      if (isStreaming) return;
      await syncAgentAuth();
      addToolApprovalResponse({ id, approved });
    },
    [addToolApprovalResponse, isStreaming, syncAgentAuth]
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

  // A drag that is cancelled outside the chat surface does not always emit a
  // dragleave event on the React root. Clear the drop target on browser-level
  // cancellation so an abandoned drag can never trap the chat UI.
  useEffect(() => {
    const cancelDrag = () => {
      dragDepthRef.current = 0;
      setIsDragging(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancelDrag();
    };

    window.addEventListener("dragend", cancelDrag);
    window.addEventListener("drop", cancelDrag);
    window.addEventListener("blur", cancelDrag);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("dragend", cancelDrag);
      window.removeEventListener("drop", cancelDrag);
      window.removeEventListener("blur", cancelDrag);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

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

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes("Files")) {
      dragDepthRef.current += 1;
      setIsDragging(true);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes("Files")) setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragDepthRef.current = 0;
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
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-kumo-elevated/80 backdrop-blur-sm border-2 border-dashed border-kumo-brand rounded-xl m-2">
          <div className="flex flex-col items-center gap-2 text-kumo-brand">
            <ImageIcon size={40} />
            <Text variant="heading3" as="span">
              Drop images here
            </Text>
            <button
              type="button"
              className="mt-2 rounded-md border border-kumo-line bg-kumo-base px-3 py-1.5 text-sm text-kumo-default hover:bg-kumo-hover"
              onClick={() => {
                dragDepthRef.current = 0;
                setIsDragging(false);
              }}
            >
              Cancel
            </button>
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
              AitherPath AI Assistant Agent
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
              onClick={clearHistory}
              className="hidden sm:inline-flex"
            >
              Clear
            </Button>
            <Button
              variant="secondary"
              shape="square"
              aria-label="Clear chat"
              icon={<TrashIcon size={16} />}
              onClick={clearHistory}
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
                  <ToolPartView
                    key={part.toolCallId}
                    part={part}
                    disabled={isStreaming}
                    onApproval={respondToApproval}
                  />
                ))}

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
          {error && (
            <div
              role="alert"
              className="mb-3 rounded-lg border border-kumo-danger/30 bg-kumo-danger/10 px-3 py-2 text-sm text-kumo-default"
            >
              {error.message ||
                "The assistant could not complete this request. Please try again."}
            </div>
          )}
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
  setEditingTitle: (title: string) => void;
  createNewChat: () => void;
  selectChat: (chatId: string) => void;
  startEditingReview: (review: ChatReview) => void;
  saveEditingReview: () => void;
  cancelEditingReview: () => void;
  deleteReview: (reviewId: string) => void;
  disconnectGmail: () => void;
};

function SidebarContent({
  reviews,
  activeChatId,
  gmailStatus,
  userId,
  editingChatId,
  editingTitle,
  editInputRef,
  setEditingTitle,
  createNewChat,
  selectChat,
  startEditingReview,
  saveEditingReview,
  cancelEditingReview,
  deleteReview,
  disconnectGmail
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
        <Button
          variant="secondary"
          onClick={() => {
            window.location.href = "/auth/google";
          }}
          className="w-full justify-center mb-3"
        >
          {gmailStatus.connected ? "Switch account" : "Log in"}
        </Button>
        {gmailStatus.connected && (
          <Button
            variant="ghost"
            onClick={disconnectGmail}
            className="w-full justify-center mb-3"
          >
            Log out
          </Button>
        )}
        <div className="space-y-1">
          <Text size="xs" variant="secondary">
            Local user: {userId.slice(-8)}
          </Text>
          <Text size="xs" variant="secondary">
            Google account: {gmailStatus.email || "Not connected"}
          </Text>
        </div>
      </div>
    </>
  );
}

export default function App() {
  const [entryMode, setEntryMode] = useState<"welcome" | "chat">("welcome");
  const [userId] = useState(getOrCreateUserId);
  const [reviews, setReviews] = useState(() => loadChatReviews(userId));
  const [activeChatId, setActiveChatId] = useState(() => reviews[0].id);
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

  const refreshGmailStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/gmail/status");
      if (!response.ok) return;
      const status = (await response.json()) as GmailStatus;
      setGmailStatus(status);
      if (status.connected) setEntryMode("chat");
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
    setEntryMode("welcome");
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

  const agentName = `${userId}:${activeChatId}`;
  const gmailConnectionKey = gmailStatus.connected
    ? gmailStatus.email || "gmail-connected"
    : "gmail-disconnected";

  if (entryMode === "welcome") {
    return (
      <WelcomeScreen
        onLogin={() => {
          window.location.href = "/auth/google";
        }}
        onAnonymousLogin={() => setEntryMode("chat")}
      />
    );
  }

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
                setEditingTitle={setEditingTitle}
                createNewChat={createNewChat}
                selectChat={selectChat}
                startEditingReview={startEditingReview}
                saveEditingReview={saveEditingReview}
                cancelEditingReview={cancelEditingReview}
                deleteReview={deleteReview}
                disconnectGmail={disconnectGmail}
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
            setEditingTitle={setEditingTitle}
            createNewChat={createNewChat}
            selectChat={selectChat}
            startEditingReview={startEditingReview}
            saveEditingReview={saveEditingReview}
            cancelEditingReview={cancelEditingReview}
            deleteReview={deleteReview}
            disconnectGmail={disconnectGmail}
          />
        </aside>

        <Chat
          key={`${activeChatId}:${gmailConnectionKey}`}
          agentName={agentName}
          onMessageSent={updateActiveReview}
          onOpenSidebar={() => setMobileSidebarOpen(true)}
        />
      </div>
    </Suspense>
  );
}
