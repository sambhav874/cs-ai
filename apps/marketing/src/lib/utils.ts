import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const APP_URL = 'https://app.draft-legal.com'
export const SITE_URL = 'https://draft-legal.com'
export const GITHUB_URL = 'https://github.com/AniketTati/draft-legal'
