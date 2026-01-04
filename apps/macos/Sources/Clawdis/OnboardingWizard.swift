import ClawdisProtocol
import Foundation
import Observation
import OSLog
import SwiftUI

private let onboardingWizardLogger = Logger(subsystem: "com.clawdis", category: "onboarding.wizard")

// MARK: - Swift 6 AnyCodable Bridging Helpers
// These helpers bridge between ClawdisProtocol.AnyCodable and the local module
// to avoid Swift 6 strict concurrency type conflicts.

private typealias ProtocolAnyCodable = ClawdisProtocol.AnyCodable

private func bridgeToProtocol(_ value: Any) -> ProtocolAnyCodable {
    ProtocolAnyCodable(value)
}

private func bridgeDict(_ dict: [String: Any]) -> [String: ProtocolAnyCodable] {
    dict.mapValues { ProtocolAnyCodable($0) }
}

@MainActor
@Observable
final class OnboardingWizardModel {
    private(set) var sessionId: String?
    private(set) var currentStep: WizardStep?
    private(set) var status: String?
    private(set) var errorMessage: String?
    var isStarting = false
    var isSubmitting = false

    var isComplete: Bool { self.status == "done" }
    var isRunning: Bool { self.status == "running" }

    func reset() {
        self.sessionId = nil
        self.currentStep = nil
        self.status = nil
        self.errorMessage = nil
        self.isStarting = false
        self.isSubmitting = false
    }

