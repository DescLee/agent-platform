# 桌面像素宠物技术方案

## 1. 文档信息

- 目标：为 OpenWorker 增加一个脱离主页面、常驻桌面的像素宠物。
- 形象：正常状态为班纳博士；任务运行期间逐步变身为绿色巨人；任务结束后变回班纳。
- 适用端：优先支持 macOS，再补充 Windows；Linux 作为降级支持。
- 当前技术栈：Tauri 2 + React/TypeScript + Rust。
- 非目标：不实现桌面 Widget、动态壁纸或系统级 Finder/Explorer 插件。

## 2. 关键结论

用户体验上不显示普通窗口，但操作系统层面仍需要一个承载桌面内容的窗口/图层。推荐使用 Tauri 的透明无边框 WebviewWindow，并将它定义为“桌面宠物层”：

- 没有标题栏、边框、背景和任务栏图标。
- 可以置顶、拖动、隐藏和恢复。
- 主窗口隐藏到托盘后，宠物仍可继续显示任务状态。
- 宠物窗口只渲染宠物，不复用主页面的布局和路由。

完全不创建窗口是不可能的：macOS、Windows 和 Linux 都要求可见像素附着到某个窗口或系统图层。WidgetKit 和动态壁纸虽然不暴露普通窗口，但不适合实时动画、拖动及任务事件同步。

## 3. 总体架构

```text
任务/session 事件
        |
        v
主窗口 React 状态层
  - 聚合所有 session 的运行状态
  - 计算 PetState
  - 持久化用户偏好
        |
        | Tauri event: pet://state-changed
        v
Tauri 宿主进程
  - 创建/销毁/显示 pet WebviewWindow
  - 设置置顶、透明、位置和屏幕边界
  - 转发系统级窗口事件
        |
        v
独立宠物层（/pet 路由）
  - 精灵图动画播放器
  - 拖动与点击交互
  - 小型上下文菜单
```

单一事实来源是主窗口的任务状态聚合器。宠物层只消费已经计算好的状态，不直接轮询 API 或自行判断任务是否运行。

## 4. 状态模型

### 4.1 任务聚合状态

```ts
type AggregateTaskState =
  | "empty"       // 没有会话
  | "queued"      // 有任务排队但尚未开始
  | "running"     // 至少一个任务正在执行
  | "waiting"     // 等待审批、输入或外部条件
  | "completed"   // 最近一次任务成功结束
  | "failed";     // 最近一次任务失败
```

并行任务采用聚合规则，而不是绑定某一个会话：

1. `running` 优先级最高，只要存在一个运行中任务，宠物就进入工作/浩克路径。
2. 没有运行中任务时，若有等待审批的任务，显示 `waiting_banner`。
3. 没有等待任务时，若最近一次任务失败，显示 `failed_hulk` 的短暂反馈。
4. 其余情况回到班纳待机。

### 4.2 宠物状态

```ts
type PetState =
  | "idle_banner"
  | "waiting_banner"
  | "transform_start"
  | "transform_mid"
  | "transform_end"
  | "running_hulk"
  | "failed_hulk"
  | "return_start"
  | "return_end";
```

对外事件只发送状态和可选进度，不发送逐帧指令：

```ts
type PetStateEvent = {
  state: PetState;
  taskCount: number;
  activeTaskId?: string;
  progress?: number;       // 0..1，仅用于变身或任务摘要
  occurredAt: number;
};
```

### 4.3 状态转换

```text
idle_banner
  -> transform_start -> transform_mid -> transform_end -> running_hulk

running_hulk
  -> return_start -> return_end -> idle_banner

running_hulk
  -> failed_hulk (停留 2~3 秒) -> return_start

idle_banner
  -> waiting_banner -> idle_banner
```

转换必须可重入：任务在变身期间结束时，不应把动画重置到第一帧。应记录当前动画和方向，播放对应的反向/收尾动画，避免闪烁。

