import type { DateValue } from 'react-aria-components'
import {
  DatePicker as RACDatePicker,
  Group,
  DateInput,
  DateSegment,
  Button,
  Popover,
  Dialog,
  Label,
  type DatePickerProps as RACDatePickerProps,
} from 'react-aria-components'
import { Calendar } from '../Calendar'
import './DatePicker.css'

export interface DatePickerProps<T extends DateValue>
  extends Omit<RACDatePickerProps<T>, 'className'> {
  label?: string
  className?: string
  /** Accessible label for the calendar-icon trigger button. Not translated
   *  internally — this component is shared with the (English-only) design
   *  system Catalog, so a real-app call site should pass its own
   *  translated string; defaults to English for Catalog/untranslated use. */
  openCalendarLabel?: string
}

export function DatePicker<T extends DateValue>({ label, className, openCalendarLabel = 'Open calendar', ...props }: DatePickerProps<T>) {
  return (
    <RACDatePicker className={['ds-datepicker', className].filter(Boolean).join(' ')} {...props}>
      {label && <Label className="ds-datepicker__label">{label}</Label>}
      <Group className="ds-datepicker__group">
        <DateInput className="ds-datepicker__input">
          {(segment) => <DateSegment segment={segment} className="ds-datepicker__segment" />}
        </DateInput>
        <Button className="ds-datepicker__trigger" aria-label={openCalendarLabel}>
          📅
        </Button>
      </Group>
      <Popover className="ds-datepicker__popover">
        <Dialog className="ds-datepicker__dialog">
          <Calendar />
        </Dialog>
      </Popover>
    </RACDatePicker>
  )
}
