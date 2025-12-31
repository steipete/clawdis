import { html, nothing } from "lit";

export type ChatProps = {
  sessionKey: string;
  onSessionKeyChange: (next: string) => void;
  thinkingLevel: string | null;
  loading: boolean;
  sending: boolean;
  messages: unknown[];
  stream: string | null;
  draft: string;
  connected: boolean;
  canSend: boolean;
  disabledReason: string | null;
  onRefresh: () => void;
  onDraftChange: (next: string) => void;
  onSend: () => void;
};

export function renderChat(props: ChatProps) {
  const canInteract = props.connected;
  const canCompose = props.canSend && !props.sending;
  const composePlaceholder = (() => {
    if (!props.connected) return "Connect to the gateway to start chatting…";
    if (!props.canSend) return "Connect an iOS/Android node to enable Web Chat + Talk…";
    return "Message (⌘↩ to send)";
  })();

  return html`
    <section class="card chat">
      <div class="chat-header">
        <div class="chat-header__left">
          <label class="field chat-session">
            <span>Session Key</span>
            <input
              .value=${props.sessionKey}
              ?disabled=${!canInteract}
              @input=${(e: Event) =>
                props.onSessionKeyChange((e.target as HTMLInputElement).value)}
            />
          </label>
          <button
            class="btn"
            ?disabled=${props.loading || !canInteract}
            @click=${props.onRefresh}
          >
            ${props.loading ? "Loading…" : "Refresh"}
          </button>
        </div>
        <div class="chat-header__right">
          <div class="muted">Thinking: ${props.thinkingLevel ?? "inherit"}</div>
        </div>
      </div>

      ${props.disabledReason
        ? html`<div class="callout" style="margin-top: 12px;">
            ${props.disabledReason}
          </div>`
        : nothing}

      <div class="chat-thread" role="log" aria-live="polite">
        ${props.loading ? html`<div class="muted">Loading chat…</div>` : nothing}
        ${props.messages.map((m) => renderMessage(m))}
        ${props.stream
          ? renderMessage(
              {
                role: "assistant",
                content: [{ type: "text", text: props.stream }],
                timestamp: Date.now(),
              },
              { streaming: true },
            )
          : nothing}
      </div>

      <div class="chat-compose">
        <label class="field chat-compose__field">
          <span>Message</span>
          <textarea
            .value=${props.draft}
            ?disabled=${!props.canSend}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key !== "Enter") return;
              if (!e.metaKey && !e.ctrlKey) return;
              e.preventDefault();
              if (canCompose) props.onSend();
            }}
            @input=${(e: Event) =>
              props.onDraftChange((e.target as HTMLTextAreaElement).value)}
            placeholder=${composePlaceholder}
          ></textarea>
        </label>
        <div class="row chat-compose__actions">
          <button
            class="btn primary"
            ?disabled=${!props.canSend || props.sending}
            @click=${props.onSend}
          >
            ${props.sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </section>
  `;
}

function renderMessage(message: unknown, opts?: { streaming?: boolean }) {
  const m = message as Record<string, unknown>;
  const role = typeof m.role === "string" ? m.role : "unknown";
  const text =
    extractText(message) ??
    (typeof m.content === "string"
      ? m.content
      : JSON.stringify(message, null, 2));

  const timestamp =
    typeof m.timestamp === "number" ? new Date(m.timestamp).toLocaleTimeString() : "";
  const klass = role === "assistant" ? "assistant" : role === "user" ? "user" : "other";
  const who = role === "assistant" ? "Assistant" : role === "user" ? "You" : role;
  return html`
    <div class="chat-line ${klass}">
      <div class="chat-msg">
        <div class="chat-bubble ${opts?.streaming ? "streaming" : ""}">
          <div class="chat-text">${text}</div>
        </div>
        <div class="chat-stamp mono">
          ${who}${timestamp ? html` · ${timestamp}` : nothing}
        </div>
      </div>
    </div>
  `;
}

function extractText(message: unknown): string | null {
  const m = message as Record<string, unknown>;
  const content = m.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = content
      .map((p) => {
        const item = p as Record<string, unknown>;
        if (item.type === "text" && typeof item.text === "string") return item.text;
        return null;
      })
      .filter((v): v is string => typeof v === "string");
    if (parts.length > 0) return parts.join("\n");
  }
  if (typeof m.text === "string") return m.text;
  return null;
}
