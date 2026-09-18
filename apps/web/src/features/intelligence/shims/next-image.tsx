/** `next/image` as a plain lazy <img>. Aliased in vite.config.ts and tsconfig.json. */
import * as React from 'react'

type ImageProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src: string | { src: string }
  fill?: boolean
  priority?: boolean
  quality?: number
  placeholder?: string
  blurDataURL?: string
  unoptimized?: boolean
}

export default function Image({ src, fill, priority, quality: _q, placeholder: _p, blurDataURL: _b, unoptimized: _u, style, ...rest }: ImageProps) {
  return (
    <img
      src={typeof src === 'string' ? src : src.src}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      style={fill ? { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', ...style } : style}
      {...rest}
    />
  )
}
