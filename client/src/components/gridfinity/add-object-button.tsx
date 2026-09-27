import { forwardRef } from "react";
import { Plus } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** One visual treatment for creation actions in lists and the editing toolbar. */
export const AddObjectButton = forwardRef<HTMLButtonElement, Omit<ButtonProps, "variant" | "size">>(
  ({ children, className, ...props }, ref) => <Button ref={ref} type="button" variant="outline" size="sm"
    className={cn("shrink-0 justify-start gap-1.5 [@media(pointer:coarse)]:min-h-11", className)} {...props}>
    <Plus className="h-4 w-4" aria-hidden />{children}
  </Button>,
);
AddObjectButton.displayName = "AddObjectButton";
