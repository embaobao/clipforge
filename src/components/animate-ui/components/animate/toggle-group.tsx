'use client';

import * as React from 'react';
import { motion } from 'motion/react';

import { cn } from '@/lib/utils';
import {
  ToggleGroupPrimitive,
  ToggleGroupItemPrimitive,
} from '@/components/animate-ui/primitives/animate/toggle-group';

/** 共享 layoutId：选中项之间复用同一 id，切换时由 motion 执行滑动动效 */
const HIGHLIGHT_LAYOUT_ID = 'toggle-group-highlight';

/**
 * 传递当前选中值的上下文。
 * 每个子项据此判断自身是否被选中，从而决定是否渲染滑动高亮层。
 */
const ToggleGroupSelectedContext = React.createContext<string>('');

/**
 * 单选语义的 ToggleGroup 容器。
 *
 * 公共 props：
 * - value：当前选中值（受控）
 * - onValueChange：值变化回调；设置项不允许反选，收到空串（取消选中）时会被忽略
 */
type ToggleGroupProps = {
  /** 当前选中值 */
  value: string;
  /** 值变化回调；空串（取消选中）会被忽略，保证设置项不可反选 */
  onValueChange: (value: string) => void;
  className?: string;
  /** 无障碍标签 */
  'aria-label'?: string;
  children: React.ReactNode;
};

function ToggleGroup({
  value,
  onValueChange,
  className,
  'aria-label': ariaLabel,
  children,
}: ToggleGroupProps) {
  // 设置项不允许反选：radix 在取消选中时会回传空串，这里直接忽略
  const handleValueChange = React.useCallback(
    (next: string) => {
      if (next === '') return;
      onValueChange(next);
    },
    [onValueChange],
  );

  return (
    <ToggleGroupSelectedContext.Provider value={value}>
      <ToggleGroupPrimitive
        type="single"
        value={value}
        onValueChange={handleValueChange}
        aria-label={ariaLabel}
        className={cn(
          'inline-flex items-center gap-1 rounded-lg bg-muted/60 p-1',
          className,
        )}
      >
        {children}
      </ToggleGroupPrimitive>
    </ToggleGroupSelectedContext.Provider>
  );
}

/**
 * 单个 ToggleGroup 项。
 *
 * 选中态会渲染一个共享 layoutId 的 motion.span 作为背景层，
 * 切换选中项时产生滑动高亮动效。选中态不止靠颜色：
 * 同时具备背景 + 轻微 inset 边框，以保证对比与可读性。
 */
type ToggleGroupItemProps = {
  /** 该项对应的值 */
  value: string;
  className?: string;
  children: React.ReactNode;
  disabled?: boolean;
};

function ToggleGroupItem({
  value,
  className,
  children,
  disabled,
}: ToggleGroupItemProps) {
  const selectedValue = React.useContext(ToggleGroupSelectedContext);
  const selected = selectedValue === value;

  return (
    <ToggleGroupItemPrimitive
      value={value}
      disabled={disabled}
      className={cn(
        'relative inline-flex min-h-[36px] min-w-0 items-center justify-center rounded-md px-3 text-sm font-medium whitespace-nowrap transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        'disabled:pointer-events-none disabled:opacity-50',
        selected
          ? 'text-foreground'
          : 'text-muted-foreground hover:text-foreground',
        className,
      )}
    >
      {selected && (
        <motion.span
          layoutId={HIGHLIGHT_LAYOUT_ID}
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0 rounded-md bg-background shadow-sm',
            // 轻微 inset 边框：选中态不止靠颜色
            'ring-1 ring-inset ring-black/[0.06] dark:ring-white/[0.08]',
          )}
          transition={{ type: 'spring', stiffness: 400, damping: 32 }}
        />
      )}
      <span
        data-slot="toggle-group-item-content"
        className="relative z-10 inline-flex items-center justify-center gap-1.5"
      >
        {children}
      </span>
    </ToggleGroupItemPrimitive>
  );
}

export {
  ToggleGroup,
  ToggleGroupItem,
  type ToggleGroupProps,
  type ToggleGroupItemProps,
};
