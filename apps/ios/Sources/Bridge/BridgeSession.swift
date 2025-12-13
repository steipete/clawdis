import ClawdisKit
import Foundation
import Network

actor BridgeSession {
    enum State: Sendable, Equatable {
        case idle
        case connecting
        case connected(serverName: String)
        case failed(message: String)
    }

    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    private var connection: NWConnection?
    private var queue: DispatchQueue?
    private var buffer = Data()

    private(set) var state: State = .idle

    func currentRemoteAddress() -> String? {
        guard let endpoint = self.connection?.currentPath?.remoteEndpoint else { return nil }
        return Self.prettyRemoteEndpoint(endpoint)
    }

    private static func prettyRemoteEndpoint(_ endpoint: NWEndpoint) -> String? {
        switch endpoint {
        case let .hostPort(host, port):
            let hostString = Self.prettyHostString(host)
            if hostString.contains(":") {
                return "[\(hostString)]:\(port)"
            }
            return "\(hostString):\(port)"
        default:
            return String(describing: endpoint)
        }
    }

    private static func prettyHostString(_ host: NWEndpoint.Host) -> String {
        var hostString = String(describing: host)
        hostString = hostString.replacingOccurrences(of: "::ffff:", with: "")

        guard let percentIndex = hostString.firstIndex(of: "%") else { return hostString }

        let prefix = hostString[..<percentIndex]
        let allowed = CharacterSet(charactersIn: "0123456789abcdefABCDEF:.")
        let isIPAddressPrefix = prefix.unicodeScalars.allSatisfy { allowed.contains($0) }
        if isIPAddressPrefix {
            return String(prefix)
        }

        return hostString
    }

    func connect(
        endpoint: NWEndpoint,
        hello: BridgeHello,
        onConnected: (@Sendable (String) async -> Void)? = nil,
        onInvoke: @escaping @Sendable (BridgeInvokeRequest) async -> BridgeInvokeResponse)
        async throws
    {
        await self.disconnect()
        self.state = .connecting

        let connection = NWConnection(to: endpoint, using: .tcp)
        let queue = DispatchQueue(label: "com.steipete.clawdis.ios.bridge-session")
        self.connection = connection
        self.queue = queue
        connection.start(queue: queue)

        try await self.send(hello)

        guard let line = try await self.receiveLine(),
              let data = line.data(using: .utf8),
              let base = try? self.decoder.decode(BridgeBaseFrame.self, from: data)
        else {
            await self.disconnect()
            throw NSError(domain: "Bridge", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "Unexpected bridge response",
            ])
        }

        if base.type == "hello-ok" {
            let ok = try self.decoder.decode(BridgeHelloOk.self, from: data)
            self.state = .connected(serverName: ok.serverName)
            await onConnected?(ok.serverName)
        } else if base.type == "error" {
            let err = try self.decoder.decode(BridgeErrorFrame.self, from: data)
            self.state = .failed(message: "\(err.code): \(err.message)")
            await self.disconnect()
            throw NSError(domain: "Bridge", code: 2, userInfo: [
                NSLocalizedDescriptionKey: "\(err.code): \(err.message)",
            ])
        } else {
            self.state = .failed(message: "Unexpected bridge response")
            await self.disconnect()
            throw NSError(domain: "Bridge", code: 3, userInfo: [
                NSLocalizedDescriptionKey: "Unexpected bridge response",
            ])
        }

        while true {
            guard let next = try await self.receiveLine() else { break }
            guard let nextData = next.data(using: .utf8) else { continue }
            guard let nextBase = try? self.decoder.decode(BridgeBaseFrame.self, from: nextData) else { continue }

            switch nextBase.type {
            case "ping":
                let ping = try self.decoder.decode(BridgePing.self, from: nextData)
                try await self.send(BridgePong(type: "pong", id: ping.id))

            case "invoke":
                let req = try self.decoder.decode(BridgeInvokeRequest.self, from: nextData)
                let res = await onInvoke(req)
                try await self.send(res)

            default:
                continue
            }
        }

        await self.disconnect()
    }

    func sendEvent(event: String, payloadJSON: String?) async throws {
        try await self.send(BridgeEventFrame(type: "event", event: event, payloadJSON: payloadJSON))
    }

    func disconnect() async {
        self.connection?.cancel()
        self.connection = nil
        self.queue = nil
        self.buffer = Data()
        self.state = .idle
    }

    private func send(_ obj: some Encodable) async throws {
        guard let connection = self.connection else {
            throw NSError(domain: "Bridge", code: 10, userInfo: [
                NSLocalizedDescriptionKey: "not connected",
            ])
        }
        let data = try self.encoder.encode(obj)
        var line = Data()
        line.append(data)
        line.append(0x0A)
        try await withCheckedThrowingContinuation(isolation: nil) { (cont: CheckedContinuation<Void, Error>) in
            connection.send(content: line, completion: .contentProcessed { err in
                if let err { cont.resume(throwing: err) } else { cont.resume(returning: ()) }
            })
        }
    }

    private func receiveLine() async throws -> String? {
        while true {
            if let idx = self.buffer.firstIndex(of: 0x0A) {
                let lineData = self.buffer.prefix(upTo: idx)
                self.buffer.removeSubrange(...idx)
                return String(data: lineData, encoding: .utf8)
            }

            let chunk = try await self.receiveChunk()
            if chunk.isEmpty { return nil }
            self.buffer.append(chunk)
        }
    }

    private func receiveChunk() async throws -> Data {
        guard let connection = self.connection else { return Data() }
        return try await withCheckedThrowingContinuation(isolation: nil) { (cont: CheckedContinuation<Data, Error>) in
            connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { data, _, isComplete, error in
                if let error {
                    cont.resume(throwing: error)
                    return
                }
                if isComplete {
                    cont.resume(returning: Data())
                    return
                }
                cont.resume(returning: data ?? Data())
            }
        }
    }
}
