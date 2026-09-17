import type { CompareData } from './types'
import { ironclad } from './ironclad'
import { harvey } from './harvey'
import { spellbook } from './spellbook'
import { docusignClm } from './docusign-clm'
import { icertis } from './icertis'

export const compareData: Record<string, CompareData> = {
  ironclad,
  harvey,
  spellbook,
  'docusign-clm': docusignClm,
  icertis,
}
