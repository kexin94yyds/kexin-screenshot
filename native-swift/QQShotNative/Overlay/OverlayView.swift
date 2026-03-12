import SwiftUI

struct OverlayView: View {
  @ObservedObject var selectionState: SelectionState

  var body: some View {
    ZStack(alignment: .topLeading) {
      Color.black.opacity(0.18)
        .ignoresSafeArea()

      VStack(alignment: .leading, spacing: 8) {
        Text("QQShot Native")
          .font(.system(size: 28, weight: .semibold))
        Text("Skeleton running. Next step is wiring ScreenCaptureKit + drag selection.")
          .font(.system(size: 14))
          .foregroundStyle(.secondary)
      }
      .padding(24)
      .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18))
      .padding(24)
    }
  }
}
