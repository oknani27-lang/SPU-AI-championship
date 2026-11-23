import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type AlertVariant = "info" | "sage" | "success" | "warning" | "error";

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant;
  title?: string;
}

const variantStyles: Record<
  AlertVariant,
  { box: string; icon: React.ComponentType<{ className?: string }>; iconColor: string }
> = {
  info: {
    box: "bg-[#F4F7F4] border-[#E3E9E3] text-[#17241D]",
    icon: Info,
    iconColor: "text-[#256B4A]",
  },
  sage: {
    box: "bg-[#EAF3EC] border-[#CFE3D4] text-[#17241D]",
    icon: Info,
    iconColor: "text-[#256B4A]",
  },
  success: {
    box: "bg-[#EAF3EC] border-[#BBD8C2] text-[#17241D]",
    icon: CheckCircle2,
    iconColor: "text-[#256B4A]",
  },
  warning: {
    box: "bg-[#FDF6F0] border-[#EBCBB2] text-[#7A441D]",
    icon: AlertTriangle,
    iconColor: "text-[#B86A32]",
  },
  error: {
    box: "bg-[#FDF4F3] border-[#EAC6C2] text-[#8E2A23]",
    icon: ShieldAlert,
    iconColor: "text-[#B53D34]",
  },
};

export function Alert({
  variant = "info",
  title,
  children,
  className,
  ...props
}: AlertProps) {
  const style = variantStyles[variant];
  const Icon = style.icon;

  return (
    <div
      role={variant === "error" || variant === "warning" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2.5 rounded-md border px-3.5 py-3 text-sm leading-relaxed",
        style.box,
        className
      )}
      {...props}
    >
      <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", style.iconColor)} />
      <div className="min-w-0 flex-1 space-y-0.5">
        {title && <p className="font-semibold leading-snug">{title}</p>}
        <div>{children}</div>
      </div>
    </div>
  );
}
