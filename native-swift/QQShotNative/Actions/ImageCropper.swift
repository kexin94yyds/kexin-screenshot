import CoreGraphics

enum ImageCropper {
  static func crop(_ image: CGImage, to rect: CGRect) -> CGImage? {
    image.cropping(to: rect.integral)
  }
}
