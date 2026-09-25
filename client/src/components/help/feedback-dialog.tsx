import { useEffect, useRef, useState, type FormEvent } from "react";
import { feedbackSchema, type Feedback } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Turnstile } from "./turnstile";

export type FeedbackKind = Feedback["kind"];
const UNAVAILABLE = "Private feedback is temporarily unavailable. Please try again later.";

/** Drafts stay in memory on close and on failure; only explicit Send uploads them. */
export function FeedbackDialog({ open, kind: initialKind, onOpenChange }: {
  open: boolean;
  kind: FeedbackKind;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const [kind, setKind] = useState(initialKind);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [replyEmail, setReplyEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [siteKey, setSiteKey] = useState("");
  const [token, setToken] = useState("");
  const [challenge, setChallenge] = useState(0);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const submitting = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setKind(initialKind);
    setToken("");
    setSiteKey("");
    setError("");
    setSent(false);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    void fetch("/api/feedback", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(UNAVAILABLE);
        const config: unknown = await response.json();
        if (typeof config !== "object" || config === null || !("siteKey" in config) || typeof config.siteKey !== "string" || !config.siteKey) throw new Error(UNAVAILABLE);
        if (!controller.signal.aborted) setSiteKey(config.siteKey);
      })
      .catch(() => { if (active) setError(UNAVAILABLE); })
      .finally(() => window.clearTimeout(timeout));
    let active = true;
    return () => { active = false; window.clearTimeout(timeout); controller.abort(); };
  }, [open, initialKind]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const parsed = feedbackSchema.safeParse({ kind, subject, message, replyEmail: replyEmail.trim(), website, turnstileToken: token });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    submitting.current = true;
    setSending(true);
    setError("");
    try {
      const response = await fetch("/api/feedback", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data), signal: AbortSignal.timeout(30_000),
      });
      const result: unknown = await response.json();
      if (!response.ok || typeof result !== "object" || result === null || !("ok" in result) || result.ok !== true) {
        const detail = typeof result === "object" && result !== null && "error" in result && typeof result.error === "string" ? result.error : "We could not confirm delivery. Please try again later.";
        throw new Error(detail);
      }
      setSent(true);
      setSubject(""); setMessage(""); setReplyEmail(""); setWebsite("");
    } catch (cause) {
      setError(cause instanceof Error && cause.name !== "SyntaxError" && cause.name !== "TimeoutError" ? cause.message : "We could not confirm delivery. Your message is still here; please try again later.");
    } finally {
      setSending(false); submitting.current = false; setToken(""); setChallenge((value) => value + 1);
    }
  }

  return <Dialog open={open} onOpenChange={(next) => { if (!sending) onOpenChange(next); }}>
    <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto [&>button:last-child]:h-11 [&>button:last-child]:w-11"
      onOpenAutoFocus={() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
      onCloseAutoFocus={(event) => { event.preventDefault(); if (returnFocus.current?.isConnected) returnFocus.current.focus(); }}>
      <DialogHeader>
        <DialogTitle>{kind === "problem" ? "Report a Problem" : "Make a Suggestion"}</DialogTitle>
        <DialogDescription>Send a private message to the Pocketry team. No account required.</DialogDescription>
      </DialogHeader>
      {sent ? <div className="space-y-4">
        <p role="status">Thanks! Your message has been submitted.</p>
        <Button className="min-h-11" onClick={() => onOpenChange(false)}>Done</Button>
      </div> : <form onSubmit={(event) => { void submit(event); }} className="space-y-4">
        <fieldset disabled={sending} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="feedback-kind">I’d like to</Label>
            <select id="feedback-kind" value={kind} onChange={(event) => setKind(event.target.value as FeedbackKind)} className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm">
              <option value="problem">Report a Problem</option><option value="suggestion">Make a Suggestion</option>
            </select>
          </div>
          <div className="space-y-1.5"><Label htmlFor="feedback-subject">Short summary</Label><Input id="feedback-subject" className="min-h-11" required maxLength={120} value={subject} onChange={(event) => setSubject(event.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="feedback-message">{kind === "problem" ? "What happened?" : "What would you like to see?"}</Label>
            <Textarea id="feedback-message" required minLength={10} maxLength={5000} rows={5} value={message} onChange={(event) => setMessage(event.target.value)} aria-describedby="feedback-message-help" />
            <p id="feedback-message-help" className="text-xs text-muted-foreground">{kind === "problem" ? "Tell us what you were doing, what you expected, and what happened instead." : "Describe your idea and how it would help you use Pocketry."}</p>
          </div>
          <div className="space-y-1.5"><Label htmlFor="feedback-email">Your email (optional)</Label><Input id="feedback-email" type="email" autoComplete="email" className="min-h-11" maxLength={254} value={replyEmail} onChange={(event) => setReplyEmail(event.target.value)} /><p className="text-xs text-muted-foreground">Only needed if you’d like us to reply.</p></div>
          <div hidden aria-hidden="true"><label htmlFor="feedback-website">Website</label><input id="feedback-website" tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} /></div>
          <p className="text-xs text-muted-foreground">Sending shares only the text above and your optional email with the Pocketry team through Cloudflare. Photos and projects stay on your device. Cloudflare checks for spam when this form is open.</p>
          {open && siteKey && <Turnstile key={challenge} siteKey={siteKey} onToken={setToken} onError={() => setError("The spam check could not load. Check your connection or content blocker, then retry.")} />}
          {error && <div role="alert" className="space-y-2 text-sm"><p>{error}</p>{siteKey && <Button type="button" variant="outline" className="min-h-11" onClick={() => { setToken(""); setError(""); setChallenge((value) => value + 1); }}>Retry spam check</Button>}</div>}
          {!siteKey && !error && <p role="status" className="text-sm text-muted-foreground">Connecting…</p>}
          <Button type="submit" className="min-h-11 w-full" disabled={!siteKey || !token || sending}>{sending ? "Sending…" : "Send privately"}</Button>
        </fieldset>
      </form>}
    </DialogContent>
  </Dialog>;
}
