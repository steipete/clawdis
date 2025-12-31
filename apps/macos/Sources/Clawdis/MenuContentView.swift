import AppKit
import AVFoundation
import Foundation
import Observation
import SwiftUI

/// Menu contents for the Clawdis menu bar extra.
struct MenuContent: View {
    @Bindable var state: AppState
    let updater: UpdaterProviding?
    @Bindable private var updateStatus: UpdateStatus
    private let gatewayManager = GatewayProcessManager.shared
    private let healthStore = HealthStore.shared
    private let heartbeatStore = HeartbeatStore.shared
    private let controlChannel = ControlChannel.shared
    private let activityStore = WorkActivityStore.shared
    @Bindable private var pairingPrompter = NodePairingApprovalPrompter.shared
    @Environment(\.openSettings) private var openSettings
    @State private var availableMics: [AudioInputDevice] = []
    @State private var loadingMics = false
    @State private var browserControlEnabled = true
    @AppStorage(cameraEnabledKey) private var cameraEnabled: Bool = false

    init(state: AppState, updater: UpdaterProviding?) {
        self._state = Bindable(wrappedValue: state)
        self.updater = updater
        self._updateStatus = Bindable(wrappedValue: updater?.updateStatus ?? UpdateStatus.disabled)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Toggle(isOn: self.activeBinding) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(self.connectionLabel)
                    self.statusLine(label: self.healthStatus.label, color: self.healthStatus.color)
                    if self.pairingPrompter.pendingCount > 0 {
                        let repairCount = self.pairingPrompter.pendingRepairCount
                        let repairSuffix = repairCount > 0 ? " · \(repairCount) repair" : ""
                        self.statusLine(
                            label: "Pairing approval pending (\(self.pairingPrompter.pendingCount))\(repairSuffix)",
                            color: .orange)
                    }
                }
            }
            .disabled(self.state.connectionMode == .unconfigured)

            Divider()
            Toggle(isOn: self.heartbeatsBinding) {
                HStack(spacing: 8) {
                    Label("Send Heartbeats", systemImage: "waveform.path.ecg")
                    Spacer(minLength: 0)
                    self.statusLine(label: self.heartbeatStatus.label, color: self.heartbeatStatus.color)
                }
            }
            Toggle(
                isOn: Binding(
                    get: { self.browserControlEnabled },
                    set: { enabled in
                        self.browserControlEnabled = enabled
                        ClawdisConfigFile.setBrowserControlEnabled(enabled)
                    })) {
                Label("Browser Control", systemImage: "globe")
            }
            Toggle(isOn: self.$cameraEnabled) {
                Label("Allow Camera", systemImage: "camera")
            }
            Toggle(isOn: Binding(get: { self.state.canvasEnabled }, set: { self.state.canvasEnabled = $0 })) {
                Label("Allow Canvas", systemImage: "rectangle.and.pencil.and.ellipsis")
            }
            .onChange(of: self.state.canvasEnabled) { _, enabled in
                if !enabled {
                    CanvasManager.shared.hideAll()
                }
            }
            Toggle(isOn: self.voiceWakeBinding) {
                Label("Voice Wake", systemImage: "mic.fill")
            }
                .disabled(!voiceWakeSupported)
                .opacity(voiceWakeSupported ? 1 : 0.5)
            if self.showVoiceWakeMicPicker {
                self.voiceWakeMicMenu
            }
            Divider()
            Button {
                Task { @MainActor in
                    await self.openDashboard()
                }
            } label: {
                Label("Open Dashboard", systemImage: "gauge")
            }
            Button {
                Task { @MainActor in
                    let sessionKey = await WebChatManager.shared.preferredSessionKey()
                    WebChatManager.shared.show(sessionKey: sessionKey)
                }
            } label: {
                Label("Open Chat", systemImage: "bubble.left.and.bubble.right")
            }
            if self.state.canvasEnabled {
                Button {
                    if self.state.canvasPanelVisible {
                        CanvasManager.shared.hideAll()
                    } else {
                        // Don't force a navigation on re-open: preserve the current web view state.
                        _ = try? CanvasManager.shared.show(sessionKey: "main", path: nil)
                    }
                } label: {
                    Label(
                        self.state.canvasPanelVisible ? "Close Canvas" : "Open Canvas",
                        systemImage: "rectangle.inset.filled.on.rectangle")
                }
            }
            Button {
                Task { await self.state.setTalkEnabled(!self.state.talkEnabled) }
            } label: {
                Label(self.state.talkEnabled ? "Stop Talk Mode" : "Talk Mode", systemImage: "waveform.circle.fill")
            }
            .disabled(!voiceWakeSupported)
            .opacity(voiceWakeSupported ? 1 : 0.5)
            Divider()
            Button("Settings…") { self.open(tab: .general) }
                .keyboardShortcut(",", modifiers: [.command])
            self.debugMenu
            Button("About Clawdis") { self.open(tab: .about) }
            if let updater, updater.isAvailable, self.updateStatus.isUpdateReady {
                Button("Update ready, restart now?") { updater.checkForUpdates(nil) }
            }
            Button("Quit") { NSApplication.shared.terminate(nil) }
        }
        .task(id: self.state.swabbleEnabled) {
            if self.state.swabbleEnabled {
                await self.loadMicrophones(force: true)
            }
        }
        .task {
            VoicePushToTalkHotkey.shared.setEnabled(voiceWakeSupported && self.state.voicePushToTalkEnabled)
        }
        .onChange(of: self.state.voicePushToTalkEnabled) { _, enabled in
            VoicePushToTalkHotkey.shared.setEnabled(voiceWakeSupported && enabled)
        }
        .onAppear {
            self.browserControlEnabled = ClawdisConfigFile.browserControlEnabled()
        }
    }

    private var connectionLabel: String {
        switch self.state.connectionMode {
        case .unconfigured:
            "Clawdis Not Configured"
        case .remote:
            "Remote Clawdis Active"
        case .local:
            "Clawdis Active"
        }
    }

    @ViewBuilder
    private var debugMenu: some View {
        if self.state.debugPaneEnabled {
            Menu("Debug") {
                Button {
                    DebugActions.openConfigFolder()
                } label: {
                    Label("Open Config Folder", systemImage: "folder")
                }
                Button {
                    Task { await DebugActions.runHealthCheckNow() }
                } label: {
                    Label("Run Health Check Now", systemImage: "stethoscope")
                }
                Button {
                    Task { _ = await DebugActions.sendTestHeartbeat() }
                } label: {
                    Label("Send Test Heartbeat", systemImage: "waveform.path.ecg")
                }
                Button {
                    Task { _ = await DebugActions.toggleVerboseLoggingMain() }
                } label: {
                    Label(
                        DebugActions.verboseLoggingEnabledMain
                            ? "Verbose Logging (Main): On"
                            : "Verbose Logging (Main): Off",
                        systemImage: "text.alignleft")
                }
                Button {
                    DebugActions.openSessionStore()
                } label: {
                    Label("Open Session Store", systemImage: "externaldrive")
                }
                Divider()
                Button {
                    DebugActions.openAgentEventsWindow()
                } label: {
                    Label("Open Agent Events…", systemImage: "bolt.horizontal.circle")
                }
                Button {
                    DebugActions.openLog()
                } label: {
                    Label("Open Log", systemImage: "doc.text.magnifyingglass")
                }
                Button {
                    Task { _ = await DebugActions.sendDebugVoice() }
                } label: {
                    Label("Send Debug Voice Text", systemImage: "waveform.circle")
                }
                Button {
                    Task { await DebugActions.sendTestNotification() }
                } label: {
                    Label("Send Test Notification", systemImage: "bell")
                }
                Divider()
                if self.state.connectionMode == .local, !AppStateStore.attachExistingGatewayOnly {
                    Button {
                        DebugActions.restartGateway()
                    } label: {
                        Label("Restart Gateway", systemImage: "arrow.clockwise")
                    }
                }
                Button {
                    DebugActions.restartApp()
                } label: {
                    Label("Restart App", systemImage: "arrow.triangle.2.circlepath")
                }
            }
        }
    }

    private func open(tab: SettingsTab) {
        SettingsTabRouter.request(tab)
        NSApp.activate(ignoringOtherApps: true)
        self.openSettings()
        NotificationCenter.default.post(name: .clawdisSelectSettingsTab, object: tab)
    }

    @MainActor
    private func openDashboard() async {
        do {
            let config = try await GatewayEndpointStore.shared.requireConfig()
            let wsURL = config.url
            guard var components = URLComponents(url: wsURL, resolvingAgainstBaseURL: false) else {
                throw NSError(domain: "Dashboard", code: 1, userInfo: [
                    NSLocalizedDescriptionKey: "Invalid gateway URL",
                ])
            }
            switch components.scheme?.lowercased() {
            case "ws":
                components.scheme = "http"
            case "wss":
                components.scheme = "https"
            default:
                components.scheme = "http"
            }
            components.path = "/"
            components.query = nil
            guard let url = components.url else {
                throw NSError(domain: "Dashboard", code: 2, userInfo: [
                    NSLocalizedDescriptionKey: "Failed to build dashboard URL",
                ])
            }
            NSWorkspace.shared.open(url)
        } catch {
            let alert = NSAlert()
            alert.messageText = "Dashboard unavailable"
            alert.informativeText = error.localizedDescription
            alert.runModal()
        }
    }

    private var healthStatus: (label: String, color: Color) {
        if let activity = self.activityStore.current {
            let color: Color = activity.role == .main ? .accentColor : .gray
            let roleLabel = activity.role == .main ? "Main" : "Other"
            let text = "\(roleLabel) · \(activity.label)"
            return (text, color)
        }

        let health = self.healthStore.state
        let isRefreshing = self.healthStore.isRefreshing
        let lastAge = self.healthStore.lastSuccess.map { age(from: $0) }

        if isRefreshing {
            return ("Health check running…", health.tint)
        }

        switch health {
        case .ok:
            let ageText = lastAge.map { " · checked \($0)" } ?? ""
            return ("Health ok\(ageText)", .green)
        case .linkingNeeded:
            return ("Health: login required", .red)
        case let .degraded(reason):
            let detail = HealthStore.shared.degradedSummary ?? reason
            let ageText = lastAge.map { " · checked \($0)" } ?? ""
            return ("\(detail)\(ageText)", .orange)
        case .unknown:
            return ("Health pending", .secondary)
        }
    }

    private var heartbeatStatus: (label: String, color: Color) {
        if case .degraded = self.controlChannel.state {
            return ("Control channel disconnected", .red)
        } else if let evt = self.heartbeatStore.lastEvent {
            let ageText = age(from: Date(timeIntervalSince1970: evt.ts / 1000))
            switch evt.status {
            case "sent":
                return ("Last heartbeat sent · \(ageText)", .blue)
            case "ok-empty", "ok-token":
                return ("Heartbeat ok · \(ageText)", .green)
            case "skipped":
                return ("Heartbeat skipped · \(ageText)", .secondary)
            case "failed":
                return ("Heartbeat failed · \(ageText)", .red)
            default:
                return ("Heartbeat · \(ageText)", .secondary)
            }
        } else {
            return ("No heartbeat yet", .secondary)
        }
    }

    @ViewBuilder
    private func statusLine(label: String, color: Color) -> some View {
        HStack(spacing: 6) {
            Circle()
                .fill(color)
                .frame(width: 6, height: 6)
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.top, 2)
    }

    private var activeBinding: Binding<Bool> {
        Binding(get: { !self.state.isPaused }, set: { self.state.isPaused = !$0 })
    }

    private var heartbeatsBinding: Binding<Bool> {
        Binding(get: { self.state.heartbeatsEnabled }, set: { self.state.heartbeatsEnabled = $0 })
    }

    private var voiceWakeBinding: Binding<Bool> {
        Binding(
            get: { self.state.swabbleEnabled },
            set: { newValue in
                Task { await self.state.setVoiceWakeEnabled(newValue) }
            })
    }

    private var showVoiceWakeMicPicker: Bool {
        voiceWakeSupported && self.state.swabbleEnabled
    }

    private var voiceWakeMicMenu: some View {
        Menu {
            self.microphoneMenuItems

            if self.loadingMics {
                Divider()
                Label("Refreshing microphones…", systemImage: "arrow.triangle.2.circlepath")
                    .labelStyle(.titleOnly)
                    .foregroundStyle(.secondary)
                    .disabled(true)
            }
        } label: {
            HStack {
                Text("Microphone")
                Spacer()
                Text(self.selectedMicLabel)
                    .foregroundStyle(.secondary)
            }
        }
        .task { await self.loadMicrophones() }
    }

    private var selectedMicLabel: String {
        if self.state.voiceWakeMicID.isEmpty { return self.defaultMicLabel }
        if let match = self.availableMics.first(where: { $0.uid == self.state.voiceWakeMicID }) {
            return match.name
        }
        return "Unavailable"
    }

    private var microphoneMenuItems: some View {
        Group {
            Button {
                self.state.voiceWakeMicID = ""
            } label: {
                Label(self.defaultMicLabel, systemImage: self.state.voiceWakeMicID.isEmpty ? "checkmark" : "")
                    .labelStyle(.titleAndIcon)
            }
            .buttonStyle(.plain)

            ForEach(self.availableMics) { mic in
                Button {
                    self.state.voiceWakeMicID = mic.uid
                } label: {
                    Label(mic.name, systemImage: self.state.voiceWakeMicID == mic.uid ? "checkmark" : "")
                        .labelStyle(.titleAndIcon)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var defaultMicLabel: String {
        if let host = Host.current().localizedName, !host.isEmpty {
            return "Auto-detect (\(host))"
        }
        return "System default"
    }

    @MainActor
    private func loadMicrophones(force: Bool = false) async {
        guard self.showVoiceWakeMicPicker else {
            self.availableMics = []
            self.loadingMics = false
            return
        }
        if !force, !self.availableMics.isEmpty { return }
        self.loadingMics = true
        let discovery = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.external, .microphone],
            mediaType: .audio,
            position: .unspecified)
        self.availableMics = discovery.devices
            .sorted { lhs, rhs in
                lhs.localizedName.localizedCaseInsensitiveCompare(rhs.localizedName) == .orderedAscending
            }
            .map { AudioInputDevice(uid: $0.uniqueID, name: $0.localizedName) }
        self.loadingMics = false
    }

    private struct AudioInputDevice: Identifiable, Equatable {
        let uid: String
        let name: String
        var id: String { self.uid }
    }
}
