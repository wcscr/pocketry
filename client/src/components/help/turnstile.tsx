import { useEffect, useRef, useState } from "react";

interface TurnstileApi {
  render(element: HTMLElement, options: {
    sitekey: string;
    action: string;
    size: "flexible";
    callback: (token: string) => void;
    "expired-callback": () => void;
    "error-callback": () => void;
  }): string;
  remove(id: string): void;
  reset(id: string): void;
}
declare global { interface Window { turnstile?: TurnstileApi } }
let loading: Promise<TurnstileApi> | undefined;

/** Load Cloudflare only when a visitor opens the feedback form. */
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!loading) {
    loading = new Promise<TurnstileApi>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      const timer = window.setTimeout(fail, 15_000);
      function fail() {
        window.clearTimeout(timer);
        script.remove();
        reject(new Error("Could not load the spam check."));
      }
      script.onload = () => {
        window.clearTimeout(timer);
        if (window.turnstile) resolve(window.turnstile);
        else fail();
      };
      script.onerror = fail;
      document.head.appendChild(script);
    }).catch((error: unknown) => { loading = undefined; throw error; });
  }
  return loading;
}

/** Remove the widget on close; expired/failed tokens cannot enable submission. */
export function Turnstile({ siteKey, resetKey, onToken, onError }: {
  siteKey: string;
  resetKey: number;
  onToken: (token: string) => void;
  onError: () => void;
}): JSX.Element {
  const container = useRef<HTMLDivElement>(null);
  const currentWidget = useRef<{ api: TurnstileApi; id: string }>();
  const previousReset = useRef(resetKey);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const callbacks = useRef({ onToken, onError });
  callbacks.current = { onToken, onError };
  useEffect(() => {
    let disposed = false;
    let widget: string | undefined;
    let api: TurnstileApi | undefined;
    void loadTurnstile().then((loaded) => {
      if (disposed || !container.current) return;
      api = loaded;
      widget = api.render(container.current, {
        sitekey: siteKey, action: "feedback", size: "flexible",
        callback: (token) => { if (!disposed) callbacks.current.onToken(token); },
        "expired-callback": () => { if (!disposed) callbacks.current.onToken(""); },
        "error-callback": () => { if (!disposed) { callbacks.current.onToken(""); callbacks.current.onError(); } },
      });
      currentWidget.current = { api, id: widget };
    }).catch(() => { if (!disposed) callbacks.current.onError(); });
    return () => {
      disposed = true;
      currentWidget.current = undefined;
      if (api && widget !== undefined) api.remove(widget);
    };
  }, [siteKey, loadAttempt]);
  useEffect(() => {
    if (previousReset.current === resetKey) return;
    previousReset.current = resetKey;
    callbacks.current.onToken("");
    if (currentWidget.current) {
      try { currentWidget.current.api.reset(currentWidget.current.id); }
      catch { callbacks.current.onError(); }
    } else {
      // Retry a failed script load or render, where no widget ID exists yet.
      setLoadAttempt((attempt) => attempt + 1);
    }
  }, [resetKey]);
  return <div ref={container} aria-label="Spam check" className="min-h-16" />;
}
