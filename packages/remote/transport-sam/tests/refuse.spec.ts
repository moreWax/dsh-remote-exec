import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SamTransport } from '../src/index.js'

describe('transport-sam credential guard', () => {
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
