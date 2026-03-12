import CoreGraphics
import SwiftUI

final class SelectionState: ObservableObject {
  @Published var currentRect: CGRect = .zero
  @Published var isSelecting = false
}
