import XCTest
@testable import QQShotNative

final class CaptureTests: XCTestCase {
  func testPermissionStateHasKnownRawValues() {
    XCTAssertEqual(CapturePermissionState.granted.rawValue, "granted")
    XCTAssertEqual(CapturePermissionState.denied.rawValue, "denied")
  }
}
