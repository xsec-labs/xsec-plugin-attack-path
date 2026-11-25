import assert from "node:assert/strict";
import test from "node:test";
import { graphModel } from "../com.xsec.desktop/frontend/index.js";

test("a tree with only a root node counts that node as one task", () => {
  const model = graphModel([{ id: "a", parent_id: null, kind: "trigger", status: "pending" }], []);
  assert.deepEqual(model.counts, { task: 1, action: 0, finding: 0 });
});

test("counts cover every node shown, by the same kind its badge shows", () => {
  const model = graphModel(
    [
      { id: "a", parent_id: null, status: "pending" },
      { id: "b", parent_id: "a", status: "pending" },
      { id: "c", parent_id: "b", status: "pending" },
      { id: "d", parent_id: "b", status: "vuln" },
    ],
    [],
  );
  assert.deepEqual(model.counts, { task: 2, action: 1, finding: 1 });
});
