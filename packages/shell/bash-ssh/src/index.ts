/**
 * SSH bash executor: implements the ShellExecutor seam over a
 * ctx.remoteTransport. Foreground runs honor timeout, abort, stdin and
 * exit-code semantics; background processes stream through a local ssh child.
 * @module @deepseek-ai/dsh-bash-ssh
 */
import { spawn } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
import '@morewax/dsh-remote-transport'
import { ShellExecutor } from '@deepseek-ai/dsh-shell'
import type {
  ShellExecRequest,
  ShellExecSpec,
  ShellProcess,
  ShellProcessRead,
  ShellRunResult,
} from '@deepseek-ai/dsh-shell'

export interface Config {
  /** Base working directory on the remote world. */
  root: string
  /** Default foreground timeout in ms. */
  defaultTimeoutMs?: number
}

const DEFAULT_TIMEOUT = 120000
const MAX_OUTPUT = 200000

function shq(s: string): string {
  return `'${s.replaceAll("'", '\'\\\'\'')}'`
}

export class SshBashExecutor extends ShellExecutor {
  declare readonly ctx: Context

  constructor(
    ctx: Context,
    private readonly cfg: Config,
  ) {
    super(ctx)
  }

  resolve(request: ShellExecRequest): ShellExecSpec {
    return {
      command: request.command,
      workdir: request.workdir ?? this.cfg.root,
      timeoutMs: Math.min(request.timeoutMs ?? this.cfg.defaultTimeoutMs ?? DEFAULT_TIMEOUT, DEFAULT_TIMEOUT * 10),
      stdoutMaxBytes: request.stdoutMaxBytes ?? MAX_OUTPUT,
      signal: request.signal,
      stdin: request.stdin,
      env: request.env,
      dshEnv: request.dshEnv,
      sandboxPolicy: undefined,
    }
  }

  async run(spec: ShellExecSpec): Promise<ShellRunResult> {
    const r = await this.ctx.remoteTransport.exec({
      command: spec.command,
      workdir: spec.workdir,
      stdin: spec.stdin,
      signal: spec.signal,
      timeoutMs: spec.timeoutMs,
    })
    const timedOut = r.stderr.includes(`killed after ${spec.timeoutMs}ms timeout`)
    return {
      exitCode: r.exitCode,
      signal: r.signal,
      timedOut,
      aborted: !timedOut && r.exitCode === null && spec.signal?.aborted === true,
      timeoutMs: spec.timeoutMs,
      stdout: { text: r.stdout.slice(0, spec.stdoutMaxBytes), truncated: r.stdout.length > spec.stdoutMaxBytes },
      stderr: { text: r.stderr.slice(0, MAX_OUTPUT), truncated: false },
    }
  }

  start(spec: ShellExecSpec): ShellProcess {
    // Background jobs keep a local ssh child streaming the remote process;
    // killing the local child closes the channel and signals the remote side.
    const child = spawn('ssh', ['-o', 'BatchMode=yes', '-', shq(`cd ${shq(spec.workdir)} && ${spec.command}`)], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    child.stdin.end(spec.stdin)

    let status: 'running' | 'completed' | 'killed' = 'running'
    let exitCode: number | null = null
    let sig: NodeJS.Signals | null = null
    let lossy = false
    let stdoutBuf = ''
    let stderrBuf = ''
    const done = new Promise<void>((resolve) => {
      child.on('error', () => { status = 'killed'; stderrBuf += 'spawn failed'; resolve() })
      child.on('close', (code, s) => {
        if (status !== 'killed') status = 'completed'
        exitCode = code
        sig = s
        resolve()
      })
    })
    child.stdout.on('data', (d) => {
      stdoutBuf += String(d)
      if (stdoutBuf.length > MAX_OUTPUT) { stdoutBuf = stdoutBuf.slice(-MAX_OUTPUT); lossy = true }
    })
    child.stderr.on('data', (d) => {
      stderrBuf += String(d)
      if (stderrBuf.length > MAX_OUTPUT) { stderrBuf = stderrBuf.slice(-MAX_OUTPUT); lossy = true }
    })

    return {
      get status() { return status },
      get exitCode() { return exitCode },
      get signal() { return sig },
      done,
      readOutput(): ShellProcessRead {
        const delta = stdoutBuf + (stderrBuf ? `\n[stderr]\n${stderrBuf}` : '')
        const wasLossy = lossy
        stdoutBuf = ''
        stderrBuf = ''
        lossy = false
        return { delta, lossy: wasLossy }
      },
      kill(): boolean {
        if (status !== 'running') return false
        status = 'killed'
        child.kill('SIGTERM')
        return true
      },
    }
  }
}

export const name = 'bash-ssh'
export const inject = ['remoteTransport'] as const

export function apply(ctx: Context, config: Config): void {
  ctx.shell = new SshBashExecutor(ctx, config)
}
