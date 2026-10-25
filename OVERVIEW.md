A code editor for Paseo's file tab, backed by language servers on your computer, with live previews where a language has one. The first language is Typst, with tinymist: click a `.typ` file in Files and it opens in this editor, with the rendered document beside it.

The preview updates as you type, before the file is saved. Click in the preview to put the cursor on the source that produced it; click in the source to scroll the preview there.

What you can do in the editor:

- Complete code as you type, see documentation on hover and signature help while calling functions.
- See errors and warnings from the compiler as you type.
- Format the document (the toolbar button or Shift+Alt+F), rename a symbol (F2), go to a definition in the same file (F12), find references (Shift+F12), and fold sections.
- Read code coloured as you type by the editor's own parser, refined by the language server once it has analysed the file.
- Show or hide the preview, invert its colors (off by default), and scroll it to the cursor.
- Keep editing when an agent changes the file: with nothing unsaved the editor loads the new version; with unsaved edits it asks whether to reload or overwrite.

Setup: Paseo 0.13.0 or later on both the app and the daemon, and each language's server installed on the computer that runs the daemon. For Typst that is [tinymist](https://github.com/Myriad-Dreamin/tinymist). The plugin finds servers on the daemon's PATH, your login shell's PATH, or common install directories, or you can set their paths in the plugin's settings. Installing from a Git repository or the registry runs `npm ci` on the daemon host, so npm needs to be on its PATH. The plugin does not download language servers.

How it works: each open editor tab runs its own language server on the daemon host, in the workspace directory, and stops it when the tab closes. The editor and the preview reach the server through Paseo's own connection to the daemon, so they work over SSH and the relay without opening ports. Your files and the preview stay between the daemon and your app; tinymist itself downloads Typst packages you import (`@preview/...`) from the Typst package registry, as the Typst compiler does.

Limits:

- Works in the desktop app and in a browser. The iOS and Android apps show the source, read-only.
- Go to definition and preview clicks that point into another file show the file name and line instead of opening it.
- The Typst preview shows the open file as the whole document; a chapter included from a main file is previewed on its own.
- Updates from the server arrive one network round trip after it sends them, so they are a little slower over a remote connection than on the same machine.
