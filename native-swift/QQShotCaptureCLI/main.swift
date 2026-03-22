import Foundation

let arguments = Array(CommandLine.arguments.dropFirst())

guard let outputPath = parseOutputPath(from: arguments) else {
  fputs("Missing required --output <path> argument.\n", stderr)
  exit(64)
}

let outputURL = URL(fileURLWithPath: outputPath)
let outputDirectory = outputURL.deletingLastPathComponent()

Task {
  do {
    try FileManager.default.createDirectory(
      at: outputDirectory,
      withIntermediateDirectories: true
    )

    let frame = try await captureCurrentDisplay()

    try PNGFileWriter.write(frame.image, to: outputURL)
    fputs("\(outputURL.path)\n", stdout)
    exit(0)
  } catch ScreenCaptureError.permissionDenied {
    fputs("Screen capture permission is missing.\n", stderr)
    exit(65)
  } catch ScreenCaptureError.unsupported {
    fputs("ScreenCaptureKit requires macOS 14.0 or later.\n", stderr)
    exit(66)
  } catch ScreenCaptureError.displayUnavailable {
    fputs("Unable to resolve the current display.\n", stderr)
    exit(67)
  } catch {
    fputs("\(error.localizedDescription)\n", stderr)
    exit(1)
  }
}

dispatchMain()

private func parseOutputPath(from arguments: [String]) -> String? {
  guard let outputFlagIndex = arguments.firstIndex(of: "--output") else {
    return nil
  }

  let valueIndex = arguments.index(after: outputFlagIndex)
  guard valueIndex < arguments.endIndex else {
    return nil
  }

  return arguments[valueIndex]
}

@MainActor
private func captureCurrentDisplay() async throws -> CapturedFrame {
  try await ScreenCaptureService().captureCurrentDisplay()
}
