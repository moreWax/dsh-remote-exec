/**
 * Package-owned invariant companion.
 * @module @deepseek-ai/dsh-fs-ssh/invariant
 */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-fs-ssh'
export const name = 'fs-ssh-invariant'
export const inject = ['invariants']

/** Contracts live at the owning seam (ctx.fs); no independent event sequence. */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
