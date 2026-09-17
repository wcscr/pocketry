# Magnetic lids: round 3 physical fit review

The gray PETG run exposed complete failures of **Side springs** and **Spring
latch**, poor grip and undersized caps on flat inset lids, and underside print
defects on overlapping stacking lids. Contact ribs and angled fins have useful
configurations, with the limits described below. Both spring options remain
disabled; substantial research is required before revisiting either design.

These are the user's observations from the September 16, 2026 test suite,
generated from `b6ac5ea47e32640ae876e5c00316c3676a28b297`. The plate contained
44 parts: six shared 1×1×2u bins and 38 lids, with 2 mm walls and 6×2 mm magnet
settings. All parts used gray Generic PETG, the first PETG profile in the project.
See the [44-part result ledger](magnetic-lids-round3.csv) for detailed notes.

Forces are qualitative. Cycle counts are reported only where supplied; the
approximately 0.2 mm seam on 405 is a visual estimate. A blank field means not
reported, not zero. No magnets were installed: hole fit and magnetic holding
force are deferred because magnets were not readily available. No geometry,
default, or slicer changes were made during this review.

## Required improvements

1. **Match the outer lid outline to the bin for every style.** Flat inset caps
   in this suite are modeled at 40.9 mm across against 41.5 mm bins. The user
   rejects this setback. Keep mating clearance separate from outer cap size.
2. **Provide enough exposed inset cap surface to grasp.** Flat inset lids are
   hard to grip even when their retention is acceptable. Stacking inset lids
   405 and 416 have comfortable grip and apparently aligned outermost edges;
   use that physical feedback when improving flat caps.
   The user also requested considering an interface indent for easier
   separation. A candidate is two opposing, shallow rounded recesses in the
   bin immediately below the joint, exposing the underside of the lid edge.
   Placement must preserve wall strength, mating contacts, and magnet pockets
   while keeping the lid's full outer footprint. A simple optional grip-recess
   control could expose this feature. This proposal is not implemented or tested.
3. **Fix overlapping stacking-top printability.** Both 305 and 316 have
   underside defects that prevent complete seating. A successful slice and
   enabled support did not ensure a usable underside.
4. **Review loose locating fits and inset fin contact.** Easy-lift and empty
   magnetic versions generally have too much play. Inset fins feel dominated
   by corner contact; actual fin engagement has not been established.
5. **Keep spring mechanisms disabled until researched and redesigned.**
   Isolated, demonstrated printable mechanisms and physical actuation checks
   must precede another integrated prototype. The present results do not
   establish a replacement geometry or a successful repair.

## Shared bases

| Base | Compatible lid group | Status |
| --- | --- | --- |
| 301 | Overlapping easy-lift, contact ribs, magnetic | Used throughout those comparisons; plain magnet holes empty |
| 302 | Same mating group as 301 | Crush-rib magnet holes; not directly assessed |
| 303 | Overlapping angled fins and side springs | Different recessed rim; used for these interfaces |
| 401 | Inset easy-lift, contact ribs, fins, side springs, magnetic | Used throughout those comparisons; plain magnet holes empty |
| 402 | Same mating group as 401 | Crush-rib magnet holes; not directly assessed |
| 403 | Inset spring latch | Matching recesses; family failed without itemized pair results |

## Overlapping results

Unless noted, grip was comfortable and outside alignment was good across the
tested overlapping lids. Full seating does not imply a measured zero seam.

| Lid / base | Configuration | Reported result |
| --- | --- | --- |
| 304 / 301 | Easy-lift, flat | Seats fully; some play; no resistance |
| 305 / 301 | Easy-lift, stacking | Loose; underside stringing prevents full seating |
| 306 / 301 | Contact ribs, light | Good, secure feel; no significant play; slight resistance |
| 307 / 301 | Contact ribs, default | Full, even seating with satisfying click; no play; moderate insertion force; somewhat difficult removal |
| 308 / 301 | Contact ribs, firm | Seats nicely with significant force; quite hard to separate |
| 319 / 301 | Two ribs per edge, default | Excessively tight; no play; removal required a thin tool |
| 320 / 301 | Three ribs per edge, default | Untested; full seating deferred after 319 required a tool |
| 313 / 303 | Angled fins, light | No real play, but no insertion/removal resistance |
| 314 / 303 | Angled fins, default | Full seating; no play; pleasant resistance; contact seems evenly distributed |
| 315 / 303 | Angled fins, firm | Similar to 314 but significantly firmer |
| 316 / 303 | Angled fins, default, stacking | Underside defects less severe than 305, but incomplete seating; acceptable insertion/removal force |
| 317 / 301 | Plain magnetic holes, empty | Excessive play; no insertion/removal force |
| 318 / 301 | Crush-rib magnetic holes, empty | Similar excessive play; very minor unmeasured edge separation |

