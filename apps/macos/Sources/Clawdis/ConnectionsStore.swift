import ClawdisProtocol
import Foundation
import Observation

struct ProvidersStatusSnapshot: Codable {
    struct WhatsAppSelf: Codable {
        let e164: String?
        let jid: String?
    }

    struct WhatsAppDisconnect: Codable {
        let at: Double
        let status: Int?
        let error: String?
        let loggedOut: Bool?
    }

    struct WhatsAppStatus: Codable {
        let configured: Bool
        let linked: Bool
        let authAgeMs: Double?
        let `self`: WhatsAppSelf?
        let running: Bool
        let connected: Bool
        let lastConnectedAt: Double?
        let lastDisconnect: WhatsAppDisconnect?
        let reconnectAttempts: Int
        let lastMessageAt: Double?
        let lastEventAt: Double?
        let lastError: String?
    }

    struct TelegramBot: Codable {
        let id: Int?
        let username: String?
    }

    struct TelegramWebhook: Codable {
        let url: String?
        let hasCustomCert: Bool?
    }

    struct TelegramProbe: Codable {
        let ok: Bool
        let status: Int?
        let error: String?
        let elapsedMs: Double?
        let bot: TelegramBot?
        let webhook: TelegramWebhook?
    }

    struct TelegramStatus: Codable {
        let configured: Bool
        let tokenSource: String?
        let running: Bool
        let mode: String?
        let lastStartAt: Double?
        let lastStopAt: Double?
        let lastError: String?
        let probe: TelegramProbe?
        let lastProbeAt: Double?
    }

    struct DiscordBot: Codable {
        let id: String?
        let username: String?
    }

    struct DiscordProbe: Codable {
        let ok: Bool
        let status: Int?
        let error: String?
        let elapsedMs: Double?
        let bot: DiscordBot?
    }

    struct DiscordStatus: Codable {
        let configured: Bool
        let tokenSource: String?
        let running: Bool
        let lastStartAt: Double?
        let lastStopAt: Double?
        let lastError: String?
        let probe: DiscordProbe?
        let lastProbeAt: Double?
    }

    struct SignalProbe: Codable {
        let ok: Bool
        let status: Int?
        let error: String?
        let elapsedMs: Double?
        let version: String?
    }

    struct SignalStatus: Codable {
        let configured: Bool
        let baseUrl: String
        let running: Bool
        let lastStartAt: Double?
        let lastStopAt: Double?
        let lastError: String?
        let probe: SignalProbe?
        let lastProbeAt: Double?
    }

    struct IMessageProbe: Codable {
        let ok: Bool
        let error: String?
    }

    struct IMessageStatus: Codable {
        let configured: Bool
        let running: Bool
        let lastStartAt: Double?
        let lastStopAt: Double?
        let lastError: String?
        let cliPath: String?
        let dbPath: String?
        let probe: IMessageProbe?
        let lastProbeAt: Double?
    }

    let ts: Double
    let whatsapp: WhatsAppStatus
    let telegram: TelegramStatus
    let discord: DiscordStatus?
    let signal: SignalStatus?
    let imessage: IMessageStatus?
}

struct ConfigSnapshot: Codable {
    struct Issue: Codable {
        let path: String
        let message: String
    }

    let path: String?
    let exists: Bool?
    let raw: String?
    let parsed: AnyCodable?
    let valid: Bool?
    let config: [String: AnyCodable]?
    let issues: [Issue]?
}

struct DiscordGuildChannelForm: Identifiable {
    let id = UUID()
    var key: String
    var allow: Bool
    var requireMention: Bool

    init(key: String = "", allow: Bool = true, requireMention: Bool = false) {
        self.key = key
        self.allow = allow
        self.requireMention = requireMention
    }
}

struct DiscordGuildForm: Identifiable {
    let id = UUID()
    var key: String
    var slug: String
    var requireMention: Bool
    var reactionNotifications: String
    var users: String
    var channels: [DiscordGuildChannelForm]

    init(
        key: String = "",
        slug: String = "",
        requireMention: Bool = false,
        reactionNotifications: String = "allowlist",
        users: String = "",
        channels: [DiscordGuildChannelForm] = []
    ) {
        self.key = key
        self.slug = slug
        self.requireMention = requireMention
        self.reactionNotifications = reactionNotifications
        self.users = users
        self.channels = channels
    }
}

@MainActor
@Observable
final class ConnectionsStore {
    static let shared = ConnectionsStore()

    var snapshot: ProvidersStatusSnapshot?
    var lastError: String?
    var lastSuccess: Date?
    var isRefreshing = false

    var whatsappLoginMessage: String?
    var whatsappLoginQrDataUrl: String?
    var whatsappLoginConnected: Bool?
    var whatsappBusy = false

