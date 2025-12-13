import AppKit
import ClawdisProtocol
import Foundation
import OSLog

@MainActor
final class NodePairingApprovalPrompter {
    static let shared = NodePairingApprovalPrompter()

    private let logger = Logger(subsystem: "com.steipete.clawdis", category: "node-pairing")
    private var task: Task<Void, Never>?
    private var isPresenting = false
    private var queue: [PendingRequest] = []

    private struct PendingRequest: Codable, Equatable, Identifiable {
        let requestId: String
        let nodeId: String
        let displayName: String?
        let platform: String?
        let version: String?
        let remoteIp: String?
        let isRepair: Bool?
        let ts: Double

        var id: String { self.requestId }
    }

    func start() {
        guard self.task == nil else { return }
        self.task = Task { [weak self] in
            guard let self else { return }
            _ = try? await GatewayConnection.shared.refresh()
            let stream = await GatewayConnection.shared.subscribe(bufferingNewest: 200)
            for await push in stream {
                if Task.isCancelled { return }
                await MainActor.run { [weak self] in self?.handle(push: push) }
            }
        }
    }

    func stop() {
        self.task?.cancel()
        self.task = nil
        self.queue.removeAll(keepingCapacity: false)
        self.isPresenting = false
    }

    private func handle(push: GatewayPush) {
        guard case let .event(evt) = push else { return }
        guard evt.event == "node.pair.requested" else { return }
        guard let payload = evt.payload else { return }
        do {
            let req = try GatewayPayloadDecoding.decode(payload, as: PendingRequest.self)
            self.enqueue(req)
        } catch {
            self.logger.error("failed to decode pairing request: \(error.localizedDescription, privacy: .public)")
        }
    }

    private func enqueue(_ req: PendingRequest) {
        if self.queue.contains(req) { return }
        self.queue.append(req)
        self.presentNextIfNeeded()
    }

    private func presentNextIfNeeded() {
        guard !self.isPresenting else { return }
        guard let next = self.queue.first else { return }
        self.isPresenting = true
        self.presentAlert(for: next)
    }

    private func presentAlert(for req: PendingRequest) {
        NSApp.activate(ignoringOtherApps: true)

        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "Allow node to connect?"
        alert.informativeText = Self.describe(req)
        alert.addButton(withTitle: "Approve")
        alert.addButton(withTitle: "Reject")
        alert.addButton(withTitle: "Later")
        if #available(macOS 11.0, *), alert.buttons.indices.contains(1) {
            alert.buttons[1].hasDestructiveAction = true
        }

        let response = alert.runModal()
        Task { [weak self] in
            await self?.handleAlertResponse(response, request: req)
        }
    }

    private func handleAlertResponse(_ response: NSApplication.ModalResponse, request: PendingRequest) async {
        defer {
            if self.queue.first == request {
                self.queue.removeFirst()
            } else {
                self.queue.removeAll { $0 == request }
            }
            self.isPresenting = false
            self.presentNextIfNeeded()
        }

        switch response {
        case .alertFirstButtonReturn:
            await self.approve(requestId: request.requestId)
        case .alertSecondButtonReturn:
            await self.reject(requestId: request.requestId)
        default:
            // Later: leave as pending (CLI can approve/reject). Request will expire on the gateway TTL.
            return
        }
    }

    private func approve(requestId: String) async {
        do {
            _ = try await GatewayConnection.shared.request(
                method: "node.pair.approve",
                params: ["requestId": AnyCodable(requestId)],
                timeoutMs: 10000)
            self.logger.info("approved node pairing requestId=\(requestId, privacy: .public)")
        } catch {
            self.logger.error("approve failed requestId=\(requestId, privacy: .public)")
            self.logger.error("approve failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    private func reject(requestId: String) async {
        do {
            _ = try await GatewayConnection.shared.request(
                method: "node.pair.reject",
                params: ["requestId": AnyCodable(requestId)],
                timeoutMs: 10000)
            self.logger.info("rejected node pairing requestId=\(requestId, privacy: .public)")
        } catch {
            self.logger.error("reject failed requestId=\(requestId, privacy: .public)")
            self.logger.error("reject failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    private static func describe(_ req: PendingRequest) -> String {
        let name = req.displayName?.trimmingCharacters(in: .whitespacesAndNewlines)
        let platform = self.prettyPlatform(req.platform)
        let version = req.version?.trimmingCharacters(in: .whitespacesAndNewlines)
        let ip = self.prettyIP(req.remoteIp)

        var lines: [String] = []
        lines.append("Name: \(name?.isEmpty == false ? name! : "Unknown")")
        lines.append("Node ID: \(req.nodeId)")
        if let platform, !platform.isEmpty { lines.append("Platform: \(platform)") }
        if let version, !version.isEmpty { lines.append("App: \(version)") }
        if let ip, !ip.isEmpty { lines.append("IP: \(ip)") }
        if req.isRepair == true { lines.append("Note: Repair request (token will rotate).") }
        return lines.joined(separator: "\n")
    }

    private static func prettyIP(_ ip: String?) -> String? {
        let trimmed = ip?.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let trimmed, !trimmed.isEmpty else { return nil }
        return trimmed.replacingOccurrences(of: "::ffff:", with: "")
    }

    private static func prettyPlatform(_ platform: String?) -> String? {
        let raw = platform?.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let raw, !raw.isEmpty else { return nil }
        if raw.lowercased() == "ios" { return "iOS" }
        if raw.lowercased() == "macos" { return "macOS" }
        return raw
    }
}
