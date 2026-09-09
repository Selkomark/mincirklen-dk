import type { TimeValue } from 'react-aria-components'
import {
  TimeField as RACTimeField,
  Group,
  DateInput,
  DateSegment,
  Label,
  type TimeFieldProps as RACTimeFieldProps,
} from 'react-aria-components'
import './TimePicker.css'

export interface TimePickerProps<T extends TimeValue>
  extends Omit<RACTimeFieldProps<T>, 'className'> {
  label?: string
  className?: string
}

export function TimePicker<T extends TimeValue>({ label, className, ...props }: TimePickerProps<T>) {
  return (
    <RACTimeField className={['ds-timepicker', className].filter(Boolean).join(' ')} {...props}>
      {label && <Label className="ds-timepicker__label">{label}</Label>}
      <Group className="ds-timepicker__group">
        <DateInput className="ds-timepicker__input">
          {(segment) => <DateSegment segment={segment} className="ds-timepicker__segment" />}
        </DateInput>
      </Group>
    </RACTimeField>
  )
}
