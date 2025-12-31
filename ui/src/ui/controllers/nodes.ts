import type { GatewayBrowserClient } from "../gateway";

export type NodesState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  nodesLoading: boolean;
  nodes: Array<Record<string, unknown>>;
  lastError: string | null;
};

export async function loadNodes(
  state: NodesState,
  opts?: { quiet?: boolean },
) {
  if (!state.client || !state.connected) return;
  if (state.nodesLoading) return;
  state.nodesLoading = true;
  if (!opts?.quiet) state.lastError = null;
  try {
    const res = (await state.client.request("node.list", {})) as {
      nodes?: Array<Record<string, unknown>>;
    };
    state.nodes = Array.isArray(res.nodes) ? res.nodes : [];
  } catch (err) {
    if (!opts?.quiet) state.lastError = String(err);
  } finally {
    state.nodesLoading = false;
  }
}
