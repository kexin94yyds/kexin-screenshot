import AppKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
  private let sceneController = SceneController()
  private let hotkeyManager = GlobalHotkeyManager()

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.setActivationPolicy(.accessory)

    sceneController.prepareOverlay()
    hotkeyManager.onCaptureRequested = { [weak self] in
      self?.sceneController.captureCurrentDisplay()
    }
    hotkeyManager.start()

    Logger.shared.log("QQShotNative skeleton launched")
  }

  func applicationWillTerminate(_ notification: Notification) {
    hotkeyManager.stop()
  }
}
