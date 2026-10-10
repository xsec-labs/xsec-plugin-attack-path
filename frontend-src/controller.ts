import { RPC, RESOURCE_STREAM, contextIdentity, contextVisible, readAttackPathNodes, readOperations,
  readSubagents, record, resourceRevision, text, verifyResume, type Context, type GraphData, type Host,
  type Operation, type Subagent, type UiError } from './core';

export interface State {
  contextRevision: number; assignmentId?: string; visible: boolean; loading: boolean;
  data?: GraphData; busy?: string; selectedSubagentId?: string; error?: UiError; status: string;
}
type Token = { epoch: number; generation: number; operationId: string };

export class AttackPathController {
  private state: State = { contextRevision: 0, visible: true, loading: false, status: '' };
  private listeners = new Set<() => void>();
  private epoch = 0;
  private generation = 0;
  private identity?: string;
  private disposed = false;
  private mounted = false;
  private failed = false;
  private dirty = false;
  private subscription?: { dispose(): void };
  constructor(private readonly host: Host) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private set(change: Partial<State>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener();
  }
  private token(): Token { return { epoch: this.epoch, generation: ++this.generation, operationId: crypto.randomUUID() }; }
  private current(token: Token): boolean { return !this.disposed && token.epoch === this.epoch && token.generation === this.generation; }
  private report(cause: unknown, action: string, token: Token) {
    if (!this.current(token)) return;
    this.failed = true; this.dirty = false;
    this.set({ error: { message: (cause instanceof Error ? cause.message : String(cause)).slice(0, 2000),
      operationId: token.operationId, action }, loading: false, busy: undefined, data: undefined, status: '' });
    console.error('attack_path.action.failed', { operation_id: token.operationId, action });
  }
  async mount(context: Context = this.host.context) {
    if (this.mounted || this.disposed) throw Error('攻击路径控制器不可重复挂载');
    this.mounted = true;
    this.subscription = this.host.onData(RESOURCE_STREAM, payload => {
      if (this.disposed) return;
      try { resourceRevision(payload); }
      catch (cause) { this.report(cause, 'resource.decode', this.token()); return; }
      if (this.failed) return;
      this.dirty = true;
      if (this.state.visible && !this.state.loading && !this.state.busy) void this.read();
    });
    console.debug('attack_path.frontend.mounted');
    await this.update(context);
  }
  async update(context: Context) {
    if (this.disposed) return;
    const token = { epoch: this.epoch, generation: this.generation, operationId: crypto.randomUUID() };
    let identity: string, visible: boolean, assignmentId: string | undefined;
    try {
      identity = contextIdentity(context); visible = contextVisible(context);
      const candidate = context.workspace?.binding?.assignmentId;
      if (candidate !== undefined) assignmentId = text(candidate, '任务绑定');
    } catch (cause) { this.report(cause, 'context.decode', token); return; }
    const changed = identity !== this.identity, becameVisible = visible && !this.state.visible;
    if (changed) {
      this.identity = identity; this.epoch += 1; this.generation += 1; this.failed = false; this.dirty = true;
      this.state = { contextRevision: this.epoch, assignmentId, visible, loading: false, status: '' };
      for (const listener of this.listeners) listener();
      console.info('attack_path.context.changed', { outcome: 'invalidated' });
    } else this.set({ visible });
    if (!visible) {
      if (this.state.loading || this.state.busy) {
        this.generation += 1; this.dirty = true;
        this.set({ loading: false, busy: undefined, data: undefined });
      }
      return;
    }
    if (assignmentId && (changed || becameVisible || this.dirty) && !this.failed && !this.state.busy) await this.read();
  }
  refresh = async () => {
    if (this.disposed || this.state.loading || this.state.busy) return;
    this.failed = false; this.dirty = true;
    await this.read();
  };
  private async read() {
    const assignmentId = this.state.assignmentId;
    if (this.disposed || this.failed || !assignmentId || !this.state.visible || this.state.loading || this.state.busy) return;
    const token = this.token(); this.dirty = false;
    this.set({ loading: true, error: undefined, status: '正在读取攻击路径…' });
    console.info('attack_path.read.started', { operation_id: token.operationId });
    try {
      const [tree, subagents, operations] = await Promise.all([
        this.host.request(RPC.tree, {}), this.host.request(RPC.subagents, {}), this.host.request(RPC.operations, {}),
      ]);
      if (!this.current(token)) return;
      const data = { nodes: readAttackPathNodes(tree, assignmentId), subagents: readSubagents(subagents, assignmentId),
        operations: readOperations(operations, assignmentId) };
      const selected = this.state.selectedSubagentId;
      this.set({ data, loading: false, selectedSubagentId: data.subagents.some(row => row.id === selected) ? selected : undefined,
        status: `${data.nodes.length} 个节点 · ${data.subagents.length} 个子 Agent` });
      console.info('attack_path.read.completed', { operation_id: token.operationId, nodes: data.nodes.length,
        subagents: data.subagents.length, operations: data.operations.length });
      if (this.dirty) await this.read();
    } catch (cause) { this.report(cause, 'graph.read', token); }
  }
  async resume(operation: Operation) {
    if (this.disposed || this.state.loading || this.state.busy || this.failed) return;
    const token = this.token();
    this.set({ busy: operation.operationId, error: undefined, status: '正在恢复 Host 操作…' });
    console.info('attack_path.resume.started', { operation_id: token.operationId, action: operation.operation.type });
    try {
      if (!this.state.data?.operations.some(row => row.operationId === operation.operationId) || operation.assignmentId !== this.state.assignmentId) throw Error('恢复操作不属于当前任务快照');
      verifyResume(await this.host.request(RPC.resume, { operationId: operation.operationId }), operation.operationId);
      if (!this.current(token)) return;
      this.set({ busy: undefined, status: 'Host 操作已恢复，正在重新读取。' });
      console.info('attack_path.resume.completed', { operation_id: token.operationId });
      this.dirty = true; await this.read();
    } catch (cause) { this.report(cause, 'operation.resume', token); }
  }
  async openSubagent(subagent: Subagent, title: string) {
    if (this.disposed || this.state.loading || this.state.busy || this.failed) return;
    const token = this.token();
    this.set({ busy: 'subagent.open', error: undefined, selectedSubagentId: subagent.id });
    console.info('attack_path.subagent.open.started', { operation_id: token.operationId });
    try {
      if (!this.state.data?.subagents.some(row => row.id === subagent.id) || subagent.assignment_id !== this.state.assignmentId) throw Error('子 Agent 不属于当前任务快照');
      const result = record(await this.host.request(RPC.open, { pluginId: 'com.xsec.workspace.sub-agent', toolId: 'subagent-detail', entityId: subagent.id,
        title: text(title, '子 Agent 详情标题').slice(0, 256) }), '子 Agent 详情打开结果');
      if (result.ok !== true) throw Error('Host 未确认子 Agent 详情已打开');
      if (!this.current(token)) return;
      this.set({ busy: undefined, status: '子 Agent 详情已打开。' });
      console.info('attack_path.subagent.open.completed', { operation_id: token.operationId });
      if (this.dirty) await this.read();
    } catch (cause) { this.report(cause, 'subagent.open', token); }
  }
  dispose = () => {
    if (this.disposed) return;
    this.disposed = true; this.epoch += 1; this.generation += 1;
    this.subscription?.dispose(); this.subscription = undefined; this.listeners.clear();
    console.debug('attack_path.frontend.disposed');
  };
}