    var telegramToken: String = ""
    var telegramRequireMention = true
    var telegramAllowFrom: String = ""
    var telegramProxy: String = ""
    var telegramWebhookUrl: String = ""
    var telegramWebhookSecret: String = ""
    var telegramWebhookPath: String = ""
    var telegramBusy = false
    var discordEnabled = true
    var discordToken: String = ""
    var discordDmEnabled = true
    var discordAllowFrom: String = ""
    var discordGroupEnabled = false
    var discordGroupChannels: String = ""
    var discordMediaMaxMb: String = ""
    var discordHistoryLimit: String = ""
    var discordTextChunkLimit: String = ""
    var discordReplyToMode: String = "off"
    var discordGuilds: [DiscordGuildForm] = []
    var discordActionReactions = true
    var discordActionStickers = true
    var discordActionPolls = true
    var discordActionPermissions = true
    var discordActionMessages = true
    var discordActionThreads = true
    var discordActionPins = true
    var discordActionSearch = true
    var discordActionMemberInfo = true
    var discordActionRoleInfo = true
    var discordActionChannelInfo = true
    var discordActionVoiceStatus = true
    var discordActionEvents = true
    var discordActionRoles = false
    var discordActionModeration = false
    var discordSlashEnabled = false
    var discordSlashName: String = ""
    var discordSlashSessionPrefix: String = ""
    var discordSlashEphemeral = true
    var signalEnabled = true
    var signalAccount: String = ""
    var signalHttpUrl: String = ""
    var signalHttpHost: String = ""
    var signalHttpPort: String = ""
    var signalCliPath: String = ""
    var signalAutoStart = true
    var signalReceiveMode: String = ""
    var signalIgnoreAttachments = false
    var signalIgnoreStories = false
    var signalSendReadReceipts = false
    var signalAllowFrom: String = ""
    var signalMediaMaxMb: String = ""
    var imessageEnabled = true
    var imessageCliPath: String = ""
    var imessageDbPath: String = ""
    var imessageService: String = "auto"
    var imessageRegion: String = ""
    var imessageAllowFrom: String = ""
    var imessageIncludeAttachments = false
    var imessageMediaMaxMb: String = ""
    var configStatus: String?
    var isSavingConfig = false

    private let interval: TimeInterval = 45
    private let isPreview: Bool
    private var pollTask: Task<Void, Never>?
    private var configRoot: [String: Any] = [:]
    private var configLoaded = false

    init(isPreview: Bool = ProcessInfo.processInfo.isPreview) {
        self.isPreview = isPreview
    }

