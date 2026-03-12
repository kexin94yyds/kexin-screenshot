import CoreGraphics
import XCTest
@testable import QQShotNative

final class GeometryTests: XCTestCase {
  func testNormalizedRectAlwaysUsesTopLeftOriginAndPositiveSize() {
    let rect = SelectionRenderer.normalizedRect(
      from: CGPoint(x: 40, y: 60),
      to: CGPoint(x: 10, y: 20)
    )

    XCTAssertEqual(rect.origin.x, 10)
    XCTAssertEqual(rect.origin.y, 20)
    XCTAssertEqual(rect.width, 30)
    XCTAssertEqual(rect.height, 40)
  }
}
