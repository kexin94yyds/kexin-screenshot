# QQShot Native

Swift native skeleton for the screenshot tool.

Current scope:
- keep the Electron app untouched
- scaffold a native macOS app target side-by-side
- split the codebase into app, capture, overlay, actions, hotkey, and shared layers
- keep ScreenCaptureKit integration as the next implementation step

Generation:

```bash
cd /Users/apple/qq 截屏/native-swift
xcodegen generate
```

Build:

```bash
xcodebuild -project QQShotNative.xcodeproj -scheme QQShotNative -configuration Debug build
```
