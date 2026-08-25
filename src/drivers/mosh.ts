/**
 * MOSH driver: interactive terminals over native mosh (UDP, roaming-safe,
 * survives laptop sleep); one-shot exec and file IO delegate to SSH.
 */
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
import { RemoteTransport } from '../transport.js'
import type { TransportExecRequest, TransportExecResult } from '../transport.js'
import { SshTransport } from './ssh.js'
import type { SshDriverConfig } from './ssh.js'

export interface MoshDriverConfig extends SshDriverConfig {
  moshPrediction?: 'adaptive' | 'always' | 'never'
}

export class MoshTransport extends RemoteTransport {
  readonly driver = 'mosh+ssh' as const

  private readonly sshFallback: SshTransport

  constructor(ctx: Context, private readonly cfg: MoshDriverConfig) {
    super(ctx, 'remoteTransport')
    this.sshFallback = new SshTransport(ctx, cfg)
  }

  exec(request: TransportExecRequest): Promise<TransportExecResult> {
    return this.sshFallback.exec(request)
  }

  readFile(path: string, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array> {
    return this.sshFallback.readFile(path, maxBytes, signal)
  }

  writeFileAtomic(path: string, bytes: Uint8Array, signal?: AbortSignal): Promise<void> {
    return this.sshFallback.writeFileAtomic(path, bytes, signal)
  }

  streamInteractive(command: string): { child: ChildProcess } {
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
