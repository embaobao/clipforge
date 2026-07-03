import type { ComponentPropsWithoutRef } from "react";

type KbdProps = ComponentPropsWithoutRef<"kbd">;

function Kbd({ className = "", ...props }: KbdProps) {
  return <kbd className={`kbd ${className}`.trim()} {...props} />;
}

export { Kbd };
