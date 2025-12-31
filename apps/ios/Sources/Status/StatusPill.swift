import SwiftUI

struct StatusPill: View {
    @Environment(\.scenePhase) private var scenePhase

    enum BridgeState: Equatable {
        case connected
        case connecting
        case error
        case disconnected

        var title: String {
            switch self {
            case .connected: "Connected"
            case .connecting: "Connecting…"
            case .error: "Error"
            case .disconnected: "Offline"
            }
        }

        var color: Color {
            switch self {
            case .connected: .green
            case .connecting: .yellow
            case .error: .red
            case .disconnected: .gray
            }
        }
    }

    struct Activity: Equatable {
        var title: String
        var systemImage: String
        var tint: Color?
    }

    var bridge: BridgeState
    var voiceWakeEnabled: Bool
    var activity: Activity?
    var brighten: Bool = false
    var onTap: () -> Void

    @State private var pulse: Bool = false

    var body: some View {
        Button(action: self.onTap) {
            HStack(spacing: 10) {
                HStack(spacing: 8) {
                    Circle()
                        .fill(self.bridge.color)
                        .frame(width: 9, height: 9)
                        .scaleEffect(self.bridge == .connecting ? (self.pulse ? 1.15 : 0.85) : 1.0)
                        .opacity(self.bridge == .connecting ? (self.pulse ? 1.0 : 0.6) : 1.0)

                    Text(self.bridge.title)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.primary)
                }

                Divider()
                    .frame(height: 14)
                    .opacity(0.35)

                if let activity {
                    HStack(spacing: 6) {
                        Image(systemName: activity.systemImage)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(activity.tint ?? .primary)
                        Text(activity.title)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(.primary)
                            .lineLimit(1)
                    }
                    .transition(.opacity.combined(with: .move(edge: .top)))
                } else {
                    Image(systemName: self.voiceWakeEnabled ? "mic.fill" : "mic.slash")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(self.voiceWakeEnabled ? .primary : .secondary)
                        .accessibilityLabel(self.voiceWakeEnabled ? "Voice Wake enabled" : "Voice Wake disabled")
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }
            }
            .padding(.vertical, 8)
            .padding(.horizontal, 12)
            .background {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(.ultraThinMaterial)
                    .overlay {
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .strokeBorder(.white.opacity(self.brighten ? 0.24 : 0.18), lineWidth: 0.5)
                    }
                    .shadow(color: .black.opacity(0.25), radius: 12, y: 6)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Status")
        .accessibilityValue(self.accessibilityValue)
        .onAppear { self.updatePulse(for: self.bridge, scenePhase: self.scenePhase) }
        .onDisappear { self.pulse = false }
        .onChange(of: self.bridge) { _, newValue in
            self.updatePulse(for: newValue, scenePhase: self.scenePhase)
        }
        .onChange(of: self.scenePhase) { _, newValue in
            self.updatePulse(for: self.bridge, scenePhase: newValue)
        }
        .animation(.easeInOut(duration: 0.18), value: self.activity?.title)
    }

    private var accessibilityValue: String {
        if let activity {
            return "\(self.bridge.title), \(activity.title)"
        }
        return "\(self.bridge.title), Voice Wake \(self.voiceWakeEnabled ? "enabled" : "disabled")"
    }

    private func updatePulse(for bridge: BridgeState, scenePhase: ScenePhase) {
        guard bridge == .connecting, scenePhase == .active else {
            withAnimation(.easeOut(duration: 0.2)) { self.pulse = false }
            return
        }

        guard !self.pulse else { return }
        withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) {
            self.pulse = true
        }
    }
}
