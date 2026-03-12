import CoreGraphics
import SwiftUI

final class SelectionState: ObservableObject {
  @Published var currentRect: CGRect = .zero
  @Published var isSelecting = false
  @Published var capturedImage: CGImage?
  @Published var statusMessage = "Press Cmd+K to capture the current display."
}
