import CoreGraphics
import Foundation

let arguments = Array(CommandLine.arguments.dropFirst())
let shouldWarmupOnly = arguments.contains("--warmup")
let shouldRunServer = arguments.contains("--server")

guard shouldRunServer || shouldWarmupOnly || parseOutputPath(from: arguments) != nil else {
  fputs("Missing required --output <path> argument.\n", stderr)
  exit(64)
}

let outputPath = parseOutputPath(from: arguments)
let outputURL = outputPath.map(URL.init(fileURLWithPath:))

if shouldRunServer {
  Task.detached {
    while let line = readLine() {
      await handleServerCommand(line)
    }

    exit(0)
  }

  dispatchMain()
}

Task {
  do {
    if shouldWarmupOnly {
      try await performWarmup()
      exit(0)
    }

    guard let outputURL else {
      fputs("Missing required --output <path> argument.\n", stderr)
      exit(64)
    }

    try await performCapture(to: outputURL)
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
private func performCapture(to outputURL: URL) async throws {
  try FileManager.default.createDirectory(
    at: outputURL.deletingLastPathComponent(),
    withIntermediateDirectories: true
  )

  let frame = try await ScreenCaptureService().captureCurrentDisplay()
  try PNGFileWriter.write(frame.image, to: outputURL)
}

@MainActor
private func performWarmup() async throws {
  try await ScreenCaptureService().warmupCurrentDisplayCapture()
}

private struct ServerCommand: Codable {
  let id: String
  let type: String
  let outputPath: String?
}

private struct ServerResponse: Codable {
  let id: String
  let ok: Bool
  let outputPath: String?
  let snapCandidates: [WindowSnapCandidate]?
  let error: String?

  init(
    id: String,
    ok: Bool,
    outputPath: String? = nil,
    snapCandidates: [WindowSnapCandidate]? = nil,
    error: String? = nil
  ) {
    self.id = id
    self.ok = ok
    self.outputPath = outputPath
    self.snapCandidates = snapCandidates
    self.error = error
  }
}

private struct WindowSnapCandidate: Codable {
  let windowId: UInt32
  let ownerName: String
  let title: String
  let x: Double
  let y: Double
  let width: Double
  let height: Double
}

private func handleServerCommand(_ line: String) async {
  let decoder = JSONDecoder()

  guard let data = line.data(using: .utf8),
    let command = try? decoder.decode(ServerCommand.self, from: data)
  else {
    writeServerResponse(
      ServerResponse(id: "unknown", ok: false, outputPath: nil, error: "Invalid command")
    )
    return
  }

  do {
    switch command.type {
    case "warmup":
      try await performWarmup()
      writeServerResponse(
        ServerResponse(id: command.id, ok: true)
      )
    case "capture":
      guard let outputPath = command.outputPath else {
        throw ServerCommandError.missingOutputPath
      }

      let outputURL = URL(fileURLWithPath: outputPath)
      try await performCapture(to: outputURL)
      writeServerResponse(
        ServerResponse(id: command.id, ok: true, outputPath: outputURL.path)
      )
    case "windows":
      writeServerResponse(
        ServerResponse(
          id: command.id,
          ok: true,
          snapCandidates: fetchWindowSnapCandidates()
        )
      )
    default:
      throw ServerCommandError.unsupportedCommand
    }
  } catch {
    writeServerResponse(
      ServerResponse(
        id: command.id,
        ok: false,
        error: error.localizedDescription
      )
    )
  }
}

private func fetchWindowSnapCandidates() -> [WindowSnapCandidate] {
  let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
  guard let windows = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
    return []
  }

  return windows.compactMap { info -> WindowSnapCandidate? in
    let layer = info[kCGWindowLayer as String] as? Int ?? 0
    guard layer == 0 else {
      return nil
    }

    let alpha = info[kCGWindowAlpha as String] as? Double ?? 1
    guard alpha > 0.05 else {
      return nil
    }

    guard let boundsInfo = info[kCGWindowBounds as String] as? CFDictionary,
      let bounds = CGRect(dictionaryRepresentation: boundsInfo)
    else {
      return nil
    }

    guard bounds.width >= 80, bounds.height >= 60 else {
      return nil
    }

    let ownerName = info[kCGWindowOwnerName as String] as? String ?? ""
    let title = info[kCGWindowName as String] as? String ?? ""
    guard !ownerName.isEmpty else {
      return nil
    }

    let windowId = info[kCGWindowNumber as String] as? UInt32 ?? 0
    return WindowSnapCandidate(
      windowId: windowId,
      ownerName: ownerName,
      title: title,
      x: Double(bounds.origin.x),
      y: Double(bounds.origin.y),
      width: Double(bounds.width),
      height: Double(bounds.height)
    )
  }
}

private func writeServerResponse(_ response: ServerResponse) {
  let encoder = JSONEncoder()

  guard let data = try? encoder.encode(response),
    let text = String(data: data, encoding: .utf8)
  else {
    fputs("{\"id\":\"unknown\",\"ok\":false,\"error\":\"Encoding response failed\"}\n", stdout)
    fflush(stdout)
    return
  }

  fputs("\(text)\n", stdout)
  fflush(stdout)
}

enum ServerCommandError: Error {
  case missingOutputPath
  case unsupportedCommand
}
