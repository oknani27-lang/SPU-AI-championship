"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <select
        ref={ref}
        className={cn(
          "flex h-10 w-full rounded-md border border-[#E3E9E3] bg-[#FFFFFF] px-3 py-2 text-[15px] text-[#17241D] transition-colors focus:border-[#256B4A] focus:outline-none focus:ring-2 focus:ring-[#256B4A]/15 disabled:cursor-not-allowed disabled:bg-[#F3F6F3] disabled:text-[#66736B]",
          className
        )}
        {...props}
      >
        {children}
      </select>
    );
  }
);

Select.displayName = "Select";
