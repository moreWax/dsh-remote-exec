/**
 * Remote transport Service Definition: one execution world reached over SSH
 * or MOSH. Providers implement the abstract methods; consumers (fs-ssh,
 * bash-ssh) program against this seam so driver choice is composition, not code.
 *
 * MOSH note: mosh carries interactive terminals over UDP and survives roaming;
 * it cannot capture one-shot command output or transfer files. The mosh
 * provider serves streamInteractive natively and delegates exec/file methods
 * to an ssh fallback.
 * @module @deepseek-ai/dsh-remote-transport
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
  /** Human-readable driver identity for logs and diagnostics. */
  abstract readonly driver: 'ssh' | 'mosh+ssh' | 'sam'

  /** Run one command to completion; rejects only on infrastructure failure. */
  abstract exec(request: TransportExecRequest): Promise<TransportExecResult>

  /** Read a remote file's bytes, capped. */
  abstract readFile(path: string, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array>

  /** Write bytes to a remote path atomically (temp file + rename). */
  abstract writeFileAtomic(path: string, bytes: Uint8Array, signal?: AbortSignal): Promise<void>

  /** Spawn an interactive terminal session (the capability MOSH exists for). */
  abstract streamInteractive(command: string): { child: ChildProcess }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    remoteTransport: RemoteTransport
  }
}

export default RemoteTransport

/** Single-quote for POSIX shells; shared by every transport consumer. */
export function shellQuote(s: string): string {
  return `'${s.replaceAll("'", '\'\'\'')}'`
}
