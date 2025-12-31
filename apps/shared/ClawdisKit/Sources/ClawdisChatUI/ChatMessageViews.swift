import ClawdisKit
import Foundation
import SwiftUI

private enum ChatUIConstants {
    static let bubbleMaxWidth: CGFloat = 560
    static let bubbleCorner: CGFloat = 18
}

private struct ChatBubbleShape: InsettableShape {
    enum Tail {
        case left
        case right
        case none
    }

    let cornerRadius: CGFloat
    let tail: Tail
    var insetAmount: CGFloat = 0

    private let tailWidth: CGFloat = 7
    private let tailBaseHeight: CGFloat = 9

    func inset(by amount: CGFloat) -> ChatBubbleShape {
        var copy = self
        copy.insetAmount += amount
        return copy
    }

    func path(in rect: CGRect) -> Path {
        let rect = rect.insetBy(dx: self.insetAmount, dy: self.insetAmount)
        switch self.tail {
        case .left:
            return self.leftTailPath(in: rect, radius: self.cornerRadius)
        case .right:
            return self.rightTailPath(in: rect, radius: self.cornerRadius)
        case .none:
            return Path(roundedRect: rect, cornerRadius: self.cornerRadius)
        }
    }

    private func rightTailPath(in rect: CGRect, radius r: CGFloat) -> Path {
        var path = Path()
        let bubbleMinX = rect.minX
        let bubbleMaxX = rect.maxX - self.tailWidth
        let bubbleMinY = rect.minY
        let bubbleMaxY = rect.maxY

        let available = max(4, bubbleMaxY - bubbleMinY - 2 * r)
        let baseH = min(tailBaseHeight, available)
        let baseBottomY = bubbleMaxY - max(r * 0.45, 6)
        let baseTopY = baseBottomY - baseH
        let midY = (baseTopY + baseBottomY) / 2

        let baseTop = CGPoint(x: bubbleMaxX, y: baseTopY)
        let baseBottom = CGPoint(x: bubbleMaxX, y: baseBottomY)
        let tip = CGPoint(x: bubbleMaxX + self.tailWidth, y: midY)

        path.move(to: CGPoint(x: bubbleMinX + r, y: bubbleMinY))
        path.addLine(to: CGPoint(x: bubbleMaxX - r, y: bubbleMinY))
        path.addQuadCurve(
            to: CGPoint(x: bubbleMaxX, y: bubbleMinY + r),
            control: CGPoint(x: bubbleMaxX, y: bubbleMinY))
        path.addLine(to: baseTop)
        path.addCurve(
            to: tip,
            control1: CGPoint(x: bubbleMaxX + self.tailWidth * 0.2, y: baseTopY + baseH * 0.05),
            control2: CGPoint(x: bubbleMaxX + self.tailWidth * 0.95, y: midY - baseH * 0.15))
        path.addCurve(
            to: baseBottom,
            control1: CGPoint(x: bubbleMaxX + self.tailWidth * 0.95, y: midY + baseH * 0.15),
            control2: CGPoint(x: bubbleMaxX + self.tailWidth * 0.2, y: baseBottomY - baseH * 0.05))
        path.addQuadCurve(
            to: CGPoint(x: bubbleMaxX - r, y: bubbleMaxY),
            control: CGPoint(x: bubbleMaxX, y: bubbleMaxY))
        path.addLine(to: CGPoint(x: bubbleMinX + r, y: bubbleMaxY))
        path.addQuadCurve(
            to: CGPoint(x: bubbleMinX, y: bubbleMaxY - r),
            control: CGPoint(x: bubbleMinX, y: bubbleMaxY))
        path.addLine(to: CGPoint(x: bubbleMinX, y: bubbleMinY + r))
        path.addQuadCurve(
            to: CGPoint(x: bubbleMinX + r, y: bubbleMinY),
            control: CGPoint(x: bubbleMinX, y: bubbleMinY))

        return path
    }

