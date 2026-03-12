import CoreGraphics

struct DisplayDescriptor: Identifiable, Equatable {
  let id: Int
  let frame: CGRect
  let scaleFactor: CGFloat
  let isPrimary: Bool
}

struct CapturedFrame {
  let image: CGImage
  let display: DisplayDescriptor
}
