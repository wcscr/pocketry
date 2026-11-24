import { useState } from "react";
import { Download, Mail, MessageSquareWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { downloadBlob } from "@/lib/download";
import { createTracePhotoReport, traceReportEmailHref, traceReportPhoto,
  TRACE_REPORT_EMAIL, TRACE_REPORT_NOTE_LIMIT } from "@/lib/trace-photo-report";
import { useTrace, type TraceState } from "@/state/trace-store";

/** Page-local reporting also works when calibration or detection has not succeeded. */
export function TracePhotoReport(): JSX.Element | null {
  const trace = useTrace();
  const [snapshot, setSnapshot] = useState<TraceState | null>(null);
  const [note, setNote] = useState("");
  const [downloadedFile, setDownloadedFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!trace.imageUrl) return null;

  const download = () => {
    if (!snapshot) return;
    setError(null);
    setDownloadedFile(null);
    try {
      const report = createTracePhotoReport(snapshot, note, navigator.userAgent);
      downloadBlob(new Blob([report.bytes], { type: "application/zip" }), report.fileName);
      setDownloadedFile(report.fileName);
    } catch {
      setError("Couldn’t prepare the photo report. Try again, or email your original photo directly to the address above.");
    }
  };

  return <Dialog open={snapshot !== null} onOpenChange={open => {
    setSnapshot(open ? trace : null);
    if (open) { setNote(""); setError(null); setDownloadedFile(null); }
  }}>
    <div className="order-last flex shrink-0 justify-end px-3">
      <DialogTrigger asChild>
        <Button variant="link" size="sm" className="h-auto min-h-8 whitespace-normal px-0 py-1 text-xs text-muted-foreground max-md:min-h-11">
          <MessageSquareWarning className="h-3.5 w-3.5" aria-hidden />Report tracing problem
        </Button>
      </DialogTrigger>
    </div>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Report tracing problem</DialogTitle>
          <DialogDescription>Share the original photo and tracing details to help improve Pocketry.</DialogDescription>
        </DialogHeader>
        <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          <strong>Your photo will be sent via email to the project maintainer at {TRACE_REPORT_EMAIL}.</strong>{" "}
          The report also includes your tracing settings, outline, app version, browser details, and the description below.
          Check the photo for personal or sensitive content; embedded photo metadata, including location if present, is included.
        </p>
        {snapshot && <img src={traceReportPhoto(snapshot) ?? undefined} alt="Original photo included in the report"
          className="max-h-36 w-full rounded-md bg-muted object-contain" />}
        <div className="space-y-2">
          <Label htmlFor="trace-report-description">What went wrong? (optional)</Label>
          <Textarea id="trace-report-description" rows={3} maxLength={TRACE_REPORT_NOTE_LIMIT} value={note}
            placeholder="For example: the outline misses the tip or includes a shadow."
            onChange={event => { setNote(event.target.value); setDownloadedFile(null); setError(null); }} />
        </div>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Download the photo report (ZIP).</li>
          <li>Open an email, attach the downloaded ZIP, and send it to {TRACE_REPORT_EMAIL}.</li>
        </ol>
        <p className="text-sm text-muted-foreground">Nothing is sent until you attach the report and send the email yourself. Email links cannot attach files automatically. You can also use your usual email app or webmail; attachment size limits may apply.</p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {downloadedFile && <p role="status" className="break-words text-sm">Report prepared: {downloadedFile}. Attach it to your email before sending.</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => setSnapshot(null)}>Cancel</Button>
          <Button variant="outline" onClick={download}><Download className="h-4 w-4" aria-hidden />Download photo report</Button>
          {downloadedFile && <Button asChild><a href={traceReportEmailHref(downloadedFile)}><Mail className="h-4 w-4" aria-hidden />Open email to maintainer</a></Button>}
        </div>
      </DialogContent>
  </Dialog>;
}
