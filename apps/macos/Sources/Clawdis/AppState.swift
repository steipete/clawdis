import AppKit
import Foundation
import Observation
import ServiceManagement
import SwiftUI

@MainActor
@Observable
final class AppState {
    private let isPreview: Bool
    private var suppressVoiceWakeGlobalSync = false
    private var voiceWakeGlobalSyncTask: Task<Void, Never>?

    private func ifNotPreview(_ action: () -> Void) {
        guard !self.isPreview else { return }
        action()
    }

    enum ConnectionMode: String {
        case unconfigured
        case local
        case remote
    }

    var isPaused: Bool {
        didSet { self.ifNotPreview { UserDefaults.standard.set(self.isPaused, forKey: pauseDefaultsKey) } }
    }

    var launchAtLogin: Bool {
        didSet { self.ifNotPreview { Task { AppStateStore.updateLaunchAtLogin(enabled: self.launchAtLogin) } } }
    }

    var onboardingSeen: Bool {
        didSet { self.ifNotPreview { UserDefaults.standard.set(self.onboardingSeen, forKey: "clawdis.onboardingSeen") }
        }
    }

    var debugPaneEnabled: Bool {
        didSet {
            self.ifNotPreview { UserDefaults.standard.set(self.debugPaneEnabled, forKey: "clawdis.debugPaneEnabled") }
            CanvasManager.shared.refreshDebugStatus()
        }
    }

    var swabbleEnabled: Bool {
        didSet {
            self.ifNotPreview {
                UserDefaults.standard.set(self.swabbleEnabled, forKey: swabbleEnabledKey)
                Task { await VoiceWakeRuntime.shared.refresh(state: self) }
            }
        }
    }

    var swabbleTriggerWords: [String] {
        didSet {
            // Preserve the raw editing state; sanitization happens when we actually use the triggers.
            self.ifNotPreview {
                UserDefaults.standard.set(self.swabbleTriggerWords, forKey: swabbleTriggersKey)
                if self.swabbleEnabled {
                    Task { await VoiceWakeRuntime.shared.refresh(state: self) }
                }
                self.scheduleVoiceWakeGlobalSyncIfNeeded()
            }
        }
    }

    var voiceWakeTriggerChime: VoiceWakeChime {
        didSet { self.ifNotPreview { self.storeChime(self.voiceWakeTriggerChime, key: voiceWakeTriggerChimeKey) } }
    }

    var voiceWakeSendChime: VoiceWakeChime {
        didSet { self.ifNotPreview { self.storeChime(self.voiceWakeSendChime, key: voiceWakeSendChimeKey) } }
    }

    var iconAnimationsEnabled: Bool {
        didSet { self.ifNotPreview { UserDefaults.standard.set(
            self.iconAnimationsEnabled,
            forKey: iconAnimationsEnabledKey) } }
    }

    var showDockIcon: Bool {
        didSet {
            self.ifNotPreview {
                UserDefaults.standard.set(self.showDockIcon, forKey: showDockIconKey)
                AppActivationPolicy.apply(showDockIcon: self.showDockIcon)
            }
        }
    }

    var voiceWakeMicID: String {
        didSet {
            self.ifNotPreview {
                UserDefaults.standard.set(self.voiceWakeMicID, forKey: voiceWakeMicKey)
                if self.swabbleEnabled {
                    Task { await VoiceWakeRuntime.shared.refresh(state: self) }
                }
            }
        }
    }

    var voiceWakeLocaleID: String {
        didSet {
            self.ifNotPreview {
                UserDefaults.standard.set(self.voiceWakeLocaleID, forKey: voiceWakeLocaleKey)
                if self.swabbleEnabled {
                    Task { await VoiceWakeRuntime.shared.refresh(state: self) }
                }
            }
        }
    }

    var voiceWakeAdditionalLocaleIDs: [String] {
        didSet { self.ifNotPreview { UserDefaults.standard.set(
            self.voiceWakeAdditionalLocaleIDs,
            forKey: voiceWakeAdditionalLocalesKey) } }
    }

    var voicePushToTalkEnabled: Bool {
        didSet { self.ifNotPreview { UserDefaults.standard.set(
            self.voicePushToTalkEnabled,
            forKey: voicePushToTalkEnabledKey) } }
    }

    var talkEnabled: Bool {
        didSet {
            self.ifNotPreview {
                UserDefaults.standard.set(self.talkEnabled, forKey: talkEnabledKey)
                Task { await TalkModeController.shared.setEnabled(self.talkEnabled) }
            }
        }
    }

