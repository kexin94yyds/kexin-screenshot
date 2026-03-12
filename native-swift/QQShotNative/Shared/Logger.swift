import Foundation

final class Logger {
  static let shared = Logger()

  private init() {}

  func log(_ message: String) {
    print("[QQShotNative] \(message)")
  }
}
