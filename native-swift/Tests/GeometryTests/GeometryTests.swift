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

  func testImageCropRectMapsTopLeftViewCoordinatesToBottomLeftImageCoordinates() {
    let cropRect = SelectionRenderer.imageCropRect(
      from: CGRect(x: 10, y: 5, width: 30, height: 20),
      in: CGSize(width: 100, height: 50),
      imageSize: CGSize(width: 200, height: 100)
    )

    XCTAssertEqual(cropRect.origin.x, 20)
    XCTAssertEqual(cropRect.origin.y, 50)
    XCTAssertEqual(cropRect.width, 60)
    XCTAssertEqual(cropRect.height, 40)
  }
}
