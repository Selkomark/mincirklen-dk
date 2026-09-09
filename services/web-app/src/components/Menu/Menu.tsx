import type { Key, ReactNode } from 'react'
import {
  MenuTrigger,
  Menu as RACMenu,
  MenuItem as RACMenuItem,
  Popover,
  Button,
  type MenuTriggerProps,
  type MenuItemProps,
} from 'react-aria-components'
import './Menu.css'

export interface MenuProps<T extends object> extends Omit<MenuTriggerProps, 'children'> {
  label: ReactNode
  items?: Iterable<T>
  className?: string
  onAction?: (key: Key) => void
  children: ReactNode | ((item: T) => ReactNode)
}

export function Menu<T extends object>({
  label,
  items,
  className,
  children,
  onAction,
  ...props
}: MenuProps<T>) {
  return (
    <MenuTrigger {...props}>
      <Button className="ds-menu__trigger">{label}</Button>
      <Popover className="ds-menu__popover">
        <RACMenu
          className={['ds-menu', className].filter(Boolean).join(' ')}
          items={items}
          onAction={onAction}
        >
          {children}
        </RACMenu>
      </Popover>
    </MenuTrigger>
  )
}

export function MenuItem(props: MenuItemProps) {
  return <RACMenuItem className="ds-menu__item" {...props} />
}