建议使用 800~1500ms 的变身时长。短任务也至少展示一次变身开始和结束，防止任务反馈不可见；连续任务启动时应复用当前浩克状态，不重复播放完整变身。

## 5. Tauri 窗口层设计

### 5.1 窗口创建

在 `surfaces/gui/src-tauri/src/lib.rs` 中增加 `create_pet_window`，使用 `WebviewWindowBuilder` 动态创建 `pet` 窗口。窗口参数建议：

```text
label: pet
url: index.html#/pet
inner_size: 240 x 260 logical pixels
transparent: true
decorations: false
shadow: false
resizable: false
always_on_top: true
skip_taskbar: true
focus: false
```

首次创建时使用主显示器右下角的安全位置；之后优先恢复持久化坐标。窗口大小固定，宠物精灵在内部按设备像素比缩放，避免动画帧造成窗口尺寸跳动。

### 5.2 生命周期

- 应用启动：不强制显示宠物，读取 `pet.enabled` 偏好；默认开启。
- 主窗口首次可用：创建宠物层并发送当前聚合状态。
- 主窗口隐藏到托盘：宠物层不受影响。
- 用户点击“隐藏宠物”：调用 `hide`，不销毁窗口，以便快速恢复。
- 用户退出应用：由 Tauri 统一销毁宠物层。
- 单实例唤醒：现有 `show_main(app)` 逻辑保持不变，可增加 `show_pet(app)` 或按偏好同步显示。

### 5.3 交互与拖动

宠物本体区域可拖动，菜单和按钮区域不参与拖动。优先使用 Tauri 的 `data-tauri-drag-region`；若当前 WebView 版本不稳定，则调用项目已有的 `start_window_drag` 命令。

交互定义：

- 单击：唤回主窗口并定位到当前活动会话。
- 双击：暂停/恢复“始终置顶”模式。
- 右键：显示隐藏、打开主窗口、恢复默认位置、退出应用。
- 拖动结束：保存窗口坐标和显示器标识。

透明区域默认不做全窗口鼠标穿透，否则宠物无法被拖动。若后续需要“只显示不交互”的模式，再增加 `clickThrough` 偏好并由 Rust 设置平台属性。

### 5.4 桌面边界与多显示器

位置数据保存为逻辑坐标，不保存物理像素：

```ts
type PetWindowPlacement = {
  x: number;
  y: number;
  displayId?: string;
};
```

每次启动和屏幕布局变化时执行校正：

```text
left <= x <= workArea.right - windowWidth
top  <= y <= workArea.bottom - windowHeight
```

显示器被拔出时，将宠物迁移到主显示器右下角。要使用工作区（排除 Dock、任务栏和菜单栏），不要直接使用全屏尺寸。

## 6. 前端实现

### 6.1 路由入口

在 `surfaces/gui/src/main.tsx` 或现有路由入口中增加 `/pet` 分支：

```tsx
if (window.location.hash === "#/pet") {
  createRoot(root).render(<PetWindow />);
} else {
  createRoot(root).render(<App />);
}
```

`PetWindow` 不加载侧边栏、会话列表和主页面 CSS，只引入宠物所需的最小样式。

### 6.2 动画播放器

推荐使用 CSS background-position 或 canvas 播放 WebP 精灵图。第一版用 CSS 即可：

```css
.pet-sprite {
  width: 192px;
  height: 208px;
  image-rendering: pixelated;
  background-repeat: no-repeat;
}
```

动画元数据从 `pet.json` 加载，不将帧数和速度散落在组件代码中：

