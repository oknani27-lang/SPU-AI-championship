"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  label?: string;
  description?: string;
  className?: string;
}

export function Switch({
  checked,
  onCheckedChange,
  disabled = false,
  id,
  label,
  description,
  className,
}: SwitchProps) {
  const autoId = React.useId();
  const controlId = id ?? autoId;

  return (
    <div className={cn("flex items-start justify-between gap-3", className)}>
      {(label || description) && (
        <div className="space-y-0.5">
          {label && (
            <label
              htmlFor={controlId}
              className={cn(
                "text-[15px] font-medium text-[#17241D] select-none",
                disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
              )}
            >
              {label}
            </label>
          )}
          {description && (
            <p className="text-sm text-[#66736B] leading-snug">{description}</p>
          )}
        </div>
      )}

      <button
        id={controlId}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors",
          checked
            ? "bg-[#256B4A] border-[#256B4A]"
            : "bg-[#DCE4DD] border-[#CBD6CD]",
          disabled && "opacity-50 cursor-not-allowed"
        )}
      >
        <span
          className={cn(
            "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-xs transition-transform",
            checked ? "translate-x-5.5" : "translate-x-1"
          )}
        />
      </button>
    </div>
  );
}
