import Foundation

enum GatewayAutostartPolicy {
    static func shouldStartGateway(mode: AppState.ConnectionMode, paused: Bool) -> Bool {
        mode == .local && !paused
    }

    static func shouldEnsureLaunchAgent(
        mode: AppState.ConnectionMode,
        paused: Bool,
        attachExistingOnly: Bool,
    ) -> Bool
    {
        shouldStartGateway(mode: mode, paused: paused) && !attachExistingOnly
    }
}
