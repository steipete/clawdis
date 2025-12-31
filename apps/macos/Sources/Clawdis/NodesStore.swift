import Foundation
import Observation
import OSLog

struct NodeInfo: Identifiable, Codable {
    let nodeId: String
    let displayName: String?
    let platform: String?
    let version: String?
    let deviceFamily: String?
    let modelIdentifier: String?
    let remoteIp: String?
    let caps: [String]?
    let commands: [String]?
    let permissions: [String: Bool]?
    let paired: Bool?
    let connected: Bool?

    var id: String { self.nodeId }
    var isConnected: Bool { self.connected ?? false }
    var isPaired: Bool { self.paired ?? false }
}

private struct NodeListResponse: Codable {
    let ts: Double?
    let nodes: [NodeInfo]
}

@MainActor
@Observable
final class NodesStore {
    static let shared = NodesStore()

    var nodes: [NodeInfo] = []
    var lastError: String?
    var statusMessage: String?
    var isLoading = false

    private let logger = Logger(subsystem: "com.steipete.clawdis", category: "nodes")
    private var task: Task<Void, Never>?
    private let interval: TimeInterval = 30
    private var startCount = 0

    func start() {
        self.startCount += 1
        guard self.startCount == 1 else { return }
        guard self.task == nil else { return }
        self.task = Task.detached { [weak self] in
            guard let self else { return }
            await self.refresh()
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(self.interval * 1_000_000_000))
                await self.refresh()
            }
        }
    }

    func stop() {
        guard self.startCount > 0 else { return }
        self.startCount -= 1
        guard self.startCount == 0 else { return }
        self.task?.cancel()
        self.task = nil
    }

    func refresh() async {
        if self.isLoading { return }
        self.statusMessage = nil
        self.isLoading = true
        defer { self.isLoading = false }
        do {
            let data = try await GatewayConnection.shared.requestRaw(method: "node.list", params: nil, timeoutMs: 8000)
            let decoded = try JSONDecoder().decode(NodeListResponse.self, from: data)
            self.nodes = decoded.nodes
            self.lastError = nil
            self.statusMessage = nil
        } catch {
            self.logger.error("node.list failed \(error.localizedDescription, privacy: .public)")
            self.nodes = []
            self.lastError = error.localizedDescription
            self.statusMessage = nil
        }
    }
}
