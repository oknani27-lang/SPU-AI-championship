"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={cn(
          "flex min-h-[92px] w-full rounded-md border border-[#E3E9E3] bg-[#FFFFFF] px-3 py-2.5 text-[15px] text-[#17241D] leading-relaxed placeholder:text-[#66736B]/75 transition-colors focus:border-[#256B4A] focus:outline-none focus:ring-2 focus:ring-[#256B4A]/15 disabled:cursor-not-allowed disabled:bg-[#F3F6F3] disabled:text-[#66736B]",
          className
        )}
        {...props}
      />
    );
  }
);

Textarea.displayName = "Textarea";
