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
  let error: String?
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
        ServerResponse(id: command.id, ok: true, outputPath: nil, error: nil)
      )
    case "capture":
      guard let outputPath = command.outputPath else {
        throw ServerCommandError.missingOutputPath
      }

      let outputURL = URL(fileURLWithPath: outputPath)
      try await performCapture(to: outputURL)
      writeServerResponse(
        ServerResponse(id: command.id, ok: true, outputPath: outputURL.path, error: nil)
      )
    default:
      throw ServerCommandError.unsupportedCommand
    }
  } catch {
    writeServerResponse(
      ServerResponse(
        id: command.id,
        ok: false,
        outputPath: nil,
        error: error.localizedDescription
      )
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
