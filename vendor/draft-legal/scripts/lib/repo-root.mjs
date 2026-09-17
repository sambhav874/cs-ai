import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Absolute path to monorepo root (contains apps/, packages/, scripts/). */
export const REPO_ROOT = path.resolve(__dirname, '..', '..')
