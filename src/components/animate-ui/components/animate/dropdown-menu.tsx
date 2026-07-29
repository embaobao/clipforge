'use client';

import {
  DropdownMenu as DropdownMenuPrimitive,
  DropdownMenuTrigger as DropdownMenuTriggerPrimitive,
  DropdownMenuContent as DropdownMenuContentPrimitive,
  DropdownMenuItem as DropdownMenuItemPrimitive,
  DropdownMenuItemIndicator as DropdownMenuItemIndicatorPrimitive,
  DropdownMenuLabel as DropdownMenuLabelPrimitive,
  DropdownMenuSeparator as DropdownMenuSeparatorPrimitive,
  DropdownMenuGroup as DropdownMenuGroupPrimitive,
  DropdownMenuCheckboxItem as DropdownMenuCheckboxItemPrimitive,
  DropdownMenuRadioGroup as DropdownMenuRadioGroupPrimitive,
  DropdownMenuRadioItem as DropdownMenuRadioItemPrimitive,
  DropdownMenuShortcut as DropdownMenuShortcutPrimitive,
  DropdownMenuSub as DropdownMenuSubPrimitive,
  DropdownMenuSubTrigger as DropdownMenuSubTriggerPrimitive,
  DropdownMenuSubContent as DropdownMenuSubContentPrimitive,
  type DropdownMenuProps as DropdownMenuPrimitiveProps,
  type DropdownMenuTriggerProps as DropdownMenuTriggerPrimitiveProps,
  type DropdownMenuContentProps as DropdownMenuContentPrimitiveProps,
  type DropdownMenuItemProps as DropdownMenuItemPrimitiveProps,
  type DropdownMenuItemIndicatorProps as DropdownMenuItemIndicatorPrimitiveProps,
  type DropdownMenuLabelProps as DropdownMenuLabelPrimitiveProps,
  type DropdownMenuSeparatorProps as DropdownMenuSeparatorPrimitiveProps,
  type DropdownMenuGroupProps as DropdownMenuGroupPrimitiveProps,
  type DropdownMenuCheckboxItemProps as DropdownMenuCheckboxItemPrimitiveProps,
  type DropdownMenuRadioGroupProps as DropdownMenuRadioGroupPrimitiveProps,
  type DropdownMenuRadioItemProps as DropdownMenuRadioItemPrimitiveProps,
  type DropdownMenuShortcutProps as DropdownMenuShortcutPrimitiveProps,
  type DropdownMenuSubProps as DropdownMenuSubPrimitiveProps,
  type DropdownMenuSubTriggerProps as DropdownMenuSubTriggerPrimitiveProps,
  type DropdownMenuSubContentProps as DropdownMenuSubContentPrimitiveProps,
} from '@/components/animate-ui/primitives/radix/dropdown-menu';
import { cn } from '@/lib/utils';
import { AnimatePresence, motion, type Transition } from 'motion/react';

type DropdownMenuProps = DropdownMenuPrimitiveProps;

function DropdownMenu(props: DropdownMenuProps) {
  return <DropdownMenuPrimitive {...props} />;
}

type DropdownMenuTriggerProps = DropdownMenuTriggerPrimitiveProps;

function DropdownMenuTrigger(props: DropdownMenuTriggerProps) {
  return <DropdownMenuTriggerPrimitive {...props} />;
}

type DropdownMenuContentProps = DropdownMenuContentPrimitiveProps & {
  transition?: Transition;
  className?: string;
};

function DropdownMenuContent({
  className,
  transition = { duration: 0.2 },
  sideOffset = 4,
  children,
  ...props
}: DropdownMenuContentProps) {
  return (
    <DropdownMenuContentPrimitive
      sideOffset={sideOffset}
      {...props}
      className={cn('dropdown-content', className)}
    >
      <AnimatePresence>
        <motion.div
          data-slot="dropdown-menu-content-inner"
          initial={{ opacity: 0, scale: 0.95, y: 6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 4 }}
          transition={transition}
          className="w-full"
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </DropdownMenuContentPrimitive>
  );
}

type DropdownMenuItemProps = DropdownMenuItemPrimitiveProps & {
  variant?: 'default' | 'destructive';
  inset?: boolean;
  className?: string;
};

function DropdownMenuItem({
  variant = 'default',
  inset = false,
  className,
  ...props
}: DropdownMenuItemProps) {
  return (
    <DropdownMenuItemPrimitive
      {...props}
      className={cn(
        'dropdown-item',
        inset && 'dropdown-item-inset',
        variant === 'destructive' && 'dropdown-item-destructive',
        className,
      )}
    />
  );
}

type DropdownMenuItemIndicatorProps = DropdownMenuItemIndicatorPrimitiveProps;