    private func leftTailPath(in rect: CGRect, radius r: CGFloat) -> Path {
        var path = Path()
        let bubbleMinX = rect.minX + self.tailWidth
        let bubbleMaxX = rect.maxX
        let bubbleMinY = rect.minY
        let bubbleMaxY = rect.maxY

        let available = max(4, bubbleMaxY - bubbleMinY - 2 * r)
        let baseH = min(tailBaseHeight, available)
        let baseBottomY = bubbleMaxY - max(r * 0.45, 6)
        let baseTopY = baseBottomY - baseH
        let midY = (baseTopY + baseBottomY) / 2

        let baseTop = CGPoint(x: bubbleMinX, y: baseTopY)
        let baseBottom = CGPoint(x: bubbleMinX, y: baseBottomY)
        let tip = CGPoint(x: bubbleMinX - self.tailWidth, y: midY)

        path.move(to: CGPoint(x: bubbleMinX + r, y: bubbleMinY))
        path.addLine(to: CGPoint(x: bubbleMaxX - r, y: bubbleMinY))
        path.addQuadCurve(
            to: CGPoint(x: bubbleMaxX, y: bubbleMinY + r),
            control: CGPoint(x: bubbleMaxX, y: bubbleMinY))
        path.addLine(to: CGPoint(x: bubbleMaxX, y: bubbleMaxY - r))
        path.addQuadCurve(
            to: CGPoint(x: bubbleMaxX - r, y: bubbleMaxY),
            control: CGPoint(x: bubbleMaxX, y: bubbleMaxY))
        path.addLine(to: CGPoint(x: bubbleMinX + r, y: bubbleMaxY))
        path.addQuadCurve(
            to: CGPoint(x: bubbleMinX, y: bubbleMaxY - r),
            control: CGPoint(x: bubbleMinX, y: bubbleMaxY))
        path.addLine(to: baseBottom)
        path.addCurve(
            to: tip,
            control1: CGPoint(x: bubbleMinX - self.tailWidth * 0.2, y: baseBottomY - baseH * 0.05),
            control2: CGPoint(x: bubbleMinX - self.tailWidth * 0.95, y: midY + baseH * 0.15))
        path.addCurve(
            to: baseTop,
            control1: CGPoint(x: bubbleMinX - self.tailWidth * 0.95, y: midY - baseH * 0.15),
            control2: CGPoint(x: bubbleMinX - self.tailWidth * 0.2, y: baseTopY + baseH * 0.05))
        path.addLine(to: CGPoint(x: bubbleMinX, y: bubbleMinY + r))
        path.addQuadCurve(
            to: CGPoint(x: bubbleMinX + r, y: bubbleMinY),
            control: CGPoint(x: bubbleMinX, y: bubbleMinY))

        return path
    }
}

@MainActor
struct ChatMessageBubble: View {
    let message: ClawdisChatMessage
    let style: ClawdisChatView.Style
    let userAccent: Color?

    var body: some View {
        ChatMessageBody(message: self.message, isUser: self.isUser, style: self.style, userAccent: self.userAccent)
            .frame(maxWidth: ChatUIConstants.bubbleMaxWidth, alignment: self.isUser ? .trailing : .leading)
            .frame(maxWidth: .infinity, alignment: self.isUser ? .trailing : .leading)
            .padding(.horizontal, 2)
    }

    private var isUser: Bool { self.message.role.lowercased() == "user" }
}

@MainActor
private struct ChatMessageBody: View {
    let message: ClawdisChatMessage
    let isUser: Bool
    let style: ClawdisChatView.Style
    let userAccent: Color?

