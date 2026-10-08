import { Github, Mail, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const FEEDBACK_LABEL = "Report an Issue / Provide Feedback";

/** Shared contact options for the header icon and compact More options menu. */
export function FeedbackMenuItems(): JSX.Element {
  return (
    <>
      <DropdownMenuItem asChild className="min-h-11">
        <a href="mailto:feedback@pocketry.xyz">
          <Mail className="h-4 w-4" aria-hidden />
          Email feedback@pocketry.xyz
        </a>
      </DropdownMenuItem>
      <DropdownMenuItem asChild className="min-h-11">
        <a href="https://github.com/wcscr/pocketry/issues/new" target="_blank" rel="noopener noreferrer">
          <Github className="h-4 w-4" aria-hidden />
          Open a GitHub issue<span className="sr-only"> (opens in a new tab)</span>
        </a>
      </DropdownMenuItem>
    </>
  );
}

/** Opens feedback choices without leaving the current workspace. */
export function FeedbackMenu(): JSX.Element {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={FEEDBACK_LABEL}>
              <MessageSquare className="h-4 w-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{FEEDBACK_LABEL}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <FeedbackMenuItems />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
