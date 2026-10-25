A code editor for Paseo's file tab, backed by language servers on your computer, with live previews where a language has one. It opens Typst, Python, Rust, Go, C/C++, JavaScript/TypeScript, LaTeX, Markdown, JSON, CSS, and HTML files. Paseo asks the first time you open each kind of file whether to use this editor or its own.

What you can do in the editor:

- Complete code as you type, see documentation on hover and signature help while calling functions.
- See errors and warnings from the language server as you type.
- Format the document (the toolbar button or Shift+Alt+F), rename a symbol (F2), go to a definition in the same file (F12), find references (Shift+F12), and fold sections.
- Read code coloured as you type by the editor's own parser, refined by the language server once it has analysed the file.
- Save automatically, 800 ms after you stop typing like Paseo's own editor, or turn that off (or change the delay) in the plugin's settings and save with Ctrl/Cmd+S. With auto-save off, unsaved edits stay with the tab, even across an app reload, until you save or close it without saving.
- Keep editing when an agent changes the file: with nothing unsaved the editor loads the new version; with unsaved edits it asks whether to reload or overwrite.
- See a live preview beside the editor, alone, or not at all, updated as you type: Typst's rendered document; Markdown, shown as slides when the file is a Marp deck; and LaTeX's built PDF. Drag the line between them to resize (double-click for half and half), or drag the grip bar at the top of the editor or the preview to put it on the left, right, top, or bottom; each tab keeps its layout. Click in the preview to put the cursor on the source that produced it (for a PDF, Ctrl/Cmd-click or double-click); click in the source to see its place in the preview. You can also invert the preview's colors.
- Check spelling as you write, with cspell, the checker behind VS Code's Code Spell Checker. Typst, LaTeX, and Markdown files have misspelled words underlined in their text and comments, leaving out code, math, references, and labels; technical terms are known, and a project's cspell.json word list applies. Right-click an underlined word, or press Alt+Enter on it, for suggestions or to add it to your dictionary. In code, spellchecking covers comments and starts off. The toolbar's spelling button turns checking on or off for each file.
- Build a PDF from Typst or LaTeX with the Compile button, or on every save by turning on "Compile to PDF on save" for the language in the plugin's settings. Typst writes the PDF beside the file; LaTeX runs latexmk beside the root document.

Language servers: each language uses a server on the computer that runs the Paseo daemon: tinymist (Typst), basedpyright (Python), rust-analyzer (Rust), gopls (Go), clangd (C/C++), typescript-language-server with TypeScript (JavaScript/TypeScript), texlab (LaTeX), marksman (Markdown), and the VS Code JSON, CSS, and HTML servers. If you already have one installed, the editor uses it; you can also set its path in the plugin's settings. Without a server the editor still opens and highlights the file.

Installing servers: when a server is missing, the editor and the settings offer to install it. Before anything is downloaded, a confirmation shows the version, where it comes from (the server's GitHub release, the npm registry, or the Go module proxy for gopls), its size and license, and the folder it goes to. Declining downloads nothing. Release downloads are checked against pinned SHA-256 checksums; npm servers install exactly the versions in lockfiles shipped with the plugin, without running install scripts; gopls installs with Go's own checksum verification. Servers go in `plugin-data/editor-plus/servers` inside your Paseo home on the daemon's computer and run as your user while you edit. The settings list what the plugin installed and remove it; uninstalling the plugin leaves them in place.

Downloads: the LaTeX preview's PDF viewer (PDF.js) and the spellchecker (cspell with its dictionaries) are downloaded from the npm registry the first time they are needed, pinned to exact versions, into `plugin-data/editor-plus` in your Paseo home on the daemon's computer. The plugin's settings list them under Downloads and remove them.

Setup: Paseo 0.13.0 or later on both the app and the daemon. Building and previewing LaTeX needs a TeX distribution with latexmk and synctex on the daemon's computer. Installing the plugin from a Git repository or the registry runs `npm ci` on the daemon host, so npm needs to be on its PATH; npm is also needed for the first LaTeX preview and spellcheck, to install the Python, JavaScript/TypeScript, JSON, CSS, and HTML servers, and Go to install gopls.

How it works: each open editor tab runs its own language server on the daemon host, in the workspace directory, and stops it when the tab closes. The editor and the preview reach the server through Paseo's own connection to the daemon, so they work over SSH and the relay without opening ports. Your files stay between the daemon and your app; Markdown is rendered and spelling checked on the daemon's computer, and local images it shows are sent to the app with it. Language servers may fetch what their language needs: tinymist downloads Typst packages you import from the Typst package registry, gopls and rust-analyzer can fetch modules and crates through Go and Cargo, and the JSON server can download schemas a file refers to.

Limits:

- Works in the desktop app and in a browser. The iOS and Android apps show the source, read-only.
- Files opened from an agent's link or a search result open in Paseo's own editor.
- Go to definition and preview clicks that point into another file show the file name and line instead of opening it.
- The Typst preview shows the open file as the whole document; a chapter included from a main file is previewed on its own.
- Updates from the server arrive one network round trip after it sends them, so they are a little slower over a remote connection than on the same machine.
