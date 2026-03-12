import AppKit

enum FileSaver {
  @MainActor
  static func promptForSaveURL(defaultName: String) -> URL? {
    let panel = NSSavePanel()
    panel.nameFieldStringValue = defaultName
    panel.allowedContentTypes = [.png]
    return panel.runModal() == .OK ? panel.url : nil
  }
}
