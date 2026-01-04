import ClawdisKit
import CoreLocation
import Foundation

@MainActor
final class MacNodeLocationService: NSObject, CLLocationManagerDelegate {
    enum Error: Swift.Error {
        case timeout
        case unavailable
    }

    private let manager = CLLocationManager()
    private var locationContinuation: CheckedContinuation<CLLocation, Swift.Error>?

    override init() {
        super.init()
        self.manager.delegate = self
        self.manager.desiredAccuracy = kCLLocationAccuracyBest
    }

    func authorizationStatus() -> CLAuthorizationStatus {
        self.manager.authorizationStatus
    }

    func accuracyAuthorization() -> CLAccuracyAuthorization {
        if #available(macOS 11.0, *) {
            return self.manager.accuracyAuthorization
        }
        return .fullAccuracy
    }

    func currentLocation(
        desiredAccuracy: ClawdisLocationAccuracy,
        maxAgeMs: Int?,
        timeoutMs: Int?) async throws -> CLLocation
    {
        guard CLLocationManager.locationServicesEnabled() else {
            throw Error.unavailable
        }

        let now = Date()
        if let maxAgeMs,
           let cached = self.manager.location,
           now.timeIntervalSince(cached.timestamp) * 1000 <= Double(maxAgeMs)
        {
            return cached
        }

        self.manager.desiredAccuracy = Self.accuracyValue(desiredAccuracy)
        let timeout = max(0, timeoutMs ?? 10_000)
        return try await self.withTimeout(timeoutMs: timeout) {
            try await self.requestLocation()
        }
    }

    private func requestLocation() async throws -> CLLocation {
        try await withCheckedThrowingContinuation { cont in
            self.locationContinuation = cont
            self.manager.requestLocation()
        }
    }

    private func withTimeout<T>(
        timeoutMs: Int,
        operation: @escaping () async throws -> T) async throws -> T
    {
        if timeoutMs == 0 {
            return try await operation()
        }

        return try await withThrowingTaskGroup(of: T.self) { group in
            group.addTask { try await operation() }
            group.addTask {
                try await Task.sleep(nanoseconds: UInt64(timeoutMs) * 1_000_000)
                throw Error.timeout
            }
            let result = try await group.next()!
            group.cancelAll()
            return result
        }
    }

    private static func accuracyValue(_ accuracy: ClawdisLocationAccuracy) -> CLLocationAccuracy {
        switch accuracy {
        case .coarse:
            return kCLLocationAccuracyKilometer
        case .balanced:
            return kCLLocationAccuracyHundredMeters
        case .precise:
            return kCLLocationAccuracyBest
        }
    }

    // MARK: - CLLocationManagerDelegate (nonisolated for Swift 6 compatibility)

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        Task { @MainActor in
            guard let cont = self.locationContinuation else { return }
            self.locationContinuation = nil
            if let latest = locations.last {
                cont.resume(returning: latest)
            } else {
                cont.resume(throwing: Error.unavailable)
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Swift.Error) {
        let errorCopy = error // Capture error for Sendable compliance
        Task { @MainActor in
            guard let cont = self.locationContinuation else { return }
            self.locationContinuation = nil
            cont.resume(throwing: errorCopy)
        }
    }
}
