"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  maxWidthClass?: string;
  footer?: React.ReactNode;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  maxWidthClass = "max-w-2xl",
  footer,
}: DialogProps) {
  const titleId = React.useId();
  const descId = React.useId();

  React.useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      role="presentation"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-[#17241D]/40 backdrop-blur-[1px]"
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Modal Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className={cn(
          "relative z-10 flex max-h-[90vh] w-full flex-col rounded-lg border border-[#E3E9E3] bg-[#FFFFFF] shadow-lg",
          maxWidthClass
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[#E3E9E3] px-5 py-4">
          <div>
            <h2
              id={titleId}
              className="text-lg font-semibold text-[#17241D] leading-snug"
            >
              {title}
            </h2>
            {description && (
              <p id={descId} className="mt-1 text-sm text-[#66736B]">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิดหน้าต่าง"
            className="rounded-md p-1.5 text-[#66736B] hover:bg-[#F4F7F4] hover:text-[#17241D]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4 flex-1">{children}</div>

        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#E3E9E3] bg-[#FAFBF9] px-5 py-3.5 rounded-b-lg">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
