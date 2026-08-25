# dsh-remote-exec

**Run DeepSeek Harness locally, execute on your server.** One plugin; the
agent's file tools and shell operate on a remote machine over SSH or mosh.

```yaml
- id: remote-exec
  name: '@morewax/dsh-remote-exec'
  config:
    driver: ssh          # ssh | mosh
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

## Install

```sh
dsh plugin --profile default add github:moreWax/dsh-remote-exec
```

## Development

```sh
pnpm install
pnpm run typecheck
pnpm test          # offline suites
pnpm build

# live end-to-end over ssh (needs key auth to the target):
DSH_REMOTE_LIVE=1 DSH_REMOTE_HOST=127.0.0.1 DSH_REMOTE_USER=$USER \
DSH_REMOTE_ROOT=/tmp/remote-test pnpm test
```

## Status

Built against DeepSeek Harness `0.1.1-rc.x` (developer preview). Remote shell
and filesystem are verified end-to-end over SSH; mosh interactive uses the
standard `mosh` client behavior.
