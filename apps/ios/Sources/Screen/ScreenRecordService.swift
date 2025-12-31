import AVFoundation
import ReplayKit

final class ScreenRecordService: @unchecked Sendable {
    private struct UncheckedSendableBox<T>: @unchecked Sendable {
        let value: T
    }

    private final class CaptureState: @unchecked Sendable {
        private let lock = NSLock()
        var writer: AVAssetWriter?
        var videoInput: AVAssetWriterInput?
        var audioInput: AVAssetWriterInput?
        var started = false
        var sawVideo = false
        var lastVideoTime: CMTime?
        var handlerError: Error?

        func withLock<T>(_ body: (CaptureState) -> T) -> T {
            self.lock.lock()
            defer { lock.unlock() }
            return body(self)
        }
    }

    enum ScreenRecordError: LocalizedError {
        case invalidScreenIndex(Int)
        case captureFailed(String)
        case writeFailed(String)

        var errorDescription: String? {
            switch self {
            case let .invalidScreenIndex(idx):
                "Invalid screen index \(idx)"
            case let .captureFailed(msg):
                msg
            case let .writeFailed(msg):
                msg
            }
        }
    }

    // swiftlint:disable:next cyclomatic_complexity
    func record(
        screenIndex: Int?,
        durationMs: Int?,
        fps: Double?,
        includeAudio: Bool?,
        outPath: String?) async throws -> String
    {
        let durationMs = Self.clampDurationMs(durationMs)
        let fps = Self.clampFps(fps)
        let fpsInt = Int32(fps.rounded())
        let fpsValue = Double(fpsInt)
        let includeAudio = includeAudio ?? true

        if let idx = screenIndex, idx != 0 {
            throw ScreenRecordError.invalidScreenIndex(idx)
        }

        let outURL: URL = {
            if let outPath, !outPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return URL(fileURLWithPath: outPath)
            }
            return FileManager.default.temporaryDirectory
                .appendingPathComponent("clawdis-screen-record-\(UUID().uuidString).mp4")
        }()
        try? FileManager.default.removeItem(at: outURL)

        let state = CaptureState()
        let recordQueue = DispatchQueue(label: "com.steipete.clawdis.screenrecord")

        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            let handler: @Sendable (CMSampleBuffer, RPSampleBufferType, Error?) -> Void = { sample, type, error in
                // ReplayKit can call the capture handler on a background queue.
                // Serialize writes to avoid queue asserts.
                recordQueue.async {
                    if let error {
                        state.withLock { state in
                            if state.handlerError == nil { state.handlerError = error }
                        }
                        return
                    }
                    guard CMSampleBufferDataIsReady(sample) else { return }

                    switch type {
                    case .video:
                        let pts = CMSampleBufferGetPresentationTimeStamp(sample)
                        let shouldSkip = state.withLock { state in
                            if let lastVideoTime = state.lastVideoTime {
                                let delta = CMTimeSubtract(pts, lastVideoTime)
                                return delta.seconds < (1.0 / fpsValue)
                            }
                            return false
                        }
                        if shouldSkip { return }

                        if state.withLock({ $0.writer == nil }) {
                            guard let imageBuffer = CMSampleBufferGetImageBuffer(sample) else {
                                state.withLock { state in
                                    if state.handlerError == nil {
                                        state.handlerError = ScreenRecordError.captureFailed("Missing image buffer")
                                    }
                                }
                                return
                            }
                            let width = CVPixelBufferGetWidth(imageBuffer)
                            let height = CVPixelBufferGetHeight(imageBuffer)
                            do {
                                let w = try AVAssetWriter(outputURL: outURL, fileType: .mp4)
                                let settings: [String: Any] = [
                                    AVVideoCodecKey: AVVideoCodecType.h264,
                                    AVVideoWidthKey: width,
                                    AVVideoHeightKey: height,
                                ]
                                let vInput = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
                                vInput.expectsMediaDataInRealTime = true
                                guard w.canAdd(vInput) else {
                                    throw ScreenRecordError.writeFailed("Cannot add video input")
                                }
                                w.add(vInput)

                                if includeAudio {
                                    let aInput = AVAssetWriterInput(mediaType: .audio, outputSettings: nil)
                                    aInput.expectsMediaDataInRealTime = true
                                    if w.canAdd(aInput) {
                                        w.add(aInput)
                                        state.withLock { state in
                                            state.audioInput = aInput
                                        }
                                    }
                                }

                                guard w.startWriting() else {
                                    throw ScreenRecordError
                                        .writeFailed(w.error?.localizedDescription ?? "Failed to start writer")
                                }
                                w.startSession(atSourceTime: pts)
                                state.withLock { state in
                                    state.writer = w
                                    state.videoInput = vInput
                                    state.started = true
                                }
                            } catch {
                                state.withLock { state in
                                    if state.handlerError == nil { state.handlerError = error }
                                }
                                return
                            }
                        }

                        let vInput = state.withLock { $0.videoInput }
                        let isStarted = state.withLock { $0.started }
                        guard let vInput, isStarted else { return }
                        if vInput.isReadyForMoreMediaData {
                            if vInput.append(sample) {
                                state.withLock { state in
                                    state.sawVideo = true
                                    state.lastVideoTime = pts
                                }
                            } else {
                                let err = state.withLock { $0.writer?.error }
                                if let err {
                                    state.withLock { state in
                                        if state.handlerError == nil {
                                            state.handlerError = ScreenRecordError.writeFailed(err.localizedDescription)
                                        }
                                    }
                                }
                            }
                        }

                    case .audioApp, .audioMic:
                        let aInput = state.withLock { $0.audioInput }
                        let isStarted = state.withLock { $0.started }
                        guard includeAudio, let aInput, isStarted else { return }
                        if aInput.isReadyForMoreMediaData {
                            _ = aInput.append(sample)
                        }

                    @unknown default:
                        break
                    }
                }
            }

