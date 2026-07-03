import * as AvatarPrimitive from "@radix-ui/react-avatar";
import type { ComponentPropsWithoutRef } from "react";

type AvatarProps = ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>;
type AvatarImageProps = ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>;
type AvatarFallbackProps = ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>;

function Avatar({ className = "", ...props }: AvatarProps) {
  return <AvatarPrimitive.Root className={`avatar ${className}`.trim()} {...props} />;
}

function AvatarImage({ className = "", ...props }: AvatarImageProps) {
  return <AvatarPrimitive.Image className={`avatar-image ${className}`.trim()} {...props} />;
}

function AvatarFallback({ className = "", ...props }: AvatarFallbackProps) {
  return (
    <AvatarPrimitive.Fallback className={`avatar-fallback ${className}`.trim()} {...props} />
  );
}

export { Avatar, AvatarFallback, AvatarImage };
