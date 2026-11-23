import { Portal } from "@radix-ui/react-tooltip";
import { Copy, FolderOpen, Pencil, Trash2, type LucideIcon } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const actions = {
  open: { icon: FolderOpen, hint: "Open project" },
  copy: { icon: Copy, hint: "Copy project" },
  rename: { icon: Pencil, hint: "Rename project" },
  remove: { icon: Trash2, hint: "Remove project" },
};

interface Props extends Pick<ButtonProps, "disabled" | "onClick"> {
  action: keyof typeof actions;
  label: string;
  icon?: LucideIcon;
  "data-testid"?: string;
}

export function LibraryProjectAction({ action, label, icon, ...props }: Props) {
  const Icon = icon ?? actions[action].icon;
  return <Tooltip>
    <TooltipTrigger asChild>
      <Button type="button" size="icon" variant="ghost" aria-label={label}
        className={cn("h-8 w-8 shrink-0 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11",
          action === "remove" && "text-destructive hover:text-destructive")}
        {...props}><Icon aria-hidden /></Button>
    </TooltipTrigger>
    <Portal><TooltipContent>{actions[action].hint}</TooltipContent></Portal>
  </Tooltip>;
}
