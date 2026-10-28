import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { api, queryKeys } from "../api/client";

export function McpStatusBar() {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: queryKeys.mcpStatus,
    queryFn: () => api.mcpStatus(),
    refetchInterval: 5 * 60 * 1000,
    staleTime: 60 * 1000,
  });

  const refresh = async () => {
    const fresh = await api.mcpStatus(true);
    queryClient.setQueryData(queryKeys.mcpStatus, fresh);
  };

  const servers = status.data?.servers ?? [];
  const title = status.data?.error
    ? `Check failed: ${status.data.error}`
    : status.data
      ? `Checked ${new Date(status.data.checkedAt).toLocaleTimeString()}`
      : "Checking connectors";

  return (
    <div className="mcp-status" title={title}>
      {status.isPending ? <span className="mcp-pill mcp-pill-pending">checking connectors</span> : null}
      {status.data?.error ? <span className="mcp-pill mcp-pill-down">connector check failed</span> : null}
      {status.data && !status.data.error && servers.length === 0 ? (
        <Link to="/settings" className="mcp-pill">
          Add integrations
        </Link>
      ) : null}
      {servers.map((server) => {
        const connected = server.status === "connected";
        return (
          <span key={server.name} className={connected ? "mcp-pill mcp-pill-up" : "mcp-pill mcp-pill-down"}>
            <span className="mcp-dot" aria-hidden="true" />
            {server.label} {connected ? "connected" : server.status}
          </span>
        );
      })}
      <button type="button" className="mcp-refresh" onClick={() => void refresh()} aria-label="Re-check connectors">
        ↻
      </button>
    </div>
  );
}
