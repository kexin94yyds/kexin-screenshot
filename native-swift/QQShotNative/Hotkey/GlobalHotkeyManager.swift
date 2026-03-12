import Carbon

final class GlobalHotkeyManager {
  var onCaptureRequested: (() -> Void)?

  private var hotKeyRef: EventHotKeyRef?
  private var eventHandler: EventHandlerRef?

  func start() {
    guard hotKeyRef == nil else {
      return
    }

    let hotKeyID = EventHotKeyID(signature: OSType(0x51534854), id: 1)
    let modifiers = UInt32(cmdKey)
    RegisterEventHotKey(UInt32(kVK_ANSI_K), modifiers, hotKeyID, GetApplicationEventTarget(), 0, &hotKeyRef)

    var eventType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
    InstallEventHandler(
      GetApplicationEventTarget(),
      { _, eventRef, userData in
        guard let userData else {
          return noErr
        }

        let manager = Unmanaged<GlobalHotkeyManager>.fromOpaque(userData).takeUnretainedValue()
        var hotKeyID = EventHotKeyID()
        let status = GetEventParameter(
          eventRef,
          EventParamName(kEventParamDirectObject),
          EventParamType(typeEventHotKeyID),
          nil,
          MemoryLayout<EventHotKeyID>.size,
          nil,
          &hotKeyID
        )

        if status == noErr && hotKeyID.signature == OSType(0x51534854) && hotKeyID.id == 1 {
          manager.onCaptureRequested?()
        }

        return noErr
      },
      1,
      &eventType,
      UnsafeMutableRawPointer(Unmanaged.passUnretained(self).toOpaque()),
      &eventHandler
    )
  }

  func stop() {
    if let hotKeyRef {
      UnregisterEventHotKey(hotKeyRef)
      self.hotKeyRef = nil
    }

    if let eventHandler {
      RemoveEventHandler(eventHandler)
      self.eventHandler = nil
    }
  }

  deinit {
    stop()
  }
}