For everyday contact-rib use the user prefers **307, or an intermediate fit
between 306 and 307**. That intermediate setting was not printed. Tighter 308
may suit deliberately very snug retention, but 319 is too difficult to remove
by hand. Default angled-fin lid **314** is preferred over 315 unless very tight
retention is desired.

## Inset results

The flat inset lids share the modeled outer setback and generally insufficient
grip surface. The stacking versions improve grip and outermost alignment.

| Lid / base | Configuration | Reported result |
| --- | --- | --- |
| 404 / 401 | Easy-lift, flat | Seats fully; far too loose with lots of play; undersized cap |
| 405 / 401 | Easy-lift, stacking | Loose and effortless; comfortable grip and aligned outline; uniform seam estimated at 0.2 mm |
| 406 / 401 | Contact ribs, light | Seats fully with gentle pressure; no play; removable but inadequate grip |
| 407 / 401 | Contact ribs, default | Seats fully with gentle pressure; nicer and slightly snugger than 406 |
| 408 / 401 | Contact ribs, firm | Preferred feel; full seating with slight pressure; removal firmer but acceptable |
| 423 / 401 | Two ribs per edge, default | Snugger and more secure than 408; removal slightly harder but acceptable |
| 424 / 401 | Three ribs per edge, default | Most secure of 408/423/424; no play; removal not excessive; 408 still preferred for feel |
| 413 / 401 | Angled fins, light | No perceptible contact; drops in and lifts freely; lots of play |
| 414 / 401 | Angled fins, default | Seats fully; slight resistance; contact seems concentrated at corners |
| 415 / 401 | Angled fins, firm | Full seating; consistent, firmer resistance; no play; still feels corner-focused; no rub marks visible |
| 416 / 401 | Angled fins, default, stacking | Comparable insertion/removal force and mated security to 415; easier to grasp; outermost edge aligns; some corner-focused contact suspected |
| 417 / 401 | Plain magnetic holes, empty | Seats okay; very loose with lots of play; undersized cap |
| 418 / 401 | Crush-rib magnetic holes, empty | Similar to 417: very loose and undersized |

Lid 408 uses one rib per edge at the firm setting. Lids 423 and 424 have two
and three ribs per edge at default tightness. Thus the 408-to-423 comparison
changes both tightness and rib count; only 423-to-424 isolates rib count.

## Repeat opening

| Pair | Observation |
| --- | --- |
| 408 / 401 | Definitely looser with very slight play and no visible damage after several openings. Continued testing toward roughly 25 total openings seemed to stabilize with a secure pull. Exact total and later play were not separately confirmed. |
| 307 / 301 | No perceptible change during the short repeat-opening check. Exact count not confirmed. |
| 314 / 303 | Loosened initially, then held up remarkably well after **25+ tests**, with **no play**. |

Early loosening did not establish loss of useful retention in 408 or 314.
The cause of the change is unknown. These unequal, qualitative checks are not
long-term durability qualification, and absence of visible damage does not
prove unchanged geometry.

## Seating seam and unsupported undersides

The user initially suspected incomplete seating on 405, then found its seam
uniform around all sides, unchanged under gentle pressure, and approximately
0.2 mm. The printed revision places the inset cap 0.2 mm above the bin rim.
This is consistent with reaching the intended position and leaving the modeled
seam. Whether that visible seam is desirable remains undecided. Lid 408 was
reconfirmed as fully seated and undersized externally; its seam was not measured.

The failures on 305 and 316 are different: underside print defects obstruct
seating. On 305, the cap underside is 4.8 mm above the bed over a hollow region
approximately 37.5 mm across the straight sides. The original plate notes say
support was enabled for 305 and 316 but none was generated. Both printed with
underside defects; 316 was less severe. Revisit the underside and printing
approach, preserving the bin-rim receiving channel and mating clearance.

## Spring-family failures

- **Side springs, 309–312 and 409–412:** complete failure as a family. Springs
  were far too thin, several broke, and the user reports slicer-added support
  obstructing actuation. Individual affected IDs were not specified.
- **Spring latch, 419–422:** complete failure as a family. Only one or two had
  any spring action; the others were fully obstructed or stuck. Individual
  affected IDs were not specified.

Do not assign every reported defect to every part. The report of support
obstruction differs from the original plate notes saying the moving cavities
had no generated support; investigate the actual obstruction and printed slice
rather than treating digital checks as proof of free movement.

Both options remain disabled. The user explicitly requires significant research
into approaches that work before revisiting them. Research, redesign, and new
physical prototypes have not been completed in this review.

## Deferred checks

- Plain/crush-rib magnet insertion and retention, and magnetic closure force:
  magnets unavailable; all holes empty.
- Lid 320: deferred after 319 required a tool, not an observed failure.
- Direct comparisons using bases 302 and 402, controlled force/cycle tests,
  larger bins, other materials, creep, and loaded stacking.

Current print artifacts remain the reference for these observations. Retest
after geometry changes; these findings do not imply that the known defects
have been fixed.