    /// Gateway-provided UI accent color (hex). Optional; clients provide a default.
    var seamColorHex: String?

    var iconOverride: IconOverrideSelection {
        didSet { self.ifNotPreview { UserDefaults.standard.set(self.iconOverride.rawValue, forKey: iconOverrideKey) } }
    }

    var isWorking: Bool = false
    var earBoostActive: Bool = false
    var blinkTick: Int = 0
    var sendCelebrationTick: Int = 0
    var heartbeatsEnabled: Bool {
        didSet {
            self.ifNotPreview {
                UserDefaults.standard.set(self.heartbeatsEnabled, forKey: heartbeatsEnabledKey)
                Task { _ = await GatewayConnection.shared.setHeartbeatsEnabled(self.heartbeatsEnabled) }
            }
        }
    }

    var connectionMode: ConnectionMode {
        didSet {
            self.ifNotPreview { UserDefaults.standard.set(self.connectionMode.rawValue, forKey: connectionModeKey) }
        }
    }

    var canvasEnabled: Bool {
        didSet { self.ifNotPreview { UserDefaults.standard.set(self.canvasEnabled, forKey: canvasEnabledKey) } }
    }

    /// Tracks whether the Canvas panel is currently visible (not persisted).
    var canvasPanelVisible: Bool = false

    var peekabooBridgeEnabled: Bool {
        didSet {
            self.ifNotPreview {
                UserDefaults.standard.set(self.peekabooBridgeEnabled, forKey: peekabooBridgeEnabledKey)
                Task { await PeekabooBridgeHostCoordinator.shared.setEnabled(self.peekabooBridgeEnabled) }
            }
        }
    }

    var attachExistingGatewayOnly: Bool {
        didSet {
            self.ifNotPreview {
                UserDefaults.standard.set(self.attachExistingGatewayOnly, forKey: attachExistingGatewayOnlyKey)
            }
        }
    }

    var remoteTarget: String {
        didSet { self.ifNotPreview { UserDefaults.standard.set(self.remoteTarget, forKey: remoteTargetKey) } }
    }

    var remoteIdentity: String {
        didSet { self.ifNotPreview { UserDefaults.standard.set(self.remoteIdentity, forKey: remoteIdentityKey) } }
    }

    var remoteProjectRoot: String {
        didSet { self.ifNotPreview { UserDefaults.standard.set(self.remoteProjectRoot, forKey: remoteProjectRootKey) } }
    }

    var remoteCliPath: String {
        didSet { self.ifNotPreview { UserDefaults.standard.set(self.remoteCliPath, forKey: remoteCliPathKey) } }
    }

    private var earBoostTask: Task<Void, Never>?

