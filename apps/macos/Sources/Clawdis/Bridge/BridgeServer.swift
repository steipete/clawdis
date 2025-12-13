import AppKit
import ClawdisKit
import Foundation
import Network
import OSLog

actor BridgeServer {
    static let shared = BridgeServer()

    private let logger = Logger(subsystem: "com.steipete.clawdis", category: "bridge")
    private var listener: NWListener?
    private var isRunning = false
    private var store: PairedNodesStore?
    private var connections: [String: BridgeConnectionHandler] = [:]
    private var presenceTasks: [String: Task<Void, Never>] = [:]

    func start() async {
        if self.isRunning { return }
        self.isRunning = true

        do {
            let storeURL = try Self.defaultStoreURL()
            let store = PairedNodesStore(fileURL: storeURL)
            await store.load()
            self.store = store

            let params = NWParameters.tcp
            params.includePeerToPeer = true
            let listener = try NWListener(using: params, on: .any)

            listener.newConnectionHandler = { [weak self] connection in
                guard let self else { return }
                Task { await self.handle(connection: connection) }
            }

            listener.stateUpdateHandler = { [weak self] state in
                guard let self else { return }
                Task { await self.handleListenerState(state) }
            }

            listener.start(queue: DispatchQueue(label: "com.steipete.clawdis.bridge"))
            self.listener = listener
        } catch {
            self.logger.error("bridge start failed: \(error.localizedDescription, privacy: .public)")
            self.isRunning = false
        }
    }

    func stop() async {
        self.isRunning = false
        self.listener?.cancel()
        self.listener = nil
    }

    private func handleListenerState(_ state: NWListener.State) {
        switch state {
        case .ready:
            self.logger.info("bridge listening")
        case let .failed(err):
            self.logger.error("bridge listener failed: \(err.localizedDescription, privacy: .public)")
        case .cancelled:
            self.logger.info("bridge listener cancelled")
        case .waiting:
            self.logger.info("bridge listener waiting")
        case .setup:
            break
        @unknown default:
            break
        }
    }

    private func handle(connection: NWConnection) async {
        let handler = BridgeConnectionHandler(connection: connection, logger: self.logger)
        await handler.run(
            resolveAuth: { [weak self] hello in
                await self?.authorize(hello: hello) ?? .error(code: "UNAVAILABLE", message: "bridge unavailable")
            },
            handlePair: { [weak self] request in
                await self?.pair(request: request) ?? .error(code: "UNAVAILABLE", message: "bridge unavailable")
            },
            onAuthenticated: { [weak self] nodeId in
                await self?.registerConnection(handler: handler, nodeId: nodeId)
            },
            onDisconnected: { [weak self] nodeId in
                await self?.unregisterConnection(nodeId: nodeId)
            },
            onEvent: { [weak self] nodeId, evt in
                await self?.handleEvent(nodeId: nodeId, evt: evt)
            })
    }

    func invoke(nodeId: String, command: String, paramsJSON: String?) async throws -> BridgeInvokeResponse {
        guard let handler = self.connections[nodeId] else {
            throw NSError(domain: "Bridge", code: 10, userInfo: [
                NSLocalizedDescriptionKey: "UNAVAILABLE: node not connected",
            ])
        }
        return try await handler.invoke(command: command, paramsJSON: paramsJSON)
    }

    func connectedNodeIds() -> [String] {
        Array(self.connections.keys).sorted()
    }

    private func registerConnection(handler: BridgeConnectionHandler, nodeId: String) async {
        self.connections[nodeId] = handler
        await self.beaconPresence(nodeId: nodeId, reason: "connect")
        self.startPresenceTask(nodeId: nodeId)
    }

    private func unregisterConnection(nodeId: String) async {
        await self.beaconPresence(nodeId: nodeId, reason: "disconnect")
        self.stopPresenceTask(nodeId: nodeId)
        self.connections.removeValue(forKey: nodeId)
    }

    private struct VoiceTranscriptPayload: Codable, Sendable {
        var text: String
        var sessionKey: String?
    }

    private func handleEvent(nodeId: String, evt: BridgeEventFrame) async {
        switch evt.event {
        case "voice.transcript":
            guard let json = evt.payloadJSON, let data = json.data(using: .utf8) else {
                return
            }
            guard let payload = try? JSONDecoder().decode(VoiceTranscriptPayload.self, from: data) else {
                return
            }
            let text = payload.text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { return }

            let sessionKey = payload.sessionKey?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
                ?? "node-\(nodeId)"

            _ = await AgentRPC.shared.send(
                text: text,
                thinking: "low",
                sessionKey: sessionKey,
                deliver: false,
                to: nil,
                channel: "last")
        case "agent.request":
            guard let json = evt.payloadJSON, let data = json.data(using: .utf8) else {
                return
            }
            guard let link = try? JSONDecoder().decode(AgentDeepLink.self, from: data) else {
                return
            }

            let message = link.message.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !message.isEmpty else { return }
            guard message.count <= 20000 else { return }

            let sessionKey = link.sessionKey?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
                ?? "node-\(nodeId)"
            let thinking = link.thinking?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
            let to = link.to?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
            let channel = link.channel?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty

            _ = await AgentRPC.shared.send(
                text: message,
                thinking: thinking,
                sessionKey: sessionKey,
                deliver: link.deliver,
                to: to,
                channel: channel ?? "last")
        default:
            break
        }
    }

    private func beaconPresence(nodeId: String, reason: String) async {
        do {
            let paired = await self.store?.find(nodeId: nodeId)
            let host = paired?.displayName?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
                ?? nodeId
            let version = paired?.version?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
            let platform = paired?.platform?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
            let ip = await self.connections[nodeId]?.remoteAddress()

            var tags: [String] = ["node", "ios"]
            if let platform { tags.append(platform) }

            let summary = [
                "Node: \(host)\(ip.map { " (\($0))" } ?? "")",
                platform.map { "platform \($0)" },
                version.map { "app \($0)" },
                "mode node",
                "reason \(reason)",
            ].compactMap(\.self).joined(separator: " · ")

            var params: [String: Any] = [
                "text": summary,
                "instanceId": nodeId,
                "host": host,
                "mode": "node",
                "reason": reason,
                "tags": tags,
            ]
            if let ip { params["ip"] = ip }
            if let version { params["version"] = version }
            _ = try await AgentRPC.shared.controlRequest(
                method: "system-event",
                params: ControlRequestParams(raw: params))
        } catch {
            // Best-effort only.
        }
    }

    private func startPresenceTask(nodeId: String) {
        self.presenceTasks[nodeId]?.cancel()
        self.presenceTasks[nodeId] = Task.detached { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 180 * 1_000_000_000)
                if Task.isCancelled { return }
                await self?.beaconPresence(nodeId: nodeId, reason: "periodic")
            }
        }
    }

    private func stopPresenceTask(nodeId: String) {
        self.presenceTasks[nodeId]?.cancel()
        self.presenceTasks.removeValue(forKey: nodeId)
    }

    private func authorize(hello: BridgeHello) async -> BridgeConnectionHandler.AuthResult {
        let nodeId = hello.nodeId.trimmingCharacters(in: .whitespacesAndNewlines)
        if nodeId.isEmpty {
            return .error(code: "INVALID_REQUEST", message: "nodeId required")
        }
        guard let store = self.store else {
            return .error(code: "UNAVAILABLE", message: "store unavailable")
        }
        guard let paired = await store.find(nodeId: nodeId) else {
            return .notPaired
        }
        guard let token = hello.token, token == paired.token else {
            return .unauthorized
        }
        do { try await store.touchSeen(nodeId: nodeId) } catch { /* ignore */ }
        return .ok
    }

    private func pair(request: BridgePairRequest) async -> BridgeConnectionHandler.PairResult {
        let nodeId = request.nodeId.trimmingCharacters(in: .whitespacesAndNewlines)
        if nodeId.isEmpty {
            return .error(code: "INVALID_REQUEST", message: "nodeId required")
        }
        guard let store = self.store else {
            return .error(code: "UNAVAILABLE", message: "store unavailable")
        }
        let existing = await store.find(nodeId: nodeId)

        let approved = await BridgePairingApprover.approve(request: request, isRepair: existing != nil)
        if !approved {
            return .rejected
        }

        let token = UUID().uuidString.replacingOccurrences(of: "-", with: "")
        let nowMs = Int(Date().timeIntervalSince1970 * 1000)
        let node = PairedNode(
            nodeId: nodeId,
            displayName: request.displayName,
            platform: request.platform,
            version: request.version,
            token: token,
            createdAtMs: nowMs,
            lastSeenAtMs: nowMs)
        do {
            try await store.upsert(node)
            return .ok(token: token)
        } catch {
            return .error(code: "UNAVAILABLE", message: "failed to persist pairing")
        }
    }

    private static func defaultStoreURL() throws -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
        guard let base else {
            throw NSError(
                domain: "Bridge",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Application Support unavailable"])
        }
        return base
            .appendingPathComponent("Clawdis", isDirectory: true)
            .appendingPathComponent("bridge", isDirectory: true)
            .appendingPathComponent("paired-nodes.json", isDirectory: false)
    }
}

@MainActor
enum BridgePairingApprover {
    static func approve(request: BridgePairRequest, isRepair: Bool) async -> Bool {
        await withCheckedContinuation { cont in
            let name = request.displayName ?? request.nodeId
            let remote = request.remoteAddress?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
            let alert = NSAlert()
            alert.messageText = isRepair ? "Re-pair Clawdis Node?" : "Pair Clawdis Node?"
            alert.informativeText = """
            Node: \(name)
            IP: \(remote ?? "unknown")
            Platform: \(request.platform ?? "unknown")
            Version: \(request.version ?? "unknown")
            """
            alert.addButton(withTitle: "Approve")
            alert.addButton(withTitle: "Reject")
            if #available(macOS 11.0, *), alert.buttons.indices.contains(1) {
                alert.buttons[1].hasDestructiveAction = true
            }
            let resp = alert.runModal()
            cont.resume(returning: resp == .alertFirstButtonReturn)
        }
    }
}

extension String {
    fileprivate var nonEmpty: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