    var body: some View {
        let text = self.primaryText
        let split = ChatMarkdownSplitter.split(markdown: text)
        let textColor = self.isUser ? ClawdisChatTheme.userText : ClawdisChatTheme.assistantText

        VStack(alignment: .leading, spacing: 10) {
            if self.isToolResultMessage {
                if !text.isEmpty {
                    ToolResultCard(
                        title: self.toolResultTitle,
                        text: text,
                        isUser: self.isUser)
                }
            } else {
                ForEach(split.blocks) { block in
                    switch block.kind {
                    case .text:
                        MarkdownTextView(text: block.text, textColor: textColor)
                    case let .code(language):
                        CodeBlockView(code: block.text, language: language, isUser: self.isUser)
                    }
                }
            }

            if !split.images.isEmpty {
                ForEach(
                    split.images,
                    id: \ChatMarkdownSplitter.InlineImage.id)
                { (item: ChatMarkdownSplitter.InlineImage) in
                    if let img = item.image {
                        ClawdisPlatformImageFactory.image(img)
                            .resizable()
                            .scaledToFit()
                            .frame(maxHeight: 260)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .strokeBorder(Color.white.opacity(0.12), lineWidth: 1))
                    } else {
                        Text(item.label.isEmpty ? "Image" : item.label)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            if !self.inlineAttachments.isEmpty {
                ForEach(self.inlineAttachments.indices, id: \.self) { idx in
                    AttachmentRow(att: self.inlineAttachments[idx], isUser: self.isUser)
                }
            }

            if !self.toolCalls.isEmpty {
                ForEach(self.toolCalls.indices, id: \.self) { idx in
                    ToolCallCard(
                        content: self.toolCalls[idx],
                        isUser: self.isUser)
                }
            }

            if !self.inlineToolResults.isEmpty {
                ForEach(self.inlineToolResults.indices, id: \.self) { idx in
                    let toolResult = self.inlineToolResults[idx]
                    ToolResultCard(
                        title: toolResult.name ?? "Tool result",
                        text: toolResult.text ?? "",
                        isUser: self.isUser)
                }
            }
        }
        .textSelection(.enabled)
        .padding(.vertical, 10)
        .padding(.horizontal, 12)
        .foregroundStyle(textColor)
        .background(self.bubbleBackground)
        .clipShape(self.bubbleShape)
        .overlay(self.bubbleBorder)
        .shadow(color: self.bubbleShadowColor, radius: self.bubbleShadowRadius, y: self.bubbleShadowYOffset)
        .padding(.leading, self.tailPaddingLeading)
        .padding(.trailing, self.tailPaddingTrailing)
    }

    private var primaryText: String {
        let parts = self.message.content.compactMap { content -> String? in
            let kind = (content.type ?? "text").lowercased()
            guard kind == "text" || kind.isEmpty else { return nil }
            return content.text
        }
        return parts.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var inlineAttachments: [ClawdisChatMessageContent] {
        self.message.content.filter { content in
            switch content.type ?? "text" {
            case "file", "attachment":
                true
            default:
                false
            }
        }
    }

    private var toolCalls: [ClawdisChatMessageContent] {
        self.message.content.filter { content in
            let kind = (content.type ?? "").lowercased()
            if ["toolcall", "tool_call", "tooluse", "tool_use"].contains(kind) {
                return true
            }
            return content.name != nil && content.arguments != nil
        }
    }

    private var inlineToolResults: [ClawdisChatMessageContent] {
        self.message.content.filter { content in
            let kind = (content.type ?? "").lowercased()
            return kind == "toolresult" || kind == "tool_result"
        }
    }

    private var isToolResultMessage: Bool {
        let role = self.message.role.lowercased()
        return role == "toolresult" || role == "tool_result"
    }

    private var toolResultTitle: String {
        if let name = self.message.toolName, !name.isEmpty {
            return name
        }
        return "Tool result"
    }

    private var bubbleFillColor: Color {
        if self.isUser {
            return self.userAccent ?? ClawdisChatTheme.userBubble
        }
        if self.style == .onboarding {
            return ClawdisChatTheme.onboardingAssistantBubble
        }
        return ClawdisChatTheme.assistantBubble
    }

    private var bubbleBackground: AnyShapeStyle {
        AnyShapeStyle(self.bubbleFillColor)
    }

    private var bubbleBorderColor: Color {
        if self.isUser {
            return Color.white.opacity(0.12)
        }
        if self.style == .onboarding {
            return ClawdisChatTheme.onboardingAssistantBorder
        }
        return Color.white.opacity(0.08)
    }

    private var bubbleBorderWidth: CGFloat {
        if self.isUser { return 0.5 }
        if self.style == .onboarding { return 0.8 }
        return 1
    }

    private var bubbleBorder: some View {
        self.bubbleShape.strokeBorder(self.bubbleBorderColor, lineWidth: self.bubbleBorderWidth)
    }

    private var bubbleShape: ChatBubbleShape {
        ChatBubbleShape(cornerRadius: ChatUIConstants.bubbleCorner, tail: self.bubbleTail)
    }

    private var bubbleTail: ChatBubbleShape.Tail {
        guard self.style == .onboarding else { return .none }
        return self.isUser ? .right : .left
    }

    private var tailPaddingLeading: CGFloat {
        self.style == .onboarding && !self.isUser ? 8 : 0
    }

    private var tailPaddingTrailing: CGFloat {
        self.style == .onboarding && self.isUser ? 8 : 0
    }

    private var bubbleShadowColor: Color {
        self.style == .onboarding && !self.isUser ? Color.black.opacity(0.28) : .clear
    }

    private var bubbleShadowRadius: CGFloat {
        self.style == .onboarding && !self.isUser ? 6 : 0
    }

    private var bubbleShadowYOffset: CGFloat {
        self.style == .onboarding && !self.isUser ? 2 : 0
    }
}

private struct AttachmentRow: View {
    let att: ClawdisChatMessageContent
    let isUser: Bool

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "paperclip")
            Text(self.att.fileName ?? "Attachment")
                .font(.footnote)
                .lineLimit(1)
                .foregroundStyle(self.isUser ? ClawdisChatTheme.userText : ClawdisChatTheme.assistantText)
            Spacer()
        }
        .padding(10)
        .background(self.isUser ? Color.white.opacity(0.2) : Color.black.opacity(0.04))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

private struct ToolCallCard: View {
    let content: ClawdisChatMessageContent
    let isUser: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: "hammer")
                    .imageScale(.small)
                Text(self.toolName)
                    .font(.footnote.weight(.semibold))
                Spacer(minLength: 0)
            }