function DropdownMenuItemIndicator(props: DropdownMenuItemIndicatorProps) {
  return <DropdownMenuItemIndicatorPrimitive {...props} />;
}

type DropdownMenuLabelProps = DropdownMenuLabelPrimitiveProps & {
  className?: string;
};

function DropdownMenuLabel({ className, ...props }: DropdownMenuLabelProps) {
  return (
    <DropdownMenuLabelPrimitive
      {...props}
      className={cn('dropdown-label', className)}
    />
  );
}

type DropdownMenuSeparatorProps = DropdownMenuSeparatorPrimitiveProps & {
  className?: string;
};

function DropdownMenuSeparator({ className, ...props }: DropdownMenuSeparatorProps) {
  return (
    <DropdownMenuSeparatorPrimitive
      {...props}
      className={cn('dropdown-separator', className)}
    />
  );
}

type DropdownMenuGroupProps = DropdownMenuGroupPrimitiveProps & {
  className?: string;
};

function DropdownMenuGroup({ className, ...props }: DropdownMenuGroupProps) {
  return (
    <DropdownMenuGroupPrimitive
      {...props}
      className={cn('dropdown-group', className)}
    />
  );
}

type DropdownMenuCheckboxItemProps = DropdownMenuCheckboxItemPrimitiveProps & {
  className?: string;
};

function DropdownMenuCheckboxItem({ className, ...props }: DropdownMenuCheckboxItemProps) {
  return (
    <DropdownMenuCheckboxItemPrimitive
      {...props}
      className={cn('dropdown-checkbox-item', className)}
    />
  );
}

type DropdownMenuRadioGroupProps = DropdownMenuRadioGroupPrimitiveProps & {
  className?: string;
};

function DropdownMenuRadioGroup({ className, ...props }: DropdownMenuRadioGroupProps) {
  return (
    <DropdownMenuRadioGroupPrimitive
      {...props}
      className={cn('dropdown-radio-group', className)}
    />
  );
}

type DropdownMenuRadioItemProps = DropdownMenuRadioItemPrimitiveProps & {
  className?: string;
};

function DropdownMenuRadioItem({ className, ...props }: DropdownMenuRadioItemProps) {
  return (
    <DropdownMenuRadioItemPrimitive
      {...props}
      className={cn('dropdown-radio-item', className)}
    />
  );
}

type DropdownMenuShortcutProps = DropdownMenuShortcutPrimitiveProps & {
  className?: string;
};

function DropdownMenuShortcut({ className, ...props }: DropdownMenuShortcutProps) {
  return (
    <DropdownMenuShortcutPrimitive
      {...props}
      className={cn('dropdown-shortcut', className)}
    />
  );
}

type DropdownMenuSubProps = DropdownMenuSubPrimitiveProps;

function DropdownMenuSub(props: DropdownMenuSubProps) {
  return <DropdownMenuSubPrimitive {...props} />;
}

type DropdownMenuSubTriggerProps = DropdownMenuSubTriggerPrimitiveProps;

function DropdownMenuSubTrigger(props: DropdownMenuSubTriggerProps) {
  return <DropdownMenuSubTriggerPrimitive {...props} />;
}

type DropdownMenuSubContentProps = DropdownMenuSubContentPrimitiveProps & {
  transition?: Transition;
  className?: string;
};

function DropdownMenuSubContent({
  className,
  transition = { duration: 0.2 },
  children,
  ...props
}: DropdownMenuSubContentProps) {
  return (
    <DropdownMenuSubContentPrimitive
      {...props}
      className={cn('dropdown-sub-content', className)}
    >
      <AnimatePresence>
        <motion.div
          data-slot="dropdown-menu-sub-content-inner"
          initial={{ opacity: 0, scale: 0.95, x: 4 }}
          animate={{ opacity: 1, scale: 1, x: 0 }}
          exit={{ opacity: 0, scale: 0.95, x: 2 }}
          transition={transition}
          className="w-full"
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </DropdownMenuSubContentPrimitive>
  );
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemIndicator,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuGroup,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  type DropdownMenuProps,
  type DropdownMenuTriggerProps,
  type DropdownMenuContentProps,
  type DropdownMenuItemProps,
  type DropdownMenuItemIndicatorProps,
  type DropdownMenuLabelProps,
  type DropdownMenuSeparatorProps,
  type DropdownMenuGroupProps,
  type DropdownMenuCheckboxItemProps,
  type DropdownMenuRadioGroupProps,
  type DropdownMenuRadioItemProps,
  type DropdownMenuShortcutProps,
  type DropdownMenuSubProps,
  type DropdownMenuSubTriggerProps,
  type DropdownMenuSubContentProps,
};