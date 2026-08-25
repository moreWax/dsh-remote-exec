/** Package-owned invariant companion. @module morewax/dsh-remote-exec/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@morewax/dsh-remote-exec'
export const name = 'remote-exec-invariant'
export const inject = ['invariants']

/** Contracts live at the ctx.fs / ctx.shell / ctx.remoteTransport seams. */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
