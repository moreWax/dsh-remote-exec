# sam-exec-fs — the remote-side tool server

For `driver: 'sam'`, the target machine runs a small MCP tool server exposing
exactly three tools under one service prefix (default `execfs`):

| Tool | Input | Output |
|---|---|---|
| `exec` | `{ command, workdir?, stdin?, timeoutMs? }` | `{ exitCode, signal, stdout, stderr }` |
| `read_file` | `{ path, maxBytes }` | `{ base64, truncated }` |
| `write_file` | `{ path, base64 }` | `{ ok: true }` (atomic: temp + rename) |

Wire it to the mesh with `sam-node register-service --type mcp --name execfs`,
and the local harness reaches it by mesh name with zero local keys. The mesh's
policy layer is the only thing that can grant or refuse access.

A reference implementation is ~80 lines with any MCP server SDK; keep it that
small. Anything the agent may do beyond exec/read/write belongs in its own,
more specific tool — not in a wider shell.
