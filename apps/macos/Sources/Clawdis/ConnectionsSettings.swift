import AppKit
import SwiftUI

struct ConnectionsSettings: View {
    private enum ConnectionProvider: String, CaseIterable, Identifiable, Hashable {
        case whatsapp
        case telegram
        case discord
        case signal
        case imessage

        var id: String { self.rawValue }

        var sortOrder: Int {
            switch self {
            case .whatsapp: 0
            case .telegram: 1
            case .discord: 2
            case .signal: 3
            case .imessage: 4
            }
        }

        var title: String {
            switch self {
            case .whatsapp: "WhatsApp"
            case .telegram: "Telegram"
            case .discord: "Discord"
            case .signal: "Signal"
            case .imessage: "iMessage"
            }
        }

        var detailTitle: String {
            switch self {
            case .whatsapp: "WhatsApp Web"
            case .telegram: "Telegram Bot"
            case .discord: "Discord Bot"
            case .signal: "Signal REST"
            case .imessage: "iMessage (imsg)"
            }
        }

        var systemImage: String {
            switch self {
            case .whatsapp: "message"
            case .telegram: "paperplane"
            case .discord: "bubble.left.and.bubble.right"
            case .signal: "antenna.radiowaves.left.and.right"
            case .imessage: "message.fill"
            }
        }
    }

    @Bindable var store: ConnectionsStore
    @State private var selectedProvider: ConnectionProvider? = nil
    @State private var showTelegramToken = false
    @State private var showDiscordToken = false

    init(store: ConnectionsStore = .shared) {
        self.store = store
    }

    var body: some View {
        NavigationSplitView {
            self.sidebar
        } detail: {
            self.detail
        }
        .onAppear {
            self.store.start()
            self.ensureSelection()
        }
        .onChange(of: self.orderedProviders) { _, _ in
            self.ensureSelection()
        }
        .onDisappear { self.store.stop() }
    }

    private var sidebar: some View {
        List(selection: self.$selectedProvider) {
            if !self.enabledProviders.isEmpty {
                Section("Configured") {
                    ForEach(self.enabledProviders) { provider in
                        self.sidebarRow(provider)
                            .tag(provider)
                    }
                }
            }

            if !self.availableProviders.isEmpty {
                Section("Available") {
                    ForEach(self.availableProviders) { provider in
                        self.sidebarRow(provider)
                            .tag(provider)
                    }
                }
            }
        }
        .listStyle(.sidebar)
        .frame(minWidth: 210, idealWidth: 230, maxWidth: 260)
    }

