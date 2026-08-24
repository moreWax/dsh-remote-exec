/** Package-owned invariant companion. @module @deepseek-ai/dsh-remote-transport/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-remote-transport'
export const name = 'remote-transport-invariant'
export const inject = ['invariants']

/** No independent event sequence: contracts live at the ctx.remoteTransport seam. */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
