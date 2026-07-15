'use client';

import * as React from 'react';
import { ToggleGroup as ToggleGroupPrimitiveNs } from 'radix-ui';

/**
 * ToggleGroup.Root 的属性。
 * 直接透传 radix-ui ToggleGroup.Root 的完整属性（type 为 'single' | 'multiple' 的判别联合）；
 * 配合本组件库时按 type="single" 受控语义使用（见 components/animate/toggle-group）。
 */
type ToggleGroupPrimitiveProps = React.ComponentProps<
  typeof ToggleGroupPrimitiveNs.Root
>;

/**
 * ToggleGroup.Root 的 forwardRef 封装（纯透传，保证判别联合类型可正确推断）。
 */
const ToggleGroupPrimitive = React.forwardRef<
  React.ComponentRef<typeof ToggleGroupPrimitiveNs.Root>,
  ToggleGroupPrimitiveProps
>((props, ref) => (
  <ToggleGroupPrimitiveNs.Root ref={ref} {...props} />
));
ToggleGroupPrimitive.displayName = 'ToggleGroupPrimitive';

/**
 * ToggleGroup.Item 的属性（透传 radix-ui）。
 */
type ToggleGroupItemPrimitiveProps = React.ComponentProps<
  typeof ToggleGroupPrimitiveNs.Item
>;

/**
 * ToggleGroup.Item 的 forwardRef 封装。
 */
const ToggleGroupItemPrimitive = React.forwardRef<
  React.ComponentRef<typeof ToggleGroupPrimitiveNs.Item>,
  ToggleGroupItemPrimitiveProps
>(({ ...props }, ref) => (
  <ToggleGroupPrimitiveNs.Item ref={ref} {...props} />
));
ToggleGroupItemPrimitive.displayName = 'ToggleGroupItemPrimitive';

export {
  ToggleGroupPrimitive,
  ToggleGroupItemPrimitive,
  type ToggleGroupPrimitiveProps,
  type ToggleGroupItemPrimitiveProps,
};
