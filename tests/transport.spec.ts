import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SamTransport, shellQuote } from '../src/index.js'

describe('shellQuote', () => {
  it('wraps in single quotes and escapes embedded quotes', () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'")
    expect(shellQuote('plain')).toBe("'plain'")
  })
})

describe('sam driver credential guard', () => {
  it('refuses to authenticate against a foreign service on the port', async () => {
    const ctx = new Context()
    const t = new SamTransport(ctx, {
      mcpUrl: 'http://127.0.0.1:9/mcp',   // nothing there; preflight must fail
      servicePrefix: 'execfs',
      token: 'secret-token-value',
    })
    await expect(t.exec({ command: 'echo pwned' })).rejects.toThrow(/cannot reach sam-node|does not speak/)
  })
})

// Opt-in live check against a real non-SAM service (e.g. a GitLab container
// squatting on 8080): the driver must refuse before sending credentials.
const LIVE = process.env.DSH_SAM_LIVE === '1'
describe.skipIf(!LIVE)('sam credential guard (live)', () => {
  it('refuses a foreign service at the configured mcpUrl', async () => {
    const ctx = new Context()
    const t = new SamTransport(ctx, {
      mcpUrl: process.env.DSH_SAM_MCP_URL ?? 'http://127.0.0.1:8080/mcp',
      servicePrefix: 'execfs',
      token: 'secret-token',
    })
    await expect(t.exec({ command: 'echo pwned' })).rejects.toThrow()
  })
})

// Opt-in end-to-end over a real ssh target (needs key auth):
//   DSH_REMOTE_LIVE=1 DSH_REMOTE_HOST=127.0.0.1 DSH_REMOTE_USER=$USER \
//   DSH_REMOTE_ROOT=/tmp/remote-test npx vitest run
const SSH_LIVE = process.env.DSH_REMOTE_LIVE === '1'
describe.skipIf(!SSH_LIVE)('ssh end-to-end (live)', () => {
  it('executes, round-trips a file, and lists', async () => {
    const { apply } = await import('../src/index.js')
    const ctx = new Context()
    const testKey = join(homedir(), '.ssh', 'dsh_test_ed25519')
    const identityArgs = existsSync(testKey) ? ['-i', testKey] : []
    apply(ctx, {
      driver: 'ssh',
      host: process.env.DSH_REMOTE_HOST ?? '127.0.0.1',
      root: process.env.DSH_REMOTE_ROOT ?? '/tmp/remote-test',
      sshArgs: [...identityArgs, '-o', 'StrictHostKeyChecking=No'],
      ...(process.env.DSH_REMOTE_USER !== undefined ? { user: process.env.DSH_REMOTE_USER } : {}),
    })
    const spec = ctx.shell.resolve({ command: 'echo hello-from-remote && uname -s' })
    const run = await ctx.shell.run(spec)
    expect(run.exitCode).toBe(0)
    expect(run.stdout.text).toContain('hello-from-remote')

    const target = await ctx.fs.resolve('dsh-proof.txt')
    await ctx.fs.writeText(target, 'written-over-ssh\n')
    expect(await ctx.fs.readText(target)).toBe('written-over-ssh\n')

    const dir = await ctx.fs.resolve('.')
    const names = (await ctx.fs.listDir(dir)).map((e) => e.name)
    expect(names).toContain('dsh-proof.txt')
  })
})
