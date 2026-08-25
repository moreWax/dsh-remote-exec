/**
 * The transport seam: one remote execution world, three drivers.
 *
 * Consumers (fs, shell) program against this interface; drivers implement it.
 * Exported so third-party plugins can also consume `ctx.remoteTransport`.
 * @module morewax/dsh-remote-exec
 */
import { Service } from '@deepseek-ai/cordis'
import type { ChildProcess } from 'node:child_process'

/** One completed command on the remote world. */
export interface TransportExecResult {
  exitCode: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
}

/** Request for one remote command. */
export interface TransportExecRequest {
  command: string
  workdir?: string | undefined
  stdin?: string | undefined
  signal?: AbortSignal | undefined
  timeoutMs?: number | undefined
}

export abstract class RemoteTransport extends Service {
  /** Driver identity for logs and diagnostics. */
  abstract readonly driver: 'ssh' | 'mosh+ssh' | 'sam'

  /** Run one command to completion; rejects only on infrastructure failure. */
  abstract exec(request: TransportExecRequest): Promise<TransportExecResult>

  /** Read a remote file's bytes, capped. */
  abstract readFile(path: string, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array>

  /** Write bytes to a remote path atomically (temp file + rename). */
  abstract writeFileAtomic(path: string, bytes: Uint8Array, signal?: AbortSignal): Promise<void>

  /** Spawn an interactive terminal session (mosh's reason to exist). */
  abstract streamInteractive(command: string): { child: ChildProcess }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    remoteTransport: RemoteTransport
  }
}

/** Single-quote for POSIX shells; one layer, applied exactly once. */
export function shellQuote(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`
}

/** Stateful lifecycle owner for one spawned child. */
class ChildCollector {
  private stdout = ''
  private stderr = ''
  private timedOut = false
  private settled = false
  private timer: NodeJS.Timeout | undefined

  constructor(
    private readonly child: ChildProcess,
    private readonly timeoutMs: number,
    private readonly abortSignal?: AbortSignal,
  ) {}

  collect(): Promise<TransportExecResult> {
    return new Promise((resolve) => {
      const finish = (result: TransportExecResult): void => {
        if (this.settled) return
        this.settled = true
        if (this.timer !== undefined) clearTimeout(this.timer)
        this.abortSignal?.removeEventListener('abort', this.onAbort)
        resolve(result)
      }
      this.child.stdout?.on('data', (data) => { this.stdout += String(data) })
      this.child.stderr?.on('data', (data) => { this.stderr += String(data) })
      this.child.once('error', (error) => finish({
        exitCode: null, signal: null, stdout: this.stdout, stderr: String(error),
      }))
      this.child.once('close', (code, signal) => finish({
        exitCode: this.timedOut ? null : code,
        signal: this.timedOut || this.abortSignal?.aborted === true ? 'SIGTERM' : signal,
        stdout: this.stdout,
        stderr: this.timedOut
          ? `${this.stderr}\n[dsh] killed after ${this.timeoutMs}ms timeout`
          : this.stderr,
      }))
      this.abortSignal?.addEventListener('abort', this.onAbort, { once: true })
      this.timer = setTimeout(() => {
        this.timedOut = true
        this.child.kill('SIGTERM')
      }, this.timeoutMs)
      if (this.abortSignal?.aborted === true) this.onAbort()
    })
  }

  private readonly onAbort = (): void => {
    if (!this.timedOut) this.child.kill('SIGTERM')
  }
}

/** Collect a spawned child into a TransportExecResult with timeout + abort. */
export function collect(
  child: ChildProcess,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<TransportExecResult> {
  return new ChildCollector(child, timeoutMs, signal).collect()
}
