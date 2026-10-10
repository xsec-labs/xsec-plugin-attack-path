# 攻击路径公共 UI

攻击路径工作区采用 `@xsec/ui-react` 0.1.7、`@xsec/design-tokens` 0.1.2 和 React 18.3.1。公共标题、工具栏、按钮、Badge、Spinner、空态和错误反馈跟随 Host 的明暗、密度、字号与减少动效设置。图谱保留既有布局及 SVG 连线，支持指针 / 触控平移、滚轮和按钮缩放，以及方向键、± 和 Home。

## 状态与交互

`frontend-src/controller.ts` 是业务状态的唯一所有者。每次绑定变化增加 epoch，每次读取或用户操作增加 generation；迟到回执只在同一上下文和操作版本内生效。隐藏时使在途读取 / 导航结果失效，并清除 loading / busy；显示后读取当前真实快照。卸载释放资源和主题订阅，图谱释放 wheel listener、ResizeObserver 和指针捕获。

资源更新使用 Host 的 `xsec.attack-path.resource.updated` 数据流，校验 ArrayBuffer 容量、UTF-8、JSON 和 u64 revision。运行中的更新合并到当前读取完成后处理。真实失败清除失效数据并显示操作编号，用户通过“重新读取”恢复。主题格式错误释放业务 controller 并呈现显示设置错误。

五项 RPC 与 manifest 固定映射：图谱、子 Agent、待恢复操作、操作恢复和子 Agent 详情导航。MCP envelope、任务归属、重复标识、恢复结果与版本均在前端边界校验。恢复完成后读取真实快照；任务与操作持久化、权限、跨插件导航及 MCP 进程由 Host 所有。

图谱缩放围绕指针或画布中心，范围 45%–180%。宽度变化按差值的一半平移，保留图谱中心。节点按钮只在绑定子 Agent 时可导航，窄屏主要操作目标至少 44px；明暗颜色和状态来自公共语义 token，Host 或系统减少动效设置停止连线动画。

## 构建与依赖

TypeScript / CSS 源码位于 `frontend-src/`，生产单 ESM 入口为 `com.xsec.desktop/frontend/index.js`。`scripts/build.mjs` 同时生成第三方许可证与 CycloneDX SBOM；`check:generated` 在临时目录重新构建并逐字节验证三项生成文件。vendor 公共包和 npm lock 固定依赖版本，构建核对实际打包版本及许可证。

资源控制器读取 status、changed plan 后，通过统一槽执行：

```sh
rtk npm run typecheck
rtk npm run check:generated
rtk npm run verify:frontend
rtk npm run verify:portable
rtk npm run verify:mcp -- <已打包的本平台原生 MCP 可执行文件>
```

本批复用现有 node_modules、npm cache 和统一 target，依赖下载为 0。前端 SHA-256 为 `0430d8f85777c6334e40c11a95dcb5575afd2c93e84d80e9caedcc7ca1ab1089`，SBOM 有 18 项打包组件。插件版本保持 2.0.7，RPC / 权限 / MCP 工具契约沿用既有声明。

## 实际验证

最终源码检查 run `a5bd19f0-4cc6-44a3-8c6d-b8dbdefb9987` 通过类型、生成一致性、5 RPC / 18 依赖组件、portable 契约、前端 / 既有 CJS 语法，以及真实原生 MCP / SQLite / NDJSON 的发现、空读、父子写入、错误传播和任务归属。耗时 6.774 s，峰值采样 RSS 498,089,984 B，卷净变化 −1,781,760 B，swap 保持 61,603,840 B。

配对 loopback Chromium 和真实隔离 macOS arm64 Runtime 完成 14 项业务流程、6 项生命周期、5 项触控 / 动效检查及 40 组视觉组合（五种视口 × 明暗 × 两种密度 × 14 / 18px）。覆盖真实 CSRF 拒绝、恢复冲突、成功恢复及持久化回读、跨任务迟到结果、隐藏中读取和导航、空任务 / 未绑定、真实指针释放、卸载 / 重新挂载，以及真实 MCP 写入经 Runtime websocket 更新图谱。页面无水平溢出，代表截图已目视检查。

真实 macOS arm64 WKWebView 挂载通过三项读取 RPC，并回读 frontend / host 日志、窗口 visible 状态和原生截图。Host 的开发制品数据目录修复由两项真实 SQLite / snapshot / ZIP 回归验证；Host 六个受影响包的 fmt、fail-fast、Clippy 和测试通过。

证据目录为 `/Users/xiaosong/.codex/visualizations/2026/10/02/01a0faad-6517-7cd3-90b5-b818bc64660d/plugin-attack-path-ui`。关键报告为 `frontend-final-v7-resource-report.json`、`browser-flow-v6-report.json`、`lifecycle-v2-report.json`、`touch-v1-report.json`、`visual-v2-report.json` 和 `native-mount-v3-report.json`。本地集成及任务资源清理以 `local-integration-final.json` 维护。

## 性能决定

同一真实 Runtime 和数据采用六组 ABBA，每版 12 个 fresh context。就绪中位数 89.85→100.95 ms，缩放提交 0.30→0.90 ms、两帧绘制 21.25→20.25 ms，真实指针平移 42.35→41.50 ms；刷新网络 11.30→10.70 ms，刷新至两帧绘制 50.75→58.20 ms。GC 后总 JS 堆 4,193,330→4,981,782 B，交互后 4,844,442→5,783,148 B。

前端 gzip 9,019→58,577 B。esbuild 生产输出原始字节中 React DOM 为 130,238 B，公共 UI 为 16,375 B、React 为 7,284 B；原始字节归因不能换算为各库 gzip 贡献。Motion 未进入输出，公共 ControlThemeProvider 与实际使用控件经 minify / tree shaking 打包。

首次脚本假定 opaque iframe 有独立 CDP target，真实浏览器因此明确失败。拓扑诊断证明双方 iframe 与父页面共享一个 isolate；最终每次 GC 采样均核对 frame tree 与默认 execution context，总堆计量一次。失败及修正证据保留。

超 10% 指标已调查，技术状态 `INVESTIGATE`；按用户自主实现授权接受本批实测绝对成本，工程决定 `ACCEPTED_WITH_MEASUREMENT_LIMITS`。证据为 `performance-v2-report.json`、`performance-topology-v1-report.json`、`bundle-analysis-v1-report.json` 和 `performance-decision-v1.json`。结论仅覆盖本机 Chromium，包含定位器观察及两帧；JS 堆不能代表原生 RSS，有限新 context 样本不能证明长会话内存行为。

## 回滚与边界

撤销本批前端源码、锁文件、vendor、构建 / 检查脚本和生成入口，重构可恢复基线 UI。代码回滚保留已确认的任务节点、操作及子 Agent 数据。Host 数据迁移的备份和恢复按 Desktop `docs/refactor/attack-path-ui-acceptance.md` 执行，保留迁移后新增数据。

本批未验证 Windows、Linux、macOS Intel Host、其他浏览器、系统输入法 / 读屏、长会话及原生性能；正式 Marketplace 安装、发布签名和生产部署需对应环境。完整三平台、四个测试目标按插件平台规范选择。本机默认官方插件初始化报告 `expected 8 plugins, got 0`，本批未确定其原因。
