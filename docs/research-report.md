# macOS 截屏工具调研报告

## 一、QQ 截图 (Snip) 核心功能

来源：https://snip.qq.com/

1. **窗口自动检测** - 鼠标悬停自动高亮窗口
2. **区域手动选择** - 拖拽框选自定义区域
3. **滚动截屏** - 捕获整个滚动窗口
4. **标注编辑** - 矩形、椭圆、箭头、手写笔刷
5. **Retina 支持** - 高分辨率截图
6. **剪贴板集成** - 快速复制分享
7. **QQ 邮箱集成** - 直接分享给好友

## 二、技术方案对比

### 方案 A：Electron（当前项目）
- **优点**：跨平台、开发快、Web 技术栈熟悉
- **缺点**：包体大（~150MB）、内存占用高
- **API**：`desktopCapturer.getSources()`

### 方案 B：Swift + ScreenCaptureKit（推荐原生）
- **优点**：包体小（~5MB）、性能好、系统集成深
- **缺点**：仅 macOS、学习成本
- **API**：`SCScreenshotManager`、`SCStreamConfiguration`
- **最低版本**：macOS 12.3+

### 方案 C：Swift + CGWindowListCreateImage（兼容）
- **优点**：兼容旧系统
- **缺点**：API 较老，功能有限
- **最低版本**：macOS 10.5+

## 三、开源参考项目

### 1. sadopc/ScreenCapture ⭐ 推荐
- **地址**：https://github.com/sadopc/ScreenCapture
- **技术栈**：Swift 6 + SwiftUI + ScreenCaptureKit
- **功能**：
  - 全屏/区域截屏
  - 标注工具（矩形、箭头、手绘、文字）
  - OCR 文字识别
  - 多显示器支持
  - 剪贴板集成

### 2. QuickRecorder
- **地址**：https://github.com/lihaoyun6/QuickRecorder
- **特点**：产品级工程，权限处理完善，Presenter Overlay

### 3. Azayaka
- **地址**：https://github.com/Mnpn/Azayaka
- **特点**：体量小、结构清晰，适合学习现代 macOS 录屏主链路

### 4. ScrollSnap
- **地址**：https://github.com/Brkgng/ScrollSnap
- **特点**：overlay manager、selection rectangle、scrolling capture、image stitching

### 5. nirix/swift-screencapture
- **地址**：https://github.com/nirix/swift-screencapture
- **特点**：轻量框架，调用系统 screencapture 命令
- **API**：`ScreenCapture.captureRegion(path)`

### 6. ksnip（跨平台）
- **地址**：https://github.com/ksnip/ksnip
- **技术栈**：Qt/C++
- **功能**：最全面的标注功能

## 四、Apple 官方资源

- **ScreenCaptureKit 文档**：https://developer.apple.com/documentation/screencapturekit
- **Capturing screen content in macOS**：https://developer.apple.com/documentation/screencapturekit/capturing-screen-content-in-macos
- **WWDC22 - Meet ScreenCaptureKit**：https://developer.apple.com/videos/play/wwdc2022/10156/
- **WWDC23 - What's new in ScreenCaptureKit**：https://developer.apple.com/videos/play/wwdc2023/10136/
- **CGWindowListCreateImage**：https://developer.apple.com/documentation/coregraphics/1455137-cgwindowlistcreateimage
- **权限检查 API**：`CGPreflightScreenCaptureAccess()`

## 五、腾讯设计资源

- **QQ截图全新设计复盘**：https://isux.tencent.com/articles/qq-screenshot.html
- **QQ截图工具升级公告**：https://cloud.tencent.com/developer/news/1587299

## 六、实现建议

### 如果继续用 Electron（当前方案）
当前项目已经很完整，可以考虑添加：
1. 标注功能（Canvas 绑定）
2. 菜单栏图标（Tray）
3. electron-builder 打包

### 如果想转 Swift 原生
1. 参考 `sadopc/ScreenCapture` 项目结构
2. 使用 ScreenCaptureKit 做截屏
3. SwiftUI 做 overlay 和标注 UI
4. 全局快捷键用 `CGEvent` 或 `MASShortcut`

---

*报告生成时间：2026-03-06*
