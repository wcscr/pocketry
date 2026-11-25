import { useEffect, useRef, useState, type FormEvent } from "react";
import { MessageSquareWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Turnstile } from "@/components/help/turnstile";
import { TRACE_REPORT_SEND_PHOTO_MAX_MIB } from "@shared/trace-photo-report-schema";
import { createTracePhotoSubmission, traceReportPhoto, TRACE_REPORT_EMAIL, TRACE_REPORT_NOTE_LIMIT } from "@/lib/trace-photo-report";
import { hasPendingManualCalibration, useTrace, type TraceState } from "@/state/trace-store";

const CONFIG_ERRORS = {
  timeout: "Connecting to photo reporting took too long.",
  unavailable: "Photo reporting is temporarily unavailable.",
  unsupported: "This installation does not provide in-app photo reporting.",
};

/** A prominent Outline action, with a fallback before scale or region setup. */
export function TracePhotoReport({ placement = "fallback" }: { placement?: "controls" | "fallback" }): JSX.Element | null {
  const trace = useTrace();
  const [snapshot, setSnapshot] = useState<TraceState | null>(null);
  const [note, setNote] = useState("");
  const [replyEmail, setReplyEmail] = useState("");
  const [siteKey, setSiteKey] = useState("");
  const [configAttempt, setConfigAttempt] = useState(0);
  const [configError, setConfigError] = useState<keyof typeof CONFIG_ERRORS | null>(null);
  const [token, setToken] = useState("");
  const [challenge, setChallenge] = useState(0);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const submitting = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!snapshot) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setConfigError("timeout");
      controller.abort();
    }, 10_000);
    void fetch("/api/feedback", { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        if (controller.signal.aborted) return;
        if (response.status === 404) {
          setConfigError("unsupported");
          return;
        }
        if (!response.ok) throw new Error();
        const config: unknown = await response.json();
        if (typeof config !== "object" || config === null || !("siteKey" in config) || typeof config.siteKey !== "string" || !config.siteKey) throw new Error();
        if (!controller.signal.aborted) setSiteKey(config.siteKey);
      })
      .catch(() => { if (!controller.signal.aborted) setConfigError("unavailable"); })
      .finally(() => window.clearTimeout(timeout));
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [snapshot, configAttempt]);

  const outlineControlsReady = !!trace.calibration && !trace.pendingAutoCalibration &&
    !hasPendingManualCalibration(trace) && !!trace.region && trace.region.width > 5 && trace.region.height > 5;
  if (!trace.imageUrl || (placement === "fallback" && outlineControlsReady)) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!snapshot || submitting.current || !token) return;
    submitting.current = true; setSending(true); setError("");
    try {
      const report = createTracePhotoSubmission(snapshot, note, replyEmail, navigator.userAgent);
      const response = await fetch("/api/trace-report", {
        method: "POST", headers: { "Content-Type": "application/json", "X-Pocketry-Turnstile": token },
        body: JSON.stringify(report), signal: AbortSignal.timeout(45_000),
      });
      const result: unknown = await response.json();
      if (!response.ok || typeof result !== "object" || result === null || !("ok" in result) || result.ok !== true) {
        const detail = typeof result === "object" && result !== null && "error" in result && typeof result.error === "string" ? result.error :
          "We could not confirm delivery. Your report is still here; please try again later.";
        throw new Error(detail);
      }
      setSent(true);
    } catch (cause) {
      setError(cause instanceof Error && cause.name !== "SyntaxError" && cause.name !== "TimeoutError" ? cause.message :
        "We could not confirm delivery. Your report is still here; please try again later.");
    } finally {
      setSending(false); submitting.current = false; setToken(""); setChallenge(value => value + 1);
    }
  }

  return <Dialog open={snapshot !== null} onOpenChange={open => {
    if (sending) return;
    setSnapshot(open ? trace : null);
    if (open) { setNote(""); setReplyEmail(""); setSiteKey(""); setConfigError(null); setToken(""); setError(""); setSent(false); }
  }}>
    <div className={placement === "controls" ? "border-t pt-2" : "order-last flex shrink-0 justify-end px-3 py-2"}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className={placement === "controls" ? "w-full" : "min-h-10 max-md:min-h-11"}>
          <MessageSquareWarning className="h-4 w-4" aria-hidden />Report tracing problem
        </Button>
      </DialogTrigger>
    </div>
    <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto [&>button:last-child]:h-11 [&>button:last-child]:w-11"
      onOpenAutoFocus={() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
      onCloseAutoFocus={event => { event.preventDefault(); if (returnFocus.current?.isConnected) returnFocus.current.focus(); }}>
      <DialogHeader>
        <DialogTitle>Report tracing problem</DialogTitle>
        <DialogDescription>Send the original photo (up to {TRACE_REPORT_SEND_PHOTO_MAX_MIB} MiB) and tracing details.</DialogDescription>
      </DialogHeader>
      {sent ? <div className="space-y-4">
        <p role="status">Thanks! Your photo report has been submitted to the project maintainer.</p>
        <Button className="min-h-11" onClick={() => setSnapshot(null)}>Done</Button>
      </div> : <form onSubmit={event => { void submit(event); }} className="space-y-4">
        <fieldset disabled={sending} className="space-y-4">
          <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
            <strong>Sending shares your original photo with the project maintainer at {TRACE_REPORT_EMAIL}.</strong>{" "}
            The report also includes your tracing settings, outline, app version, browser details, description, and optional email address.
            Check the photo for personal or sensitive content; embedded photo metadata, including location if present, is included.
          </p>
          {snapshot && <img src={traceReportPhoto(snapshot) ?? undefined} alt="Original photo included in the report"
            className="max-h-36 w-full rounded-md bg-muted object-contain" />}
          <div className="space-y-2">
            <Label htmlFor="trace-report-description">What went wrong? (optional)</Label>
            <Textarea id="trace-report-description" rows={3} maxLength={TRACE_REPORT_NOTE_LIMIT} value={note}
              placeholder="For example: the outline misses the tip or includes a shadow."
              onChange={event => setNote(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="trace-report-email">Your email (optional)</Label>
            <Input id="trace-report-email" type="email" autoComplete="email" maxLength={254} value={replyEmail}
              onChange={event => setReplyEmail(event.target.value)} />
            <p className="text-xs text-muted-foreground">Only needed if you’d like a reply.</p>
          </div>
          {siteKey && <Turnstile resetKey={challenge} siteKey={siteKey} onToken={setToken}
            onError={() => setError("The spam check could not load. Check your connection or content blocker, then retry.")} />}
          {error && <div role="alert" className="space-y-2 text-sm"><p>{error}</p>
            <a className="inline-block underline" href={`mailto:${TRACE_REPORT_EMAIL}`}>Email the maintainer</a>
            {siteKey && <Button type="button" variant="outline" className="min-h-11" onClick={() => { setToken(""); setError(""); setChallenge(value => value + 1); }}>Retry spam check</Button>}
          </div>}
          {configError && <div role="alert" className="space-y-2 text-sm">
            <p>{CONFIG_ERRORS[configError]}</p>
            <p>Email issues or recommendations to the maintainer at{" "}
              <a className="underline" href={`mailto:${TRACE_REPORT_EMAIL}`}>{TRACE_REPORT_EMAIL}</a>.
            </p>
            {configError !== "unsupported" && <Button type="button" variant="outline" className="min-h-11" onClick={() => {
              setConfigError(null);
              setConfigAttempt(value => value + 1);
            }}>Retry connection</Button>}
          </div>}
          {!siteKey && !configError && <p role="status" className="text-sm text-muted-foreground">Connecting…</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setSnapshot(null)}>Cancel</Button>
            <Button type="submit" disabled={!siteKey || !token || sending}>{sending ? "Sending…" : "Send photo report"}</Button>
          </div>
        </fieldset>
      </form>}
    </DialogContent>
  </Dialog>;
}
