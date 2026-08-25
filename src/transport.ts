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

/** Collect a spawned child into a TransportExecResult with timeout + abort. */
export function collect(
  child: ChildProcess,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<TransportExecResult> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM') }, timeoutMs)
    const onAbort = () => { if (!timedOut) child.kill('SIGTERM') }
    signal?.addEventListener('abort', onAbort, { once: true })
    child.stdout?.on('data', (d) => { stdout += String(d) })
    child.stderr?.on('data', (d) => { stderr += String(d) })
    child.on('error', (e) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolve({ exitCode: null, signal: null, stdout: '', stderr: String(e) })
    })
    child.on('close', (code, closingSignal) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolve({
        exitCode: timedOut ? null : code,
        signal: timedOut || signal?.aborted === true ? 'SIGTERM' : closingSignal,
        stdout,
        stderr: timedOut ? `${stderr}\n[dsh] killed after ${timeoutMs}ms timeout` : stderr,
      })
    })
  })
}
