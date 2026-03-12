import AppKit
import CoreGraphics

enum ClipboardWriter {
  static func write(_ image: CGImage) {
    let nsImage = NSImage(
      cgImage: image,
      size: NSSize(width: image.width, height: image.height)
    )
    write(nsImage)
  }

  static func write(_ image: NSImage) {
    let pasteboard = NSPasteboard.general
    pasteboard.clearContents()
    pasteboard.writeObjects([image])
  }
}
