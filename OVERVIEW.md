Edit Typst files in Paseo's file tab, with tinymist's language features and its live preview beside the editor. Click a `.typ` file in Files and it opens in this editor instead of Paseo's plain source view.

The preview updates as you type, before the file is saved. Click in the preview to put the cursor on the source that produced it; click in the source to scroll the preview there.

What you can do in the editor:

- Complete code as you type, see documentation on hover and signature help while calling functions.
- See errors and warnings from the compiler in the editor as you type.
- Format the document with typstyle (the toolbar button or Shift+Alt+F), rename a symbol (F2), go to a definition in the same file (F12), and find references (Shift+F12).
- Show or hide the preview, invert its colors for a dark theme, and scroll it to the cursor.
- Keep editing when an agent changes the file: with nothing unsaved the editor loads the new version; with unsaved edits it asks whether to reload or overwrite.

Setup: Paseo 0.13.0 or later on both the app and the daemon, and [tinymist](https://github.com/Myriad-Dreamin/tinymist) installed on the computer that runs the daemon. The plugin finds tinymist on the daemon's PATH, your login shell's PATH, or common install directories, or you can set its path in the plugin's settings. Installing from a Git repository or the registry runs `npm ci` on the daemon host, so npm needs to be on its PATH. The plugin does not download tinymist.

How it works: each open Typst tab runs its own tinymist on the daemon host, in the workspace directory, and stops it when the tab closes. The editor and the preview reach tinymist through Paseo's own connection to the daemon, so they work over SSH and the relay without opening ports. Your files and the preview stay between the daemon and your app; tinymist itself downloads Typst packages you import (`@preview/...`) from the Typst package registry, as the Typst compiler does.

Limits:

- Works in the desktop app and in a browser. The iOS and Android apps show the source, read-only.
- Go to definition and preview clicks that point into another file show the file name and line instead of opening it.
- The preview shows the open file as the whole document; a chapter included from a main file is previewed on its own.
- Preview updates arrive one network round trip after tinymist sends them, so they are a little slower over a remote connection than on the same machine.
