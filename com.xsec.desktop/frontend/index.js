const TREE_METHOD = "xsec.attack-path.tree.list";
const SUBAGENTS_METHOD = "xsec.attack-path.subagents.list";
const OPERATIONS_METHOD = "xsec.attack-path.operations.list";
const RESUME_OPERATION_METHOD = "xsec.attack-path.operations.resume";
const OPEN_TOOL_METHOD = "xsec.workspace.tool.open";
const SUBAGENT_PLUGIN_ID = "com.xsec.workspace.sub-agent";
const SUBAGENT_DETAIL_TOOL_ID = "subagent-detail";
const NODE_WIDTH = 130;
const NODE_HEIGHT = 58;
const X_GAP = 150;
const Y_GAP = 120;
const ROOT_GAP = 80;
const PADDING = 80;
const MIN_SCALE = 0.45;
const MAX_SCALE = 1.8;
const MAX_REFRESH_RETRIES = 3;
const REFRESH_RETRY_BASE_MS = 750;
const RESOURCE_UPDATE_STREAM = "xsec.attack-path.resource.updated";
const SVG_NS = "http://www.w3.org/2000/svg";
// 画布上的节点比布局坐标宽松：布局（layoutTreeNodes）与 Desktop 原生面板共用一份夹具，这里只在显示时放大间距。
const VIEW_SCALE_X = 1.24;
const VIEW_SCALE_Y = 1.2;
const NODE_VIEW_WIDTH = 164;
const NODE_VIEW_HEIGHT = 88;
const FIT_MIN_SCALE = 0.6;
const FIT_MARGIN = 32;
const WHEEL_ZOOM_RATE = 1.0025;
const KIND_LABELS = { task: "任务", action: "动作", finding: "发现" };
// 子 Agent 状态的中文名与语气，与 Desktop 的状态表一致；表里没有的值原样显示。
const SUBAGENT_STATUSES = {
  running: ["运行中", "running"], active: ["进行中", "running"], starting: ["启动中", "running"],
  queued: ["等待运行", "waiting"], waiting: ["等待运行", "waiting"], pending: ["待处理", "waiting"],
  waiting_user: ["等待用户", "waiting"], waiting_permission: ["等待权限", "waiting"], waiting_elicitation: ["等待输入", "waiting"],
  recovery_required: ["需要恢复", "waiting"], interrupted: ["已中断", "waiting"], stopping: ["停止中", "waiting"],
  completed: ["已完成", "success"], done: ["已完成", "success"],
  failed: ["失败", "error"], error: ["出错", "error"],
  idle: ["空闲", "neutral"], cancelled: ["已取消", "neutral"], canceled: ["已取消", "neutral"], stopped: ["已停止", "neutral"], terminated: ["已终止", "neutral"],
};
const ICONS = {
  minus: ["M5 12h14"],
  plus: ["M5 12h14", "M12 5v14"],
  refresh: ["M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8", "M21 3v5h-5", "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16", "M8 16H3v5"],
  branch: ["M6 3v12", "M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M18 9a9 9 0 0 1-9 9"],
  alert: ["M12 9v4", "M12 17h.01", "M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"],
};

/**
 * Pure refresh-retry timer policy: a newer schedule always replaces any pending
 * timer so exponential backoff is honored after an interrupting refresh/load.
 * @param {{ disposed: boolean, mode: "schedule" | "immediate-load" }} input
 * @returns {{ clearPending: boolean, armTimer: boolean }}
 */
export function resolveRefreshRetryTimerPolicy({ disposed, mode }) {
  if (disposed) {
    return { clearPending: false, armTimer: false };
  }
  if (mode === "immediate-load") {
    // Immediate refresh supersedes any delayed retry.
    return { clearPending: true, armTimer: false };
  }
  // mode === "schedule": clear then arm with the newly calculated delay.
  return { clearPending: true, armTimer: true };
}

/** Start a replacement load only after cancelling its pending retry timer. */
export function startImmediateRefresh({ disposed, clearPending, startLoad }) {
  const policy = resolveRefreshRetryTimerPolicy({ disposed, mode: "immediate-load" });
  if (policy.clearPending) clearPending();
  if (!disposed) startLoad();
}

export function shouldRefreshForContext({ visible, assignmentChanged, becameVisible }) {
  return visible && (assignmentChanged || becameVisible);
}

