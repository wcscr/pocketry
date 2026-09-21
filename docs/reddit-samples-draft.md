# Reddit post draft

## Title

Pocketry update: non-rectangular bins, two-level pockets, and sample projects to try

## Post

I've been using Pocketry to make bins for my own tools, and I've put a set of
sample projects on GitHub so you can try the designs or adapt them to your setup.

Pocketry is a free, open-source browser app that turns photos of tools into
editable outlines and printable bins. Image processing, project storage, and
model generation happen locally in your browser.

A few additions since my earlier post:

- **Non-rectangular bins:** edit the footprint to leave out unused grid cells.
  The Ryobi cutter is an example of fitting the bin around an awkward tool.
- **Two-level pockets:** split one tool pocket into two sections with different
  depths. This lets a thin blade and a thicker handle sit in the same continuous
  pocket. The cutter and stapler samples use this.
- **UI improvements:** simpler project opening, saving, and renaming; clearer
  pocket and finger-access controls; more canvas space on phones; and a larger
  precision view for editing outlines.

The samples cover a Wolfbox MF70 Airduster Kit, DeWalt right-angle tools,
a Ryobi cutter, caliper storage, a stapler, wire strippers, a Klein voltage
tester, and a Citadel mouldline remover. Each folder includes a print model and
an editable project JSON, with photos of all eight finished bins. Most also
include a photo with the tool removed so you can see the pockets.

[Try Pocketry](https://pocketry.xyz) ·
[Browse the sample projects](https://github.com/wcscr/pocketry/tree/main/samples) ·
[Source code](https://github.com/wcscr/pocketry)

To try a project, download its `.pocketry.json`, open **Bin → Open project** in
Pocketry, and select the file. The 3MFs can go straight into your slicer. Check
the dimensions and print a fit check before committing to a full bin for your
own tools. You can also download `pocketry-sample-library.json` to add all eight
designs at once through **Bin → Project → Manage library → Import library**.

I'd love to see what you make, and hear which parts of the workflow could be
easier.

## Publication notes

- Publish the sample directory before posting so the GitHub link is live.
- Use `samples/wolfbox-mf70-airduster-kit/photos/printed-bin-loaded.jpg` as the first image and
  `printed-bin-pocket.jpg` to show the fitted pocket with the tool removed.
- Include `samples/ryobi-cutter/photos/printed-bin-pocket.jpg` to show the custom
  footprint and two-level pocket, plus the loaded DeWalt and wire-stripper photos.
- The caliper, stapler, Klein tester, and mouldline remover folders also include
  loaded and empty-bin photos. All sample photos are cropped, rotated, and stripped
  of embedded metadata.
- This is a draft; it has not been posted to Reddit.
