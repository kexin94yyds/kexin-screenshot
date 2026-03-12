import AppKit
import ScreenCaptureKit

enum ScreenCaptureError: Error {
  case permissionDenied
  case unsupported
  case notImplemented
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

  func captureCurrentDisplay() async throws -> CGImage {
    guard permissionState() == .granted else {
      throw ScreenCaptureError.permissionDenied
    }

    guard #available(macOS 13.0, *) else {
      throw ScreenCaptureError.unsupported
    }

    // Skeleton only: ScreenCaptureKit integration will be filled in Phase 1.
    throw ScreenCaptureError.notImplemented
  }
}