            if let summary = self.summary, !summary.isEmpty {
                Text(summary)
                    .font(.footnote.monospaced())
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(ClawdisChatTheme.subtleCard)
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)))
    }

    private var toolName: String {
        self.content.name?.isEmpty == false ? (self.content.name ?? "Tool") : "Tool"
    }

    private var summary: String? {
        guard let args = self.content.arguments else { return nil }
        if let dict = args.value as? [String: AnyCodable] {
            if let command = dict["command"]?.value as? String { return command }
            if let path = dict["path"]?.value as? String { return path }
            if let pattern = dict["pattern"]?.value as? String { return pattern }
            if let query = dict["query"]?.value as? String { return query }
            if let url = dict["url"]?.value as? String { return url }
            return Self.renderArgs(dict)
        }
        return Self.renderValue(args)
    }

    private static func renderArgs(_ dict: [String: AnyCodable]) -> String? {
        let keys = dict.keys.sorted()
        let pairs = keys.prefix(6).compactMap { key -> String? in
            guard let value = dict[key] else { return nil }
            return "\(key)=\(self.renderValue(value) ?? "…")"
        }
        guard !pairs.isEmpty else { return nil }
        return pairs.joined(separator: " ")
    }

    private static func renderValue(_ value: AnyCodable) -> String? {
        switch value.value {
        case let str as String:
            return str
        case let num as Int:
            return String(num)
        case let num as Double:
            return String(num)
        case let bool as Bool:
            return bool ? "true" : "false"
        default:
            if let data = try? JSONEncoder().encode(value),
               let string = String(data: data, encoding: .utf8)
            {
                return string
            }
            return nil
        }
    }
}

private struct ToolResultCard: View {
    let title: String
    let text: String
    let isUser: Bool
    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "terminal")
                    .imageScale(.small)
                Text(self.title)
                    .font(.footnote.weight(.semibold))
                Spacer(minLength: 0)
            }

            Text(self.displayText)
                .font(.footnote.monospaced())
                .foregroundStyle(self.isUser ? ClawdisChatTheme.userText : ClawdisChatTheme.assistantText)
                .lineLimit(self.expanded ? nil : Self.previewLineLimit)

            if self.shouldShowToggle {
                Button(self.expanded ? "Show less" : "Show full output") {
                    self.expanded.toggle()
                }
                .buttonStyle(.plain)
                .font(.caption)
                .foregroundStyle(.secondary)
            }
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(ClawdisChatTheme.subtleCard)
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)))
    }

    private static let previewLineLimit = 8

    private var lines: [Substring] {
        self.text.components(separatedBy: .newlines).map { Substring($0) }
    }

    private var displayText: String {
        guard !self.expanded, self.lines.count > Self.previewLineLimit else { return self.text }
        return self.lines.prefix(Self.previewLineLimit).joined(separator: "\n") + "\n…"
    }

    private var shouldShowToggle: Bool {
        self.lines.count > Self.previewLineLimit
    }
}

@MainActor
struct ChatTypingIndicatorBubble: View {
    let style: ClawdisChatView.Style

    var body: some View {
        HStack(spacing: 10) {
            TypingDots()
            if self.style == .standard {
                Text("Clawd is thinking…")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Spacer()
            }
        }
        .padding(.vertical, self.style == .standard ? 12 : 10)
        .padding(.horizontal, self.style == .standard ? 12 : 14)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(ClawdisChatTheme.assistantBubble))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(Color.white.opacity(0.08), lineWidth: 1))
        .frame(maxWidth: ChatUIConstants.bubbleMaxWidth, alignment: .leading)
        .focusable(false)
    }
}

extension ChatTypingIndicatorBubble: @MainActor Equatable {
    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.style == rhs.style
    }
}

@MainActor
struct ChatStreamingAssistantBubble: View {
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ChatMarkdownBody(text: self.text, textColor: ClawdisChatTheme.assistantText)
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(ClawdisChatTheme.assistantBubble))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(Color.white.opacity(0.08), lineWidth: 1))
        .frame(maxWidth: ChatUIConstants.bubbleMaxWidth, alignment: .leading)
        .focusable(false)
    }
}

