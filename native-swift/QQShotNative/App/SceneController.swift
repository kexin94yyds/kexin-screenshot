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

    let contentView = OverlayView(
      selectionState: selectionState,
      onSelectionCommitted: { [weak self] selectionRect, viewSize in
        self?.commitSelection(selectionRect, in: viewSize)
      }
    )
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
    selectionState.resetSelection()
    overlayWindow?.setFrame(display?.frame ?? NSScreen.main?.frame ?? .zero, display: true)
    overlayWindow?.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  func hideOverlay() {
    overlayWindow?.orderOut(nil)
    selectionState.resetCaptureState()
  }

  func captureCurrentDisplay() {
    Task { @MainActor [weak self] in
      guard let self else {
        return
      }

      do {
        let capturedFrame = try await captureService.captureCurrentDisplay()
        selectionState.capturedImage = capturedFrame.image
        selectionState.statusMessage = "Drag to select an area. Release to copy. Press Esc to cancel."
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

  private func commitSelection(_ selectionRect: CGRect, in viewSize: CGSize) {
    guard selectionRect.width >= 4, selectionRect.height >= 4 else {
      selectionState.statusMessage = "Selection is too small. Drag a larger area or press Esc to cancel."
      selectionState.resetSelection()
      return
    }

    guard let capturedImage = selectionState.capturedImage else {
      selectionState.statusMessage = "No captured frame is available yet. Press Cmd+K to try again."
      return
    }

    let cropRect = SelectionRenderer.imageCropRect(
      from: selectionRect,
      in: viewSize,
      imageSize: CGSize(width: capturedImage.width, height: capturedImage.height)
    )

    guard let croppedImage = ImageCropper.crop(capturedImage, to: cropRect) else {
      selectionState.statusMessage = "Failed to crop the selected area. Try again."
      selectionState.resetSelection()
      return
    }

    ClipboardWriter.write(croppedImage)
    hideOverlay()
  }
}
