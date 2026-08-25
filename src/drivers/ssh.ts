/** SSH driver: exec + file IO over the local OpenSSH client (optionally via Tailscale). */
import { spawn } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
import { RemoteTransport, shellQuote, collect } from '../transport.js'
import type { TransportExecRequest, TransportExecResult } from '../transport.js'

export interface SshDriverConfig {
  host: string
  user?: string
  port?: number
  sshArgs?: string[]
  tailscale?: boolean
  defaultTimeoutMs?: number
}

const BASE_ARGS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10']

export class SshTransport extends RemoteTransport {
  readonly driver = 'ssh' as const

  constructor(ctx: Context, private readonly cfg: SshDriverConfig) {
    super(ctx, 'remoteTransport')
  }

  private target(): string {
    return this.cfg.user !== undefined ? `${this.cfg.user}@${this.cfg.host}` : this.cfg.host
  }

  /** With tailscale on, `tailscale ssh` authenticates by tailnet identity — no keys. */
  private baseCommand(): { bin: string; prefix: string[] } {
    if (this.cfg.tailscale) return { bin: 'tailscale', prefix: ['ssh'] }
    return { bin: 'ssh', prefix: [...BASE_ARGS, ...this.cfg.sshArgs ?? []] }
  }

  private runChild(args: string[], opts: { stdin?: string | undefined } = {}): ChildProcessWithoutNullStreams {
    const { bin, prefix } = this.baseCommand()
    const child = spawn(bin, [...prefix, this.target(), ...args], { stdio: ['pipe', 'pipe', 'pipe'] })
    child.stdin.end(opts.stdin ?? '')
    return child
  }

  exec(request: TransportExecRequest): Promise<TransportExecResult> {
    // The command rides stdin into `bash -s`: ONE remote shell layer, so consumer
    // scripts may contain any quoting without double-parse issues.
    const preamble =
      request.workdir !== undefined ? `cd ${shellQuote(request.workdir)} || exit 97\n` : ''
    const child = this.runChild(['bash', '-s'], { stdin: `${preamble}${request.command}\n` })
    return collect(child, request.timeoutMs ?? this.cfg.defaultTimeoutMs ?? 120000, request.signal)
  }

  async readFile(path: string, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array> {
    // head -c caps transfer; base64 keeps binary payloads safe across the channel.
    const child = this.runChild(['bash', '-s'], {
      stdin: `head -c ${maxBytes} ${shellQuote(path)} | base64\n`,
    })
    const r = await collect(child, this.cfg.defaultTimeoutMs ?? 120000, signal)
    if (r.exitCode !== 0) throw new Error(`ssh read failed (${r.exitCode}): ${r.stderr.slice(0, 400)}`)
    return new Uint8Array(Buffer.from(r.stdout.replace(/\s+/g, ''), 'base64'))
  }

  async writeFileAtomic(path: string, bytes: Uint8Array, signal?: AbortSignal): Promise<void> {
    const dir = path.replace(/[^/]*$/, '')
    const tmp = `${path}.dsh-tmp.$$`
    const b64 = Buffer.from(bytes).toString('base64')
    const script =
      `mkdir -p ${shellQuote(dir)} && ` +
      `printf %s ${shellQuote(b64)} | base64 -d > ${shellQuote(tmp)} && mv -f ${shellQuote(tmp)} ${shellQuote(path)}`
    const result = await this.exec({ command: script, signal })
    if (result.exitCode !== 0) {
      throw new Error(`ssh write failed (${result.exitCode}): ${result.stderr.slice(0, 400)}`)
    }
  }

  streamInteractive(command: string): { child: ReturnType<typeof spawn> } {
    const { bin, prefix } = this.baseCommand()
    const argv =
      bin === 'tailscale'
        ? [...prefix, '-t', this.target(), command]
        : ['-t', ...prefix, this.target(), shellQuote(command)]
    const child = spawn(bin, argv, { stdio: 'inherit' })
    return { child }
  }
}

import type { ChildProcessWithoutNullStreams } from 'node:child_process'
