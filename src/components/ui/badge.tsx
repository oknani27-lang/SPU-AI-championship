import * as React from "react";
import { cn } from "@/lib/utils";

export type BadgeVariant =
  | "default"
  | "primary"
  | "sage"
  | "warning"
  | "neutral"
  | "locked";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: "bg-[#F4F7F4] text-[#17241D] border-[#E3E9E3]",
  primary: "bg-[#256B4A] text-white border-[#256B4A]",
  sage: "bg-[#EAF3EC] text-[#1E583C] border-[#CFE3D4]",
  warning: "bg-[#FDF6F0] text-[#B86A32] border-[#EBCBB2]",
  neutral: "bg-[#F4F6F4] text-[#66736B] border-[#E3E9E3]",
  locked: "bg-[#EAF3EC] text-[#256B4A] border-[#C5DEC9]",
};

export function Badge({
  className,
  variant = "default",
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium leading-tight whitespace-nowrap",
        variantClasses[variant],
        className
      )}
      {...props}
    />
  );
}
