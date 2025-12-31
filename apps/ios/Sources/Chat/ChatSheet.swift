import ClawdisChatUI
import SwiftUI

struct ChatSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var viewModel: ClawdisChatViewModel
    private let userAccent: Color?

    init(bridge: BridgeSession, sessionKey: String = "main", userAccent: Color? = nil) {
        let transport = IOSBridgeChatTransport(bridge: bridge)
        self._viewModel = State(
            initialValue: ClawdisChatViewModel(
                sessionKey: sessionKey,
                transport: transport))
        self.userAccent = userAccent
    }

    var body: some View {
        NavigationStack {
            ClawdisChatView(viewModel: self.viewModel, userAccent: self.userAccent)
                .navigationTitle("Chat")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            self.dismiss()
                        } label: {
                            Image(systemName: "xmark")
                        }
                        .accessibilityLabel("Close")
                    }
                }
        }
    }
}
