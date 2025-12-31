import SwiftUI

@MainActor
public struct ClawdisChatView: View {
    public enum Style {
        case standard
        case onboarding
    }

    @State private var viewModel: ClawdisChatViewModel
    @State private var scrollerBottomID = UUID()
    @State private var scrollPosition: UUID?
    @State private var showSessions = false
    @State private var hasPerformedInitialScroll = false
    private let showsSessionSwitcher: Bool
    private let style: Style
    private let userAccent: Color?

    private enum Layout {
        #if os(macOS)
        static let outerPaddingHorizontal: CGFloat = 6
        static let outerPaddingVertical: CGFloat = 0
        static let stackSpacing: CGFloat = 6
        static let messageSpacing: CGFloat = 6
        static let messageListPaddingTop: CGFloat = 0
        static let messageListPaddingBottom: CGFloat = 4
        static let messageListPaddingHorizontal: CGFloat = 6
        #else
        static let outerPaddingHorizontal: CGFloat = 6
        static let outerPaddingVertical: CGFloat = 6
        static let stackSpacing: CGFloat = 6
        static let messageSpacing: CGFloat = 12
        static let messageListPaddingTop: CGFloat = 4
        static let messageListPaddingBottom: CGFloat = 6
        static let messageListPaddingHorizontal: CGFloat = 8
        #endif
    }

    public init(
        viewModel: ClawdisChatViewModel,
        showsSessionSwitcher: Bool = false,
        style: Style = .standard,
        userAccent: Color? = nil)
    {
        self._viewModel = State(initialValue: viewModel)
        self.showsSessionSwitcher = showsSessionSwitcher
        self.style = style
        self.userAccent = userAccent
    }