```json
{
  "id": "banner-hulk",
  "displayName": "班纳/浩克",
  "cellWidth": 192,
  "cellHeight": 208,
  "columns": 8,
  "rows": {
    "idle_banner": { "row": 0, "frames": 8, "fps": 6, "loop": true },
    "transform_start": { "row": 1, "frames": 6, "fps": 8, "loop": false },
    "transform_mid": { "row": 2, "frames": 8, "fps": 10, "loop": false },
    "transform_end": { "row": 3, "frames": 6, "fps": 8, "loop": false },
    "running_hulk": { "row": 4, "frames": 8, "fps": 6, "loop": true },
    "return_start": { "row": 5, "frames": 6, "fps": 8, "loop": false },
    "return_end": { "row": 6, "frames": 6, "fps": 8, "loop": false },
    "failed_hulk": { "row": 7, "frames": 8, "fps": 5, "loop": true },
    "waiting_banner": { "row": 8, "frames": 8, "fps": 5, "loop": true }
  }
}
```

### 6.3 主窗口到宠物窗口的事件

主窗口在任务聚合状态变化时发送事件：

```ts
await emit("pet://state-changed", payload);
```

宠物窗口只监听此事件。为了处理窗口晚创建或事件丢失，主窗口应同时维护一份 `currentPetState`，宠物窗口创建完成后主动请求一次快照：

```text
event stream = 增量更新
snapshot     = 初始同步/恢复同步
```

窗口通信失败不应影响任务执行，发送事件采用 best-effort，错误只记录到调试日志。

### 6.4 性能

- 仅在宠物可见时播放动画。
- 非运行状态降至 4~6 FPS；运行状态 8~12 FPS。
- 不使用每帧 React state 更新；播放器内部使用 CSS animation 或 `requestAnimationFrame`。
- 图片使用 WebP，避免把完整 PNG 行带入运行时。
- 透明窗口尺寸保持固定，减少合成层重建。

## 7. 素材生产规范

按照 `hatch-pet` 约束建立统一精灵资源：

- 每帧 `192x208`，透明背景，固定脚底基线和安全边距。
- 班纳和浩克必须保持同一像素风、脸部识别点和色彩逻辑。
- 变身通过姿势、比例、服装破裂和肤色变化表达，不依赖光晕、阴影或漂浮特效。
- 运行状态表示“工作中/处理任务”，不画真实跑步、速度线、尘土或拖影。
- idle 必须存在轻微呼吸、眨眼或身体微动，不能是完全相同的静帧。
- 每行生成后执行帧提取、透明度检查、接触表和动画预览检查。

建议资源目录：

```text
surfaces/gui/public/pets/banner-hulk/
  spritesheet.webp
  pet.json
  preview.png
```

版权说明：如果产品公开发布，不应直接复制 Marvel 的电影造型、标志或可识别服装细节。可以保留“科学家变身绿色巨人”的叙事，但使用原创发型、服装、配色细节和名称；若必须使用“浩克”，需要确认授权范围。

## 8. 偏好与设置

建议增加以下配置：

```ts
type PetPreferences = {
  enabled: boolean;
  alwaysOnTop: boolean;
  clickThrough: boolean;
  scale: 0.75 | 1 | 1.25 | 1.5;
  soundEnabled: boolean;
  launchOnStartup: boolean;
  placement?: PetWindowPlacement;
};
```

设置入口放在主应用设置页和宠物右键菜单中。默认值：

```text
enabled=true
alwaysOnTop=true
clickThrough=false
scale=1
soundEnabled=false
launchOnStartup=false
```

音效默认关闭；若增加音效，必须提供全局静音和系统音量适配，避免任务批量运行时重复播放。

## 9. 跨平台差异与降级

### macOS

- 使用透明、无装饰、floating/nonactivating 的窗口行为。
- 不抢焦点，点击宠物时再显式激活主窗口。
- 处理多显示器工作区和 Mission Control 行为。

### Windows

- 测试高 DPI（100%、125%、150%、200%）。
- 验证透明窗口的阴影、任务栏排除和显示器热插拔。
- 确保宠物层不会额外显示控制台窗口。

### Linux

