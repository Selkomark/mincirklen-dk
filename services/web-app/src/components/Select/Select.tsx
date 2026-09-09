import type { ReactNode } from 'react'
import {
  Select as RACSelect,
  Button,
  SelectValue,
  Popover,
  ListBox,
  ListBoxItem,
  Label,
  type SelectProps as RACSelectProps,
  type ListBoxItemProps,
} from 'react-aria-components'
import './Select.css'

export interface SelectProps<T extends object>
  extends Omit<RACSelectProps<T>, 'className' | 'children'> {
  label?: string
  className?: string
  items?: Iterable<T>
  children: ReactNode | ((item: T) => ReactNode)
}

export function Select<T extends object>({
  label,
  className,
  items,
  children,
  placeholder,
  ...props
}: SelectProps<T>) {
  return (
    <RACSelect className={['ds-select', className].filter(Boolean).join(' ')} placeholder={placeholder} {...props}>
      {label && <Label className="ds-select__label">{label}</Label>}
      <Button className="ds-select__trigger">
        {/* Renders the selected item's `textValue`, not its full `children` —
            an item's rendered JSX (e.g. a name plus a UTC offset) can carry
            more than the closed trigger has room for; `textValue` is each
            SelectItem's short, trigger-appropriate label when it differs
            from what's shown in the open list (see the Preferences
            timezone picker in SessionPage.tsx for the motivating case). */}
        <SelectValue className="ds-select__value">
          {({ selectedText, isPlaceholder }) => (isPlaceholder ? placeholder : selectedText)}
        </SelectValue>
        <span className="ds-select__chevron" aria-hidden="true">
          ⌄
        </span>
      </Button>
      <Popover className="ds-select__popover">
        <ListBox className="ds-select__listbox" items={items}>
          {children}
        </ListBox>
      </Popover>
    </RACSelect>
  )
}

export function SelectItem(props: ListBoxItemProps) {
  return <ListBoxItem className="ds-select__item" {...props} />
}
