import CoreGraphics

enum CapturePermissionState: String {
  case granted
  case denied
}

enum CapturePermissions {
  static func currentState() -> CapturePermissionState {
    CGPreflightScreenCaptureAccess() ? .granted : .denied
  }
}
