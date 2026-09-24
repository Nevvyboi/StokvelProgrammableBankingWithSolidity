# deck

`index.html` is the whole talk in one file: eighteen slides on the run sheet plus three appendix
slides, the fonts inlined, the diagrams inlined as SVG, no CDN and no network. It is the backup if
PowerPoint fails, and it has the animated hash chain.

Open it in any browser. Keys: arrows or space to move, **N** for the speaker notes, **F** for
fullscreen, **L** to switch to the light theme, **G** to jump to a slide number.

Rebuild it after changing the script or the diagrams:

```bash
python3 build.py
```

It reads `talk/SPEECH.md` for the notes, `assets/diagrams/*.svg` for the diagrams, `assets/fonts`
for the fonts, and the same quilt algorithm as the cards and the dashboard.
