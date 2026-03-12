import CoreGraphics
import SwiftUI

@MainActor
final class SelectionState: ObservableObject {
  @Published var currentRect: CGRect = .zero
  @Published var isSelecting = false
  @Published var capturedImage: CGImage?
  @Published var dragStart: CGPoint?
  @Published var statusMessage = "Press Cmd+K to capture the current display."

  func beginSelection(at point: CGPoint) {
    dragStart = point
    isSelecting = true
    currentRect = .zero
  }

  func updateSelection(to point: CGPoint) {
    guard let dragStart else {
      beginSelection(at: point)
      return
    }

    currentRect = SelectionRenderer.normalizedRect(from: dragStart, to: point)
  }

  func finishSelection(at point: CGPoint) -> CGRect {
    defer {
      dragStart = nil
      isSelecting = false
    }

    guard let dragStart else {
      currentRect = .zero
      return .zero
    }

    let rect = SelectionRenderer.normalizedRect(from: dragStart, to: point)
    currentRect = rect
    return rect
  }

  func resetSelection() {
    dragStart = nil
    currentRect = .zero
    isSelecting = false
  }

  func resetCaptureState() {
    resetSelection()
    capturedImage = nil
    statusMessage = "Press Cmd+K to capture the current display."
  }
}
