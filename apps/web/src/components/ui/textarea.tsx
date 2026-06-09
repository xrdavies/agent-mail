import * as React from "react";

import { cn } from "../../lib/utils";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "flex min-h-[132px] w-full rounded-[20px] border border-[#d6c6b1] bg-white/80 px-4 py-3 text-sm text-[#201b18] shadow-sm outline-none placeholder:text-[#998a7a] focus-visible:border-[#9d3526]",
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = "Textarea";

