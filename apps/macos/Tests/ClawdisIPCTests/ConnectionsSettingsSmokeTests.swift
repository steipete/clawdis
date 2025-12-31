import SwiftUI
import Testing
@testable import Clawdis

@Suite(.serialized)
@MainActor
struct ConnectionsSettingsSmokeTests {
    @Test func connectionsSettingsBuildsBodyWithSnapshot() {
        let store = ConnectionsStore(isPreview: true)
        store.snapshot = ProvidersStatusSnapshot(
            ts: 1_700_000_000_000,
            whatsapp: ProvidersStatusSnapshot.WhatsAppStatus(
                configured: true,
                linked: true,
                authAgeMs: 86_400_000,
                self: ProvidersStatusSnapshot.WhatsAppSelf(
                    e164: "+15551234567",
                    jid: nil),
                running: true,
                connected: false,
                lastConnectedAt: 1_700_000_000_000,
                lastDisconnect: ProvidersStatusSnapshot.WhatsAppDisconnect(
                    at: 1_700_000_050_000,
                    status: 401,
                    error: "logged out",
                    loggedOut: true),
                reconnectAttempts: 2,
                lastMessageAt: 1_700_000_060_000,
                lastEventAt: 1_700_000_060_000,
                lastError: "needs login"),
            telegram: ProvidersStatusSnapshot.TelegramStatus(
                configured: true,
                tokenSource: "env",
                running: true,
                mode: "polling",
                lastStartAt: 1_700_000_000_000,
                lastStopAt: nil,
                lastError: nil,
                probe: ProvidersStatusSnapshot.TelegramProbe(
                    ok: true,
                    status: 200,
                    error: nil,
                    elapsedMs: 120,
                    bot: ProvidersStatusSnapshot.TelegramBot(id: 123, username: "clawdisbot"),
                    webhook: ProvidersStatusSnapshot.TelegramWebhook(url: "https://example.com/hook", hasCustomCert: false)),
                lastProbeAt: 1_700_000_050_000),
            discord: nil)

        store.whatsappLoginMessage = "Scan QR"
        store.whatsappLoginQrDataUrl =
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/ay7pS8AAAAASUVORK5CYII="
        store.telegramToken = "123:abc"
        store.telegramRequireMention = false
        store.telegramAllowFrom = "123456789"
        store.telegramProxy = "socks5://localhost:9050"
        store.telegramWebhookUrl = "https://example.com/telegram"
        store.telegramWebhookSecret = "secret"
        store.telegramWebhookPath = "/telegram"

        let view = ConnectionsSettings(store: store)
        _ = view.body
    }

    @Test func connectionsSettingsBuildsBodyWithoutSnapshot() {
        let store = ConnectionsStore(isPreview: true)
        store.snapshot = ProvidersStatusSnapshot(
            ts: 1_700_000_000_000,
            whatsapp: ProvidersStatusSnapshot.WhatsAppStatus(
                configured: false,
                linked: false,
                authAgeMs: nil,
                self: nil,
                running: false,
                connected: false,
                lastConnectedAt: nil,
                lastDisconnect: nil,
                reconnectAttempts: 0,
                lastMessageAt: nil,
                lastEventAt: nil,
                lastError: nil),
            telegram: ProvidersStatusSnapshot.TelegramStatus(
                configured: false,
                tokenSource: nil,
                running: false,
                mode: nil,
                lastStartAt: nil,
                lastStopAt: nil,
                lastError: "bot missing",
                probe: ProvidersStatusSnapshot.TelegramProbe(
                    ok: false,
                    status: 403,
                    error: "unauthorized",
                    elapsedMs: 120,
                    bot: nil,
                    webhook: nil),
                lastProbeAt: 1_700_000_100_000),
            discord: nil)

        let view = ConnectionsSettings(store: store)
        _ = view.body
    }
}
