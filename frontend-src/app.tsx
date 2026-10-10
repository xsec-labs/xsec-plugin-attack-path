import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Minus, Plus, RotateCw, Scan } from 'lucide-react';
import { Badge, ControlButton, EmptyState, ErrorState, PageHeader, Spinner, Toolbar } from '@xsec/ui-react';
import { graphModel, displayIds, nodeKind, NODE_WIDTH, NODE_HEIGHT } from './geometry.js';
import { AttackPathController } from './controller';
import type { GraphData } from './core';

type View = { x: number; y: number; scale: number };
const KINDS = { task: '任务', action: '动作', finding: '发现' } as const;
function Graph({ data, controller, disabled, selectedSubagentId }: {
  data: GraphData; controller: AttackPathController; disabled: boolean; selectedSubagentId?: string;
}) {
  const model = useMemo(() => graphModel(data.nodes, data.subagents), [data]);
  const ids = useMemo(() => displayIds(data.nodes, model.rootId), [data, model.rootId]);
  const canvas = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 32, y: 40, scale: 1 });
  const drag = useRef<{ pointerId: number; x: number; y: number; view: View }>();
  const reset = () => {
    const element = canvas.current, position = model.rootId ? model.positions.get(model.rootId) : undefined;
    if (!element || !position) return;
    setView({ x: element.clientWidth / 2 - position.x - NODE_WIDTH / 2, y: 36 - position.y, scale: 1 });
  };
  const zoom = (delta: number, origin?: { x: number; y: number }) => {
    const element = canvas.current;
    if (!element) return;
    const point = origin ?? { x: element.clientWidth / 2, y: element.clientHeight / 2 };
    setView(before => {
      const scale = Math.min(1.8, Math.max(0.45, before.scale + delta));
      return { scale, x: point.x - (point.x - before.x) / before.scale * scale,
        y: point.y - (point.y - before.y) / before.scale * scale };
    });
  };
  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element) throw Error('攻击路径画布未挂载');
    const wheel = (event: WheelEvent) => {
      event.preventDefault(); const rect = element.getBoundingClientRect();
      zoom(event.deltaY > 0 ? -0.1 : 0.1, { x: event.clientX - rect.left, y: event.clientY - rect.top });
    };
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      const next = element.clientWidth, delta = next - width;
      width = next;
      if (delta) setView(before => ({ ...before, x: before.x + delta / 2 }));
    });
    observer.observe(element);
    element.addEventListener('wheel', wheel, { passive: false });
    return () => {
      observer.disconnect();
      element.removeEventListener('wheel', wheel);
      const active = drag.current;
      if (active && element.hasPointerCapture(active.pointerId)) element.releasePointerCapture(active.pointerId);
      drag.current = undefined;
    };
  }, []);
  useLayoutEffect(() => { reset(); }, [model.rootId, data.nodes.length]);
  return <>
    <Toolbar className="ap-tools">
      <div className="ap-legend">{(Object.keys(KINDS) as Array<keyof typeof KINDS>).map(kind =>
        <span key={kind}><i className={'ap-dot ' + kind}/>{KINDS[kind]} <b>{model.counts[kind]}</b></span>)}</div>
      <div className="ap-controls">
        <ControlButton variant="ghost" aria-label="缩小攻击路径" disabled={view.scale <= 0.45} onClick={() => zoom(-0.1)}><Minus size={16}/></ControlButton>
        <ControlButton variant="secondary" aria-label="重置攻击路径视图" onClick={reset}><Scan size={16}/>{Math.round(view.scale * 100)}%</ControlButton>
        <ControlButton variant="ghost" aria-label="放大攻击路径" disabled={view.scale >= 1.8} onClick={() => zoom(0.1)}><Plus size={16}/></ControlButton>
      </div>
    </Toolbar>
    <div ref={canvas} className="ap-canvas" role="region" aria-label="攻击路径图谱" tabIndex={0}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        const delta = { ArrowLeft: { x: 40, y: 0 }, ArrowRight: { x: -40, y: 0 }, ArrowUp: { x: 0, y: 40 }, ArrowDown: { x: 0, y: -40 } }[event.key];
        if (delta) { event.preventDefault(); setView(before => ({ ...before, x: before.x + delta.x, y: before.y + delta.y })); }
        else if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(0.1); }
        else if (event.key === '-') { event.preventDefault(); zoom(-0.1); }
        else if (event.key === 'Home') { event.preventDefault(); reset(); }
      }}
      onPointerDown={event => {
        if (event.button !== 0 || (event.target as HTMLElement).closest('.ap-node')) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, view };
        event.currentTarget.classList.add('ap-dragging');
      }}
      onPointerMove={event => {
        const current = drag.current;
        if (current?.pointerId === event.pointerId) setView({ ...current.view, x: current.view.x + event.clientX - current.x,
          y: current.view.y + event.clientY - current.y });
      }}
      onPointerUp={event => {
        if (drag.current?.pointerId !== event.pointerId) return;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        drag.current = undefined; event.currentTarget.classList.remove('ap-dragging');
      }}
      onPointerCancel={event => { drag.current = undefined; event.currentTarget.classList.remove('ap-dragging'); }}>
      <div className="ap-stage" style={{ width: model.stage.width, height: model.stage.height,
        transform: `translate(${view.x}px,${view.y}px) scale(${view.scale})` }}>
        <svg className="ap-links" width={model.stage.width} height={model.stage.height} aria-hidden="true">
          {data.nodes.map(node => {
            const parent = node.parent_id ? model.positions.get(node.parent_id) : undefined, child = model.positions.get(node.id);
            if (!parent || !child) return null;
            const sx = parent.x + NODE_WIDTH / 2, sy = parent.y + NODE_HEIGHT,
              ex = child.x + NODE_WIDTH / 2, ey = child.y, mid = sy + Math.max(32, (ey - sy) / 2);
            return <path key={node.id} className={'ap-link ' + nodeKind(node, model.rootId)} d={`M ${sx} ${sy} C ${sx} ${mid}, ${ex} ${mid}, ${ex} ${ey}`}/>;
          })}
        </svg>
        {model.positioned.map(position => {
          const node = position.node, kind = nodeKind(node, model.rootId), subagent = model.subagentsByNode.get(node.id);
          return <button key={node.id} type="button" className={'ap-node ' + kind + (subagent ? '' : ' ap-unassigned')}
            disabled={disabled || !subagent} style={{ transform: `translate(${position.x}px,${position.y}px)` }}
            aria-label={`${KINDS[kind]}节点：${node.title}`} aria-pressed={Boolean(subagent && selectedSubagentId === subagent.id)}
            title={subagent ? `状态：${subagent.status}${subagent.status_reason ? '\n原因：' + subagent.status_reason : ''}` : '尚未派发子 Agent'}
            onClick={() => { if (subagent) void controller.openSubagent(subagent, node.title); }}>
            <span className="ap-chip">{KINDS[kind]}</span><span className="ap-node-title">{node.title}</span>
            <span className="ap-id">{ids.get(node.id)}</span>
            {subagent?.status_reason ? <span className="ap-reason">{subagent.status_reason}</span> : null}
          </button>;
        })}
      </div>
    </div>
    <p className="ap-hint">拖动画布移动；滚轮或按钮缩放。聚焦画布后可用方向键移动、+ / − 缩放、Home 重置。</p>
  </>;
}
export function AttackPathApp({ controller }: { controller: AttackPathController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot), disabled = state.loading || Boolean(state.busy);
  const operations = state.data?.operations;
  return <main className="ap-page" aria-busy={state.loading || undefined}>
    <PageHeader title="攻击路径" description="查看任务节点、动作与发现。" actions={
      <ControlButton variant="secondary" disabled={disabled || !state.assignmentId} onClick={() => void controller.refresh()}><RotateCw size={16}/>刷新攻击路径</ControlButton>}/>
    {state.error ? <ErrorState title="攻击路径操作未完成" description={state.error.message} errorId={state.error.operationId}
      action={<ControlButton variant="secondary" disabled={disabled} onClick={() => void controller.refresh()}>重新读取</ControlButton>}/> : null}
    <div className="ap-status" role="status" aria-live="polite">{state.loading ? <Spinner label="正在读取攻击路径…"/> : state.status}</div>
    {operations?.length ? <section className="ap-operations" aria-label="待恢复的 Host 操作">
      <div><Badge tone="warning">{operations.length} 项待恢复</Badge><p>Host 操作完成后可继续终结报告。</p></div>
      <div className="ap-operation-actions">{operations.map(operation => <ControlButton key={operation.operationId} variant="secondary"
        loading={state.busy === operation.operationId} disabled={disabled} onClick={() => void controller.resume(operation)}>
        恢复 {operation.operation.type}</ControlButton>)}</div>
    </section> : null}
    {!state.assignmentId ? <EmptyState title="攻击路径尚未绑定任务" description="选择任务后查看路径、节点与子 Agent 状态。"/> : null}
    {state.data?.nodes.length === 0 ? <EmptyState title="暂无攻击路径节点" description="主 Agent 创建节点并派发任务后，这里会自动更新。"/> : null}
    {state.data && state.data.nodes.length > 0 ? <Graph key={state.contextRevision} data={state.data} controller={controller}
      disabled={disabled} selectedSubagentId={state.selectedSubagentId}/> : null}
  </main>;
}
