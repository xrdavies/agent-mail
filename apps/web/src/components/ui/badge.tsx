import type * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em]",
  {
    variants: {
      tone: {
        neutral: "bg-[rgba(30,27,24,0.08)] text-[#4d4135]",
        online: "bg-[rgba(31,122,76,0.14)] text-[#1f7a4c]",
        degraded: "bg-[rgba(156,106,0,0.14)] text-[#9c6a00]",
        offline: "bg-[rgba(138,49,49,0.14)] text-[#8a3131]"
      }
    },
    defaultVariants: {
      tone: "neutral"
    }
  }
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

export const Badge = ({ className, tone, ...props }: BadgeProps) => (
  <div className={cn(badgeVariants({ tone }), className)} {...props} />
);