@MainActor
struct ChatPendingToolsBubble: View {
    let toolCalls: [ClawdisChatPendingToolCall]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Running tools…", systemImage: "hammer")
                .font(.caption)
                .foregroundStyle(.secondary)

            ForEach(self.toolCalls) { call in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(call.name)
                        .font(.footnote.monospaced())
                        .lineLimit(1)
                    Spacer(minLength: 0)
                    ProgressView().controlSize(.mini)
                }
                .padding(10)
                .background(Color.white.opacity(0.06))
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(ClawdisChatTheme.assistantBubble))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(Color.white.opacity(0.08), lineWidth: 1))
        .frame(maxWidth: ChatUIConstants.bubbleMaxWidth, alignment: .leading)
        .focusable(false)
    }
}

extension ChatPendingToolsBubble: @MainActor Equatable {
    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.toolCalls == rhs.toolCalls
    }
}

@MainActor
private struct TypingDots: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var animate = false

    var body: some View {
        HStack(spacing: 5) {
            ForEach(0..<3, id: \.self) { idx in
                Circle()
                    .fill(Color.secondary.opacity(0.55))
                    .frame(width: 7, height: 7)
                    .scaleEffect(self.reduceMotion ? 0.85 : (self.animate ? 1.05 : 0.70))
                    .opacity(self.reduceMotion ? 0.55 : (self.animate ? 0.95 : 0.30))
                    .animation(
                        self.reduceMotion ? nil : .easeInOut(duration: 0.55)
                            .repeatForever(autoreverses: true)
                            .delay(Double(idx) * 0.16),
                        value: self.animate)
            }
        }
        .onAppear { self.updateAnimationState() }
        .onDisappear { self.animate = false }
        .onChange(of: self.scenePhase) { _, _ in
            self.updateAnimationState()
        }
        .onChange(of: self.reduceMotion) { _, _ in
            self.updateAnimationState()
        }
    }

    private func updateAnimationState() {
        guard !self.reduceMotion, self.scenePhase == .active else {
            self.animate = false
            return
        }
        self.animate = true
    }
}

@MainActor
private struct MarkdownTextView: View {
    let text: String
    let textColor: Color

    var body: some View {
        let normalized = self.text.replacingOccurrences(
            of: "(?<!\\n)\\n(?!\\n)",
            with: " ",
            options: .regularExpression)
        let options = AttributedString.MarkdownParsingOptions(
            interpretedSyntax: .inlineOnlyPreservingWhitespace)
        if let attributed = try? AttributedString(markdown: normalized, options: options) {
            Text(attributed)
                .font(.system(size: 14))
                .foregroundStyle(self.textColor)
        } else {
            Text(normalized)
                .font(.system(size: 14))
                .foregroundStyle(self.textColor)
        }
    }
}

@MainActor
private struct ChatMarkdownBody: View {
    let text: String
    let textColor: Color

    var body: some View {
        let split = ChatMarkdownSplitter.split(markdown: self.text)
        VStack(alignment: .leading, spacing: 10) {
            ForEach(split.blocks) { block in
                switch block.kind {
                case .text:
                    MarkdownTextView(text: block.text, textColor: self.textColor)
                case let .code(language):
                    CodeBlockView(code: block.text, language: language, isUser: false)
                }
            }

            if !split.images.isEmpty {
                ForEach(
                    split.images,
                    id: \ChatMarkdownSplitter.InlineImage.id)
                { (item: ChatMarkdownSplitter.InlineImage) in
                    if let img = item.image {
                        ClawdisPlatformImageFactory.image(img)
                            .resizable()
                            .scaledToFit()
                            .frame(maxHeight: 260)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .strokeBorder(Color.white.opacity(0.12), lineWidth: 1))
                    } else {
                        Text(item.label.isEmpty ? "Image" : item.label)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .textSelection(.enabled)
    }
}

@MainActor
private struct CodeBlockView: View {
    let code: String
    let language: String?
    let isUser: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let language, !language.isEmpty {
                Text(language)
                    .font(.caption2.monospaced())
                    .foregroundStyle(.secondary)
            }
            Text(self.code)
                .font(.system(size: 13, weight: .regular, design: .monospaced))
                .foregroundStyle(self.isUser ? .white : .primary)
                .textSelection(.enabled)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(self.isUser ? Color.white.opacity(0.16) : Color.black.opacity(0.06))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(Color.black.opacity(0.08), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}
