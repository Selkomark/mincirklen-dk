import type { HTMLAttributes } from 'react'
import './List.css'

export interface ListProps extends HTMLAttributes<HTMLUListElement | HTMLOListElement> {
  /** Renders an <ol> instead of <ul>. */
  ordered?: boolean
  /** Removes list markers and left padding. */
  unstyled?: boolean
}

export function List({ ordered = false, unstyled = false, className, ...props }: ListProps) {
  const Tag = ordered ? 'ol' : 'ul'
  return (
    <Tag
      className={['ds-list', unstyled && 'ds-list--unstyled', className].filter(Boolean).join(' ')}
      {...props}
    />
  )
}
