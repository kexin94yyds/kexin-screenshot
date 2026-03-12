import AppKit

final class DisplayRegistry {
  func currentDisplay() -> DisplayDescriptor? {
    let location = NSEvent.mouseLocation
    return availableDisplays().first { descriptor in
      descriptor.frame.contains(location)
    } ?? availableDisplays().first(where: \.isPrimary)
  }

  func availableDisplays() -> [DisplayDescriptor] {
    NSScreen.screens.map { screen in
      let frame = screen.frame
      let deviceDescription = screen.deviceDescription
      let screenNumber = deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber

      return DisplayDescriptor(
        id: screenNumber?.intValue ?? 0,
        frame: frame,
        scaleFactor: screen.backingScaleFactor,
        isPrimary: screen == NSScreen.screens.first
      )
    }
  }
}
