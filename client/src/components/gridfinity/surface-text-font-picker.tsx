import { useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { HelpHint } from "@/components/ui/help-hint";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { SURFACE_TEXT_FONTS, type SurfaceText } from "@shared/gridfinity/surface-text";
import { importLocalFont, inspectSystemFont, listSystemFonts, supportsSystemFonts, type SystemFont } from "@/lib/gridfinity/local-font";
import { surfaceTextOutline } from "@/lib/gridfinity/surface-text";

/** One picker; system-font permission is requested only when the user opens it. */
export function SurfaceTextFontPicker({ label, id, index, onChange }: {
  label: SurfaceText; id: string; index: number; onChange: (font: SurfaceText["font"]) => void;
}): JSX.Element {
  const request = useRef(0);
  const latest = useRef({ label, onChange });
  latest.current = { label, onChange };
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [listing, setListing] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fonts, setFonts] = useState<SystemFont[] | null>(null);
  const [query, setQuery] = useState("");
  const [checking, setChecking] = useState(false);
  const [checks, setChecks] = useState<Record<string, { text: string; error: string | null }>>({});
  const checksRef = useRef(checks);
  checksRef.current = checks;
  const available = supportsSystemFonts();
  const matching = fonts?.filter(font => `${font.fullName} ${font.family} ${font.style}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())) ?? [];
  const visible = matching.filter(font => checks[font.postscriptName]?.text === label.text && checks[font.postscriptName].error === null);
  const currentName = typeof label.font === "string" ? SURFACE_TEXT_FONTS.find(font => font.id === label.font)!.name : label.font.name;
  useEffect(() => { request.current++; setBusy(false); setError(null); }, [label]);
  useEffect(() => () => { request.current++; }, []);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setChecking(true);
    void (async () => {
      for (const font of matching) {
        if (!active) break;
        const previous = checksRef.current[font.postscriptName];
        if (previous?.text === label.text) continue;
        let problem: string | null = null;
        try { await inspectSystemFont(await font.blob(), font.fullName, label.text); }
        catch (cause) { problem = cause instanceof Error ? cause.message : "Unavailable font"; }
        if (active) setChecks(previous => ({ ...previous, [font.postscriptName]: { text: label.text, error: problem } }));
      }
      if (active) setChecking(false);
    })();
    return () => { active = false; };
  }, [open, fonts, query, label.text]);
  const list = async () => {
    setAttempted(true); setListing(true); setError(null);
    try { setFonts(await listSystemFonts()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setListing(false); }
  };
  const close = () => { request.current++; setBusy(false); setOpen(false); };
  const apply = (font: SurfaceText["font"]) => {
    try {
      surfaceTextOutline({ ...latest.current.label, font });
      setError(null);
      latest.current.onChange(font);
      close();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const selectSystemFont = async (font: SystemFont) => {
    const token = ++request.current;
    const wording = label.text;
    setBusy(true); setError(null);
    try {
      const imported = await importLocalFont(await font.blob(), font.fullName, wording);
      if (request.current === token) apply(imported);
    } catch (cause) { if (request.current === token) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (request.current === token) setBusy(false); }
  };
  return <div className="space-y-1.5">
    <div className="flex min-w-0 items-center gap-2">
      <div className="flex shrink-0 items-center gap-1"><Label htmlFor={id} className="text-xs">Font</Label>
        <HelpHint label="surface text fonts">Built-in fonts work in every supported browser. Installed system fonts require permission and desktop Chrome or Edge; Safari, Firefox, and mobile browsers cannot access them. Only system fonts with printable outlines for the characters in your wording are shown. The chosen font is saved with your project so wording stays editable on other devices.</HelpHint></div>
      <Popover open={open} onOpenChange={next => {
        if (next) setOpen(true);
        if (next) { setQuery(""); if (available && !attempted) void list(); }
        else close();
      }}>
        <PopoverTrigger asChild><Button id={id} role="combobox" aria-label={`Text ${index + 1} font`} aria-expanded={open} variant="outline" className="h-8 min-w-0 flex-1 justify-between gap-1 px-2 font-normal">
          <span className="truncate">{currentName}</span><ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button></PopoverTrigger>
        <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] p-0">
          <Command shouldFilter={false}>
            <CommandInput aria-label="Search fonts" placeholder="Search system fonts…" value={query} onValueChange={setQuery} />
            <CommandList aria-label="Fonts">
              <CommandGroup heading="Built-in fonts">
                {SURFACE_TEXT_FONTS.map(font => <CommandItem key={font.id} value={`builtin-${font.id}`} onSelect={() => { request.current++; setBusy(false); apply(font.id); }}>
                  <Check className={`mr-2 h-3.5 w-3.5 ${label.font === font.id ? "opacity-100" : "opacity-0"}`} />{font.name}
                </CommandItem>)}
              </CommandGroup>
              {!SURFACE_TEXT_FONTS.some(font => font.id === label.font) && <CommandGroup heading="Saved font">
                <CommandItem value="saved" onSelect={close}><Check className="mr-2 h-3.5 w-3.5" />{currentName}</CommandItem>
              </CommandGroup>}
              {available && <CommandGroup heading="System fonts">
                {listing && <p role="status" className="px-2 py-1 text-xs text-muted-foreground">Loading system fonts…</p>}
                {visible.map(font => <CommandItem key={font.postscriptName} value={font.postscriptName} disabled={busy}
                  onSelect={() => void selectSystemFont(font)}>{font.fullName}</CommandItem>)}
                {checking && <p role="status" className="px-2 py-1 text-xs text-muted-foreground">Checking compatible fonts…</p>}
                {fonts && !checking && !visible.length && <p className="px-2 py-1 text-xs text-muted-foreground">No compatible system fonts match this wording and search.</p>}
              </CommandGroup>}
            </CommandList>
          </Command>
          {!available && <p className="border-t p-2 text-xs text-muted-foreground">This browser cannot access system fonts. Built-in fonts are available above.</p>}
          {busy && <p role="status" className="border-t p-2 text-xs">Loading font…</p>}
          {error && <div className="border-t p-2"><p role="alert" className="text-xs text-destructive">{error}</p>
            {available && !fonts && <Button variant="ghost" size="sm" disabled={listing} onClick={() => void list()}>Retry system font access</Button>}
          </div>}
        </PopoverContent>
      </Popover>
    </div>
    {error && !open && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>;
}
