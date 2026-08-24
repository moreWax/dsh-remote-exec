/**
 * MOSH transport provider: interactive terminals over mosh (UDP, roaming-safe,
 * persistent sessions), with one-shot exec and file IO delegated to the SSH
 * driver — the mosh protocol cannot capture command output or carry files.
 * @module @deepseek-ai/dsh-transport-mosh
 */
import { spawn } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
import { RemoteTransport } from '@morewax/dsh-remote-transport'
import type { TransportExecRequest, TransportExecResult } from '@morewax/dsh-remote-transport'
import { SshTransport } from '@morewax/dsh-transport-ssh'
import type { Config as SshConfig } from '@morewax/dsh-transport-ssh'

export interface Config extends SshConfig {
  /** MOSH prediction mode forwarded to mosh-client. Default: adaptive. */
  moshPrediction?: 'adaptive' | 'always' | 'never'
}

export class MoshTransport extends RemoteTransport {
  readonly driver = 'mosh+ssh' as const

  private readonly sshFallback: SshTransport

  constructor(ctx: Context, private readonly cfg: Config) {
    super(ctx, 'remoteTransport')
    this.sshFallback = new SshTransport(ctx, cfg)
  }

  /** One-shot exec and file IO ride the ssh fallback. */
  exec(request: TransportExecRequest): Promise<TransportExecResult> {
    return this.sshFallback.exec(request)
  }

  readFile(path: string, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array> {
    return this.sshFallback.readFile(path, maxBytes, signal)
  }

  writeFileAtomic(path: string, bytes: Uint8Array, signal?: AbortSignal): Promise<void> {
    return this.sshFallback.writeFileAtomic(path, bytes, signal)
  }

  /**
   * Interactive terminal over native mosh. The local `mosh` client owns the
   * UDP session; it survives IP changes and laptop sleep — exactly where a
   * plain ssh terminal drops.
   */
  streamInteractive(command: string): { child: ReturnType<typeof spawn> } {
    const target = this.cfg.user !== undefined ? `${this.cfg.user}@${this.cfg.host}` : this.cfg.host
    const child = spawn('mosh', [
      ...(this.cfg.moshPrediction !== undefined ? [`--prediction=${this.cfg.moshPrediction}`] : []),
      ...(this.cfg.port !== undefined ? ['-p', String(this.cfg.port)] : []),
      target,
      '--', command,
    ], { stdio: 'inherit' })
    return { child }
  }
}

export const name = 'transport-mosh'
export const inject = [] as const

export function apply(ctx: Context, config: Config): void {
  ctx.remoteTransport = new MoshTransport(ctx, config)
}
