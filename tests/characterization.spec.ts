import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { RemoteShell, RemoteTransport, SamTransport, apply } from '../src/index.js'
import { collect } from '../src/transport.js'
import type { TransportExecRequest, TransportExecResult } from '../src/index.js'

class FakeTransport extends RemoteTransport {
  readonly driver = 'ssh' as const
  readonly requests: TransportExecRequest[] = []
  constructor(ctx: Context) { super(ctx, 'remoteTransport') }
  exec(request: TransportExecRequest): Promise<TransportExecResult> {
    this.requests.push(request)
    return Promise.resolve({ exitCode: 0, signal: null, stdout: 'ok', stderr: '' })
  }
  readFile(): Promise<Uint8Array> { return Promise.resolve(new Uint8Array()) }
  writeFileAtomic(): Promise<void> { return Promise.resolve() }
  streamInteractive(): { child: ChildProcess } { throw new Error('unused') }
}

describe('public provider characterization', () => {
  it('applies defaults and supports selectively disabling providers', () => {
    const ctx = new Context()
    apply(ctx, { host: 'example.test', fs: false })
    expect(ctx.remoteTransport).toBeDefined()
    expect(ctx.fs).toBeUndefined()
    expect(ctx.shell).toBeDefined()
    expect(ctx.shell.resolve({ command: 'pwd' })).toMatchObject({
      command: 'pwd', workdir: '~', timeoutMs: 120000, stdoutMaxBytes: 200000,
    })
  })

  it('forwards resolved foreground requests only through the transport seam', async () => {
    const ctx = new Context()
    const transport = new FakeTransport(ctx)
    const shell = new RemoteShell(ctx, transport, { root: '/workspace' })
    const spec = shell.resolve({ command: 'printf ok', stdin: 'input', timeoutMs: 42 })
    await expect(shell.run(spec)).resolves.toMatchObject({ exitCode: 0, stdout: { text: 'ok' } })
    expect(transport.requests).toEqual([expect.objectContaining({
      command: 'printf ok', workdir: '/workspace', stdin: 'input', timeoutMs: 42,
    })])
  })

  it.each([
    [{ driver: 'ssh' as const }, /requires config.host/],
    [{ driver: 'mosh' as const }, /requires config.host/],
  ])('rejects missing host consistently for %o', (config, error) => {
    expect(() => apply(new Context(), config)).toThrow(error)
  })
})

describe('SAM token preflight characterization', () => {
  it('never includes credentials in the identity preflight request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html>foreign service</html>', { status: 200 }),
    )
    const transport = new SamTransport(new Context(), {
      mcpUrl: 'http://foreign.test:8080/mcp', servicePrefix: 'execfs', token: 'top-secret',
    })
    await expect(transport.exec({ command: 'true' })).rejects.toThrow(/does not speak/)
    const init = fetchMock.mock.calls[0]?.[1]
    expect(new Headers(init?.headers).has('authorization')).toBe(false)
    expect(new Headers(init?.headers).has('x-sam-authentication')).toBe(false)
    fetchMock.mockRestore()
  })
})


describe('process collection characterization', () => {
  it('terminates a child immediately when passed an already-aborted signal', async () => {
    const child = new EventEmitter() as ChildProcess
    Object.assign(child, {
      stdout: new EventEmitter(), stderr: new EventEmitter(),
      kill: vi.fn(() => { queueMicrotask(() => child.emit('close', null, 'SIGTERM')); return true }),
    })
    const controller = new AbortController()
    controller.abort()
    const result = await collect(child, 10000, controller.signal)
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    expect(result.signal).toBe('SIGTERM')
  })
})