            let completion: @Sendable (Error?) -> Void = { error in
                if let error { cont.resume(throwing: error) } else { cont.resume() }
            }

            Task { @MainActor in
                startReplayKitCapture(
                    includeAudio: includeAudio,
                    handler: handler,
                    completion: completion)
            }
        }

        try await Task.sleep(nanoseconds: UInt64(durationMs) * 1_000_000)

        let stopError = await withCheckedContinuation { cont in
            Task { @MainActor in
                stopReplayKitCapture { error in cont.resume(returning: error) }
            }
        }
        if let stopError { throw stopError }

        let handlerErrorSnapshot = state.withLock { $0.handlerError }
        if let handlerErrorSnapshot { throw handlerErrorSnapshot }
        let writerSnapshot = state.withLock { $0.writer }
        let videoInputSnapshot = state.withLock { $0.videoInput }
        let audioInputSnapshot = state.withLock { $0.audioInput }
        let sawVideoSnapshot = state.withLock { $0.sawVideo }
        guard let writerSnapshot, let videoInputSnapshot, sawVideoSnapshot else {
            throw ScreenRecordError.captureFailed("No frames captured")
        }

        videoInputSnapshot.markAsFinished()
        audioInputSnapshot?.markAsFinished()

        let writerBox = UncheckedSendableBox(value: writerSnapshot)
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            writerBox.value.finishWriting {
                let writer = writerBox.value
                if let err = writer.error {
                    cont.resume(throwing: ScreenRecordError.writeFailed(err.localizedDescription))
                } else if writer.status != .completed {
                    cont.resume(throwing: ScreenRecordError.writeFailed("Failed to finalize video"))
                } else {
                    cont.resume()
                }
            }
        }

        return outURL.path
    }

    private nonisolated static func clampDurationMs(_ ms: Int?) -> Int {
        let v = ms ?? 10000
        return min(60000, max(250, v))
    }

    private nonisolated static func clampFps(_ fps: Double?) -> Double {
        let v = fps ?? 10
        if !v.isFinite { return 10 }
        return min(30, max(1, v))
    }
}

@MainActor
private func startReplayKitCapture(
    includeAudio: Bool,
    handler: @escaping @Sendable (CMSampleBuffer, RPSampleBufferType, Error?) -> Void,
    completion: @escaping @Sendable (Error?) -> Void)
{
    let recorder = RPScreenRecorder.shared()
    recorder.isMicrophoneEnabled = includeAudio
    recorder.startCapture(handler: handler, completionHandler: completion)
}

@MainActor
private func stopReplayKitCapture(_ completion: @escaping @Sendable (Error?) -> Void) {
    RPScreenRecorder.shared().stopCapture { error in completion(error) }
}

#if DEBUG
extension ScreenRecordService {
    nonisolated static func _test_clampDurationMs(_ ms: Int?) -> Int {
        self.clampDurationMs(ms)
    }

    nonisolated static func _test_clampFps(_ fps: Double?) -> Double {
        self.clampFps(fps)
    }
}
#endif
