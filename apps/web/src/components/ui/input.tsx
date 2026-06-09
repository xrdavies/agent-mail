import * as React from "react";

import { cn } from "../../lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "flex h-11 w-full rounded-2xl border border-[#d6c6b1] bg-white/80 px-4 py-2 text-sm text-[#201b18] shadow-sm outline-none placeholder:text-[#998a7a] focus-visible:border-[#9d3526]",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";

