import type { Subagent, TreeNode } from './core';
export const NODE_WIDTH: number;
export const NODE_HEIGHT: number;
export function layoutTreeNodes(nodes: TreeNode[], rootId?: string): {
  positions: Map<string, { x: number; y: number }>; width: number; height: number;
};
export function nodeKind(node: TreeNode, rootId?: string): 'task' | 'action' | 'finding';
export function displayIds(nodes: TreeNode[], rootId?: string): Map<string, string>;
export function graphModel(nodes: TreeNode[], subagents: Subagent[]): {
  rootId?: string;
  layout: ReturnType<typeof layoutTreeNodes>;
  positioned: Array<{ node: TreeNode; x: number; y: number }>;
  positions: Map<string, { node: TreeNode; x: number; y: number }>;
  subagentsByNode: Map<string, Subagent>;
  counts: Record<'task' | 'action' | 'finding', number>;
  stage: { width: number; height: number };
};
