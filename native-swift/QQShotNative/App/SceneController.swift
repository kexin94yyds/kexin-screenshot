import AppKit
import SwiftUI

@MainActor
final class SceneController {
  private let selectionState = SelectionState()
  private let captureService = ScreenCaptureService()
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
    window.onEscape = { [weak self] in
      self?.hideOverlay()
    }
    window.orderOut(nil)

    overlayWindow = window
  }

  func showOverlay(on display: DisplayDescriptor? = nil) {
    overlayWindow?.setFrame(display?.frame ?? NSScreen.main?.frame ?? .zero, display: true)
    overlayWindow?.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  func hideOverlay() {
    overlayWindow?.orderOut(nil)
  }

  func captureCurrentDisplay() {
    Task { @MainActor [weak self] in
      guard let self else {
        return
      }

      do {
        let capturedFrame = try await captureService.captureCurrentDisplay()
        selectionState.capturedImage = capturedFrame.image
        selectionState.statusMessage = "ScreenCaptureKit frame ready. Press Esc to dismiss."
        showOverlay(on: capturedFrame.display)
      } catch ScreenCaptureError.permissionDenied {
        selectionState.capturedImage = nil
        selectionState.statusMessage = "Screen recording permission is missing. Grant it in System Settings."
        showOverlay()
      } catch {
        selectionState.capturedImage = nil
        selectionState.statusMessage = "ScreenCaptureKit capture is not fully wired yet: \(error.localizedDescription)"
        showOverlay()
      }
    }
  }
}
