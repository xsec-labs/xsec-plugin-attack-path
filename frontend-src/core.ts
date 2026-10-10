export type JsonObject = Record<string, unknown>;
export interface Context {
  visible?: boolean;
  surface?: { bindingRevision?: string };
  workspace?: { binding?: { projectId?: string; sessionId?: string; assignmentId?: string; runId?: string } };
}
export interface Host {
  apiVersion: number;
  context: Context;
  request(method: string, params: JsonObject): Promise<unknown>;
  onTheme(callback: (theme: Record<string, string>) => void): { dispose(): void };
  onData(stream: string, callback: (payload: ArrayBuffer) => void): { dispose(): void };
}
export const RPC = Object.freeze({
  tree: 'xsec.attack-path.tree.list', subagents: 'xsec.attack-path.subagents.list',
  operations: 'xsec.attack-path.operations.list', resume: 'xsec.attack-path.operations.resume',
  open: 'xsec.workspace.tool.open',
});
export const RESOURCE_STREAM = 'xsec.attack-path.resource.updated';
export interface TreeNode extends JsonObject {
  id: string; title: string; kind: string; status: string;
  parent_id: string | null; subagent_id: string | null;
}
export interface Subagent extends JsonObject {
  id: string; assignment_id: string; role: string; status: string;
  node_id: string | null; status_reason: string | null;
}
export interface Operation extends JsonObject {
  operationId: string; assignmentId: string; status: string;
  operation: JsonObject & { type: string }; result: JsonObject | null;
}
export interface GraphData { nodes: TreeNode[]; subagents: Subagent[]; operations: Operation[] }
export interface UiError { message: string; operationId: string; action: string }

export function record(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(label + '格式无效');
  return value as JsonObject;
}
export function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw Error(label + '格式无效');
  return value;
}
function optionalText(value: unknown, label: string): string | null {
  return value === undefined || value === null ? null : text(value, label);
}
function unique<T>(rows: T[], id: (row: T) => string, label: string): T[] {
  if (new Set(rows.map(id)).size !== rows.length) throw Error(label + '包含重复标识');
  return rows;
}
export function readAttackPathNodes(value: unknown, assignmentId: string): TreeNode[] {
  const envelope = record(value, '攻击路径 MCP 响应');
  if (envelope.isError !== undefined && typeof envelope.isError !== 'boolean') throw Error('MCP 错误标记无效');
  if (!Array.isArray(envelope.content) || envelope.content.length !== 1) throw Error('攻击路径 MCP 内容无效');
  const content = record(envelope.content[0], '攻击路径 MCP 内容');
  if (content.type !== 'text' || typeof content.text !== 'string') throw Error('攻击路径 MCP 文本无效');
  const payload = record(JSON.parse(content.text), '攻击路径 MCP JSON');
  if (envelope.isError === true) throw Error(text(payload.error, '攻击路径错误说明'));
  if (!Array.isArray(payload.items)) throw Error('攻击路径未返回节点列表');
  return unique(payload.items.map(value => {
    const row = record(value, '攻击路径节点');
    if (row.assignmentId !== assignmentId) throw Error('攻击路径节点与当前任务不匹配');
    return { ...row, id: text(row.id, '节点 ID'), title: text(row.title, '节点标题'),
      kind: text(row.kind, '节点类型'), status: text(row.status, '节点状态'),
      parent_id: optionalText(row.parentId, '父节点 ID'), subagent_id: optionalText(row.subagentId, '子 Agent ID') };
  }), row => row.id, '攻击路径节点');
}
export function readSubagents(value: unknown, assignmentId: string): Subagent[] {
  const payload = record(value, '子 Agent 响应');
  if (!Array.isArray(payload.subagents)) throw Error('子 Agent 未返回列表');
  return unique(payload.subagents.map(value => {
    const row = record(value, '子 Agent');
    if (row.assignment_id !== assignmentId) throw Error('子 Agent 与当前任务不匹配');
    return { ...row, id: text(row.id, '子 Agent ID'), assignment_id: assignmentId,
      role: text(row.role, '子 Agent 角色'), status: text(row.status, '子 Agent 状态'),
      node_id: optionalText(row.node_id, '子 Agent 节点'), status_reason: optionalText(row.status_reason, '状态说明') };
  }), row => row.id, '子 Agent');
}
export function readOperations(value: unknown, assignmentId: string): Operation[] {
  const payload = record(value, 'Host 操作响应');
  if (!Array.isArray(payload.operations)) throw Error('Host 操作未返回列表');
  return unique(payload.operations.map(value => {
    const row = record(value, 'Host 操作'), operation = record(row.operation, '操作描述');
    if (row.assignmentId !== assignmentId) throw Error('Host 操作与当前任务不匹配');
    const type = text(operation.type, '操作类型');
    if (!['bind', 'complete', 'release', 'cleanup'].includes(type)) throw Error('Host 操作类型无效');
    return { ...row, operationId: text(row.operationId, '操作 ID'), assignmentId,
      status: text(row.status, '操作状态'), operation: { ...operation, type },
      result: row.result === null ? null : record(row.result, '操作结果') };
  }), row => row.operationId, 'Host 操作');
}
export function verifyResume(value: unknown, operationId: string): JsonObject {
  const response = record(value, '恢复操作响应'), status = text(response.status, '恢复操作状态');
  if (response.operationId !== operationId) throw Error('恢复操作标识不匹配');
  if (!Number.isSafeInteger(response.revision) || Number(response.revision) < 0 || typeof response.replayed !== 'boolean') throw Error('恢复操作版本或回放标记无效');
  const result = record(response.result, '恢复操作结果');
  if (status !== 'completed') throw Error(typeof result.diagnostic === 'string' && result.diagnostic.trim() ? result.diagnostic : '恢复操作状态：' + status);
  return response;
}
export function resourceRevision(payload: ArrayBuffer): string {
  if (!(payload instanceof ArrayBuffer) || payload.byteLength > 8192) throw Error('攻击路径更新事件容量或格式无效');
  const value = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload)), '攻击路径更新事件');
  if (typeof value.revision !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value.revision) || BigInt(value.revision) > 18446744073709551615n) throw Error('攻击路径更新事件版本无效');
  return value.revision;
}
export function contextIdentity(context: Context): string {
  const binding = context.workspace?.binding;
  return JSON.stringify([binding?.projectId, binding?.sessionId, binding?.assignmentId, binding?.runId, context.surface?.bindingRevision]);
}
export function contextVisible(context: Context): boolean {
  if (context.visible !== undefined && typeof context.visible !== 'boolean') throw Error('攻击路径可见状态无效');
  return context.visible !== false;
}
export function failure(cause: unknown, operationId: string, action = 'theme.decode'): UiError {
  return { message: (cause instanceof Error ? cause.message : String(cause)).slice(0, 2000), operationId, action };
}