    public var body: some View {
        ZStack {
            ClawdisChatTheme.background
                .ignoresSafeArea()

            VStack(spacing: Layout.stackSpacing) {
                self.messageList
                ClawdisChatComposer(viewModel: self.viewModel, style: self.style)
            }
            .padding(.horizontal, Layout.outerPaddingHorizontal)
            .padding(.vertical, Layout.outerPaddingVertical)
            .frame(maxWidth: .infinity)
            .frame(maxHeight: .infinity, alignment: .top)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .onAppear { self.viewModel.load() }
        .sheet(isPresented: self.$showSessions) {
            if self.showsSessionSwitcher {
                ChatSessionsSheet(viewModel: self.viewModel)
            } else {
                EmptyView()
            }
        }
    }

    private var messageList: some View {
        ZStack {
            ScrollView {
                LazyVStack(spacing: Layout.messageSpacing) {
                    self.messageListRows
                }
                // Use scroll targets for stable auto-scroll without ScrollViewReader relayout glitches.
                .scrollTargetLayout()
                .padding(.top, Layout.messageListPaddingTop)
                .padding(.horizontal, Layout.messageListPaddingHorizontal)
            }
            // Keep the scroll pinned to the bottom for new messages.
            .scrollPosition(id: self.$scrollPosition, anchor: .bottom)

            if self.viewModel.isLoading {
                ProgressView()
                    .controlSize(.large)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        // Ensure the message list claims vertical space on the first layout pass.
        .frame(maxHeight: .infinity, alignment: .top)
        .layoutPriority(1)
        .onChange(of: self.viewModel.isLoading) { _, isLoading in
            guard !isLoading, !self.hasPerformedInitialScroll else { return }
            self.scrollPosition = self.scrollerBottomID
            self.hasPerformedInitialScroll = true
        }
        .onChange(of: self.viewModel.messages.count) { _, _ in
            guard self.hasPerformedInitialScroll else { return }
            withAnimation(.snappy(duration: 0.22)) {
                self.scrollPosition = self.scrollerBottomID
            }
        }
        .onChange(of: self.viewModel.pendingRunCount) { _, _ in
            guard self.hasPerformedInitialScroll else { return }
            withAnimation(.snappy(duration: 0.22)) {
                self.scrollPosition = self.scrollerBottomID
            }
        }
    }

    @ViewBuilder
    private var messageListRows: some View {
        ForEach(self.visibleMessages) { msg in
            ChatMessageBubble(message: msg, style: self.style, userAccent: self.userAccent)
                .frame(
                    maxWidth: .infinity,
                    alignment: msg.role.lowercased() == "user" ? .trailing : .leading)
        }

        if self.viewModel.pendingRunCount > 0 {
            HStack {
                ChatTypingIndicatorBubble(style: self.style)
                    .equatable()
                Spacer(minLength: 0)
            }
        }

        if !self.viewModel.pendingToolCalls.isEmpty {
            ChatPendingToolsBubble(toolCalls: self.viewModel.pendingToolCalls)
                .equatable()
                .frame(maxWidth: .infinity, alignment: .leading)
        }

        if let text = self.viewModel.streamingAssistantText, !text.isEmpty {
            ChatStreamingAssistantBubble(text: text)
                .frame(maxWidth: .infinity, alignment: .leading)
        }

        Color.clear
            .frame(height: Layout.messageListPaddingBottom + 1)
            .id(self.scrollerBottomID)
    }

    private var visibleMessages: [ClawdisChatMessage] {
        let base: [ClawdisChatMessage]
        if self.style == .onboarding {
            guard let first = self.viewModel.messages.first else { return [] }
            base = first.role.lowercased() == "user" ? Array(self.viewModel.messages.dropFirst()) : self.viewModel
                .messages
        } else {
            base = self.viewModel.messages
        }
        return self.mergeToolResults(in: base)
    }

    private func mergeToolResults(in messages: [ClawdisChatMessage]) -> [ClawdisChatMessage] {
        var result: [ClawdisChatMessage] = []
        result.reserveCapacity(messages.count)

        for message in messages {
            guard self.isToolResultMessage(message) else {
                result.append(message)
                continue
            }

            guard let toolCallId = message.toolCallId,
                  let last = result.last,
                  self.toolCallIds(in: last).contains(toolCallId)
            else {
                result.append(message)
                continue
            }

            let toolText = self.toolResultText(from: message)
            if toolText.isEmpty {
                continue
            }

            var content = last.content
            content.append(
                ClawdisChatMessageContent(
                    type: "tool_result",
                    text: toolText,
                    thinking: nil,
                    thinkingSignature: nil,
                    mimeType: nil,
                    fileName: nil,
                    content: nil,
                    id: toolCallId,
                    name: message.toolName,
                    arguments: nil))

            let merged = ClawdisChatMessage(
                id: last.id,
                role: last.role,
                content: content,
                timestamp: last.timestamp,
                toolCallId: last.toolCallId,
                toolName: last.toolName,
                usage: last.usage,
                stopReason: last.stopReason)
            result[result.count - 1] = merged
        }

        return result
    }

    private func isToolResultMessage(_ message: ClawdisChatMessage) -> Bool {
        let role = message.role.lowercased()
        return role == "toolresult" || role == "tool_result"
    }

    private func toolCallIds(in message: ClawdisChatMessage) -> Set<String> {
        var ids = Set<String>()
        for content in message.content {
            let kind = (content.type ?? "").lowercased()
            let isTool =
                ["toolcall", "tool_call", "tooluse", "tool_use"].contains(kind) ||
                (content.name != nil && content.arguments != nil)
            if isTool, let id = content.id {
                ids.insert(id)
            }
        }
        if let toolCallId = message.toolCallId {
            ids.insert(toolCallId)
        }
        return ids
    }

    private func toolResultText(from message: ClawdisChatMessage) -> String {
        let parts = message.content.compactMap { content -> String? in
            let kind = (content.type ?? "text").lowercased()
            guard kind == "text" || kind.isEmpty else { return nil }
            return content.text
        }
        return parts.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