- 某些 Wayland 窗口管理器不保证始终置顶或透明点击行为。
- 能力不可用时降级为普通无边框窗口，并在设置里隐藏“始终置顶”选项。

## 10. 安全与资源管理

- 宠物窗口使用与主窗口相同的本地资源，不开放任意远程 URL。
- 不把任务输出、路径或用户数据写入宠物资源或 URL 参数。
- Tauri command 只接受枚举化的操作（show/hide/reset-position），不接受任意窗口句柄。
- 关闭主应用时确保宠物窗口和 sidecar 一起退出，避免残留进程。
- 监听器在宠物窗口销毁时解除，避免重复订阅和内存泄漏。

## 11. 测试方案

### 单元测试

- 聚合多个 session 时，任一 `running` 都会得到 `running_hulk`。
- `running -> completed` 只触发一次变回动画。
- 变身过程中收到 completed 不会回到第一帧。
- 失败状态只显示有限时长，然后恢复班纳。
- 重复收到同一状态不会重启动画。

### 集成测试

- 创建宠物层后能接收状态快照。
- 主窗口隐藏/恢复不影响宠物层。
- 宠物层关闭后可重新创建并恢复位置。
- 右键隐藏、显示和恢复默认位置有效。

### 手工验收

- 桌面上只看到角色，不看到白底、黑底或窗口边框。
- 拖动时角色和窗口位置同步，无跳动。
- 任务启动后在 1.5 秒内完成班纳到浩克的变身。
- 多显示器拔出后宠物不会消失在屏幕外。
- 125%/200% DPI 下像素边缘仍清晰，不发生模糊缩放。
- 主窗口退出后不存在残留宠物进程。

## 12. 分阶段交付

### Phase 1：桌面层骨架

- 新增 `pet` WebviewWindow。
- 实现透明、无边框、置顶、拖动、隐藏和位置记忆。
- 用静态占位精灵验证跨平台窗口行为。

### Phase 2：状态同步

- 抽取 session 聚合状态。
- 增加 `pet://state-changed` 和初始快照。
- 接入班纳待机、浩克运行、失败反馈。

### Phase 3：正式像素资源

- 按 hatch-pet 规范生成并验收 spritesheet。
- 接入变身开始、中段、结束和变回动画。
- 做接触表、GIF 预览和透明度验证。

### Phase 4：产品化

- 设置页、右键菜单、缩放、始终置顶和开机启动。
- 多屏/DPI/窗口管理器兼容。
- 完成打包、升级和异常恢复测试。

## 13. 建议的代码边界

```text
surfaces/gui/src/
  pet/
    PetWindow.tsx          # /pet 独立入口
    PetAnimator.ts         # 精灵播放与状态转换
    petState.ts            # 状态类型和转换表
    petEvents.ts           # Tauri 事件协议
    petPreferences.ts      # 偏好读写
    pet.css

surfaces/gui/src-tauri/src/
  lib.rs                   # 创建窗口、位置、平台能力
  pet_window.rs            # 可选：窗口相关 Rust 封装

surfaces/gui/public/pets/banner-hulk/
  spritesheet.webp
  pet.json
```

第一版不建议把宠物逻辑放入 `App.tsx` 或各个会话组件。主应用只负责提供聚合状态和发送事件，宠物层保持独立，之后才能支持替换角色、多个宠物主题和不同任务类型动画。

## 14. 验收标准

功能完成的最低标准是：

1. 应用启动后可以独立显示一个无边框透明宠物层。
2. 宠物可以拖动，位置跨应用重启保留。
3. 主窗口隐藏到托盘后，宠物仍可显示。
4. 任一任务运行时，宠物按顺序完成班纳到浩克的变身。
5. 所有任务结束后，宠物平滑变回班纳。
6. 失败和等待审批有独立且可识别的状态。
7. macOS 主流程通过测试，Windows 在高 DPI 下无严重布局问题。
8. 透明背景、像素清晰度、帧基线和资源校验全部通过。