    init(preview: Bool = false) {
        self.isPreview = preview
        let onboardingSeen = UserDefaults.standard.bool(forKey: "clawdis.onboardingSeen")
        self.isPaused = UserDefaults.standard.bool(forKey: pauseDefaultsKey)
        self.launchAtLogin = false
        self.onboardingSeen = onboardingSeen
        self.debugPaneEnabled = UserDefaults.standard.bool(forKey: "clawdis.debugPaneEnabled")
        let savedVoiceWake = UserDefaults.standard.bool(forKey: swabbleEnabledKey)
        self.swabbleEnabled = voiceWakeSupported ? savedVoiceWake : false
        self.swabbleTriggerWords = UserDefaults.standard
            .stringArray(forKey: swabbleTriggersKey) ?? defaultVoiceWakeTriggers
        self.voiceWakeTriggerChime = Self.loadChime(
            key: voiceWakeTriggerChimeKey,
            fallback: .system(name: "Glass"))
        self.voiceWakeSendChime = Self.loadChime(
            key: voiceWakeSendChimeKey,
            fallback: .system(name: "Glass"))
        if let storedIconAnimations = UserDefaults.standard.object(forKey: iconAnimationsEnabledKey) as? Bool {
            self.iconAnimationsEnabled = storedIconAnimations
        } else {
            self.iconAnimationsEnabled = true
            UserDefaults.standard.set(true, forKey: iconAnimationsEnabledKey)
        }
        self.showDockIcon = UserDefaults.standard.bool(forKey: showDockIconKey)
        self.voiceWakeMicID = UserDefaults.standard.string(forKey: voiceWakeMicKey) ?? ""
        self.voiceWakeLocaleID = UserDefaults.standard.string(forKey: voiceWakeLocaleKey) ?? Locale.current.identifier
        self.voiceWakeAdditionalLocaleIDs = UserDefaults.standard
            .stringArray(forKey: voiceWakeAdditionalLocalesKey) ?? []
        self.voicePushToTalkEnabled = UserDefaults.standard
            .object(forKey: voicePushToTalkEnabledKey) as? Bool ?? false
        self.talkEnabled = UserDefaults.standard.bool(forKey: talkEnabledKey)
        self.seamColorHex = nil
        if let storedHeartbeats = UserDefaults.standard.object(forKey: heartbeatsEnabledKey) as? Bool {
            self.heartbeatsEnabled = storedHeartbeats
        } else {
            self.heartbeatsEnabled = true
            UserDefaults.standard.set(true, forKey: heartbeatsEnabledKey)
        }
        if let storedOverride = UserDefaults.standard.string(forKey: iconOverrideKey),
           let selection = IconOverrideSelection(rawValue: storedOverride)
        {
            self.iconOverride = selection
        } else {
            self.iconOverride = .system
            UserDefaults.standard.set(IconOverrideSelection.system.rawValue, forKey: iconOverrideKey)
        }

        let storedMode = UserDefaults.standard.string(forKey: connectionModeKey)
        if let storedMode {
            self.connectionMode = ConnectionMode(rawValue: storedMode) ?? .local
        } else {
            self.connectionMode = onboardingSeen ? .local : .unconfigured
        }
        self.remoteTarget = UserDefaults.standard.string(forKey: remoteTargetKey) ?? ""
        self.remoteIdentity = UserDefaults.standard.string(forKey: remoteIdentityKey) ?? ""
        self.remoteProjectRoot = UserDefaults.standard.string(forKey: remoteProjectRootKey) ?? ""
        self.remoteCliPath = UserDefaults.standard.string(forKey: remoteCliPathKey) ?? ""
        self.canvasEnabled = UserDefaults.standard.object(forKey: canvasEnabledKey) as? Bool ?? true
        self.peekabooBridgeEnabled = UserDefaults.standard
            .object(forKey: peekabooBridgeEnabledKey) as? Bool ?? true
        self.attachExistingGatewayOnly = UserDefaults.standard.bool(forKey: attachExistingGatewayOnlyKey)

        if !self.isPreview {
            Task.detached(priority: .utility) { [weak self] in
                let current = await LaunchAgentManager.status()
                await MainActor.run { [weak self] in self?.launchAtLogin = current }
            }
        }

        if self.swabbleEnabled, !PermissionManager.voiceWakePermissionsGranted() {
            self.swabbleEnabled = false
        }
        if self.talkEnabled, !PermissionManager.voiceWakePermissionsGranted() {
            self.talkEnabled = false
        }

        if !self.isPreview {
            Task { await VoiceWakeRuntime.shared.refresh(state: self) }
            Task { await TalkModeController.shared.setEnabled(self.talkEnabled) }
        }
    }

