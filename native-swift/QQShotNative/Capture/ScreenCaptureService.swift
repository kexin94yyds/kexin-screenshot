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

  func warmupCurrentDisplayCapture() async throws {
    _ = try await resolveCurrentDisplayTarget()
  }

  func captureCurrentDisplay() async throws -> CapturedFrame {
    let (currentDisplay, targetDisplay) = try await resolveCurrentDisplayTarget()

    let configuration = SCStreamConfiguration()
    configuration.width = Int(currentDisplay.frame.width * currentDisplay.scaleFactor)
    configuration.height = Int(currentDisplay.frame.height * currentDisplay.scaleFactor)

    let image = try await SCScreenshotManager.captureImage(
      contentFilter: SCContentFilter(
        display: targetDisplay,
        excludingApplications: [],
        exceptingWindows: []
      ),
      configuration: configuration
    )

    return CapturedFrame(image: image, display: currentDisplay)
  }

  private func resolveCurrentDisplayTarget() async throws -> (DisplayDescriptor, SCDisplay) {
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

    return (currentDisplay, targetDisplay)
  }
}
