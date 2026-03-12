import SwiftUI

struct OverlayView: View {
  @ObservedObject var selectionState: SelectionState

  var body: some View {
    ZStack(alignment: .topLeading) {
      if let capturedImage = selectionState.capturedImage {
        Image(decorative: capturedImage, scale: 1.0, orientation: .up)
          .resizable()
          .scaledToFill()
          .ignoresSafeArea()
      } else {
        Color.black.opacity(0.18)
          .ignoresSafeArea()
      }

      VStack(alignment: .leading, spacing: 8) {
        Text("QQShot Native")
          .font(.system(size: 28, weight: .semibold))
        Text(selectionState.statusMessage)
          .font(.system(size: 14))
          .foregroundColor(selectionState.capturedImage == nil ? .secondary : .white.opacity(0.82))
      }
      .padding(24)
      .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18))
      .padding(24)
    }
  }
}
