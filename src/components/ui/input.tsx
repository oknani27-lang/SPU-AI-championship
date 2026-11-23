"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md border border-[#E3E9E3] bg-[#FFFFFF] px-3 py-2 text-[15px] text-[#17241D] placeholder:text-[#66736B]/75 transition-colors focus:border-[#256B4A] focus:outline-none focus:ring-2 focus:ring-[#256B4A]/15 disabled:cursor-not-allowed disabled:bg-[#F3F6F3] disabled:text-[#66736B]",
          className
        )}
        {...props}
      />
    );
  }
);

Input.displayName = "Input";
