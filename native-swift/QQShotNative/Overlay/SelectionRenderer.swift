import CoreGraphics

enum SelectionRenderer {
  static func normalizedRect(from start: CGPoint, to end: CGPoint) -> CGRect {
    CGRect(
      x: min(start.x, end.x),
      y: min(start.y, end.y),
      width: abs(end.x - start.x),
      height: abs(end.y - start.y)
    )
  }

  static func imageCropRect(
    from selectionRect: CGRect,
    in viewSize: CGSize,
    imageSize: CGSize
  ) -> CGRect {
    guard
      selectionRect.width > 0,
      selectionRect.height > 0,
      viewSize.width > 0,
      viewSize.height > 0,
      imageSize.width > 0,
      imageSize.height > 0
    else {
      return .zero
    }

    let scaleX = imageSize.width / viewSize.width
    let scaleY = imageSize.height / viewSize.height
    let cropRect = CGRect(
      x: selectionRect.origin.x * scaleX,
      y: (viewSize.height - selectionRect.maxY) * scaleY,
      width: selectionRect.width * scaleX,
      height: selectionRect.height * scaleY
    ).integral

    let imageBounds = CGRect(origin: .zero, size: imageSize)
    return cropRect.intersection(imageBounds)
  }
}
