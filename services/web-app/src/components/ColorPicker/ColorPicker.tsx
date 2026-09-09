import {
  ColorPicker as RACColorPicker,
  ColorSwatch,
  ColorArea,
  ColorSlider,
  ColorThumb,
  ColorField,
  DialogTrigger,
  Popover,
  Dialog,
  Button,
  Label,
  Input,
  SliderTrack,
  type ColorPickerProps as RACColorPickerProps,
} from 'react-aria-components'
import './ColorPicker.css'

export interface ColorPickerProps extends Omit<RACColorPickerProps, 'children'> {
  label?: string
}

export function ColorPicker({ label, ...props }: ColorPickerProps) {
  return (
    <RACColorPicker {...props}>
      <DialogTrigger>
        <Button className="ds-colorpicker__trigger">
          <ColorSwatch className="ds-colorpicker__swatch" />
          {label && <span>{label}</span>}
        </Button>
        <Popover className="ds-colorpicker__popover">
          <Dialog className="ds-colorpicker__dialog">
            <ColorArea
              className="ds-colorpicker__area"
              colorSpace="hsb"
              xChannel="saturation"
              yChannel="brightness"
            >
              <ColorThumb className="ds-colorpicker__area-thumb" />
            </ColorArea>
            <ColorSlider className="ds-colorpicker__slider" colorSpace="hsb" channel="hue">
              <SliderTrack className="ds-colorpicker__slider-track">
                <ColorThumb className="ds-colorpicker__slider-thumb" />
              </SliderTrack>
            </ColorSlider>
            <ColorField className="ds-colorpicker__field">
              <Label className="ds-colorpicker__field-label">Hex</Label>
              <Input className="ds-colorpicker__field-input" />
            </ColorField>
          </Dialog>
        </Popover>
      </DialogTrigger>
    </RACColorPicker>
  )
}
