const NODE_WIDTH = 130;
const NODE_HEIGHT = 58;
const X_GAP = 150;
const Y_GAP = 120;
const ROOT_GAP = 80;
const PADDING = 80;

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

export function displayIds(nodes, rootId) {
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


export { NODE_WIDTH, NODE_HEIGHT };
