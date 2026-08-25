# dsh-remote-exec

**Run DeepSeek Harness locally, execute on your server.** One plugin; the
agent's file tools and shell operate on a remote machine over your choice of
transport.

```yaml
- id: remote-exec
  name: '@morewax/dsh-remote-exec'
  config:
    driver: ssh          # ssh | mosh | sam
    host: gpu-box        # or a Tailscale MagicDNS name
    user: me
    root: /home/me/work  # remote workspace
    tailscale: true      # keyless tailnet auth (ssh/mosh)
```

## Drivers

| Driver | Exec & files | Interactive terminal | Auth |
|---|---|---|---|
| `ssh` | OpenSSH | ssh PTY | keys, or `tailscale: true` for keyless tailnet identity |
| `mosh` | via ssh | **native mosh** — roaming-safe, survives sleep | same as ssh |
| `sam` | SAM mesh (MCP tools on a peer) | — (use mosh) | mesh identity; **zero local keys** |

The sam driver speaks MCP through the **v2 TypeScript SDK** (`@modelcontextprotocol/client@^2`),
which natively implements the **2026-07-28 specification** — the stateless protocol core (no
initialize handshake, no `Mcp-Session-Id`, self-describing requests with `Mcp-Method`/`Mcp-Name`
headers, MRTR for mid-call input, cacheable list results). Era negotiation is built in: it speaks
2026-07-28 to modern servers and falls back to legacy-era revisions (2025-11-25 and older) for
servers that haven't upgraded yet.

The `sam` driver refuses to send credentials to any endpoint that does not
prove it speaks the sam-node API — a foreign service squatting on the port
fails the driver loudly instead of receiving your token.

## Install

```sh
dsh plugin --profile default add github:moreWax/dsh-remote-exec
```

## The remote side (driver: sam)

Run a small exec/fs tool server on the target machine and register it with
your mesh — see [sam-exec-fs/README.md](sam-exec-fs/README.md). Exposes exactly
three tools (`exec`, `read_file`, `write_file`); everything else stays policy-
gated by the mesh.

## Development

```sh
pnpm install
pnpm test          # offline suites
pnpm build

# live end-to-end over ssh (needs key auth to the target):
DSH_REMOTE_LIVE=1 DSH_REMOTE_HOST=127.0.0.1 DSH_REMOTE_USER=$USER \
DSH_REMOTE_ROOT=/tmp/remote-test pnpm test
```

## Status

Built against DeepSeek Harness `0.1.1-rc.x` (developer preview). Remote shell
and filesystem are verified end-to-end over ssh; mosh interactive is standard
`mosh` client behavior; the sam driver ships with a credential guard and is
exercised by unit + opt-in live tests.
