import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

enum PNGFileWriter {
  static func write(_ image: CGImage, to url: URL) throws {
    guard let destination = CGImageDestinationCreateWithURL(
      url as CFURL,
      UTType.png.identifier as CFString,
      1,
      nil
    ) else {
      throw PNGFileWriterError.cannotCreateDestination
    }

    CGImageDestinationAddImage(destination, image, nil)

    guard CGImageDestinationFinalize(destination) else {
      throw PNGFileWriterError.cannotFinalizeDestination
    }
  }
}

enum PNGFileWriterError: Error {
  case cannotCreateDestination
  case cannotFinalizeDestination
}
