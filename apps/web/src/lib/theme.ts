/**
 * Appearance: light, dark, or follow the OS. The choice lives in
 * localStorage['theme']; index.html applies it before first paint so there is
 * no flash, and this module keeps it applied afterwards.
 */
import { useEffect, useState } from 'react'

export type ThemeChoice = 'light' | 'dark' | 'system'

const KEY = 'theme'
const media = () => window.matchMedia('(prefers-color-scheme: dark)')

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'dark' || v === 'system' ? v : 'light'
  } catch {
    return 'light'
  }
}

function apply(choice: ThemeChoice) {
  const dark = choice === 'dark' || (choice === 'system' && media().matches)
  document.documentElement.classList.toggle('dark', dark)
}

export function useTheme(): [ThemeChoice, (c: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(read)

  useEffect(() => {
    apply(choice)
    if (choice !== 'system') return
    const m = media()
    const onChange = () => apply('system')
    m.addEventListener('change', onChange)
    return () => m.removeEventListener('change', onChange)
  }, [choice])

  const set = (c: ThemeChoice) => {
    try {
      localStorage.setItem(KEY, c)
    } catch {
      /* private mode: the choice lasts for this tab */
    }
    setChoice(c)
  }
  return [choice, set]
}
