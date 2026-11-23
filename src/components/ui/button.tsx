"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "outline"
  | "ghost"
  | "warning";

export type ButtonSize = "sm" | "md" | "lg" | "icon";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-[#256B4A] text-white border border-[#256B4A] hover:bg-[#1E583C] hover:border-[#1E583C] active:bg-[#184831] disabled:bg-[#9CB8A9] disabled:border-[#9CB8A9]",
  secondary:
    "bg-[#EAF3EC] text-[#17241D] border border-[#D4E6D8] hover:bg-[#DCECE0] active:bg-[#CFE4D4] disabled:opacity-50",
  outline:
    "bg-[#FFFFFF] text-[#17241D] border border-[#E3E9E3] hover:bg-[#F4F7F4] hover:border-[#CFD9D1] disabled:opacity-50",
  ghost:
    "bg-transparent text-[#17241D] border border-transparent hover:bg-[#EAF3EC]/70 disabled:opacity-50",
  warning:
    "bg-[#FDF6F0] text-[#B86A32] border border-[#EBCBB2] hover:bg-[#FAEADB] disabled:opacity-50",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm gap-1.5 rounded-md",
  md: "h-10 px-4 text-[15px] gap-2 rounded-md",
  lg: "h-11 px-5 text-base gap-2 rounded-lg",
  icon: "h-9 w-9 p-0 rounded-md",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "md",
      loading = false,
      disabled,
      type = "button",
      children,
      ...props
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        className={cn(
          "inline-flex items-center justify-center font-medium transition-colors whitespace-nowrap select-none disabled:cursor-not-allowed",
          variantClasses[variant],
          sizeClasses[size],
          className
        )}
        {...props}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin shrink-0" />}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
