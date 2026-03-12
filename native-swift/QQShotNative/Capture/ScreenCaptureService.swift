import AppKit
import ScreenCaptureKit

enum ScreenCaptureError: Error {
  case permissionDenied
  case unsupported
  case displayUnavailable
}

@MainActor
final class ScreenCaptureService {
  private let displayRegistry = DisplayRegistry()

  func permissionState() -> CapturePermissionState {
    CapturePermissions.currentState()
  }

  func availableDisplays() -> [DisplayDescriptor] {
    displayRegistry.availableDisplays()
  }

  func captureCurrentDisplay() async throws -> CapturedFrame {
    guard permissionState() == .granted else {
      throw ScreenCaptureError.permissionDenied
    }

    guard #available(macOS 14.0, *) else {
      throw ScreenCaptureError.unsupported
    }

    guard let currentDisplay = displayRegistry.currentDisplay() else {
      throw ScreenCaptureError.displayUnavailable
    }

    let shareableContent = try await SCShareableContent.excludingDesktopWindows(
      false,
      onScreenWindowsOnly: true
    )

    guard let targetDisplay = shareableContent.displays.first(where: {
      abs($0.frame.origin.x - currentDisplay.frame.origin.x) < 1 &&
        abs($0.frame.origin.y - currentDisplay.frame.origin.y) < 1 &&
        abs($0.frame.width - currentDisplay.frame.width) < 1 &&
        abs($0.frame.height - currentDisplay.frame.height) < 1
    }) else {
      throw ScreenCaptureError.displayUnavailable
    }

    let filter = SCContentFilter(
      display: targetDisplay,
      excludingApplications: [],
      exceptingWindows: []
    )
    let configuration = SCStreamConfiguration()
    configuration.width = Int(currentDisplay.frame.width * currentDisplay.scaleFactor)
    configuration.height = Int(currentDisplay.frame.height * currentDisplay.scaleFactor)

    let image = try await SCScreenshotManager.captureImage(
      contentFilter: filter,
      configuration: configuration
    )

    return CapturedFrame(image: image, display: currentDisplay)
  }
}