    func start() {
        guard !self.isPreview else { return }
        guard self.pollTask == nil else { return }
        self.pollTask = Task.detached { [weak self] in
            guard let self else { return }
            await self.refresh(probe: true)
            await self.loadConfig()
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(self.interval * 1_000_000_000))
                await self.refresh(probe: false)
            }
        }
    }

    func stop() {
        self.pollTask?.cancel()
        self.pollTask = nil
    }

    func refresh(probe: Bool) async {
        guard !self.isRefreshing else { return }
        self.isRefreshing = true
        defer { self.isRefreshing = false }

        do {
            let params: [String: AnyCodable] = [
                "probe": AnyCodable(probe),
                "timeoutMs": AnyCodable(8000),
            ]
            let snap: ProvidersStatusSnapshot = try await GatewayConnection.shared.requestDecoded(
                method: .providersStatus,
                params: params,
                timeoutMs: 12000)
            self.snapshot = snap
            self.lastSuccess = Date()
            self.lastError = nil
        } catch {
            self.lastError = error.localizedDescription
        }
    }

    func startWhatsAppLogin(force: Bool, autoWait: Bool = true) async {
        guard !self.whatsappBusy else { return }
        self.whatsappBusy = true
        defer { self.whatsappBusy = false }
        var shouldAutoWait = false
        do {
            let params: [String: AnyCodable] = [
                "force": AnyCodable(force),
                "timeoutMs": AnyCodable(30000),
            ]
            let result: WhatsAppLoginStartResult = try await GatewayConnection.shared.requestDecoded(
                method: .webLoginStart,
                params: params,
                timeoutMs: 35000)
            self.whatsappLoginMessage = result.message
            self.whatsappLoginQrDataUrl = result.qrDataUrl
            self.whatsappLoginConnected = nil
            shouldAutoWait = autoWait && result.qrDataUrl != nil
        } catch {
            self.whatsappLoginMessage = error.localizedDescription
            self.whatsappLoginQrDataUrl = nil
            self.whatsappLoginConnected = nil
        }
        await self.refresh(probe: true)
        if shouldAutoWait {
            Task { await self.waitWhatsAppLogin() }
        }
    }

    func waitWhatsAppLogin(timeoutMs: Int = 120_000) async {
        guard !self.whatsappBusy else { return }
        self.whatsappBusy = true
        defer { self.whatsappBusy = false }
        do {
            let params: [String: AnyCodable] = [
                "timeoutMs": AnyCodable(timeoutMs),
            ]
            let result: WhatsAppLoginWaitResult = try await GatewayConnection.shared.requestDecoded(
                method: .webLoginWait,
                params: params,
                timeoutMs: Double(timeoutMs) + 5000)
            self.whatsappLoginMessage = result.message
            self.whatsappLoginConnected = result.connected
            if result.connected {
                self.whatsappLoginQrDataUrl = nil
            }
        } catch {
            self.whatsappLoginMessage = error.localizedDescription
        }
        await self.refresh(probe: true)
    }

    func logoutWhatsApp() async {
        guard !self.whatsappBusy else { return }
        self.whatsappBusy = true
        defer { self.whatsappBusy = false }
        do {
            let result: WhatsAppLogoutResult = try await GatewayConnection.shared.requestDecoded(
                method: .webLogout,
                params: nil,
                timeoutMs: 15000)
            self.whatsappLoginMessage = result.cleared
                ? "Logged out and cleared credentials."
                : "No WhatsApp session found."
            self.whatsappLoginQrDataUrl = nil
        } catch {
            self.whatsappLoginMessage = error.localizedDescription
        }
        await self.refresh(probe: true)
    }

    func logoutTelegram() async {
        guard !self.telegramBusy else { return }
        self.telegramBusy = true
        defer { self.telegramBusy = false }
        do {
            let result: TelegramLogoutResult = try await GatewayConnection.shared.requestDecoded(
                method: .telegramLogout,
                params: nil,
                timeoutMs: 15000)
            if result.envToken == true {
                self.configStatus = "Telegram token still set via env; config cleared."
            } else {
                self.configStatus = result.cleared
                    ? "Telegram token cleared."
                    : "No Telegram token configured."
            }
            await self.loadConfig()
        } catch {
            self.configStatus = error.localizedDescription
        }
        await self.refresh(probe: true)
    }

    func loadConfig() async {
        do {
            let snap: ConfigSnapshot = try await GatewayConnection.shared.requestDecoded(
                method: .configGet,
                params: nil,
                timeoutMs: 10000)
            self.configStatus = snap.valid == false
                ? "Config invalid; fix it in ~/.clawdis/clawdis.json."
                : nil
            self.configRoot = snap.config?.mapValues { $0.foundationValue } ?? [:]
            self.configLoaded = true

            let ui = snap.config?["ui"]?.dictionaryValue
            let rawSeam = ui?["seamColor"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            AppStateStore.shared.seamColorHex = rawSeam.isEmpty ? nil : rawSeam

            let telegram = snap.config?["telegram"]?.dictionaryValue
            self.telegramToken = telegram?["botToken"]?.stringValue ?? ""
            self.telegramRequireMention = telegram?["requireMention"]?.boolValue ?? true
            if let allow = telegram?["allowFrom"]?.arrayValue {
                let strings = allow.compactMap { entry -> String? in
                    if let str = entry.stringValue { return str }
                    if let intVal = entry.intValue { return String(intVal) }
                    if let doubleVal = entry.doubleValue { return String(Int(doubleVal)) }
                    return nil
                }
                self.telegramAllowFrom = strings.joined(separator: ", ")
            } else {
                self.telegramAllowFrom = ""
            }
            self.telegramProxy = telegram?["proxy"]?.stringValue ?? ""
            self.telegramWebhookUrl = telegram?["webhookUrl"]?.stringValue ?? ""
            self.telegramWebhookSecret = telegram?["webhookSecret"]?.stringValue ?? ""
            self.telegramWebhookPath = telegram?["webhookPath"]?.stringValue ?? ""

            let discord = snap.config?["discord"]?.dictionaryValue
            self.discordEnabled = discord?["enabled"]?.boolValue ?? true
            self.discordToken = discord?["token"]?.stringValue ?? ""
            let discordDm = discord?["dm"]?.dictionaryValue
            self.discordDmEnabled = discordDm?["enabled"]?.boolValue ?? true
            if let allow = discordDm?["allowFrom"]?.arrayValue {
                let strings = allow.compactMap { entry -> String? in
                    if let str = entry.stringValue { return str }
                    if let intVal = entry.intValue { return String(intVal) }
                    if let doubleVal = entry.doubleValue { return String(Int(doubleVal)) }
                    return nil
                }
                self.discordAllowFrom = strings.joined(separator: ", ")
            } else {
                self.discordAllowFrom = ""
            }
            self.discordGroupEnabled = discordDm?["groupEnabled"]?.boolValue ?? false
            if let channels = discordDm?["groupChannels"]?.arrayValue {
                let strings = channels.compactMap { entry -> String? in
                    if let str = entry.stringValue { return str }
                    if let intVal = entry.intValue { return String(intVal) }
                    if let doubleVal = entry.doubleValue { return String(Int(doubleVal)) }
                    return nil
                }
                self.discordGroupChannels = strings.joined(separator: ", ")
            } else {
                self.discordGroupChannels = ""
            }
            if let media = discord?["mediaMaxMb"]?.doubleValue ?? discord?["mediaMaxMb"]?.intValue.map(Double.init) {
                self.discordMediaMaxMb = String(Int(media))
            } else {
                self.discordMediaMaxMb = ""
            }
            if let history = discord?["historyLimit"]?.doubleValue ?? discord?["historyLimit"]?.intValue.map(Double.init) {
                self.discordHistoryLimit = String(Int(history))
            } else {
                self.discordHistoryLimit = ""
            }
            if let limit = discord?["textChunkLimit"]?.doubleValue ?? discord?["textChunkLimit"]?.intValue.map(Double.init) {
                self.discordTextChunkLimit = String(Int(limit))
            } else {
                self.discordTextChunkLimit = ""
            }
            if let mode = discord?["replyToMode"]?.stringValue, ["off", "first", "all"].contains(mode) {
                self.discordReplyToMode = mode
            } else {
                self.discordReplyToMode = "off"
            }
            if let guilds = discord?["guilds"]?.dictionaryValue {
                self.discordGuilds = guilds
                    .map { key, value in
                        let entry = value.dictionaryValue ?? [:]
                        let slug = entry["slug"]?.stringValue ?? ""
                        let requireMention = entry["requireMention"]?.boolValue ?? false
                        let reactionModeRaw = entry["reactionNotifications"]?.stringValue ?? ""
                        let reactionNotifications = ["off", "own", "all", "allowlist"].contains(reactionModeRaw)
                            ? reactionModeRaw
                            : "allowlist"
                        let users = entry["users"]?.arrayValue?
                            .compactMap { item -> String? in
                                if let str = item.stringValue { return str }
                                if let intVal = item.intValue { return String(intVal) }
                                if let doubleVal = item.doubleValue { return String(Int(doubleVal)) }
                                return nil
                            }
                            .joined(separator: ", ") ?? ""
                        let channels: [DiscordGuildChannelForm]
                        if let channelMap = entry["channels"]?.dictionaryValue {
                            channels = channelMap.map { channelKey, channelValue in
                                let channelEntry = channelValue.dictionaryValue ?? [:]
                                let allow = channelEntry["allow"]?.boolValue ?? true
                                let channelRequireMention =
                                    channelEntry["requireMention"]?.boolValue ?? false
                                return DiscordGuildChannelForm(
                                    key: channelKey,
                                    allow: allow,
                                    requireMention: channelRequireMention)
                            }
                        } else {
                            channels = []
                        }
                        return DiscordGuildForm(
                            key: key,
                            slug: slug,
                            requireMention: requireMention,
                            reactionNotifications: reactionNotifications,
                            users: users,
                            channels: channels)
                    }
                    .sorted { $0.key < $1.key }
            } else {
                self.discordGuilds = []
            }
            let discordActions = discord?["actions"]?.dictionaryValue
            self.discordActionReactions = discordActions?["reactions"]?.boolValue ?? true
            self.discordActionStickers = discordActions?["stickers"]?.boolValue ?? true
            self.discordActionPolls = discordActions?["polls"]?.boolValue ?? true
            self.discordActionPermissions = discordActions?["permissions"]?.boolValue ?? true
            self.discordActionMessages = discordActions?["messages"]?.boolValue ?? true
            self.discordActionThreads = discordActions?["threads"]?.boolValue ?? true
            self.discordActionPins = discordActions?["pins"]?.boolValue ?? true
            self.discordActionSearch = discordActions?["search"]?.boolValue ?? true
            self.discordActionMemberInfo = discordActions?["memberInfo"]?.boolValue ?? true
            self.discordActionRoleInfo = discordActions?["roleInfo"]?.boolValue ?? true
            self.discordActionChannelInfo = discordActions?["channelInfo"]?.boolValue ?? true
            self.discordActionVoiceStatus = discordActions?["voiceStatus"]?.boolValue ?? true
            self.discordActionEvents = discordActions?["events"]?.boolValue ?? true
            self.discordActionRoles = discordActions?["roles"]?.boolValue ?? false
            self.discordActionModeration = discordActions?["moderation"]?.boolValue ?? false
            let slash = discord?["slashCommand"]?.dictionaryValue
            self.discordSlashEnabled = slash?["enabled"]?.boolValue ?? false
            self.discordSlashName = slash?["name"]?.stringValue ?? ""
            self.discordSlashSessionPrefix = slash?["sessionPrefix"]?.stringValue ?? ""
            self.discordSlashEphemeral = slash?["ephemeral"]?.boolValue ?? true

            let signal = snap.config?["signal"]?.dictionaryValue
            self.signalEnabled = signal?["enabled"]?.boolValue ?? true
            self.signalAccount = signal?["account"]?.stringValue ?? ""
            self.signalHttpUrl = signal?["httpUrl"]?.stringValue ?? ""
            self.signalHttpHost = signal?["httpHost"]?.stringValue ?? ""
            if let port = signal?["httpPort"]?.doubleValue ?? signal?["httpPort"]?.intValue.map(Double.init) {
                self.signalHttpPort = String(Int(port))
            } else {
                self.signalHttpPort = ""
            }
            self.signalCliPath = signal?["cliPath"]?.stringValue ?? ""
            self.signalAutoStart = signal?["autoStart"]?.boolValue ?? true
            self.signalReceiveMode = signal?["receiveMode"]?.stringValue ?? ""
            self.signalIgnoreAttachments = signal?["ignoreAttachments"]?.boolValue ?? false
            self.signalIgnoreStories = signal?["ignoreStories"]?.boolValue ?? false
            self.signalSendReadReceipts = signal?["sendReadReceipts"]?.boolValue ?? false
            if let allow = signal?["allowFrom"]?.arrayValue {
                let strings = allow.compactMap { entry -> String? in
                    if let str = entry.stringValue { return str }
                    if let intVal = entry.intValue { return String(intVal) }
                    if let doubleVal = entry.doubleValue { return String(Int(doubleVal)) }
                    return nil
                }
                self.signalAllowFrom = strings.joined(separator: ", ")
            } else {
                self.signalAllowFrom = ""
            }
            if let media = signal?["mediaMaxMb"]?.doubleValue ?? signal?["mediaMaxMb"]?.intValue.map(Double.init) {
                self.signalMediaMaxMb = String(Int(media))
            } else {
                self.signalMediaMaxMb = ""
            }

            let imessage = snap.config?["imessage"]?.dictionaryValue
            self.imessageEnabled = imessage?["enabled"]?.boolValue ?? true
            self.imessageCliPath = imessage?["cliPath"]?.stringValue ?? ""
            self.imessageDbPath = imessage?["dbPath"]?.stringValue ?? ""
            self.imessageService = imessage?["service"]?.stringValue ?? "auto"
            self.imessageRegion = imessage?["region"]?.stringValue ?? ""
            if let allow = imessage?["allowFrom"]?.arrayValue {
                let strings = allow.compactMap { entry -> String? in
                    if let str = entry.stringValue { return str }
                    if let intVal = entry.intValue { return String(intVal) }
                    if let doubleVal = entry.doubleValue { return String(Int(doubleVal)) }
                    return nil
                }
                self.imessageAllowFrom = strings.joined(separator: ", ")
            } else {
                self.imessageAllowFrom = ""
            }
            self.imessageIncludeAttachments = imessage?["includeAttachments"]?.boolValue ?? false
            if let media = imessage?["mediaMaxMb"]?.doubleValue ?? imessage?["mediaMaxMb"]?.intValue.map(Double.init) {
                self.imessageMediaMaxMb = String(Int(media))
            } else {
                self.imessageMediaMaxMb = ""
            }
        } catch {
            self.configStatus = error.localizedDescription
        }
    }

    func saveTelegramConfig() async {
        guard !self.isSavingConfig else { return }
        self.isSavingConfig = true
        defer { self.isSavingConfig = false }
        if !self.configLoaded {
            await self.loadConfig()
        }

        var telegram: [String: Any] = (self.configRoot["telegram"] as? [String: Any]) ?? [:]
        let token = self.telegramToken.trimmingCharacters(in: .whitespacesAndNewlines)
        if token.isEmpty {
            telegram.removeValue(forKey: "botToken")
        } else {
            telegram["botToken"] = token
        }

        if self.telegramRequireMention {
            telegram["requireMention"] = true
        } else {
            telegram["requireMention"] = false
        }

        let allow = self.telegramAllowFrom
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        if allow.isEmpty {
            telegram.removeValue(forKey: "allowFrom")
        } else {
            telegram["allowFrom"] = allow
        }

        let proxy = self.telegramProxy.trimmingCharacters(in: .whitespacesAndNewlines)
        if proxy.isEmpty {
            telegram.removeValue(forKey: "proxy")
        } else {
            telegram["proxy"] = proxy
        }

        let webhookUrl = self.telegramWebhookUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        if webhookUrl.isEmpty {
            telegram.removeValue(forKey: "webhookUrl")
        } else {
            telegram["webhookUrl"] = webhookUrl
        }

        let webhookSecret = self.telegramWebhookSecret.trimmingCharacters(in: .whitespacesAndNewlines)
        if webhookSecret.isEmpty {
            telegram.removeValue(forKey: "webhookSecret")
        } else {
            telegram["webhookSecret"] = webhookSecret
        }

        let webhookPath = self.telegramWebhookPath.trimmingCharacters(in: .whitespacesAndNewlines)
        if webhookPath.isEmpty {
            telegram.removeValue(forKey: "webhookPath")
        } else {
            telegram["webhookPath"] = webhookPath
        }

        if telegram.isEmpty {
            self.configRoot.removeValue(forKey: "telegram")
        } else {
            self.configRoot["telegram"] = telegram
        }

        do {
            let data = try JSONSerialization.data(
                withJSONObject: self.configRoot,
                options: [.prettyPrinted, .sortedKeys])
            guard let raw = String(data: data, encoding: .utf8) else {
                self.configStatus = "Failed to encode config."
                return
            }
            let params: [String: AnyCodable] = ["raw": AnyCodable(raw)]
            _ = try await GatewayConnection.shared.requestRaw(
                method: .configSet,
                params: params,
                timeoutMs: 10000)
            self.configStatus = "Saved to ~/.clawdis/clawdis.json."
            await self.refresh(probe: true)
        } catch {
            self.configStatus = error.localizedDescription
        }
    }

    func saveDiscordConfig() async {
        guard !self.isSavingConfig else { return }
        self.isSavingConfig = true
        defer { self.isSavingConfig = false }
        if !self.configLoaded {
            await self.loadConfig()
        }

        var discord: [String: Any] = (self.configRoot["discord"] as? [String: Any]) ?? [:]
        if self.discordEnabled {
            discord.removeValue(forKey: "enabled")
        } else {
            discord["enabled"] = false
        }
        let token = self.discordToken.trimmingCharacters(in: .whitespacesAndNewlines)
        if token.isEmpty {
            discord.removeValue(forKey: "token")
        } else {
            discord["token"] = token
        }

        var dm: [String: Any] = (discord["dm"] as? [String: Any]) ?? [:]
        if self.discordDmEnabled {
            dm.removeValue(forKey: "enabled")
        } else {
            dm["enabled"] = false
        }
        let allow = self.discordAllowFrom
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        if allow.isEmpty {
            dm.removeValue(forKey: "allowFrom")
        } else {
            dm["allowFrom"] = allow
        }

        if self.discordGroupEnabled {
            dm["groupEnabled"] = true
        } else {
            dm.removeValue(forKey: "groupEnabled")
        }

        let groupChannels = self.discordGroupChannels
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        if groupChannels.isEmpty {
            dm.removeValue(forKey: "groupChannels")
        } else {
            dm["groupChannels"] = groupChannels
        }

        if dm.isEmpty {
            discord.removeValue(forKey: "dm")
        } else {
            discord["dm"] = dm
        }

        let media = self.discordMediaMaxMb.trimmingCharacters(in: .whitespacesAndNewlines)
        if media.isEmpty {
            discord.removeValue(forKey: "mediaMaxMb")
        } else if let value = Double(media) {
            discord["mediaMaxMb"] = value
        }

        let history = self.discordHistoryLimit.trimmingCharacters(in: .whitespacesAndNewlines)
        if history.isEmpty {
            discord.removeValue(forKey: "historyLimit")
        } else if let value = Int(history), value >= 0 {
            discord["historyLimit"] = value
        } else {
            discord.removeValue(forKey: "historyLimit")
        }

        let chunkLimit = self.discordTextChunkLimit.trimmingCharacters(in: .whitespacesAndNewlines)
        if chunkLimit.isEmpty {
            discord.removeValue(forKey: "textChunkLimit")
        } else if let value = Int(chunkLimit), value > 0 {
            discord["textChunkLimit"] = value
        } else {
            discord.removeValue(forKey: "textChunkLimit")
        }

        let replyToMode = self.discordReplyToMode.trimmingCharacters(in: .whitespacesAndNewlines)
        if replyToMode.isEmpty || replyToMode == "off" {
            discord.removeValue(forKey: "replyToMode")
        } else if ["first", "all"].contains(replyToMode) {
            discord["replyToMode"] = replyToMode
        } else {
            discord.removeValue(forKey: "replyToMode")
        }

        let guilds: [String: Any] = self.discordGuilds.reduce(into: [:]) { result, entry in
            let key = entry.key.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !key.isEmpty else { return }
            var payload: [String: Any] = [:]
            let slug = entry.slug.trimmingCharacters(in: .whitespacesAndNewlines)
            if !slug.isEmpty { payload["slug"] = slug }
            if entry.requireMention { payload["requireMention"] = true }
            if ["off", "own", "all", "allowlist"].contains(entry.reactionNotifications) {
                payload["reactionNotifications"] = entry.reactionNotifications
            }
            let users = entry.users
                .split(separator: ",")
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
            if !users.isEmpty { payload["users"] = users }
            let channels: [String: Any] = entry.channels.reduce(into: [:]) { channelsResult, channel in
                let channelKey = channel.key.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !channelKey.isEmpty else { return }
                var channelPayload: [String: Any] = [:]
                if !channel.allow { channelPayload["allow"] = false }
                if channel.requireMention { channelPayload["requireMention"] = true }
                channelsResult[channelKey] = channelPayload
            }
            if !channels.isEmpty { payload["channels"] = channels }
            result[key] = payload
        }
        if guilds.isEmpty {
            discord.removeValue(forKey: "guilds")
        } else {
            discord["guilds"] = guilds
        }

        var actions: [String: Any] = (discord["actions"] as? [String: Any]) ?? [:]
        func setAction(_ key: String, value: Bool, defaultValue: Bool) {
            if value == defaultValue {
                actions.removeValue(forKey: key)
            } else {
                actions[key] = value
            }
        }
        setAction("reactions", value: self.discordActionReactions, defaultValue: true)
        setAction("stickers", value: self.discordActionStickers, defaultValue: true)
        setAction("polls", value: self.discordActionPolls, defaultValue: true)
        setAction("permissions", value: self.discordActionPermissions, defaultValue: true)
        setAction("messages", value: self.discordActionMessages, defaultValue: true)
        setAction("threads", value: self.discordActionThreads, defaultValue: true)
        setAction("pins", value: self.discordActionPins, defaultValue: true)
        setAction("search", value: self.discordActionSearch, defaultValue: true)
        setAction("memberInfo", value: self.discordActionMemberInfo, defaultValue: true)
        setAction("roleInfo", value: self.discordActionRoleInfo, defaultValue: true)
        setAction("channelInfo", value: self.discordActionChannelInfo, defaultValue: true)
        setAction("voiceStatus", value: self.discordActionVoiceStatus, defaultValue: true)
        setAction("events", value: self.discordActionEvents, defaultValue: true)
        setAction("roles", value: self.discordActionRoles, defaultValue: false)
        setAction("moderation", value: self.discordActionModeration, defaultValue: false)
        if actions.isEmpty {
            discord.removeValue(forKey: "actions")
        } else {
            discord["actions"] = actions
        }

        var slash: [String: Any] = (discord["slashCommand"] as? [String: Any]) ?? [:]
        if self.discordSlashEnabled {
            slash["enabled"] = true
        } else {
            slash.removeValue(forKey: "enabled")
        }
        let slashName = self.discordSlashName.trimmingCharacters(in: .whitespacesAndNewlines)
        if slashName.isEmpty {
            slash.removeValue(forKey: "name")
        } else {
            slash["name"] = slashName
        }
        let slashPrefix = self.discordSlashSessionPrefix.trimmingCharacters(in: .whitespacesAndNewlines)
        if slashPrefix.isEmpty {
            slash.removeValue(forKey: "sessionPrefix")
        } else {
            slash["sessionPrefix"] = slashPrefix
        }
        if self.discordSlashEphemeral {
            slash.removeValue(forKey: "ephemeral")
        } else {
            slash["ephemeral"] = false
        }
        if slash.isEmpty {
            discord.removeValue(forKey: "slashCommand")
        } else {
            discord["slashCommand"] = slash
        }

        if discord.isEmpty {
            self.configRoot.removeValue(forKey: "discord")
        } else {
            self.configRoot["discord"] = discord
        }

        do {
            let data = try JSONSerialization.data(
                withJSONObject: self.configRoot,
                options: [.prettyPrinted, .sortedKeys])
            guard let raw = String(data: data, encoding: .utf8) else {
                self.configStatus = "Failed to encode config."
                return
            }
            let params: [String: AnyCodable] = ["raw": AnyCodable(raw)]
            _ = try await GatewayConnection.shared.requestRaw(
                method: .configSet,
                params: params,
                timeoutMs: 10000)
            self.configStatus = "Saved to ~/.clawdis/clawdis.json."
            await self.refresh(probe: true)
        } catch {
            self.configStatus = error.localizedDescription
        }
    }

    func saveSignalConfig() async {
        guard !self.isSavingConfig else { return }
        self.isSavingConfig = true
        defer { self.isSavingConfig = false }
        if !self.configLoaded {
            await self.loadConfig()
        }

        var signal: [String: Any] = (self.configRoot["signal"] as? [String: Any]) ?? [:]
        if self.signalEnabled {
            signal.removeValue(forKey: "enabled")
        } else {
            signal["enabled"] = false
        }

        let account = self.signalAccount.trimmingCharacters(in: .whitespacesAndNewlines)
        if account.isEmpty {
            signal.removeValue(forKey: "account")
        } else {
            signal["account"] = account
        }

        let httpUrl = self.signalHttpUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        if httpUrl.isEmpty {
            signal.removeValue(forKey: "httpUrl")
        } else {
            signal["httpUrl"] = httpUrl
        }

        let httpHost = self.signalHttpHost.trimmingCharacters(in: .whitespacesAndNewlines)
        if httpHost.isEmpty {
            signal.removeValue(forKey: "httpHost")
        } else {
            signal["httpHost"] = httpHost
        }

        let httpPort = self.signalHttpPort.trimmingCharacters(in: .whitespacesAndNewlines)
        if httpPort.isEmpty {
            signal.removeValue(forKey: "httpPort")
        } else if let value = Double(httpPort) {
            signal["httpPort"] = value
        }

        let cliPath = self.signalCliPath.trimmingCharacters(in: .whitespacesAndNewlines)
        if cliPath.isEmpty {
            signal.removeValue(forKey: "cliPath")
        } else {
            signal["cliPath"] = cliPath
        }

        if self.signalAutoStart {
            signal.removeValue(forKey: "autoStart")
        } else {
            signal["autoStart"] = false
        }

        let receiveMode = self.signalReceiveMode.trimmingCharacters(in: .whitespacesAndNewlines)
        if receiveMode.isEmpty {
            signal.removeValue(forKey: "receiveMode")
        } else {
            signal["receiveMode"] = receiveMode
        }

        if self.signalIgnoreAttachments {
            signal["ignoreAttachments"] = true
        } else {
            signal.removeValue(forKey: "ignoreAttachments")
        }
        if self.signalIgnoreStories {
            signal["ignoreStories"] = true
        } else {
            signal.removeValue(forKey: "ignoreStories")
        }
        if self.signalSendReadReceipts {
            signal["sendReadReceipts"] = true
        } else {
            signal.removeValue(forKey: "sendReadReceipts")
        }

        let allow = self.signalAllowFrom
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        if allow.isEmpty {
            signal.removeValue(forKey: "allowFrom")
        } else {
            signal["allowFrom"] = allow
        }

        let media = self.signalMediaMaxMb.trimmingCharacters(in: .whitespacesAndNewlines)
        if media.isEmpty {
            signal.removeValue(forKey: "mediaMaxMb")
        } else if let value = Double(media) {
            signal["mediaMaxMb"] = value
        }

        if signal.isEmpty {
            self.configRoot.removeValue(forKey: "signal")
        } else {
            self.configRoot["signal"] = signal
        }

        do {
            let data = try JSONSerialization.data(
                withJSONObject: self.configRoot,
                options: [.prettyPrinted, .sortedKeys])
            guard let raw = String(data: data, encoding: .utf8) else {
                self.configStatus = "Failed to encode config."
                return
            }
            let params: [String: AnyCodable] = ["raw": AnyCodable(raw)]
            _ = try await GatewayConnection.shared.requestRaw(
                method: .configSet,
                params: params,
                timeoutMs: 10000)
            self.configStatus = "Saved to ~/.clawdis/clawdis.json."
            await self.refresh(probe: true)
        } catch {
            self.configStatus = error.localizedDescription
        }
    }

    func saveIMessageConfig() async {
        guard !self.isSavingConfig else { return }
        self.isSavingConfig = true
        defer { self.isSavingConfig = false }
        if !self.configLoaded {
            await self.loadConfig()
        }

        var imessage: [String: Any] = (self.configRoot["imessage"] as? [String: Any]) ?? [:]
        if self.imessageEnabled {
            imessage.removeValue(forKey: "enabled")
        } else {
            imessage["enabled"] = false
        }

        let cliPath = self.imessageCliPath.trimmingCharacters(in: .whitespacesAndNewlines)
        if cliPath.isEmpty {
            imessage.removeValue(forKey: "cliPath")
        } else {
            imessage["cliPath"] = cliPath
        }

        let dbPath = self.imessageDbPath.trimmingCharacters(in: .whitespacesAndNewlines)
        if dbPath.isEmpty {
            imessage.removeValue(forKey: "dbPath")
        } else {
            imessage["dbPath"] = dbPath
        }

        let service = self.imessageService.trimmingCharacters(in: .whitespacesAndNewlines)
        if service.isEmpty || service == "auto" {
            imessage.removeValue(forKey: "service")
        } else {
            imessage["service"] = service
        }

        let region = self.imessageRegion.trimmingCharacters(in: .whitespacesAndNewlines)
        if region.isEmpty {
            imessage.removeValue(forKey: "region")
        } else {
            imessage["region"] = region
        }

        let allow = self.imessageAllowFrom
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        if allow.isEmpty {
            imessage.removeValue(forKey: "allowFrom")
        } else {
            imessage["allowFrom"] = allow
        }

        if self.imessageIncludeAttachments {
            imessage["includeAttachments"] = true
        } else {
            imessage.removeValue(forKey: "includeAttachments")
        }

        let media = self.imessageMediaMaxMb.trimmingCharacters(in: .whitespacesAndNewlines)
        if media.isEmpty {
            imessage.removeValue(forKey: "mediaMaxMb")
        } else if let value = Double(media) {
            imessage["mediaMaxMb"] = value
        }

        if imessage.isEmpty {
            self.configRoot.removeValue(forKey: "imessage")
        } else {
            self.configRoot["imessage"] = imessage
        }

        do {
            let data = try JSONSerialization.data(
                withJSONObject: self.configRoot,
                options: [.prettyPrinted, .sortedKeys])
            guard let raw = String(data: data, encoding: .utf8) else {
                self.configStatus = "Failed to encode config."
                return
            }
            let params: [String: AnyCodable] = ["raw": AnyCodable(raw)]
            _ = try await GatewayConnection.shared.requestRaw(
                method: .configSet,
                params: params,
                timeoutMs: 10000)
            self.configStatus = "Saved to ~/.clawdis/clawdis.json."
            await self.refresh(probe: true)
        } catch {
            self.configStatus = error.localizedDescription
        }
    }
}

private struct WhatsAppLoginStartResult: Codable {
    let qrDataUrl: String?
    let message: String
}

private struct WhatsAppLoginWaitResult: Codable {
    let connected: Bool
    let message: String
}

private struct WhatsAppLogoutResult: Codable {
    let cleared: Bool
}

private struct TelegramLogoutResult: Codable {
    let cleared: Bool
    let envToken: Bool?
}
