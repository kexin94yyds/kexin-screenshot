import AppKit
import SwiftUI

@MainActor
final class SceneController {
  private let selectionState = SelectionState()
  private var overlayWindow: OverlayWindow?

  func prepareOverlay() {
    guard overlayWindow == nil else {
      return
    }

    let contentView = OverlayView(selectionState: selectionState)
    let hostingView = NSHostingView(rootView: contentView)
    let targetFrame = NSScreen.main?.frame ?? .zero
    let window = OverlayWindow(contentRect: targetFrame)

    window.contentView = hostingView
    window.orderOut(nil)

    overlayWindow = window
  }

  func showOverlay() {
    overlayWindow?.setFrame(NSScreen.main?.frame ?? .zero, display: true)
    overlayWindow?.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  func hideOverlay() {
    overlayWindow?.orderOut(nil)
  }

  func toggleOverlay() {
    guard let overlayWindow else {
      prepareOverlay()
      showOverlay()
      return
    }

    if overlayWindow.isVisible {
      hideOverlay()
      return
    }

    showOverlay()
  }
}