/** Pure refresh-after-load policy (durable dirty intent vs in-flight queue). */
export function resolveRefreshAfterLoad({
  succeeded,
  refreshQueued,
  refreshDirty,
  refreshRetryAttempt,
  maxRetries = MAX_REFRESH_RETRIES,
  retryBaseMs = REFRESH_RETRY_BASE_MS,
}) {
  if (succeeded) {
    const hadQueued = Boolean(refreshQueued);
    return {
      refreshQueued: false,
      refreshDirty: hadQueued,
      refreshRetryAttempt: 0,
      action: hadQueued ? "reload" : "idle",
      delay: 0,
    };
  }
  const dirty = Boolean(refreshQueued || refreshDirty);
  if (!dirty) {
    return {
      refreshQueued: false,
      refreshDirty: false,
      refreshRetryAttempt,
      action: "idle",
      delay: 0,
    };
  }
  if (refreshRetryAttempt >= maxRetries) {
    return {
      refreshQueued: false,
      refreshDirty: false,
      refreshRetryAttempt: 0,
      action: "give-up",
      delay: 0,
    };
  }
  return {
    refreshQueued: false,
    refreshDirty: true,
    refreshRetryAttempt: refreshRetryAttempt + 1,
    action: "schedule-retry",
    delay: retryBaseMs * (2 ** refreshRetryAttempt),
  };
}

export function layoutTreeNodes(nodes, rootId) {
  const positions = new Map();
  if (!nodes.length) return { positions, width: 0, height: 0 };
  const nodeIds = new Set(nodes.map((node) => node.id));
  const children = new Map();
  for (const node of nodes) {
    if (!node.parent_id || !nodeIds.has(node.parent_id)) continue;
    children.set(node.parent_id, [...(children.get(node.parent_id) ?? []), node]);
  }
  const roots = nodes.filter((node) => !node.parent_id || !nodeIds.has(node.parent_id));
  const preferredRoot = nodes.find((node) => node.id === rootId);
  if (preferredRoot) {
    const index = roots.findIndex((node) => node.id === preferredRoot.id);
    if (index > 0) roots.unshift(...roots.splice(index, 1));
  }
  let leaf = 0;
  const visited = new Set();
  const place = (node, depth) => {
    if (visited.has(node.id)) return PADDING + NODE_WIDTH / 2;
    visited.add(node.id);
    const kids = children.get(node.id) ?? [];
    const center = kids.length
      ? kids.reduce((sum, child) => sum + place(child, depth + 1), 0) / kids.length
      : PADDING + NODE_WIDTH / 2 + leaf++ * X_GAP;
    positions.set(node.id, { x: center - NODE_WIDTH / 2, y: PADDING + depth * Y_GAP });
    return center;
  };
  const placeRoot = (root) => {
    if (visited.has(root.id)) return;
    place(root, 0);
    leaf += ROOT_GAP / X_GAP;
  };
  roots.forEach(placeRoot);
  nodes.forEach(placeRoot);
  let maxX = 0;
  let maxY = 0;
  positions.forEach((position) => {
    maxX = Math.max(maxX, position.x + NODE_WIDTH);
    maxY = Math.max(maxY, position.y + NODE_HEIGHT);
  });
  return { positions, width: maxX + PADDING, height: maxY + PADDING };
}

export function nodeKind(node, rootId) {
  if (!node.parent_id || node.parent_id === rootId) return "task";
  if (node.status === "vuln" || node.kind === "vuln") return "finding";
  return "action";
}

export function graphModel(nodes, subagents) {
  const rootId = nodes.find((node) => !node.parent_id)?.id;
  const layout = layoutTreeNodes(nodes, rootId);
  const positioned = nodes.map((node) => ({
    node,
    ...(layout.positions.get(node.id) ?? { x: PADDING, y: PADDING }),
  }));
  const positions = new Map(positioned.map((position) => [position.node.id, position]));
  const subagentsByNode = new Map();
  for (const node of nodes) {
    if (!node.subagent_id) continue;
    const subagent = subagents.find((candidate) => candidate.id === node.subagent_id);
    if (subagent) subagentsByNode.set(node.id, subagent);
  }
  for (const subagent of subagents) {
    if (subagent.node_id && !subagentsByNode.has(subagent.node_id)) subagentsByNode.set(subagent.node_id, subagent);
  }
  const counts = { task: 0, action: 0, finding: 0 };
  for (const node of nodes) {
    if (node.parent_id) counts[nodeKind(node, rootId)] += 1;
  }
  return {
    rootId,
    layout,
    positioned,
    positions,
    subagentsByNode,
    counts,
    stage: { width: Math.max(layout.width, 900), height: Math.max(layout.height, 520) },
  };
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(name, size = 16) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.75");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const d of ICONS[name]) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

export function subagentStatusStyle(status) {
  const value = typeof status === "string" ? status.trim() : "";
  if (!value) return { label: "未知", tone: "neutral" };
  const known = SUBAGENT_STATUSES[value.toLowerCase()];
  return known ? { label: known[0], tone: known[1] } : { label: value, tone: "neutral" };
}

function viewPosition(position) {
  return { x: position.x * VIEW_SCALE_X, y: position.y * VIEW_SCALE_Y };
}

function clampScale(scale) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

function displayIds(nodes, rootId) {
  const sequence = { task: 0, action: 0, finding: 0 };
  const ids = new Map();
  for (const node of nodes) {
    if (!node.parent_id) {
      ids.set(node.id, "Root");
      continue;
    }
    const kind = nodeKind(node, rootId);
    ids.set(node.id, `${kind[0].toUpperCase()}${kind.slice(1)}_${String(++sequence[kind]).padStart(3, "0")}`);
  }
  return ids;
}

function contextAssignmentId(context) {
  return context?.workspace?.binding?.assignmentId ?? null;
}

function contextVisible(context) {
  return context?.visible !== false;
}

function mcpJson(result) {
  if (result?.isError) throw new Error(mcpErrorMessage(result));
  const content = result?.content;
  if (!Array.isArray(content) || content.length !== 1) throw new Error("攻击路径 MCP 返回格式无效");
  const text = content[0]?.text;
  if (typeof text !== "string") throw new Error("攻击路径 MCP 未返回 JSON 内容");
  const payload = JSON.parse(text);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("攻击路径 MCP JSON 内容无效");
  }
  return payload;
}