    private var detail: some View {
        Group {
            if let provider = self.selectedProvider {
                self.providerDetail(provider)
            } else {
                self.emptyDetail
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var emptyDetail: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Connections")
                .font(.title3.weight(.semibold))
            Text("Select a provider to view status and settings.")
                .font(.callout)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 18)
    }

    private func providerDetail(_ provider: ConnectionProvider) -> some View {
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 16) {
                self.detailHeader(for: provider)
                Divider()
                self.providerSection(provider)
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 24)
            .padding(.vertical, 18)
        }
    }

    private func sidebarRow(_ provider: ConnectionProvider) -> some View {
        HStack(spacing: 8) {
            Circle()
                .fill(self.providerTint(provider))
                .frame(width: 8, height: 8)
            VStack(alignment: .leading, spacing: 2) {
                Text(provider.title)
                Text(self.providerSummary(provider))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }

    private func detailHeader(for provider: ConnectionProvider) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Label(provider.detailTitle, systemImage: provider.systemImage)
                    .font(.title3.weight(.semibold))
                self.statusBadge(
                    self.providerSummary(provider),
                    color: self.providerTint(provider))
                Spacer()
                self.providerHeaderActions(provider)
            }

            HStack(spacing: 10) {
                Text("Last check \(self.providerLastCheckText(provider))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if self.providerHasError(provider) {
                    Text("Error")
                        .font(.caption2.weight(.semibold))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.red.opacity(0.15))
                        .foregroundStyle(.red)
                        .clipShape(Capsule())
                }
            }

            if let details = self.providerDetails(provider) {
                Text(details)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func statusBadge(_ text: String, color: Color) -> some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(color.opacity(0.16))
            .foregroundStyle(color)
            .clipShape(Capsule())
    }

    private func formSection(_ title: String, @ViewBuilder content: () -> some View) -> some View {
        GroupBox(title) {
            VStack(alignment: .leading, spacing: 10) {
                content()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private func providerHeaderActions(_ provider: ConnectionProvider) -> some View {
        HStack(spacing: 8) {
            if provider == .whatsapp {
                Button("Logout") {
                    Task { await self.store.logoutWhatsApp() }
                }
                .buttonStyle(.bordered)
                .disabled(self.store.whatsappBusy)
            }

            if provider == .telegram {
                Button("Logout") {
                    Task { await self.store.logoutTelegram() }
                }
                .buttonStyle(.bordered)
                .disabled(self.store.telegramBusy)
            }

            Button {
                Task { await self.store.refresh(probe: true) }
            } label: {
                if self.store.isRefreshing {
                    ProgressView().controlSize(.small)
                } else {
                    Text("Refresh")
                }
            }
            .buttonStyle(.bordered)
            .disabled(self.store.isRefreshing)
        }
        .controlSize(.small)
    }

    private var whatsAppSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            self.formSection("Linking") {
                if let message = self.store.whatsappLoginMessage {
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if let qr = self.store.whatsappLoginQrDataUrl, let image = self.qrImage(from: qr) {
                    Image(nsImage: image)
                        .resizable()
                        .interpolation(.none)
                        .frame(width: 180, height: 180)
                        .cornerRadius(8)
                }

                HStack(spacing: 12) {
                    Button {
                        Task { await self.store.startWhatsAppLogin(force: false) }
                    } label: {
                        if self.store.whatsappBusy {
                            ProgressView().controlSize(.small)
                        } else {
                            Text("Show QR")
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(self.store.whatsappBusy)

                    Button("Relink") {
                        Task { await self.store.startWhatsAppLogin(force: true) }
                    }
                    .buttonStyle(.bordered)
                    .disabled(self.store.whatsappBusy)
                }
                .font(.caption)
            }
        }
    }

    private var telegramSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            self.formSection("Authentication") {
                Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 14, verticalSpacing: 8) {
                    GridRow {
                        self.gridLabel("Bot token")
                        if self.showTelegramToken {
                            TextField("123:abc", text: self.$store.telegramToken)
                                .textFieldStyle(.roundedBorder)
                                .disabled(self.isTelegramTokenLocked)
                        } else {
                            SecureField("123:abc", text: self.$store.telegramToken)
                                .textFieldStyle(.roundedBorder)
                                .disabled(self.isTelegramTokenLocked)
                        }
                        Toggle("Show", isOn: self.$showTelegramToken)
                            .toggleStyle(.switch)
                            .disabled(self.isTelegramTokenLocked)
                    }
                }
            }

            self.formSection("Access") {
                Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 14, verticalSpacing: 8) {
                    GridRow {
                        self.gridLabel("Require mention")
                        Toggle("", isOn: self.$store.telegramRequireMention)
                            .labelsHidden()
                            .toggleStyle(.checkbox)
                    }
                    GridRow {
                        self.gridLabel("Allow from")
                        TextField("123456789, @team", text: self.$store.telegramAllowFrom)
                            .textFieldStyle(.roundedBorder)
                    }
                }
            }

            self.formSection("Webhook") {
                Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 14, verticalSpacing: 8) {
                    GridRow {
                        self.gridLabel("Webhook URL")
                        TextField("https://example.com/telegram-webhook", text: self.$store.telegramWebhookUrl)
                            .textFieldStyle(.roundedBorder)
                    }
                    GridRow {
                        self.gridLabel("Webhook secret")
                        TextField("secret", text: self.$store.telegramWebhookSecret)
                            .textFieldStyle(.roundedBorder)
                    }
                    GridRow {
                        self.gridLabel("Webhook path")
                        TextField("/telegram-webhook", text: self.$store.telegramWebhookPath)
                            .textFieldStyle(.roundedBorder)
                    }
                }
            }

            self.formSection("Network") {
                Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 14, verticalSpacing: 8) {
                    GridRow {
                        self.gridLabel("Proxy")
                        TextField("socks5://localhost:9050", text: self.$store.telegramProxy)
                            .textFieldStyle(.roundedBorder)
                    }
                }
            }

            if self.isTelegramTokenLocked {
                Text("Token set via TELEGRAM_BOT_TOKEN env; config edits won’t override it.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            self.configStatusMessage

            HStack(spacing: 12) {
                Button {
                    Task { await self.store.saveTelegramConfig() }
                } label: {
                    if self.store.isSavingConfig {
                        ProgressView().controlSize(.small)
                    } else {
                        Text("Save")
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(self.store.isSavingConfig)

                Spacer()
            }
            .font(.caption)
        }
    }

    private var discordSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            self.formSection("Authentication") {
                Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 14, verticalSpacing: 8) {
                    GridRow {
                        self.gridLabel("Enabled")
                        Toggle("", isOn: self.$store.discordEnabled)
                            .labelsHidden()
                            .toggleStyle(.checkbox)
                    }
                    GridRow {
                        self.gridLabel("Bot token")
                        if self.showDiscordToken {
                            TextField("bot token", text: self.$store.discordToken)
                                .textFieldStyle(.roundedBorder)
                                .disabled(self.isDiscordTokenLocked)
                        } else {
                            SecureField("bot token", text: self.$store.discordToken)
                                .textFieldStyle(.roundedBorder)
                                .disabled(self.isDiscordTokenLocked)
                        }
                        Toggle("Show", isOn: self.$showDiscordToken)
                            .toggleStyle(.switch)
                            .disabled(self.isDiscordTokenLocked)
                    }
                }
            }

            self.formSection("Messages") {
                Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 14, verticalSpacing: 8) {
                    GridRow {
                        self.gridLabel("Allow DMs from")
                        TextField("123456789, username#1234", text: self.$store.discordAllowFrom)
                            .textFieldStyle(.roundedBorder)
                    }
                    GridRow {
                        self.gridLabel("DMs enabled")
                        Toggle("", isOn: self.$store.discordDmEnabled)
                            .labelsHidden()
                            .toggleStyle(.checkbox)
                    }
                    GridRow {
                        self.gridLabel("Group DMs")
                        Toggle("", isOn: self.$store.discordGroupEnabled)
                            .labelsHidden()
                            .toggleStyle(.checkbox)
                    }
                    GridRow {
                        self.gridLabel("Group channels")
                        TextField("channelId1, channelId2", text: self.$store.discordGroupChannels)
                            .textFieldStyle(.roundedBorder)
                    }
                    GridRow {
                        self.gridLabel("Reply to mode")
                        Picker("", selection: self.$store.discordReplyToMode) {
                            Text("off").tag("off")
                            Text("first").tag("first")
                            Text("all").tag("all")
                        }
                        .labelsHidden()
                    }
                }
            }

            self.formSection("Limits") {
                Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 14, verticalSpacing: 8) {
                    GridRow {
                        self.gridLabel("Media max MB")
                        TextField("8", text: self.$store.discordMediaMaxMb)
                            .textFieldStyle(.roundedBorder)
                    }
                    GridRow {
                        self.gridLabel("History limit")
                        TextField("20", text: self.$store.discordHistoryLimit)
                            .textFieldStyle(.roundedBorder)
                    }
                    GridRow {
                        self.gridLabel("Text chunk limit")
                        TextField("2000", text: self.$store.discordTextChunkLimit)
                            .textFieldStyle(.roundedBorder)
                    }
                }
            }

            self.formSection("Slash command") {
                Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 14, verticalSpacing: 8) {
                    GridRow {
                        self.gridLabel("Enabled")
                        Toggle("", isOn: self.$store.discordSlashEnabled)
                            .labelsHidden()
                            .toggleStyle(.checkbox)
                    }
                    GridRow {
                        self.gridLabel("Slash name")
                        TextField("clawd", text: self.$store.discordSlashName)
                            .textFieldStyle(.roundedBorder)
                    }
                    GridRow {
                        self.gridLabel("Session prefix")
                        TextField("discord:slash", text: self.$store.discordSlashSessionPrefix)
                            .textFieldStyle(.roundedBorder)
                    }
                    GridRow {
                        self.gridLabel("Ephemeral")
                        Toggle("", isOn: self.$store.discordSlashEphemeral)
                            .labelsHidden()
                            .toggleStyle(.checkbox)
                    }
                }
            }

            GroupBox("Guilds") {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach($store.discordGuilds) { $guild in
                        VStack(alignment: .leading, spacing: 10) {
                            HStack {
                                TextField("guild id or slug", text: $guild.key)
                                    .textFieldStyle(.roundedBorder)
                                Button("Remove") {
                                    self.store.discordGuilds.removeAll { $0.id == guild.id }
                                }
                                .buttonStyle(.bordered)
                            }

                            Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 14, verticalSpacing: 8) {
                                GridRow {
                                    self.gridLabel("Slug")
                                    TextField("optional slug", text: $guild.slug)
                                        .textFieldStyle(.roundedBorder)
                                }
                                GridRow {
                                    self.gridLabel("Require mention")
                                    Toggle("", isOn: $guild.requireMention)
                                        .labelsHidden()
                                        .toggleStyle(.checkbox)
                                }
                                GridRow {
                                    self.gridLabel("Reaction notifications")
                                    Picker("", selection: $guild.reactionNotifications) {
                                        Text("Off").tag("off")
                                        Text("Own").tag("own")
                                        Text("All").tag("all")
                                        Text("Allowlist").tag("allowlist")
                                    }
                                    .labelsHidden()
                                    .pickerStyle(.segmented)
                                }
                                GridRow {
                                    self.gridLabel("Users allowlist")
                                    TextField("123456789, username#1234", text: $guild.users)
                                        .textFieldStyle(.roundedBorder)
                                }
                            }

                            Text("Channels")
                                .font(.caption)
                                .foregroundStyle(.secondary)

                            VStack(alignment: .leading, spacing: 8) {
                                ForEach($guild.channels) { $channel in
                                    HStack(spacing: 10) {
                                        TextField("channel id or slug", text: $channel.key)
                                            .textFieldStyle(.roundedBorder)
                                        Toggle("Allow", isOn: $channel.allow)
                                            .toggleStyle(.checkbox)
                                        Toggle("Require mention", isOn: $channel.requireMention)
                                            .toggleStyle(.checkbox)
                                        Button("Remove") {
                                            guild.channels.removeAll { $0.id == channel.id }
                                        }
                                        .buttonStyle(.bordered)
                                    }
                                }
                                Button("Add channel") {
                                    guild.channels.append(DiscordGuildChannelForm())
                                }
                                .buttonStyle(.bordered)
                            }
                        }
                        .padding(10)
                        .background(Color.secondary.opacity(0.08))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                    }

                    Button("Add guild") {
                        self.store.discordGuilds.append(DiscordGuildForm())
                    }
                    .buttonStyle(.bordered)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            GroupBox("Tool actions") {
                Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 14, verticalSpacing: 8) {
                    GridRow {
                        self.gridLabel("Reactions")
                        Toggle("", isOn: self.$store.discordActionReactions)
                            .labelsHidden()
                            .toggleStyle(.checkbox)
                    }
                    GridRow {
                        self.gridLabel("Stickers")
                        Toggle("", isOn: self.$store.discordActionStickers)
                            .labelsHidden()
                            .toggleStyle(.checkbox)
                    }
                    GridRow {
                        self.gridLabel("Polls")
                        Toggle("", isOn: self.$store.discordActionPolls)
                            .labelsHidden()
                            .toggleStyle(.checkbox)
                    }
                    GridRow {
                        self.gridLabel("Permissions")
                        Toggle("", isOn: self.$store.discordActionPermissions)
                            .labelsHidden()
                            .toggleStyle(.checkbox)
                    }
                    GridRow {
                        self.gridLabel("Messages")
                        Toggle("", isOn: self.$store.discordActionMessages)
                            .labelsHidden()
                            .toggleStyle(.checkbox)
                    }
                    GridRow {
                        self.gridLabel("Threads")
                        Toggle("", isOn: self.$store.discordActionThreads)
                            .labelsHidden()
                            .toggleStyle(.checkbox)
                    }
                    GridRow {
                        self.gridLabel("Pins")
                        Toggle("", isOn: self.$store.discordActionPins)
                            .labelsHidden()
                            .toggleStyle(.checkbox)
                    }
                    GridRow {
                        self.gridLabel("Search")
                        Toggle("", isOn: self.$store.discordActionSearch)
                            .labelsHidden()
                            .toggleStyle(.checkbox)
                    }
                    GridRow {
                        self.gridLabel("Member info")
                        Toggle("", isOn: self.$store.discordActionMemberInfo)
                            .labelsHidden()
                            .toggleStyle(.checkbox)
                    }
                    GridRow {
                        self.gridLabel("Role info")
                        Toggle("", isOn: self.$store.discordActionRoleInfo)
                            .labelsHidden()
                            .toggleStyle(.checkbox)
                    }
                    GridRow {
                        self.gridLabel("Channel info")
                        Toggle("", isOn: self.$store.discordActionChannelInfo)
                            .labelsHidden()
                            .toggleStyle(.checkbox)
                    }
                    GridRow {
                        self.gridLabel("Voice status")
                        Toggle("", isOn: self.$store.discordActionVoiceStatus)
                            .labelsHidden()
                            .toggleStyle(.checkbox)
                    }
                    GridRow {
                        self.gridLabel("Events")
                        Toggle("", isOn: self.$store.discordActionEvents)
                            .labelsHidden()
                            .toggleStyle(.checkbox)
                    }
                    GridRow {
                        self.gridLabel("Role changes")
                        Toggle("", isOn: self.$store.discordActionRoles)
                            .labelsHidden()
                            .toggleStyle(.checkbox)
                    }
                    GridRow {
                        self.gridLabel("Moderation")
                        Toggle("", isOn: self.$store.discordActionModeration)
                            .labelsHidden()
                            .toggleStyle(.checkbox)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            if self.isDiscordTokenLocked {
                Text("Token set via DISCORD_BOT_TOKEN env; config edits won’t override it.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            self.configStatusMessage

            HStack(spacing: 12) {
                Button {
                    Task { await self.store.saveDiscordConfig() }
                } label: {
                    if self.store.isSavingConfig {
                        ProgressView().controlSize(.small)
                    } else {
                        Text("Save")
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(self.store.isSavingConfig)

                Spacer()
            }
            .font(.caption)
        }
    }

    private var signalSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            self.formSection("Connection") {
                Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 14, verticalSpacing: 8) {
                    GridRow {
                        self.gridLabel("Enabled")
                        Toggle("", isOn: self.$store.signalEnabled)
                            .labelsHidden()
                            .toggleStyle(.checkbox)
                    }
                    GridRow {
                        self.gridLabel("Account")
                        TextField("+15551234567", text: self.$store.signalAccount)
                            .textFieldStyle(.roundedBorder)
                    }
                    GridRow {
                        self.gridLabel("HTTP URL")
                        TextField("http://127.0.0.1:8080", text: self.$store.signalHttpUrl)
                            .textFieldStyle(.roundedBorder)
                    }
                    GridRow {
                        self.gridLabel("HTTP host")
                        TextField("127.0.0.1", text: self.$store.signalHttpHost)
                            .textFieldStyle(.roundedBorder)
                    }
                    GridRow {
                        self.gridLabel("HTTP port")
                        TextField("8080", text: self.$store.signalHttpPort)
                            .textFieldStyle(.roundedBorder)
                    }
                    GridRow {
                        self.gridLabel("CLI path")
                        TextField("signal-cli", text: self.$store.signalCliPath)
                            .textFieldStyle(.roundedBorder)
                    }
                }
            }

            self.formSection("Behavior") {
                Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 14, verticalSpacing: 8) {
                    GridRow {
                        self.gridLabel("Auto start")
                        Toggle("", isOn: self.$store.signalAutoStart)
                            .labelsHidden()
                            .toggleStyle(.checkbox)
                    }
                    GridRow {
                        self.gridLabel("Receive mode")
                        Picker("", selection: self.$store.signalReceiveMode) {
                            Text("Default").tag("")
                            Text("on-start").tag("on-start")
                            Text("manual").tag("manual")
                        }
                        .labelsHidden()
                        .pickerStyle(.menu)
                    }
                    GridRow {
                        self.gridLabel("Ignore attachments")
                        Toggle("", isOn: self.$store.signalIgnoreAttachments)
                            .labelsHidden()
                            .toggleStyle(.checkbox)
                    }
                    GridRow {
                        self.gridLabel("Ignore stories")
                        Toggle("", isOn: self.$store.signalIgnoreStories)
                            .labelsHidden()
                            .toggleStyle(.checkbox)
                    }
                    GridRow {
                        self.gridLabel("Read receipts")
                        Toggle("", isOn: self.$store.signalSendReadReceipts)
                            .labelsHidden()
                            .toggleStyle(.checkbox)
                    }
                }
            }

            self.formSection("Access & limits") {
                Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 14, verticalSpacing: 8) {
                    GridRow {
                        self.gridLabel("Allow from")
                        TextField("12345, +1555", text: self.$store.signalAllowFrom)
                            .textFieldStyle(.roundedBorder)
                    }
                    GridRow {
                        self.gridLabel("Media max MB")
                        TextField("8", text: self.$store.signalMediaMaxMb)
                            .textFieldStyle(.roundedBorder)
                    }
                }
            }

            self.configStatusMessage

            HStack(spacing: 12) {
                Button {
                    Task { await self.store.saveSignalConfig() }
                } label: {
                    if self.store.isSavingConfig {
                        ProgressView().controlSize(.small)
                    } else {
                        Text("Save")
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(self.store.isSavingConfig)

                Spacer()
            }
            .font(.caption)
        }
    }

    private var imessageSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            self.formSection("Connection") {
                Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 14, verticalSpacing: 8) {
                    GridRow {
                        self.gridLabel("Enabled")
                        Toggle("", isOn: self.$store.imessageEnabled)
                            .labelsHidden()
                            .toggleStyle(.checkbox)
                    }
                    GridRow {
                        self.gridLabel("CLI path")
                        TextField("imsg", text: self.$store.imessageCliPath)
                            .textFieldStyle(.roundedBorder)
                    }
                    GridRow {
                        self.gridLabel("DB path")
                        TextField("~/Library/Messages/chat.db", text: self.$store.imessageDbPath)
                            .textFieldStyle(.roundedBorder)
                    }
                    GridRow {
                        self.gridLabel("Service")
                        Picker("", selection: self.$store.imessageService) {
                            Text("auto").tag("auto")
                            Text("imessage").tag("imessage")
                            Text("sms").tag("sms")
                        }
                        .labelsHidden()
                        .pickerStyle(.menu)
                    }
                }
            }

            self.formSection("Behavior") {
                Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 14, verticalSpacing: 8) {
                    GridRow {
                        self.gridLabel("Region")
                        TextField("US", text: self.$store.imessageRegion)
                            .textFieldStyle(.roundedBorder)
                    }
                    GridRow {
                        self.gridLabel("Allow from")
                        TextField("chat_id:101, +1555", text: self.$store.imessageAllowFrom)
                            .textFieldStyle(.roundedBorder)
                    }
                    GridRow {
                        self.gridLabel("Attachments")
                        Toggle("", isOn: self.$store.imessageIncludeAttachments)
                            .labelsHidden()
                            .toggleStyle(.checkbox)
                    }
                    GridRow {
                        self.gridLabel("Media max MB")
                        TextField("16", text: self.$store.imessageMediaMaxMb)
                            .textFieldStyle(.roundedBorder)
                    }
                }
            }

            self.configStatusMessage

            HStack(spacing: 12) {
                Button {
                    Task { await self.store.saveIMessageConfig() }
                } label: {
                    if self.store.isSavingConfig {
                        ProgressView().controlSize(.small)
                    } else {
                        Text("Save")
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(self.store.isSavingConfig)

                Spacer()
            }
            .font(.caption)
        }
    }

    private var whatsAppTint: Color {
        guard let status = self.store.snapshot?.whatsapp else { return .secondary }
        if !status.configured { return .secondary }
        if !status.linked { return .red }
        if status.lastError != nil { return .orange }
        if status.connected { return .green }
        if status.running { return .orange }
        return .orange
    }

    private var telegramTint: Color {
        guard let status = self.store.snapshot?.telegram else { return .secondary }
        if !status.configured { return .secondary }
        if status.lastError != nil { return .orange }
        if status.probe?.ok == false { return .orange }
        if status.running { return .green }
        return .orange
    }

    private var discordTint: Color {
        guard let status = self.store.snapshot?.discord else { return .secondary }
        if !status.configured { return .secondary }
        if status.lastError != nil { return .orange }
        if status.probe?.ok == false { return .orange }
        if status.running { return .green }
        return .orange
    }

    private var signalTint: Color {
        guard let status = self.store.snapshot?.signal else { return .secondary }
        if !status.configured { return .secondary }
        if status.lastError != nil { return .orange }
        if status.probe?.ok == false { return .orange }
        if status.running { return .green }
        return .orange
    }

    private var imessageTint: Color {
        guard let status = self.store.snapshot?.imessage else { return .secondary }
        if !status.configured { return .secondary }
        if status.lastError != nil { return .orange }
        if status.probe?.ok == false { return .orange }
        if status.running { return .green }
        return .orange
    }

    private var whatsAppSummary: String {
        guard let status = self.store.snapshot?.whatsapp else { return "Checking…" }
        if !status.linked { return "Not linked" }
        if status.connected { return "Connected" }
        if status.running { return "Running" }
        return "Linked"
    }

    private var telegramSummary: String {
        guard let status = self.store.snapshot?.telegram else { return "Checking…" }
        if !status.configured { return "Not configured" }
        if status.running { return "Running" }
        return "Configured"
    }

    private var discordSummary: String {
        guard let status = self.store.snapshot?.discord else { return "Checking…" }
        if !status.configured { return "Not configured" }
        if status.running { return "Running" }
        return "Configured"
    }

    private var signalSummary: String {
        guard let status = self.store.snapshot?.signal else { return "Checking…" }
        if !status.configured { return "Not configured" }
        if status.running { return "Running" }
        return "Configured"
    }

    private var imessageSummary: String {
        guard let status = self.store.snapshot?.imessage else { return "Checking…" }
        if !status.configured { return "Not configured" }
        if status.running { return "Running" }
        return "Configured"
    }

    private var whatsAppDetails: String? {
        guard let status = self.store.snapshot?.whatsapp else { return nil }
        var lines: [String] = []
        if let e164 = status.`self`?.e164 ?? status.`self`?.jid {
            lines.append("Linked as \(e164)")
        }
        if let age = status.authAgeMs {
            lines.append("Auth age \(msToAge(age))")
        }
        if let last = self.date(fromMs: status.lastConnectedAt) {
            lines.append("Last connect \(relativeAge(from: last))")
        }
        if let disconnect = status.lastDisconnect {
            let when = self.date(fromMs: disconnect.at).map { relativeAge(from: $0) } ?? "unknown"
            let code = disconnect.status.map { "status \($0)" } ?? "status unknown"
            let err = disconnect.error ?? "disconnect"
            lines.append("Last disconnect \(code) · \(err) · \(when)")
        }
        if status.reconnectAttempts > 0 {
            lines.append("Reconnect attempts \(status.reconnectAttempts)")
        }
        if let msgAt = self.date(fromMs: status.lastMessageAt) {
            lines.append("Last message \(relativeAge(from: msgAt))")
        }
        if let err = status.lastError, !err.isEmpty {
            lines.append("Error: \(err)")
        }
        return lines.isEmpty ? nil : lines.joined(separator: " · ")
    }

    private var telegramDetails: String? {
        guard let status = self.store.snapshot?.telegram else { return nil }
        var lines: [String] = []
        if let source = status.tokenSource {
            lines.append("Token source: \(source)")
        }
        if let mode = status.mode {
            lines.append("Mode: \(mode)")
        }
        if let probe = status.probe {
            if probe.ok {
                if let name = probe.bot?.username {
                    lines.append("Bot: @\(name)")
                }
                if let url = probe.webhook?.url, !url.isEmpty {
                    lines.append("Webhook: \(url)")
                }
            } else {
                let code = probe.status.map { String($0) } ?? "unknown"
                lines.append("Probe failed (\(code))")
            }
        }
        if let last = self.date(fromMs: status.lastProbeAt) {
            lines.append("Last probe \(relativeAge(from: last))")
        }
        if let err = status.lastError, !err.isEmpty {
            lines.append("Error: \(err)")
        }
        return lines.isEmpty ? nil : lines.joined(separator: " · ")
    }

    private var discordDetails: String? {
        guard let status = self.store.snapshot?.discord else { return nil }
        var lines: [String] = []
        if let source = status.tokenSource {
            lines.append("Token source: \(source)")
        }
        if let probe = status.probe {
            if probe.ok {
                if let name = probe.bot?.username {
                    lines.append("Bot: @\(name)")
                }
                if let elapsed = probe.elapsedMs {
                    lines.append("Probe \(Int(elapsed))ms")
                }
            } else {
                let code = probe.status.map { String($0) } ?? "unknown"
                lines.append("Probe failed (\(code))")
            }
        }
        if let last = self.date(fromMs: status.lastProbeAt) {
            lines.append("Last probe \(relativeAge(from: last))")
        }
        if let err = status.lastError, !err.isEmpty {
            lines.append("Error: \(err)")
        }
        return lines.isEmpty ? nil : lines.joined(separator: " · ")
    }

    private var signalDetails: String? {
        guard let status = self.store.snapshot?.signal else { return nil }
        var lines: [String] = []
        lines.append("Base URL: \(status.baseUrl)")
        if let probe = status.probe {
            if probe.ok {
                if let version = probe.version, !version.isEmpty {
                    lines.append("Version \(version)")
                }
                if let elapsed = probe.elapsedMs {
                    lines.append("Probe \(Int(elapsed))ms")
                }
            } else {
                let code = probe.status.map { String($0) } ?? "unknown"
                lines.append("Probe failed (\(code))")
            }
        }
        if let last = self.date(fromMs: status.lastProbeAt) {
            lines.append("Last probe \(relativeAge(from: last))")
        }
        if let err = status.lastError, !err.isEmpty {
            lines.append("Error: \(err)")
        }
        return lines.isEmpty ? nil : lines.joined(separator: " · ")
    }

    private var imessageDetails: String? {
        guard let status = self.store.snapshot?.imessage else { return nil }
        var lines: [String] = []
        if let cliPath = status.cliPath, !cliPath.isEmpty {
            lines.append("CLI: \(cliPath)")
        }
        if let dbPath = status.dbPath, !dbPath.isEmpty {
            lines.append("DB: \(dbPath)")
        }
        if let probe = status.probe, !probe.ok {
            let err = probe.error ?? "probe failed"
            lines.append("Probe error: \(err)")
        }
        if let last = self.date(fromMs: status.lastProbeAt) {
            lines.append("Last probe \(relativeAge(from: last))")
        }
        if let err = status.lastError, !err.isEmpty {
            lines.append("Error: \(err)")
        }
        return lines.isEmpty ? nil : lines.joined(separator: " · ")
    }

    private var isTelegramTokenLocked: Bool {
        self.store.snapshot?.telegram.tokenSource == "env"
    }

    private var isDiscordTokenLocked: Bool {
        self.store.snapshot?.discord?.tokenSource == "env"
    }

    private var orderedProviders: [ConnectionProvider] {
        ConnectionProvider.allCases.sorted { lhs, rhs in
            let lhsEnabled = self.providerEnabled(lhs)
            let rhsEnabled = self.providerEnabled(rhs)
            if lhsEnabled != rhsEnabled { return lhsEnabled && !rhsEnabled }
            return lhs.sortOrder < rhs.sortOrder
        }
    }

    private var enabledProviders: [ConnectionProvider] {
        self.orderedProviders.filter { self.providerEnabled($0) }
    }

    private var availableProviders: [ConnectionProvider] {
        self.orderedProviders.filter { !self.providerEnabled($0) }
    }

    private func ensureSelection() {
        guard let selected = self.selectedProvider else {
            self.selectedProvider = self.orderedProviders.first
            return
        }
        if !self.orderedProviders.contains(selected) {
            self.selectedProvider = self.orderedProviders.first
        }
    }

    private func providerEnabled(_ provider: ConnectionProvider) -> Bool {
        switch provider {
        case .whatsapp:
            guard let status = self.store.snapshot?.whatsapp else { return false }
            return status.configured || status.linked || status.running
        case .telegram:
            guard let status = self.store.snapshot?.telegram else { return false }
            return status.configured || status.running
        case .discord:
            guard let status = self.store.snapshot?.discord else { return false }
            return status.configured || status.running
        case .signal:
            guard let status = self.store.snapshot?.signal else { return false }
            return status.configured || status.running
        case .imessage:
            guard let status = self.store.snapshot?.imessage else { return false }
            return status.configured || status.running
        }
    }

    @ViewBuilder
    private func providerSection(_ provider: ConnectionProvider) -> some View {
        switch provider {
        case .whatsapp:
            self.whatsAppSection
        case .telegram:
            self.telegramSection
        case .discord:
            self.discordSection
        case .signal:
            self.signalSection
        case .imessage:
            self.imessageSection
        }
    }

    @ViewBuilder
    private var configStatusMessage: some View {
        if let status = self.store.configStatus {
            Text(status)
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func providerTint(_ provider: ConnectionProvider) -> Color {
        switch provider {
        case .whatsapp:
            self.whatsAppTint
        case .telegram:
            self.telegramTint
        case .discord:
            self.discordTint
        case .signal:
            self.signalTint
        case .imessage:
            self.imessageTint
        }
    }

    private func providerSummary(_ provider: ConnectionProvider) -> String {
        switch provider {
        case .whatsapp:
            self.whatsAppSummary
        case .telegram:
            self.telegramSummary
        case .discord:
            self.discordSummary
        case .signal:
            self.signalSummary
        case .imessage:
            self.imessageSummary
        }
    }

    private func providerDetails(_ provider: ConnectionProvider) -> String? {
        switch provider {
        case .whatsapp:
            self.whatsAppDetails
        case .telegram:
            self.telegramDetails
        case .discord:
            self.discordDetails
        case .signal:
            self.signalDetails
        case .imessage:
            self.imessageDetails
        }
    }

    private func providerLastCheckText(_ provider: ConnectionProvider) -> String {
        guard let date = self.providerLastCheck(provider) else { return "never" }
        return relativeAge(from: date)
    }

    private func providerLastCheck(_ provider: ConnectionProvider) -> Date? {
        switch provider {
        case .whatsapp:
            guard let status = self.store.snapshot?.whatsapp else { return nil }
            return self.date(fromMs: status.lastEventAt ?? status.lastMessageAt ?? status.lastConnectedAt)
        case .telegram:
            return self.date(fromMs: self.store.snapshot?.telegram.lastProbeAt)
        case .discord:
            return self.date(fromMs: self.store.snapshot?.discord?.lastProbeAt)
        case .signal:
            return self.date(fromMs: self.store.snapshot?.signal?.lastProbeAt)
        case .imessage:
            return self.date(fromMs: self.store.snapshot?.imessage?.lastProbeAt)
        }
    }

    private func providerHasError(_ provider: ConnectionProvider) -> Bool {
        switch provider {
        case .whatsapp:
            guard let status = self.store.snapshot?.whatsapp else { return false }
            return status.lastError?.isEmpty == false || status.lastDisconnect?.loggedOut == true
        case .telegram:
            guard let status = self.store.snapshot?.telegram else { return false }
            return status.lastError?.isEmpty == false || status.probe?.ok == false
        case .discord:
            guard let status = self.store.snapshot?.discord else { return false }
            return status.lastError?.isEmpty == false || status.probe?.ok == false
        case .signal:
            guard let status = self.store.snapshot?.signal else { return false }
            return status.lastError?.isEmpty == false || status.probe?.ok == false
        case .imessage:
            guard let status = self.store.snapshot?.imessage else { return false }
            return status.lastError?.isEmpty == false || status.probe?.ok == false
        }
    }

    private func gridLabel(_ text: String) -> some View {
        Text(text)
            .font(.callout.weight(.semibold))
            .frame(width: 140, alignment: .leading)
    }

    private func date(fromMs ms: Double?) -> Date? {
        guard let ms else { return nil }
        return Date(timeIntervalSince1970: ms / 1000)
    }

    private func qrImage(from dataUrl: String) -> NSImage? {
        guard let comma = dataUrl.firstIndex(of: ",") else { return nil }
        let header = dataUrl[..<comma]
        guard header.contains("base64") else { return nil }
        let base64 = dataUrl[dataUrl.index(after: comma)...]
        guard let data = Data(base64Encoded: String(base64)) else { return nil }
        return NSImage(data: data)
    }
}
