import ClawdisKit
import Network
import Observation
import SwiftUI
import UIKit

@MainActor
@Observable
private final class ConnectStatusStore {
    var text: String?
}

extension ConnectStatusStore: @unchecked Sendable {}

struct SettingsTab: View {
    @Environment(NodeAppModel.self) private var appModel: NodeAppModel
    @Environment(VoiceWakeManager.self) private var voiceWake: VoiceWakeManager
    @Environment(BridgeConnectionController.self) private var bridgeController: BridgeConnectionController
    @Environment(\.dismiss) private var dismiss
    @AppStorage("node.displayName") private var displayName: String = "iOS Node"
    @AppStorage("node.instanceId") private var instanceId: String = UUID().uuidString
    @AppStorage("voiceWake.enabled") private var voiceWakeEnabled: Bool = false
    @AppStorage("talk.enabled") private var talkEnabled: Bool = false
    @AppStorage("talk.button.enabled") private var talkButtonEnabled: Bool = true
    @AppStorage("camera.enabled") private var cameraEnabled: Bool = true
    @AppStorage("screen.preventSleep") private var preventSleep: Bool = true
    @AppStorage("bridge.preferredStableID") private var preferredBridgeStableID: String = ""
    @AppStorage("bridge.lastDiscoveredStableID") private var lastDiscoveredBridgeStableID: String = ""
    @AppStorage("bridge.manual.enabled") private var manualBridgeEnabled: Bool = false
    @AppStorage("bridge.manual.host") private var manualBridgeHost: String = ""
    @AppStorage("bridge.manual.port") private var manualBridgePort: Int = 18790
    @AppStorage("bridge.discovery.debugLogs") private var discoveryDebugLogsEnabled: Bool = false
    @AppStorage("canvas.debugStatusEnabled") private var canvasDebugStatusEnabled: Bool = false
    @State private var connectStatus = ConnectStatusStore()
    @State private var connectingBridgeID: String?
    @State private var localIPAddress: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Node") {
                    TextField("Name", text: self.$displayName)
                    Text(self.instanceId)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    LabeledContent("IP", value: self.localIPAddress ?? "—")
                        .contextMenu {
                            if let ip = self.localIPAddress {
                                Button {
                                    UIPasteboard.general.string = ip
                                } label: {
                                    Label("Copy", systemImage: "doc.on.doc")
                                }
                            }
                        }
                    LabeledContent("Platform", value: self.platformString())
                    LabeledContent("Version", value: self.appVersion())
                    LabeledContent("Model", value: self.modelIdentifier())
                }

                Section("Bridge") {
                    LabeledContent("Discovery", value: self.bridgeController.discoveryStatusText)
                    LabeledContent("Status", value: self.appModel.bridgeStatusText)
                    if let serverName = self.appModel.bridgeServerName {
                        LabeledContent("Server", value: serverName)
                        if let addr = self.appModel.bridgeRemoteAddress {
                            let parts = Self.parseHostPort(from: addr)
                            let urlString = Self.httpURLString(host: parts?.host, port: parts?.port, fallback: addr)
                            LabeledContent("Address") {
                                Text(urlString)
                            }
                            .contextMenu {
                                Button {
                                    UIPasteboard.general.string = urlString
                                } label: {
                                    Label("Copy URL", systemImage: "doc.on.doc")
                                }

                                if let parts {
                                    Button {
                                        UIPasteboard.general.string = parts.host
                                    } label: {
                                        Label("Copy Host", systemImage: "doc.on.doc")
                                    }

                                    Button {
                                        UIPasteboard.general.string = "\(parts.port)"
                                    } label: {
                                        Label("Copy Port", systemImage: "doc.on.doc")
                                    }
                                }
                            }
                        }

                        Button("Disconnect", role: .destructive) {
                            self.appModel.disconnectBridge()
                        }

                        self.bridgeList(showing: .availableOnly)
                    } else {
                        self.bridgeList(showing: .all)
                    }

                    if let text = self.connectStatus.text {
                        Text(text)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }

                    DisclosureGroup("Advanced") {
                        Toggle("Use Manual Bridge", isOn: self.$manualBridgeEnabled)

                        TextField("Host", text: self.$manualBridgeHost)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()

                        TextField("Port", value: self.$manualBridgePort, format: .number)
                            .keyboardType(.numberPad)

                        Button {
                            Task { await self.connectManual() }
                        } label: {
                            if self.connectingBridgeID == "manual" {
                                HStack(spacing: 8) {
                                    ProgressView()
                                        .progressViewStyle(.circular)
                                    Text("Connecting…")
                                }
                            } else {
                                Text("Connect (Manual)")
                            }
                        }
                        .disabled(self.connectingBridgeID != nil || self.manualBridgeHost
                            .trimmingCharacters(in: .whitespacesAndNewlines)
                            .isEmpty || self.manualBridgePort <= 0 || self.manualBridgePort > 65535)

                        Text(
                            "Use this when mDNS/Bonjour discovery is blocked. "
                                + "The bridge runs on the gateway (default port 18790).")
                            .font(.footnote)
                            .foregroundStyle(.secondary)

                        Toggle("Discovery Debug Logs", isOn: self.$discoveryDebugLogsEnabled)
                            .onChange(of: self.discoveryDebugLogsEnabled) { _, newValue in
                                self.bridgeController.setDiscoveryDebugLoggingEnabled(newValue)
                            }

                        NavigationLink("Discovery Logs") {
                            BridgeDiscoveryDebugLogView()
                        }

                        Toggle("Debug Canvas Status", isOn: self.$canvasDebugStatusEnabled)
                    }
                }

                Section("Voice") {
                    Toggle("Voice Wake", isOn: self.$voiceWakeEnabled)
                        .onChange(of: self.voiceWakeEnabled) { _, newValue in
                            self.appModel.setVoiceWakeEnabled(newValue)
                        }
                    Toggle("Talk Mode", isOn: self.$talkEnabled)
                        .onChange(of: self.talkEnabled) { _, newValue in
                            self.appModel.setTalkEnabled(newValue)
                        }
                    // Keep this separate so users can hide the side bubble without disabling Talk Mode.
                    Toggle("Show Talk Button", isOn: self.$talkButtonEnabled)

                    NavigationLink {
                        VoiceWakeWordsSettingsView()
                    } label: {
                        LabeledContent(
                            "Wake Words",
                            value: VoiceWakePreferences.displayString(for: self.voiceWake.triggerWords))
                    }
                }

                Section("Camera") {
                    Toggle("Allow Camera", isOn: self.$cameraEnabled)
                    Text("Allows the bridge to request photos or short video clips (foreground only).")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section("Screen") {
                    Toggle("Prevent Sleep", isOn: self.$preventSleep)
                    Text("Keeps the screen awake while Clawdis is open.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        self.dismiss()
                    } label: {
                        Image(systemName: "xmark")
                    }
                    .accessibilityLabel("Close")
                }
            }
            .onAppear {
                self.localIPAddress = Self.primaryIPv4Address()
            }
            .onChange(of: self.preferredBridgeStableID) { _, newValue in
                let trimmed = newValue.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !trimmed.isEmpty else { return }
                BridgeSettingsStore.savePreferredBridgeStableID(trimmed)
            }
            .onChange(of: self.appModel.bridgeServerName) { _, _ in
                self.connectStatus.text = nil
            }
        }
    }

    @ViewBuilder
    private func bridgeList(showing: BridgeListMode) -> some View {
        if self.bridgeController.bridges.isEmpty {
            Text("No bridges found yet.")
                .foregroundStyle(.secondary)
        } else {
            let connectedID = self.appModel.connectedBridgeID
            let rows = self.bridgeController.bridges.filter { bridge in
                let isConnected = bridge.stableID == connectedID
                switch showing {
                case .all:
                    return true
                case .availableOnly:
                    return !isConnected
                }
            }

            if rows.isEmpty, showing == .availableOnly {
                Text("No other bridges found.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(rows) { bridge in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(bridge.name)
                            let detailLines = self.bridgeDetailLines(bridge)
                            ForEach(detailLines, id: \.self) { line in
                                Text(line)
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        Spacer()

                        Button {
                            Task { await self.connect(bridge) }
                        } label: {
                            if self.connectingBridgeID == bridge.id {
                                ProgressView()
                                    .progressViewStyle(.circular)
                            } else {
                                Text("Connect")
                            }
                        }
                        .disabled(self.connectingBridgeID != nil)
                    }
                }
            }
        }
    }

    private enum BridgeListMode: Equatable {
        case all
        case availableOnly
    }

    private func keychainAccount() -> String {
        "bridge-token.\(self.instanceId)"
    }

    private func platformString() -> String {
        let v = ProcessInfo.processInfo.operatingSystemVersion
        return "iOS \(v.majorVersion).\(v.minorVersion).\(v.patchVersion)"
    }

    private func appVersion() -> String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "dev"
    }

    private func deviceFamily() -> String {
        switch UIDevice.current.userInterfaceIdiom {
        case .pad:
            "iPad"
        case .phone:
            "iPhone"
        default:
            "iOS"
        }
    }

    private func modelIdentifier() -> String {
        var systemInfo = utsname()
        uname(&systemInfo)
        let machine = withUnsafeBytes(of: &systemInfo.machine) { ptr in
            String(bytes: ptr.prefix { $0 != 0 }, encoding: .utf8)
        }
        let trimmed = machine?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? "unknown" : trimmed
    }

    private func currentCaps() -> [String] {
        var caps = [ClawdisCapability.canvas.rawValue, ClawdisCapability.screen.rawValue]

        let cameraEnabled =
            UserDefaults.standard.object(forKey: "camera.enabled") == nil
                ? true
                : UserDefaults.standard.bool(forKey: "camera.enabled")
        if cameraEnabled { caps.append(ClawdisCapability.camera.rawValue) }

        let voiceWakeEnabled = UserDefaults.standard.bool(forKey: VoiceWakePreferences.enabledKey)
        if voiceWakeEnabled { caps.append(ClawdisCapability.voiceWake.rawValue) }

        return caps
    }

    private func currentCommands() -> [String] {
        var commands: [String] = [
            ClawdisCanvasCommand.present.rawValue,
            ClawdisCanvasCommand.hide.rawValue,
            ClawdisCanvasCommand.navigate.rawValue,
            ClawdisCanvasCommand.evalJS.rawValue,
            ClawdisCanvasCommand.snapshot.rawValue,
            ClawdisCanvasA2UICommand.push.rawValue,
            ClawdisCanvasA2UICommand.pushJSONL.rawValue,
            ClawdisCanvasA2UICommand.reset.rawValue,
            ClawdisScreenCommand.record.rawValue,
        ]

        let caps = Set(self.currentCaps())
        if caps.contains(ClawdisCapability.camera.rawValue) {
            commands.append(ClawdisCameraCommand.snap.rawValue)
            commands.append(ClawdisCameraCommand.clip.rawValue)
        }

        return commands
    }

    private func connect(_ bridge: BridgeDiscoveryModel.DiscoveredBridge) async {
        self.connectingBridgeID = bridge.id
        self.manualBridgeEnabled = false
        self.preferredBridgeStableID = bridge.stableID
        BridgeSettingsStore.savePreferredBridgeStableID(bridge.stableID)
        self.lastDiscoveredBridgeStableID = bridge.stableID
        BridgeSettingsStore.saveLastDiscoveredBridgeStableID(bridge.stableID)
        defer { self.connectingBridgeID = nil }

        do {
            let statusStore = self.connectStatus
            let existing = KeychainStore.loadString(
                service: "com.steipete.clawdis.bridge",
                account: self.keychainAccount())
            let existingToken = (existing?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false) ?
                existing :
                nil

            let hello = BridgeHello(
                nodeId: self.instanceId,
                displayName: self.displayName,
                token: existingToken,
                platform: self.platformString(),
                version: self.appVersion(),
                deviceFamily: self.deviceFamily(),
                modelIdentifier: self.modelIdentifier(),
                caps: self.currentCaps(),
                commands: self.currentCommands())
            let token = try await BridgeClient().pairAndHello(
                endpoint: bridge.endpoint,
                hello: hello,
                onStatus: { status in
                    Task { @MainActor in
                        statusStore.text = status
                    }
                })

            if !token.isEmpty, token != existingToken {
                _ = KeychainStore.saveString(
                    token,
                    service: "com.steipete.clawdis.bridge",
                    account: self.keychainAccount())
            }

            self.appModel.connectToBridge(
                endpoint: bridge.endpoint,
                hello: BridgeHello(
                    nodeId: self.instanceId,
                    displayName: self.displayName,
                    token: token,
                    platform: self.platformString(),
                    version: self.appVersion(),
                    deviceFamily: self.deviceFamily(),
                    modelIdentifier: self.modelIdentifier(),
                    caps: self.currentCaps(),
                    commands: self.currentCommands()))

        } catch {
            self.connectStatus.text = "Failed: \(error.localizedDescription)"
        }
    }

    private func connectManual() async {
        let host = self.manualBridgeHost.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !host.isEmpty else {
            self.connectStatus.text = "Failed: host required"
            return
        }
        guard self.manualBridgePort > 0, self.manualBridgePort <= 65535 else {
            self.connectStatus.text = "Failed: invalid port"
            return
        }
        guard let port = NWEndpoint.Port(rawValue: UInt16(self.manualBridgePort)) else {
            self.connectStatus.text = "Failed: invalid port"
            return
        }

        self.connectingBridgeID = "manual"
        self.manualBridgeEnabled = true
        defer { self.connectingBridgeID = nil }

        let endpoint: NWEndpoint = .hostPort(host: NWEndpoint.Host(host), port: port)

        do {
            let statusStore = self.connectStatus
            let existing = KeychainStore.loadString(
                service: "com.steipete.clawdis.bridge",
                account: self.keychainAccount())
            let existingToken = (existing?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false) ?
                existing :
                nil

            let hello = BridgeHello(
                nodeId: self.instanceId,
                displayName: self.displayName,
                token: existingToken,
                platform: self.platformString(),
                version: self.appVersion(),
                deviceFamily: self.deviceFamily(),
                modelIdentifier: self.modelIdentifier(),
                caps: self.currentCaps(),
                commands: self.currentCommands())
            let token = try await BridgeClient().pairAndHello(
                endpoint: endpoint,
                hello: hello,
                onStatus: { status in
                    Task { @MainActor in
                        statusStore.text = status
                    }
                })

            if !token.isEmpty, token != existingToken {
                _ = KeychainStore.saveString(
                    token,
                    service: "com.steipete.clawdis.bridge",
                    account: self.keychainAccount())
            }

            self.appModel.connectToBridge(
                endpoint: endpoint,
                hello: BridgeHello(
                    nodeId: self.instanceId,
                    displayName: self.displayName,
                    token: token,
                    platform: self.platformString(),
                    version: self.appVersion(),
                    deviceFamily: self.deviceFamily(),
                    modelIdentifier: self.modelIdentifier(),
                    caps: self.currentCaps(),
                    commands: self.currentCommands()))

        } catch {
            self.connectStatus.text = "Failed: \(error.localizedDescription)"
        }
    }

    private static func primaryIPv4Address() -> String? {
        var addrList: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&addrList) == 0, let first = addrList else { return nil }
        defer { freeifaddrs(addrList) }

        var fallback: String?
        var en0: String?

        for ptr in sequence(first: first, next: { $0.pointee.ifa_next }) {
            let flags = Int32(ptr.pointee.ifa_flags)
            let isUp = (flags & IFF_UP) != 0
            let isLoopback = (flags & IFF_LOOPBACK) != 0
            let name = String(cString: ptr.pointee.ifa_name)
            let family = ptr.pointee.ifa_addr.pointee.sa_family
            if !isUp || isLoopback || family != UInt8(AF_INET) { continue }

            var addr = ptr.pointee.ifa_addr.pointee
            var buffer = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            let result = getnameinfo(
                &addr,
                socklen_t(ptr.pointee.ifa_addr.pointee.sa_len),
                &buffer,
                socklen_t(buffer.count),
                nil,
                0,
                NI_NUMERICHOST)
            guard result == 0 else { continue }
            let len = buffer.prefix { $0 != 0 }
            let bytes = len.map { UInt8(bitPattern: $0) }
            guard let ip = String(bytes: bytes, encoding: .utf8) else { continue }

            if name == "en0" { en0 = ip; break }
            if fallback == nil { fallback = ip }
        }

        return en0 ?? fallback
    }

    private static func parseHostPort(from address: String) -> SettingsHostPort? {
        SettingsNetworkingHelpers.parseHostPort(from: address)
    }

    private static func httpURLString(host: String?, port: Int?, fallback: String) -> String {
        SettingsNetworkingHelpers.httpURLString(host: host, port: port, fallback: fallback)
    }

    private func bridgeDetailLines(_ bridge: BridgeDiscoveryModel.DiscoveredBridge) -> [String] {
        var lines: [String] = []
        if let lanHost = bridge.lanHost { lines.append("LAN: \(lanHost)") }
        if let tailnet = bridge.tailnetDns { lines.append("Tailnet: \(tailnet)") }

        let gatewayPort = bridge.gatewayPort
        let bridgePort = bridge.bridgePort
        let canvasPort = bridge.canvasPort
        if gatewayPort != nil || bridgePort != nil || canvasPort != nil {
            let gw = gatewayPort.map(String.init) ?? "—"
            let br = bridgePort.map(String.init) ?? "—"
            let canvas = canvasPort.map(String.init) ?? "—"
            lines.append("Ports: gw \(gw) · bridge \(br) · canvas \(canvas)")
        }

        if lines.isEmpty {
            lines.append(bridge.debugID)
        }

        return lines
    }
}
