import ClawdisKit
import SwiftUI
import UIKit

@MainActor
private final class ConnectStatusStore: ObservableObject {
    @Published var text: String?
}

extension ConnectStatusStore: @unchecked Sendable {}

struct SettingsTab: View {
    @EnvironmentObject private var appModel: NodeAppModel
    @Environment(\.dismiss) private var dismiss
    @AppStorage("node.displayName") private var displayName: String = "iOS Node"
    @AppStorage("node.instanceId") private var instanceId: String = UUID().uuidString
    @AppStorage("voiceWake.enabled") private var voiceWakeEnabled: Bool = false
    @AppStorage("bridge.preferredStableID") private var preferredBridgeStableID: String = ""
    @StateObject private var discovery = BridgeDiscoveryModel()
    @StateObject private var connectStatus = ConnectStatusStore()
    @State private var connectingBridgeID: String?
    @State private var didAutoConnect = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Node") {
                    TextField("Name", text: self.$displayName)
                    Text(self.instanceId)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section("Voice") {
                    Toggle("Voice Wake", isOn: self.$voiceWakeEnabled)
                        .onChange(of: self.voiceWakeEnabled) { _, newValue in
                            self.appModel.setVoiceWakeEnabled(newValue)
                        }
                }

                Section("Bridge") {
                    LabeledContent("Discovery", value: self.discovery.statusText)
                    LabeledContent("Status", value: self.appModel.bridgeStatusText)
                    if let serverName = self.appModel.bridgeServerName {
                        LabeledContent("Server", value: serverName)
                        if let addr = self.appModel.bridgeRemoteAddress {
                            LabeledContent("Address") {
                                Text(addr)
                            }
                            .contextMenu {
                                Button {
                                    UIPasteboard.general.string = addr
                                } label: {
                                    Label("Copy", systemImage: "doc.on.doc")
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
            .onAppear { self.discovery.start() }
            .onDisappear { self.discovery.stop() }
            .onChange(of: self.discovery.bridges) { _, newValue in
                if self.didAutoConnect { return }
                if self.appModel.bridgeServerName != nil { return }

                let existing = KeychainStore.loadString(
                    service: "com.steipete.clawdis.bridge",
                    account: self.keychainAccount())
                guard let existing, !existing.isEmpty else { return }
                guard let target = self.pickAutoConnectBridge(from: newValue) else { return }

                self.didAutoConnect = true
                self.preferredBridgeStableID = target.stableID
                self.appModel.connectToBridge(
                    endpoint: target.endpoint,
                    hello: BridgeHello(
                        nodeId: self.instanceId,
                        displayName: self.displayName,
                        token: existing,
                        platform: self.platformString(),
                        version: self.appVersion()))
                self.connectStatus.text = nil
            }
            .onChange(of: self.appModel.bridgeServerName) { _, _ in
                self.connectStatus.text = nil
            }
        }
    }

    @ViewBuilder
    private func bridgeList(showing: BridgeListMode) -> some View {
        if self.discovery.bridges.isEmpty {
            Text("No bridges found yet.")
                .foregroundStyle(.secondary)
        } else {
            let connectedID = self.appModel.connectedBridgeID
            let rows = self.discovery.bridges.filter { bridge in
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

    private func connect(_ bridge: BridgeDiscoveryModel.DiscoveredBridge) async {
        self.connectingBridgeID = bridge.id
        self.preferredBridgeStableID = bridge.stableID
        defer { self.connectingBridgeID = nil }

        do {
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
                version: self.appVersion())
            let token = try await BridgeClient().pairAndHello(
                endpoint: bridge.endpoint,
                hello: hello,
                onStatus: { status in
                    let store = self.connectStatus
                    Task { @MainActor in
                        store.text = status
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
                    version: self.appVersion()))

        } catch {
            self.connectStatus.text = "Failed: \(error.localizedDescription)"
        }
    }

    private func pickAutoConnectBridge(from bridges: [BridgeDiscoveryModel.DiscoveredBridge]) -> BridgeDiscoveryModel
    .DiscoveredBridge? {
        if !self.preferredBridgeStableID.isEmpty,
           let match = bridges.first(where: { $0.stableID == self.preferredBridgeStableID })
        {
            return match
        }
        return bridges.first
    }
}
