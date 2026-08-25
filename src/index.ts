/**
 * @morewax/dsh-remote-exec — run the harness locally, execute on your server.
 *
 * One plugin, three transports, selected by config:
 *
 *   driver: 'ssh'   — OpenSSH (optionally via `tailscale ssh`, keyless)
 *   driver: 'mosh'  — mosh interactive terminals + ssh for exec/files
 *   driver: 'sam'   — SAM mesh via sam-node MCP (zero local keys)
 *
 * Mounts the agent's file tools (ctx.fs) and shell (ctx.shell) onto the remote
 * world. Composition: add this row to a profile and replace the local
 * fs/bash rows (see cordis.patch.yml).
 *
 * @module morewax/dsh-remote-exec
 */
import type { Context } from '@deepseek-ai/cordis'
import type { RemoteTransport } from './transport.js'
import { SshTransport } from './drivers/ssh.js'
import { MoshTransport } from './drivers/mosh.js'
import { SamTransport } from './drivers/sam.js'
import { RemoteFileSystem } from './fs.js'
import { RemoteShell } from './shell.js'

export interface Config {
  /** Transport driver. Default 'ssh'. */
  driver?: 'ssh' | 'mosh' | 'sam'
  /** Remote host (ssh/mosh). A Tailscale MagicDNS name works when tailscale is on. */
  host?: string
  /** Remote user; omitted uses your ssh config. */
  user?: string
  /** SSH port. */
  port?: number
  /** Extra ssh args (IdentityFile, JumpHost, …). */
  sshArgs?: string[]
  /** Route ssh via `tailscale ssh` — tailnet-identity auth, no key management. */
  tailscale?: boolean
  /** mosh prediction mode (driver: mosh only). */
  moshPrediction?: 'adaptive' | 'always' | 'never'
  /** sam-node MCP endpoint (driver: sam only). Default http://127.0.0.1:8080/mcp */
  mcpUrl?: string
  /** sam-node bearer token; omit when riding the local Unix socket (driver: sam). */
  token?: string
  /** Namespaced tool prefix of the remote sam-exec-fs server (driver: sam). */
  servicePrefix?: string
  /** Peer id hosting the tool server; omit to let the mesh router choose (driver: sam). */
  peerId?: string
  /** Remote workspace root — default cwd for the agent's tools. Default '~'. */
  root?: string
  /** Default command timeout in ms. Default 120000. */
  defaultTimeoutMs?: number
  /** Mount the remote filesystem provider (ctx.fs). Default true. */
  fs?: boolean
  /** Mount the remote shell provider (ctx.shell). Default true. */
  shell?: boolean
}

export { RemoteTransport } from './transport.js'
export type { TransportExecRequest, TransportExecResult } from './transport.js'
export { shellQuote } from './transport.js'
export { SshTransport } from './drivers/ssh.js'
export { MoshTransport } from './drivers/mosh.js'
export { SamTransport } from './drivers/sam.js'
export { RemoteFileSystem } from './fs.js'
export { RemoteShell } from './shell.js'

export const name = 'remote-exec'
export const inject = [] as const

function buildTransport(ctx: Context, config: Config): RemoteTransport {
  switch (config.driver ?? 'ssh') {
    case 'ssh':
    case 'mosh': {
      if (config.host === undefined) {
        throw new Error(`driver ${config.driver ?? 'ssh'} requires config.host`)
      }
      const common = {
        host: config.host,
        ...(config.user !== undefined ? { user: config.user } : {}),
        ...(config.port !== undefined ? { port: config.port } : {}),
        ...(config.sshArgs !== undefined ? { sshArgs: config.sshArgs } : {}),
        ...(config.tailscale !== undefined ? { tailscale: config.tailscale } : {}),
        ...(config.defaultTimeoutMs !== undefined ? { defaultTimeoutMs: config.defaultTimeoutMs } : {}),
      }
      if ((config.driver ?? 'ssh') === 'mosh') {
        return new MoshTransport(ctx, {
          ...common,
          ...(config.moshPrediction !== undefined ? { moshPrediction: config.moshPrediction } : {}),
        })
      }
      return new SshTransport(ctx, common)
    }
    case 'sam':
      return new SamTransport(ctx, {
        servicePrefix: config.servicePrefix ?? 'execfs',
        ...(config.mcpUrl !== undefined ? { mcpUrl: config.mcpUrl } : {}),
        ...(config.token !== undefined ? { token: config.token } : {}),
        ...(config.peerId !== undefined ? { peerId: config.peerId } : {}),
        ...(config.defaultTimeoutMs !== undefined ? { defaultTimeoutMs: config.defaultTimeoutMs } : {}),
      })
  }
}

export function apply(ctx: Context, config: Config = {}): void {
  const transport = buildTransport(ctx, config)
  ctx.remoteTransport = transport

  const root = config.root ?? '~'
  if (config.fs !== false) ctx.fs = new RemoteFileSystem(ctx, transport, { root })
  if (config.shell !== false) {
    ctx.shell = new RemoteShell(ctx, transport, {
      root,
      ...(config.defaultTimeoutMs !== undefined ? { defaultTimeoutMs: config.defaultTimeoutMs } : {}),
    })
  }
}
