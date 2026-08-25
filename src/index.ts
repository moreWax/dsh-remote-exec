/**
 * @morewax/dsh-remote-exec — run the harness locally, execute on your server.
 *
 * One plugin, two transports, selected by config:
 *
 *   driver: 'ssh'   — OpenSSH (optionally via `tailscale ssh`, keyless)
 *   driver: 'mosh'  — mosh interactive terminals + ssh for exec/files
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
import { RemoteFileSystem } from './fs.js'
import { RemoteShell } from './shell.js'
import { sshConfig } from './config.js'

export interface Config {
  /** Transport driver. Default 'ssh'. */
  driver?: 'ssh' | 'mosh'
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
export { RemoteFileSystem } from './fs.js'
export { RemoteShell } from './shell.js'

export const name = 'remote-exec'
export const inject = [] as const

function buildTransport(ctx: Context, config: Config): RemoteTransport {
  switch (config.driver ?? 'ssh') {
    case 'ssh':
    case 'mosh': {
      const common = sshConfig(config)
      if ((config.driver ?? 'ssh') === 'mosh') {
        return new MoshTransport(ctx, {
          ...common,
          ...(config.moshPrediction !== undefined ? { moshPrediction: config.moshPrediction } : {}),
        })
      }
      return new SshTransport(ctx, common)
    }
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
