# QQ 截屏性能优化总结

日期：2026-04-09

## 背景

本轮优化目标优先处理两类体验问题：

1. 首开截图时从快捷键触发到遮罩显示的延迟
2. 拖拽过程，尤其是标注/马赛克相关的流畅度

## 测量结果

本地编译原生 helper 后，针对 `QQShotCaptureCLI` 做了两组测量：

### 原生 helper 基线

- 冷 `warmup`：约 `0.48s`
- 单次独立 `capture`：约 `0.21s`

### 常驻 `--server` 模式

- `warmup`：约 `78.7ms`
- 连续 3 次 `capture`：约 `165.8ms / 110.7ms / 116.0ms`

### 真实 Electron 首开链路

通过实际启动应用并触发 `Cmd+K`，抓到主链路日志：

- 第一次 `capture startup timing`：`218ms`
- 第二次 `capture startup timing`：`153ms`

对应日志里的关键阶段：

- 第一次 `captureElapsedMs`：`165ms`
- 第二次 `captureElapsedMs`：`106ms`

## 结论

1. `ScreenCaptureKit` 原生截图本体在预热后并不是最主要的瓶颈。
2. 首开慢更像是整条 UI 链路被串行放大：
   - 截图生成
   - 主进程处理预览资源
   - renderer 解码预览图
   - overlay 等待首帧绘制完成
3. 在当前这台机器上，真实主链路首开大约在 `218ms`，热路径约 `153ms`。
4. 拖动流畅度问题主要集中在 overlay 层的同步重绘热区。

## 本轮保留的优化

### 1. 选区拖拽阶段跳过无意义的 annotation/mosaic 重绘

文件：`src/overlay.js`

优化点：

- 在用户刚开始拖拽选区、尚未产生任何标注时，不再调用 `renderAnnotations()`
- 避免每个 `mousemove` 都去清空/重绘 annotation 与 mosaic 图层

收益：

- 降低初始框选阶段的无效 canvas/SVG 工作量
- 改动面小，风险低

## 本轮已验证但未保留的尝试

### helper display 解析缓存

文件：`native-swift/QQShotNative/Capture/ScreenCaptureService.swift`

尝试过在 helper 内缓存 display 解析结果，让 `warmup` 直接服务下一次 capture。

结果：

- 收益不稳定
- 部分测量下没有明显优于基线
- 复杂度上升，不值得在当前证据不足时保留

因此该实验已回退。

## 已记录到知识库的问题

已写入：

- `~/.cunzhi-knowledge/experience/problems.md`

问题主题：

- qq 截屏首开链路存在临时 PNG 落盘后重复解码，首开延迟被主进程与 renderer 串行放大

## 后续建议

如果继续往下优化，建议按这个顺序推进：

1. 给 Electron 主链路补更细的阶段耗时日志：
   - helper capture 完成
   - preview 发送到 renderer
   - image load 完成
   - overlay 可交互
2. 若首开仍慢，继续压主进程与 renderer 之间的预览资源处理链路。
3. 若用户主要感知在标注阶段，再继续细化马赛克重绘策略。

## 本轮运行环境补充

本机最开始无法直接 `npm start`，不是业务代码错误，而是运行环境缺少本地 Electron 二进制：

- 项目根目录最初没有可用的 `node_modules/electron/dist/Electron.app`
- `npm install` 走 `electron install.js` 时因下载超时失败

最终采用的处理方式：

1. 先执行 `npm install --ignore-scripts`
2. 再手动下载 `electron-v40.8.0-darwin-arm64.zip`
3. 解压到 `node_modules/electron/dist`
4. 写入 `node_modules/electron/path.txt`

这样后续 `npm start` 已可正常启动并产生日志。
