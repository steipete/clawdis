import Foundation

enum GatewayLaunchAgentManager {
    private static var plistURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/LaunchAgents/\(gatewayLaunchdLabel).plist")
    }

    private static func gatewayExecutablePath(bundlePath: String) -> String {
        "\(bundlePath)/Contents/Resources/Relay/clawdis-gateway"
    }

    private static func relayDir(bundlePath: String) -> String {
        "\(bundlePath)/Contents/Resources/Relay"
    }

    static func status() async -> Bool {
        guard FileManager.default.fileExists(atPath: self.plistURL.path) else { return false }
        let result = await self.runLaunchctl(["print", "gui/\(getuid())/\(gatewayLaunchdLabel)"])
        return result.status == 0
    }

    static func set(enabled: Bool, bundlePath: String, port: Int) async -> String? {
        if enabled {
            let gatewayBin = self.gatewayExecutablePath(bundlePath: bundlePath)
            guard FileManager.default.isExecutableFile(atPath: gatewayBin) else {
                return "Embedded gateway missing in bundle; rebuild via scripts/package-mac-app.sh"
            }
            self.writePlist(bundlePath: bundlePath, port: port)
            _ = await self.runLaunchctl(["bootout", "gui/\(getuid())/\(gatewayLaunchdLabel)"])
            let bootstrap = await self.runLaunchctl(["bootstrap", "gui/\(getuid())", self.plistURL.path])
            if bootstrap.status != 0 {
                return bootstrap.output.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    ? "Failed to bootstrap gateway launchd job"
                    : bootstrap.output.trimmingCharacters(in: .whitespacesAndNewlines)
            }
            _ = await self.runLaunchctl(["kickstart", "-k", "gui/\(getuid())/\(gatewayLaunchdLabel)"])
            return nil
        }

        _ = await self.runLaunchctl(["bootout", "gui/\(getuid())/\(gatewayLaunchdLabel)"])
        try? FileManager.default.removeItem(at: self.plistURL)
        return nil
    }

    static func kickstart() async {
        _ = await self.runLaunchctl(["kickstart", "-k", "gui/\(getuid())/\(gatewayLaunchdLabel)"])
    }

    private static func writePlist(bundlePath: String, port: Int) {
        let gatewayBin = self.gatewayExecutablePath(bundlePath: bundlePath)
        let relayDir = self.relayDir(bundlePath: bundlePath)
        let preferredPath = ([relayDir] + CommandResolver.preferredPaths())
            .joined(separator: ":")
        let plist = """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
          <key>Label</key>
          <string>\(gatewayLaunchdLabel)</string>
          <key>ProgramArguments</key>
          <array>
            <string>\(gatewayBin)</string>
            <string>--port</string>
            <string>\(port)</string>
            <string>--bind</string>
            <string>loopback</string>
          </array>
          <key>WorkingDirectory</key>
          <string>\(FileManager.default.homeDirectoryForCurrentUser.path)</string>
          <key>RunAtLoad</key>
          <true/>
          <key>KeepAlive</key>
          <true/>
          <key>EnvironmentVariables</key>
          <dict>
            <key>PATH</key>
            <string>\(preferredPath)</string>
            <key>CLAWDIS_IMAGE_BACKEND</key>
            <string>sips</string>
          </dict>
          <key>StandardOutPath</key>
          <string>\(LogLocator.launchdGatewayLogPath)</string>
          <key>StandardErrorPath</key>
          <string>\(LogLocator.launchdGatewayLogPath)</string>
        </dict>
        </plist>
        """
        try? plist.write(to: self.plistURL, atomically: true, encoding: .utf8)
    }

    private struct LaunchctlResult {
        let status: Int32
        let output: String
    }

    @discardableResult
    private static func runLaunchctl(_ args: [String]) async -> LaunchctlResult {
        await Task.detached(priority: .utility) { () -> LaunchctlResult in
            let process = Process()
            process.launchPath = "/bin/launchctl"
            process.arguments = args
            let pipe = Pipe()
            process.standardOutput = pipe
            process.standardError = pipe
            do {
                try process.run()
                process.waitUntilExit()
                let data = pipe.fileHandleForReading.readToEndSafely()
                let output = String(data: data, encoding: .utf8) ?? ""
                return LaunchctlResult(status: process.terminationStatus, output: output)
            } catch {
                return LaunchctlResult(status: -1, output: error.localizedDescription)
            }
        }.value
    }
}
