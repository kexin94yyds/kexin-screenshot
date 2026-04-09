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

## 结论

1. `ScreenCaptureKit` 原生截图本体在预热后并不是最主要的瓶颈。
2. 首开慢更像是整条 UI 链路被串行放大：
   - 截图生成
   - 主进程处理预览资源
   - renderer 解码预览图
   - overlay 等待首帧绘制完成
3. 拖动流畅度问题主要集中在 overlay 层的同步重绘热区。

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
