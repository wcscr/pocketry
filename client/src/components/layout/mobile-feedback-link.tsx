import { MessageSquare } from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

/** Feedback stays available in More options without interrupting first use. */
export function MobileFeedbackLink(): JSX.Element {
  return <DropdownMenuItem asChild className="min-h-11">
    <a href="https://github.com/wcscr/pocketry/issues/new" target="_blank" rel="noopener noreferrer">
      <MessageSquare className="mr-2 h-4 w-4" aria-hidden />
      Give mobile feedback<span className="sr-only"> (opens in a new tab)</span>
    </a>
  </DropdownMenuItem>;
}