function mcpErrorMessage(result) {
  const text = result?.content?.[0]?.text;
  if (typeof text !== "string") return "攻击路径 MCP 调用失败";
  try {
    const payload = JSON.parse(text);
    if (typeof payload?.error === "string" && payload.error.trim()) return payload.error;
  } catch {}
  return text;
}

export function readAttackPathNodes(result) {
  const items = mcpJson(result).items;
  if (!Array.isArray(items)) throw new Error("攻击路径 MCP 未返回节点列表");
  return items.map(normalizeAttackPathNode);
}

function normalizeAttackPathNode(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("攻击路径节点格式无效");
  const id = requiredText(item.id, "节点 ID");
  const title = requiredText(item.title, "节点标题");
  const kind = requiredText(item.kind, "节点类型");
  const status = requiredText(item.status, "节点状态");
  return {
    ...item,
    id,
    title,
    kind,
    status,
    parent_id: optionalText(item.parentId, "父节点 ID"),
    subagent_id: optionalText(item.subagentId, "子 Agent ID"),
  };
}

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}无效`);
  return value;
}

function optionalText(value, label) {
  if (value === null || value === undefined) return null;
  return requiredText(value, label);
}

function resourceRevision(payload) {
  try {
    const value = JSON.parse(new TextDecoder().decode(payload));
    return typeof value?.revision === "string" && /^(0|[1-9][0-9]*)$/.test(value.revision)
      ? value.revision
      : null;
  } catch {
    return null;
  }
}

function installStyles() {
  if (document.getElementById("xsec-attack-path-styles")) return;
  const style = document.createElement("style");
  style.id = "xsec-attack-path-styles";
  // 颜色全部由宿主推来的 --xsec-* 设计 token 推出（亮暗主题、强调色都跟随 Desktop）；宿主没有推送时用 Desktop 的默认值。
  style.textContent = `
    :root{color-scheme:light dark;--ap-d-canvas:#f7f7f8;--ap-d-surface:#fff;--ap-d-text:#18181b;--ap-d-muted:#62626b;--ap-d-danger:#b42318;--ap-d-success:#187344;--ap-d-warning:#8a5700}
    @media (prefers-color-scheme:dark){:root{--ap-d-canvas:#111113;--ap-d-surface:#19191c;--ap-d-text:#f4f4f5;--ap-d-muted:#a1a1aa;--ap-d-danger:#ff938a;--ap-d-success:#7ad6a0;--ap-d-warning:#e9bd70}}
    :root{
      --ap-canvas:var(--xsec-window-background,var(--ap-d-canvas));--ap-surface:var(--xsec-content-surface,var(--ap-d-surface));
      --ap-text:var(--xsec-text-primary,var(--ap-d-text));--ap-muted:var(--xsec-text-secondary,var(--ap-d-muted));
      --ap-danger:var(--xsec-status-error,var(--ap-d-danger));--ap-success:var(--xsec-status-success,var(--ap-d-success));--ap-warning:var(--xsec-status-warning,var(--ap-d-warning));
      --ap-accent:color-mix(in srgb,var(--xsec-text-accent,#0169cc) 72%,var(--ap-text));
      --ap-fill:color-mix(in srgb,var(--ap-text) 6%,transparent);--ap-fill-hover:color-mix(in srgb,var(--ap-text) 9%,transparent);--ap-fill-pressed:color-mix(in srgb,var(--ap-text) 13%,transparent);
      --ap-hairline:color-mix(in srgb,var(--ap-text) 9%,transparent);--ap-focus:color-mix(in srgb,var(--ap-accent) 28%,transparent);
      --ap-radius:var(--xsec-radius-md,8px);--ap-radius-lg:var(--xsec-radius-lg,12px);
      font-family:var(--xsec-font-family,Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif);
    }
    *{box-sizing:border-box}html,body,[data-xsec-plugin-root]{width:100%;height:100%;margin:0;overflow:hidden}button{font:inherit}
    .ap-root{display:flex;width:100%;height:100%;min-width:0;min-height:280px;flex-direction:column;background:var(--ap-surface);color:var(--ap-text);font-size:13px;line-height:1.4;-webkit-font-smoothing:antialiased}
    .ap-head{display:flex;min-height:48px;align-items:center;gap:12px;padding:8px 12px 8px 16px;border-bottom:1px solid var(--ap-hairline)}
    .ap-title{font-size:14px;font-weight:600;white-space:nowrap}
    .ap-legend{display:flex;min-width:0;align-items:center;gap:6px;margin-left:auto}
    .ap-badge{display:inline-flex;align-items:center;gap:6px;padding:2px 9px;border-radius:999px;background:color-mix(in srgb,var(--ap-kind) 12%,transparent);color:var(--ap-kind);font-size:12px;font-weight:600;white-space:nowrap;font-variant-numeric:tabular-nums}
    .task{--ap-kind:var(--ap-accent)}.action{--ap-kind:var(--ap-success)}.finding{--ap-kind:var(--ap-warning)}
    .ap-controls{display:flex;flex:0 0 auto;align-items:center;gap:2px}
    .ap-zoom{display:flex;align-items:center;padding:2px;border-radius:var(--ap-radius);background:var(--ap-fill)}
    .ap-btn{display:inline-grid;height:28px;min-width:28px;place-items:center;padding:0 6px;border:0;border-radius:6px;background:transparent;color:var(--ap-text);cursor:pointer;transition:background .12s}
    .ap-btn:hover{background:var(--ap-fill-hover)}.ap-btn:active{background:var(--ap-fill-pressed)}.ap-btn:focus-visible,.ap-node:focus-visible,.ap-action:focus-visible{outline:2px solid var(--ap-accent);outline-offset:1px}
    .ap-btn.ap-scale{min-width:52px;color:var(--ap-muted);font-size:12px;font-variant-numeric:tabular-nums}.ap-btn.ap-refresh{margin-left:4px;color:var(--ap-muted)}.ap-btn.spinning svg{animation:ap-spin .8s linear infinite}
    .ap-strip{display:none;align-items:center;gap:8px;padding:8px 16px;border-bottom:1px solid var(--ap-hairline);background:color-mix(in srgb,var(--ap-tone) 9%,transparent);color:var(--ap-tone);font-size:12px}.ap-strip.show{display:flex}
    .ap-strip svg{flex:0 0 auto}.ap-strip span{overflow:hidden;min-width:0;flex:1;color:var(--ap-text);text-overflow:ellipsis;white-space:nowrap}
    .ap-status{--ap-tone:var(--ap-danger)}.ap-operations{--ap-tone:var(--ap-warning)}
    .ap-action{height:26px;padding:0 10px;border:0;border-radius:6px;background:var(--ap-fill);color:var(--ap-text);font-size:12px;font-weight:500;cursor:pointer}.ap-action:hover{background:var(--ap-fill-hover)}.ap-action:disabled{cursor:wait;opacity:.55}
    .ap-canvas{position:relative;min-height:0;flex:1;overflow:hidden;cursor:grab;touch-action:none;background-color:var(--ap-canvas);background-image:radial-gradient(circle,color-mix(in srgb,var(--ap-text) 11%,transparent) 1px,transparent 1.5px);background-size:24px 24px}.ap-canvas.dragging{cursor:grabbing}
    .ap-stage{position:absolute;top:0;left:0;transform-origin:0 0}.ap-links{position:absolute;top:0;left:0;overflow:visible;pointer-events:none}
    .ap-link{fill:none;stroke:color-mix(in srgb,var(--ap-kind) 46%,transparent);stroke-width:1.5;stroke-linecap:round}.ap-link.live{stroke:var(--ap-kind);stroke-dasharray:5 7;animation:ap-flow 1s linear infinite}
    .ap-node{position:absolute;top:0;left:0;display:flex;width:${NODE_VIEW_WIDTH}px;height:${NODE_VIEW_HEIGHT}px;flex-direction:column;gap:4px;padding:10px 12px;border:1px solid color-mix(in srgb,var(--ap-kind) 34%,var(--ap-hairline));border-radius:var(--ap-radius);background:var(--ap-surface);box-shadow:0 1px 2px rgba(0,0,0,.05),0 4px 12px -6px rgba(0,0,0,.12);color:var(--ap-text);cursor:pointer;text-align:left;user-select:none;transition:border-color .12s,box-shadow .12s}
    .ap-node:hover{border-color:color-mix(in srgb,var(--ap-kind) 70%,transparent);box-shadow:0 1px 2px rgba(0,0,0,.06),0 8px 18px -8px rgba(0,0,0,.2)}
    .ap-node.no-agent{border-style:dashed;background:color-mix(in srgb,var(--ap-surface) 55%,var(--ap-canvas));box-shadow:none;cursor:default}.ap-node.no-agent:hover{border-color:color-mix(in srgb,var(--ap-kind) 34%,var(--ap-hairline))}
    .ap-node.root{border-style:solid;border-color:color-mix(in srgb,var(--ap-kind) 55%,transparent);background:color-mix(in srgb,var(--ap-kind) 7%,var(--ap-surface));box-shadow:0 1px 2px rgba(0,0,0,.05),0 4px 12px -6px rgba(0,0,0,.12)}
    .ap-node.selected{border-color:var(--ap-accent);box-shadow:0 0 0 3px var(--ap-focus)}
    .ap-node-top{display:flex;align-items:center;gap:6px;font-size:11px;line-height:16px}.ap-kind{display:inline-flex;align-items:center;gap:5px;color:var(--ap-kind);font-weight:600}.ap-kind::before{width:6px;height:6px;border-radius:2px;background:currentColor;content:""}
    .ap-state{display:inline-flex;align-items:center;gap:5px;margin-left:auto;color:var(--ap-muted);white-space:nowrap}.ap-state i{width:6px;height:6px;border-radius:50%;background:var(--ap-muted)}
    .ap-state.running i{background:var(--ap-accent);animation:ap-pulse 1.4s ease-in-out infinite}.ap-state.success i{background:var(--ap-success)}.ap-state.waiting i{background:var(--ap-warning)}.ap-state.error i{background:var(--ap-danger)}.ap-state.error{color:var(--ap-danger)}
    .ap-node-title{display:-webkit-box;overflow:hidden;font-size:13px;font-weight:600;line-height:18px;-webkit-box-orient:vertical;-webkit-line-clamp:2}
    .ap-node-foot{overflow:hidden;margin-top:auto;color:var(--ap-muted);font-size:11px;line-height:14px;text-overflow:ellipsis;white-space:nowrap}.ap-id{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}.ap-reason{color:var(--ap-warning)}
    .ap-empty{display:grid;height:100%;place-content:center;justify-items:center;gap:6px;padding:28px;color:var(--ap-muted);text-align:center}.ap-empty-tile{display:grid;width:40px;height:40px;place-items:center;margin-bottom:6px;border-radius:var(--ap-radius-lg);background:var(--ap-fill);color:var(--ap-muted)}
    .ap-empty strong{color:var(--ap-text);font-size:14px;font-weight:600}.ap-empty span{max-width:320px;font-size:12px;line-height:1.6}.ap-loading{width:20px;height:20px;border:2px solid var(--ap-fill-pressed);border-top-color:var(--ap-accent);border-radius:50%;animation:ap-spin .8s linear infinite}
    @keyframes ap-flow{to{stroke-dashoffset:-12}}@keyframes ap-spin{to{transform:rotate(360deg)}}@keyframes ap-pulse{50%{opacity:.4}}
    @media (prefers-reduced-motion:reduce){.ap-link.live,.ap-loading,.ap-state.running i,.ap-btn.spinning svg{animation:none}}
    @media (max-width:520px){.ap-head{flex-wrap:wrap}.ap-legend{order:3;width:100%;margin-left:0}}
  `;
  document.head.append(style);
}

function createController(host) {
  let root = null;
  let assignmentId = null;
  let visible = true;
  let disposed = false;
  let loading = false;
  let requestGeneration = 0;
  let resourceSubscription = null;
  let refreshQueued = false;
  let refreshDirty = false;
  let refreshRetryTimer = null;
  let refreshRetryAttempt = 0;
  let resizeObserver = null;
  let nodes = [];
  let subagents = [];
  let operations = [];
  let model = graphModel([], []);
  let resetKey = "";
  let selectedSubagentId = null;
  let view = { x: 32, y: 40, scale: 1 };
  let drag = null;
  let legend = null;
  let status = null;
  let canvas = null;
  let zoomLabel = null;
  let operationBar = null;
  let refreshButton = null;

  const showStatus = (message) => {
    if (!status) return;
    status.replaceChildren();
    if (message) status.append(icon("alert", 14), element("span", "", message));
    status.classList.toggle("show", Boolean(message));
    status.title = message ?? "";
  };
  const applyTransform = () => {
    const stage = canvas?.querySelector(".ap-stage");
    if (stage) stage.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.scale})`;
    if (zoomLabel) zoomLabel.textContent = `${Math.round(view.scale * 100)}%`;
  };
  const resetView = () => {
    if (!canvas || !model.rootId) return;
    const rootPosition = model.positions.get(model.rootId);
    if (!rootPosition) return;
    const rect = canvas.getBoundingClientRect();
    const rootView = viewPosition(rootPosition);
    // 图比视口宽时缩小到能看全（不小于 60%）并按整张图居中；否则 100%，根节点居中。
    let left = Infinity;
    let right = -Infinity;
    for (const position of model.positioned) {
      const place = viewPosition(position);
      left = Math.min(left, place.x);
      right = Math.max(right, place.x + NODE_VIEW_WIDTH);
    }
    const scale = Math.max(FIT_MIN_SCALE, Math.min(1, (rect.width - FIT_MARGIN * 2) / (right - left)));
    const focusX = scale < 1 ? (left + right) / 2 : rootView.x + NODE_VIEW_WIDTH / 2;
    view = { x: rect.width / 2 - focusX * scale, y: 40 - rootView.y * scale, scale };
    applyTransform();
  };
  const zoomTo = (nextScale, origin) => {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const focus = origin ?? { x: rect.width / 2, y: rect.height / 2 };
    const scale = clampScale(nextScale);
    const worldX = (focus.x - view.x) / view.scale;
    const worldY = (focus.y - view.y) / view.scale;
    view = { scale, x: focus.x - worldX * scale, y: focus.y - worldY * scale };
    applyTransform();
  };
  const renderEmpty = (title, description, spinner = false) => {
    if (!canvas) return;
    const empty = element("div", "ap-empty");
    const tile = element("span", "ap-empty-tile");
    tile.append(spinner ? element("span", "ap-loading") : icon("branch", 20));
    empty.append(tile);
    empty.append(element("strong", "", title), element("span", "", description));
    canvas.replaceChildren(empty);
    legend?.replaceChildren();
  };
  const openSubagent = async (subagent, title, button) => {
    if (!subagent?.id) return;
    selectedSubagentId = subagent.id;
    canvas?.querySelectorAll(".ap-node").forEach((node) => {
      node.classList.remove("selected");
      node.setAttribute("aria-pressed", "false");
    });
    button.classList.add("selected");
    button.setAttribute("aria-pressed", "true");
    try {
      await host.request(OPEN_TOOL_METHOD, {
        pluginId: SUBAGENT_PLUGIN_ID,
        toolId: SUBAGENT_DETAIL_TOOL_ID,
        entityId: subagent.id,
        title: title || subagent.role || "子 Agent 详情",
      });
      showStatus(null);
    } catch (error) {
      showStatus(`无法打开子 Agent：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const renderGraph = () => {
    if (!canvas) return;
    if (!assignmentId) {
      renderEmpty("攻击路径尚未绑定任务", "Agent 派发子任务后，这里会显示路径、节点和子 Agent 状态。");
      return;
    }
    if (!nodes.length) {
      renderEmpty("暂无攻击路径节点", "主 Agent 创建测试节点并派发子任务后会自动更新。");
      return;
    }
    model = graphModel(nodes, subagents);
    const ids = displayIds(nodes, model.rootId);
    legend.replaceChildren();
    for (const kind of ["task", "action", "finding"]) {
      legend.append(element("span", `ap-badge ${kind}`, `${KIND_LABELS[kind]} ${model.counts[kind]}`));
    }
    const stageWidth = model.stage.width * VIEW_SCALE_X;
    const stageHeight = model.stage.height * VIEW_SCALE_Y;
    const stage = element("div", "ap-stage");
    stage.style.width = `${stageWidth}px`;
    stage.style.height = `${stageHeight}px`;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "ap-links");
    svg.setAttribute("width", String(stageWidth));
    svg.setAttribute("height", String(stageHeight));
    for (const node of nodes) {
      if (!node.parent_id) continue;
      const parentPosition = model.positions.get(node.parent_id);
      const childPosition = model.positions.get(node.id);
      if (!parentPosition || !childPosition) continue;
      const parent = viewPosition(parentPosition);
      const child = viewPosition(childPosition);
      const sx = parent.x + NODE_VIEW_WIDTH / 2;
      const sy = parent.y + NODE_VIEW_HEIGHT;
      const ex = child.x + NODE_VIEW_WIDTH / 2;
      const ey = child.y;
      const mid = sy + Math.max(20, (ey - sy) / 2);
      const live = subagentStatusStyle(model.subagentsByNode.get(node.id)?.status).tone === "running";
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("class", `ap-link ${nodeKind(node, model.rootId)}${live ? " live" : ""}`);
      path.setAttribute("d", `M ${sx} ${sy} C ${sx} ${mid}, ${ex} ${mid}, ${ex} ${ey}`);
      svg.append(path);
    }
    stage.append(svg);
    for (const position of model.positioned) {
      const node = position.node;
      const kind = nodeKind(node, model.rootId);
      const kindLabel = node.parent_id ? KIND_LABELS[kind] : "根任务";
      const subagent = model.subagentsByNode.get(node.id);
      const selected = selectedSubagentId === subagent?.id;
      const place = viewPosition(position);
      const button = element("button", `ap-node ${kind}${node.parent_id ? "" : " root"}${subagent ? "" : " no-agent"}${selected ? " selected" : ""}`);
      button.type = "button";
      button.style.transform = `translate(${place.x}px,${place.y}px)`;
      button.setAttribute("aria-label", `${kindLabel}节点：${node.title}`);
      button.setAttribute("aria-pressed", String(selected));
      if (!subagent) button.setAttribute("aria-disabled", "true");
      const state = subagent ? subagentStatusStyle(subagent.status) : null;
      const reason = subagent?.status_reason ? `\n原因：${subagent.status_reason}` : "";
      button.title = state ? `${node.title}\n状态：${state.label}${reason}` : `${node.title}\n尚未派发子 Agent`;
      const top = element("span", "ap-node-top");
      top.append(element("span", "ap-kind", kindLabel));
      if (state) {
        const badge = element("span", `ap-state ${state.tone}`);
        badge.append(element("i"), document.createTextNode(state.label));
        top.append(badge);
      }
      const foot = subagent?.status_reason
        ? element("span", "ap-node-foot ap-reason", subagent.status_reason)
        : element("span", "ap-node-foot ap-id", ids.get(node.id) ?? node.id);
      button.append(top, element("span", "ap-node-title", node.title), foot);
      if (subagent) button.addEventListener("click", () => void openSubagent(subagent, node.title, button));
      stage.append(button);
    }
    canvas.replaceChildren(stage);
    const nextResetKey = `${assignmentId}:${model.rootId ?? ""}:${nodes.length}`;
    if (nextResetKey !== resetKey) {
      resetKey = nextResetKey;
      requestAnimationFrame(resetView);
    } else applyTransform();
  };

  const resumeOperation = async (operation, button) => {
    button.disabled = true;
    try {
      const result = await host.request(RESUME_OPERATION_METHOD, { operationId: operation.operationId });
      if (result?.status !== "completed") throw new Error(result?.result?.diagnostic ?? `恢复结果：${result?.status ?? "unknown"}`);
      showStatus(null);
      requestRefresh();
    } catch (error) {
      showStatus(`恢复失败：${error instanceof Error ? error.message : String(error)}`);
      button.disabled = false;
    }
  };

  const renderOperations = () => {
    if (!operationBar) return;
    operationBar.classList.toggle("show", operations.length > 0);
    operationBar.replaceChildren();
    if (!operations.length) return;
    operationBar.append(icon("alert", 14), element("span", "", `${operations.length} 个 Host 操作待恢复，报告终结已阻断`));
    for (const operation of operations) {
      const button = element("button", "ap-action", `恢复 ${operation.operation?.type ?? operation.operationId}`);
      button.type = "button";
      button.title = operation.result?.result?.diagnostic ?? operation.result?.diagnostic ?? operation.operationId;
      button.addEventListener("click", () => void resumeOperation(operation, button));
      operationBar.append(button);
    }
  };

  const clearRefreshRetry = () => {
    if (refreshRetryTimer != null) {
      clearTimeout(refreshRetryTimer);
      refreshRetryTimer = null;
    }
  };
  const scheduleRefreshRetry = (delay) => {
    const policy = resolveRefreshRetryTimerPolicy({ disposed, mode: "schedule" });
    if (!policy.armTimer) return;
    if (policy.clearPending) clearRefreshRetry();
    refreshRetryTimer = setTimeout(() => {
      refreshRetryTimer = null;
      if (!disposed) requestRefresh();
    }, delay);
  };
  const applyRefreshAfterLoad = (succeeded) => {
    const plan = resolveRefreshAfterLoad({
      succeeded,
      refreshQueued,
      refreshDirty,
      refreshRetryAttempt,
    });
    refreshQueued = plan.refreshQueued;
    refreshDirty = plan.refreshDirty;
    refreshRetryAttempt = plan.refreshRetryAttempt;
    if (plan.action === "reload") {
      clearRefreshRetry();
      void load();
      return;
    }
    if (plan.action === "schedule-retry") {
      scheduleRefreshRetry(plan.delay);
      return;
    }
    if (plan.action === "give-up" || plan.action === "idle") {
      if (succeeded || plan.action === "give-up") clearRefreshRetry();
    }
  };

  const load = async () => {
    if (disposed || loading || !visible || !assignmentId) return;
    loading = true;
    refreshButton?.classList.add("spinning");
    const generation = ++requestGeneration;
    let succeeded = false;
    if (!nodes.length) renderEmpty("正在读取攻击路径", "正在同步节点与子 Agent 状态…", true);
    try {
      const [treeResult, subagentResult, operationResult] = await Promise.all([
        host.request(TREE_METHOD, {}),
        host.request(SUBAGENTS_METHOD, {}),
        host.request(OPERATIONS_METHOD, {}),
      ]);
      if (disposed || generation !== requestGeneration) return;
      nodes = readAttackPathNodes(treeResult);
      subagents = Array.isArray(subagentResult?.subagents) ? subagentResult.subagents : [];
      operations = Array.isArray(operationResult?.operations) ? operationResult.operations : [];
      showStatus(null);
      renderOperations();
      renderGraph();
      succeeded = true;
    } catch (error) {
      if (disposed || generation !== requestGeneration) return;
      const message = error instanceof Error ? error.message : String(error);
      console.error("attack_path.load.failed", { message });
      showStatus(message);
      if (!nodes.length) renderEmpty("攻击路径暂时不可用", "读取插件数据失败，请检查会话或插件运行状态。");
      // Rebuild resume controls so a prior successful resume + failed refresh
      // does not leave recovery buttons permanently disabled.
      if (operations.length > 0) renderOperations();
    } finally {
      if (generation === requestGeneration) {
        loading = false;
        refreshButton?.classList.remove("spinning");
        applyRefreshAfterLoad(succeeded);
      }
    }
  };

  const requestRefresh = () => {
    refreshDirty = true;
    if (loading) {
      refreshQueued = true;
      return;
    }
    startImmediateRefresh({
      disposed,
      clearPending: clearRefreshRetry,
      startLoad: () => void load(),
    });
  };

  const buildShell = () => {
    installStyles();
    const shell = element("section", "ap-root");
    shell.setAttribute("aria-label", "攻击路径");
    const head = element("header", "ap-head");
    head.append(element("span", "ap-title", "攻击路径"));
    status = element("div", "ap-strip ap-status");
    status.setAttribute("role", "status");
    legend = element("span", "ap-legend");
    const controls = element("span", "ap-controls");
    const control = (className, label, tip, child, onClick) => {
      const button = element("button", `ap-btn ${className}`);
      button.type = "button";
      button.title = tip;
      button.setAttribute("aria-label", label);
      button.append(child);
      button.addEventListener("click", onClick);
      return button;
    };
    const zoom = element("span", "ap-zoom");
    zoomLabel = control("ap-scale", "重置攻击路径视图", "重置视图", document.createTextNode("100%"), resetView);
    zoom.append(
      control("", "缩小攻击路径", "缩小", icon("minus"), () => zoomTo(view.scale - 0.1)),
      zoomLabel,
      control("", "放大攻击路径", "放大", icon("plus"), () => zoomTo(view.scale + 0.1)),
    );
    refreshButton = control("ap-refresh", "刷新攻击路径", "刷新攻击路径", icon("refresh"), requestRefresh);
    controls.append(zoom, refreshButton);
    head.append(legend, controls);
    operationBar = element("div", "ap-strip ap-operations");
    canvas = element("div", "ap-canvas");
    // 与 Desktop 的画布一致：Ctrl/⌘ + 滚轮或触摸板捏合以指针为中心缩放，普通滚动平移。
    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const rect = canvas.getBoundingClientRect();
        zoomTo(view.scale * WHEEL_ZOOM_RATE ** -event.deltaY, { x: event.clientX - rect.left, y: event.clientY - rect.top });
        return;
      }
      view = { ...view, x: view.x - event.deltaX, y: view.y - event.deltaY };
      applyTransform();
    }, { passive: false });
    canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest(".ap-node")) return;
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add("dragging");
      drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, view: { ...view } };
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      view = { ...drag.view, x: drag.view.x + event.clientX - drag.startX, y: drag.view.y + event.clientY - drag.startY };
      applyTransform();
    });
    const stopDrag = (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      canvas.classList.remove("dragging");
      drag = null;
    };
    canvas.addEventListener("pointerup", stopDrag);
    canvas.addEventListener("pointercancel", stopDrag);
    shell.append(head, status, operationBar, canvas);
    root.replaceChildren(shell);
    resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(() => applyTransform()) : null;
    resizeObserver?.observe(canvas);
  };

  const updateContext = (context) => {
    const nextAssignmentId = contextAssignmentId(context);
    const assignmentChanged = nextAssignmentId !== assignmentId;
    const nextVisible = contextVisible(context);
    const becameVisible = nextVisible && !visible;
    visible = nextVisible;
    assignmentId = nextAssignmentId;
    if (assignmentChanged) {
      requestGeneration += 1;
      loading = false;
      nodes = [];
      subagents = [];
      operations = [];
      selectedSubagentId = null;
      resetKey = "";
      refreshQueued = false;
      refreshDirty = false;
      clearRefreshRetry();
      refreshRetryAttempt = 0;
      renderOperations();
    }
    renderGraph();
    if (shouldRefreshForContext({ visible, assignmentChanged, becameVisible })) requestRefresh();
  };

  return {
    async mount(nextRoot, initialContext) {
      root = nextRoot;
      buildShell();
      resourceSubscription = host.onData(RESOURCE_UPDATE_STREAM, (payload) => {
        if (!resourceRevision(payload)) {
          console.warn("attack_path.resource_update_invalid");
          return;
        }
        requestRefresh();
      });
      updateContext(initialContext);
      console.debug("attack_path.mount");
    },
    async update(nextContext) {
      updateContext(nextContext);
    },
    async dispose() {
      disposed = true;
      requestGeneration += 1;
      clearRefreshRetry();
      resourceSubscription?.dispose();
      resizeObserver?.disconnect();
      root?.replaceChildren();
      console.debug("attack_path.dispose");
    },
  };
}

export function activate(host) {
  return createController(host);
}
