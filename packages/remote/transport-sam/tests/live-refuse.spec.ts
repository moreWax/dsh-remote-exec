import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SamTransport } from '../src/index.js'

// Opt-in live check: verifies the credential guard refuses non-SAM services.
const LIVE = process.env.DSH_SAM_LIVE === '1'
describe.skipIf(!LIVE)('transport-sam credential guard (live)', () => {
  it('refuses to send credentials to a foreign service on mcpUrl', async () => {
    const ctx = new Context()
    const t = new SamTransport(ctx, {
      mcpUrl: process.env.DSH_SAM_MCP_URL ?? 'http://127.0.0.1:8080/mcp',
      servicePrefix: 'execfs',
      token: 'secret-token',
    })
    await expect(t.exec({ command: 'echo pwned' })).rejects.toThrow()
  })
})