    func startIfNeeded(mode: AppState.ConnectionMode, workspace: String? = nil) async {
        guard self.sessionId == nil, !self.isStarting else { return }
        guard mode == .local else { return }
        self.isStarting = true
        self.errorMessage = nil
        defer { self.isStarting = false }

        do {
            var params: [String: AnyCodable] = ["mode": AnyCodable("local")]
            if let workspace, !workspace.isEmpty {
                params["workspace"] = AnyCodable(workspace)
            }
            let res: WizardStartResult = try await GatewayConnection.shared.requestDecoded(
                method: .wizardStart,
                params: params)
            applyStartResult(res)
        } catch {
            self.status = "error"
            self.errorMessage = error.localizedDescription
            onboardingWizardLogger.error("start failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    func submit(step: WizardStep, value: AnyCodable?) async {
        guard let sessionId, !self.isSubmitting else { return }
        self.isSubmitting = true
        self.errorMessage = nil
        defer { self.isSubmitting = false }

        do {
            var params: [String: AnyCodable] = ["sessionId": AnyCodable(sessionId)]
            var answer: [String: AnyCodable] = ["stepId": AnyCodable(step.id)]
            if let value {
                answer["value"] = value
            }
            params["answer"] = AnyCodable(answer)
            let res: WizardNextResult = try await GatewayConnection.shared.requestDecoded(
                method: .wizardNext,
                params: params)
            applyNextResult(res)
        } catch {
            self.status = "error"
            self.errorMessage = error.localizedDescription
            onboardingWizardLogger.error("submit failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    func cancelIfRunning() async {
        guard let sessionId, self.isRunning else { return }
        do {
            let res: WizardStatusResult = try await GatewayConnection.shared.requestDecoded(
                method: .wizardCancel,
                params: ["sessionId": AnyCodable(sessionId)])
            applyStatusResult(res)
        } catch {
            self.status = "error"
            self.errorMessage = error.localizedDescription
            onboardingWizardLogger.error("cancel failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    private func applyStartResult(_ res: WizardStartResult) {
        self.sessionId = res.sessionid
        self.status = anyCodableStringValue(res.status) ?? (res.done ? "done" : "running")
        self.errorMessage = res.error
        self.currentStep = decodeWizardStep(res.step)
        if res.done { self.currentStep = nil }
    }

    private func applyNextResult(_ res: WizardNextResult) {
        self.status = anyCodableStringValue(res.status) ?? self.status
        self.errorMessage = res.error
        self.currentStep = decodeWizardStep(res.step)
        if res.done { self.currentStep = nil }
        if res.done || anyCodableStringValue(res.status) == "done" || anyCodableStringValue(res.status) == "cancelled"
            || anyCodableStringValue(res.status) == "error" {
            self.sessionId = nil
        }
    }

    private func applyStatusResult(_ res: WizardStatusResult) {
        self.status = anyCodableStringValue(res.status) ?? "unknown"
        self.errorMessage = res.error
        self.currentStep = nil
        self.sessionId = nil
    }
}

struct OnboardingWizardStepView: View {
    let step: WizardStep
    let isSubmitting: Bool
    let onSubmit: (AnyCodable?) -> Void

    @State private var textValue: String
    @State private var confirmValue: Bool
    @State private var selectedIndex: Int
    @State private var selectedIndices: Set<Int>

    private let optionItems: [WizardOptionItem]

    init(step: WizardStep, isSubmitting: Bool, onSubmit: @escaping (AnyCodable?) -> Void) {
        self.step = step
        self.isSubmitting = isSubmitting
        self.onSubmit = onSubmit
        let options = parseWizardOptions(step.options).enumerated().map { index, option in
            WizardOptionItem(index: index, option: option)
        }
        self.optionItems = options
        let initialText = anyCodableString(step.initialvalue)
        let initialConfirm = anyCodableBool(step.initialvalue)
        let initialIndex = options.firstIndex(where: { anyCodableEqual($0.option.value, step.initialvalue) }) ?? 0
        let initialMulti = Set(
            options.filter { option in
                anyCodableArray(step.initialvalue).contains { anyCodableEqual($0, option.option.value) }
            }.map { $0.index }
        )

        _textValue = State(initialValue: initialText)
        _confirmValue = State(initialValue: initialConfirm)
        _selectedIndex = State(initialValue: initialIndex)
        _selectedIndices = State(initialValue: initialMulti)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let title = step.title, !title.isEmpty {
                Text(title)
                    .font(.title2.weight(.semibold))
            }
            if let message = step.message, !message.isEmpty {
                Text(message)
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            switch wizardStepType(step) {
            case "note":
                EmptyView()
            case "text":
                textField
            case "confirm":
                Toggle("", isOn: $confirmValue)
                    .toggleStyle(.switch)
            case "select":
                selectOptions
            case "multiselect":
                multiselectOptions
            case "progress":
                ProgressView()
                    .controlSize(.small)
            case "action":
                EmptyView()
            default:
                Text("Unsupported step type")
                    .foregroundStyle(.secondary)
            }

            Button(action: submit) {
                Text(wizardStepType(step) == "action" ? "Run" : "Continue")
                    .frame(minWidth: 120)
            }
            .buttonStyle(.borderedProminent)
            .disabled(isSubmitting || isBlocked)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var textField: some View {
        let isSensitive = step.sensitive == true
        if isSensitive {
            SecureField(step.placeholder ?? "", text: $textValue)
                .textFieldStyle(.roundedBorder)
                .frame(maxWidth: 360)
        } else {
            TextField(step.placeholder ?? "", text: $textValue)
                .textFieldStyle(.roundedBorder)
                .frame(maxWidth: 360)
        }
    }

    private var selectOptions: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(optionItems) { item in
                Button {
                    selectedIndex = item.index
                } label: {
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: selectedIndex == item.index ? "largecircle.fill.circle" : "circle")
                            .foregroundStyle(.accent)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.option.label)
                                .foregroundStyle(.primary)
                            if let hint = item.option.hint, !hint.isEmpty {
                                Text(hint)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var multiselectOptions: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(optionItems) { item in
                Toggle(isOn: bindingForOption(item)) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.option.label)
                        if let hint = item.option.hint, !hint.isEmpty {
                            Text(hint)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
    }

    private func bindingForOption(_ item: WizardOptionItem) -> Binding<Bool> {
        Binding(get: {
            selectedIndices.contains(item.index)
        }, set: { newValue in
            if newValue {
                selectedIndices.insert(item.index)
            } else {
                selectedIndices.remove(item.index)
            }
        })
    }

    private var isBlocked: Bool {
        let type = wizardStepType(step)
        if type == "select" { return optionItems.isEmpty }
        if type == "multiselect" { return optionItems.isEmpty }
        return false
    }

    private func submit() {
        switch wizardStepType(step) {
        case "note", "progress":
            onSubmit(nil)
        case "text":
            onSubmit(AnyCodable(textValue))
        case "confirm":
            onSubmit(AnyCodable(confirmValue))
        case "select":
            guard optionItems.indices.contains(selectedIndex) else {
                onSubmit(nil)
                return
            }
            let option = optionItems[selectedIndex].option
            onSubmit(option.value ?? AnyCodable(option.label))
        case "multiselect":
            let values = optionItems
                .filter { selectedIndices.contains($0.index) }
                .map { $0.option.value ?? AnyCodable($0.option.label) }
            onSubmit(AnyCodable(values))
        case "action":
            onSubmit(AnyCodable(true))
        default:
            onSubmit(nil)
        }
    }
}

private struct WizardOptionItem: Identifiable {
    let index: Int
    let option: WizardOption

    var id: Int { index }
}

private struct WizardOption {
    let value: ProtocolAnyCodable?
    let label: String
    let hint: String?
}

private func decodeWizardStep(_ raw: [String: ProtocolAnyCodable]?) -> WizardStep? {
    guard let raw else { return nil }
    do {
        let data = try JSONEncoder().encode(raw)
        return try JSONDecoder().decode(WizardStep.self, from: data)
    } catch {
        onboardingWizardLogger.error("wizard step decode failed: \(error.localizedDescription, privacy: .public)")
        return nil
    }
}

private func parseWizardOptions(_ raw: [[String: ProtocolAnyCodable]]?) -> [WizardOption] {
    guard let raw else { return [] }
    return raw.map { entry in
        let value = entry["value"]
        let label = (entry["label"]?.value as? String) ?? ""
        let hint = entry["hint"]?.value as? String
        return WizardOption(value: value, label: label, hint: hint)
    }
}

private func wizardStepType(_ step: WizardStep) -> String {
    (step.type.value as? String) ?? ""
}

private func anyCodableString(_ value: ProtocolAnyCodable?) -> String {
    switch value?.value {
    case let string as String:
        return string
    case let int as Int:
        return String(int)
    case let double as Double:
        return String(double)
    case let bool as Bool:
        return bool ? "true" : "false"
    default:
        return ""
    }
}

private func anyCodableStringValue(_ value: ProtocolAnyCodable?) -> String? {
    value?.value as? String
}

private func anyCodableBool(_ value: ProtocolAnyCodable?) -> Bool {
    switch value?.value {
    case let bool as Bool:
        return bool
    case let string as String:
        return string.lowercased() == "true"
    default:
        return false
    }
}

private func anyCodableArray(_ value: ProtocolAnyCodable?) -> [ProtocolAnyCodable] {
    switch value?.value {
    case let arr as [ProtocolAnyCodable]:
        return arr
    case let arr as [Any]:
        return arr.map { ProtocolAnyCodable($0) }
    default:
        return []
    }
}

private func anyCodableEqual(_ lhs: ProtocolAnyCodable?, _ rhs: ProtocolAnyCodable?) -> Bool {
    switch (lhs?.value, rhs?.value) {
    case let (l as String, r as String):
        return l == r
    case let (l as Int, r as Int):
        return l == r
    case let (l as Double, r as Double):
        return l == r
    case let (l as Bool, r as Bool):
        return l == r
    case let (l as String, r as Int):
        return l == String(r)
    case let (l as Int, r as String):
        return String(l) == r
    case let (l as String, r as Double):
        return l == String(r)
    case let (l as Double, r as String):
        return String(l) == r
    default:
        return false
    }
}