    func triggerVoiceEars(ttl: TimeInterval? = 5) {
        self.earBoostTask?.cancel()
        self.earBoostActive = true

        guard let ttl else { return }

        self.earBoostTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(ttl * 1_000_000_000))
            await MainActor.run { [weak self] in self?.earBoostActive = false }
        }
    }

    func stopVoiceEars() {
        self.earBoostTask?.cancel()
        self.earBoostTask = nil
        self.earBoostActive = false
    }

    func blinkOnce() {
        self.blinkTick &+= 1
    }

    func celebrateSend() {
        self.sendCelebrationTick &+= 1
    }

    func setVoiceWakeEnabled(_ enabled: Bool) async {
        guard voiceWakeSupported else {
            self.swabbleEnabled = false
            return
        }

        self.swabbleEnabled = enabled
        guard !self.isPreview else { return }

        if !enabled {
            Task { await VoiceWakeRuntime.shared.refresh(state: self) }
            return
        }

        if PermissionManager.voiceWakePermissionsGranted() {
            Task { await VoiceWakeRuntime.shared.refresh(state: self) }
            return
        }

        let granted = await PermissionManager.ensureVoiceWakePermissions(interactive: true)
        self.swabbleEnabled = granted
        Task { await VoiceWakeRuntime.shared.refresh(state: self) }
    }

    func setTalkEnabled(_ enabled: Bool) async {
        guard voiceWakeSupported else {
            self.talkEnabled = false
            await GatewayConnection.shared.talkMode(enabled: false, phase: "disabled")
            return
        }

        self.talkEnabled = enabled
        guard !self.isPreview else { return }

        if !enabled {
            await GatewayConnection.shared.talkMode(enabled: false, phase: "disabled")
            return
        }

        if PermissionManager.voiceWakePermissionsGranted() {
            await GatewayConnection.shared.talkMode(enabled: true, phase: "enabled")
            return
        }

        let granted = await PermissionManager.ensureVoiceWakePermissions(interactive: true)
        self.talkEnabled = granted
        await GatewayConnection.shared.talkMode(enabled: granted, phase: granted ? "enabled" : "denied")
    }

    // MARK: - Global wake words sync (Gateway-owned)

    func applyGlobalVoiceWakeTriggers(_ triggers: [String]) {
        self.suppressVoiceWakeGlobalSync = true
        self.swabbleTriggerWords = triggers
        self.suppressVoiceWakeGlobalSync = false
    }

    private func scheduleVoiceWakeGlobalSyncIfNeeded() {
        guard !self.suppressVoiceWakeGlobalSync else { return }
        let sanitized = sanitizeVoiceWakeTriggers(self.swabbleTriggerWords)
        self.voiceWakeGlobalSyncTask?.cancel()
        self.voiceWakeGlobalSyncTask = Task { [sanitized] in
            try? await Task.sleep(nanoseconds: 650_000_000)
            await GatewayConnection.shared.voiceWakeSetTriggers(sanitized)
        }
    }

    func setWorking(_ working: Bool) {
        self.isWorking = working
    }

    // MARK: - Chime persistence

    private static func loadChime(key: String, fallback: VoiceWakeChime) -> VoiceWakeChime {
        guard let data = UserDefaults.standard.data(forKey: key) else { return fallback }
        if let decoded = try? JSONDecoder().decode(VoiceWakeChime.self, from: data) {
            return decoded
        }
        return fallback
    }

    private func storeChime(_ chime: VoiceWakeChime, key: String) {
        guard let data = try? JSONEncoder().encode(chime) else { return }
        UserDefaults.standard.set(data, forKey: key)
    }
}

extension AppState {
    static var preview: AppState {
        let state = AppState(preview: true)
        state.isPaused = false
        state.launchAtLogin = true
        state.onboardingSeen = true
        state.debugPaneEnabled = true
        state.swabbleEnabled = true
        state.swabbleTriggerWords = ["Claude", "Computer", "Jarvis"]
        state.voiceWakeTriggerChime = .system(name: "Glass")
        state.voiceWakeSendChime = .system(name: "Ping")
        state.iconAnimationsEnabled = true
        state.showDockIcon = true
        state.voiceWakeMicID = "BuiltInMic"
        state.voiceWakeLocaleID = Locale.current.identifier
        state.voiceWakeAdditionalLocaleIDs = ["en-US", "de-DE"]
        state.voicePushToTalkEnabled = false
        state.talkEnabled = false
        state.iconOverride = .system
        state.heartbeatsEnabled = true
        state.connectionMode = .local
        state.canvasEnabled = true
        state.remoteTarget = "user@example.com"
        state.remoteIdentity = "~/.ssh/id_ed25519"
        state.remoteProjectRoot = "~/Projects/clawdis"
        state.remoteCliPath = ""
        state.attachExistingGatewayOnly = false
        return state
    }
}

@MainActor
enum AppStateStore {
    static let shared = AppState()
    static var isPausedFlag: Bool { UserDefaults.standard.bool(forKey: pauseDefaultsKey) }

    static func updateLaunchAtLogin(enabled: Bool) {
        Task.detached(priority: .utility) {
            await LaunchAgentManager.set(enabled: enabled, bundlePath: Bundle.main.bundlePath)
        }
    }

    static var canvasEnabled: Bool {
        UserDefaults.standard.object(forKey: canvasEnabledKey) as? Bool ?? true
    }

    static var attachExistingGatewayOnly: Bool {
        UserDefaults.standard.bool(forKey: attachExistingGatewayOnlyKey)
    }
}

@MainActor
enum AppActivationPolicy {
    static func apply(showDockIcon: Bool) {
        _ = showDockIcon
        DockIconManager.shared.updateDockVisibility()
    }
}
