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
  private var cachedDisplayTarget: (display: DisplayDescriptor, target: SCDisplay)?

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

    do {
      let image = try await captureImage(for: currentDisplay, targetDisplay: targetDisplay)
      return CapturedFrame(image: image, display: currentDisplay)
    } catch {
      cachedDisplayTarget = nil

      let (refreshedDisplay, refreshedTargetDisplay) = try await resolveCurrentDisplayTarget()
      let image = try await captureImage(
        for: refreshedDisplay,
        targetDisplay: refreshedTargetDisplay
      )
      return CapturedFrame(image: image, display: refreshedDisplay)
    }
  }

  private func captureImage(
    for display: DisplayDescriptor,
    targetDisplay: SCDisplay
  ) async throws -> CGImage {
    let configuration = SCStreamConfiguration()
    configuration.width = Int(display.frame.width * display.scaleFactor)
    configuration.height = Int(display.frame.height * display.scaleFactor)

    return try await SCScreenshotManager.captureImage(
      contentFilter: SCContentFilter(
        display: targetDisplay,
        excludingApplications: [],
        exceptingWindows: []
      ),
      configuration: configuration
    )
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

    if let cachedDisplayTarget, displayMatches(cachedDisplayTarget.display, currentDisplay) {
      return (currentDisplay, cachedDisplayTarget.target)
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

    cachedDisplayTarget = (display: currentDisplay, target: targetDisplay)
    return (currentDisplay, targetDisplay)
  }

  private func displayMatches(_ lhs: DisplayDescriptor, _ rhs: DisplayDescriptor) -> Bool {
    lhs.id == rhs.id &&
      abs(lhs.frame.origin.x - rhs.frame.origin.x) < 1 &&
      abs(lhs.frame.origin.y - rhs.frame.origin.y) < 1 &&
      abs(lhs.frame.width - rhs.frame.width) < 1 &&
      abs(lhs.frame.height - rhs.frame.height) < 1 &&
      abs(lhs.scaleFactor - rhs.scaleFactor) < 0.01
  }
}
