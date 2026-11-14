# Packaging as an AppImage

```sh
npm ci                                   # repo root
cd apps/desktop
npm run package:appimage                 # both variants (needs mksquashfs: dnf/apt install squashfs-tools)
npm run package:appimage:fuse2           # or one of them
npm run package:appimage:uruntime
```

Output in `apps/desktop/release/`:

| File | Runtime | Needs on the user's machine |
|---|---|---|
| `Cave_Notes-<v>-x86_64.AppImage` | classic AppImageKit | `libfuse.so.2` (package `fuse-libs` / `libfuse2`) and `fusermount` |
| `Cave_Notes-<v>-x86_64-uruntime.AppImage` | [uruntime](https://github.com/VHSgunzo/uruntime) | nothing: uses FUSE if present, else user namespaces, else unpacks to a temp folder |

`build-appimage.sh type2` / `all` also builds with the current official runtime (static, but still needs /dev/fuse and fusermount).
**The version** is set in one place: the `package.json` at the top of the repository. `npm version patch` (or `minor`, `major`, or `npm version 1.2.3`) run there changes it, copies it into `apps/desktop/package.json` (which the About box and the packager read) and the AppImage names follow. `APP_VERSION=1.2.3 ./packaging/build-appimage.sh` overrides it for one build.

Any AppImage can be run without FUSE with `--appimage-extract-and-run`.

## Sandbox

An AppImage can never hold a root-owned setuid `chrome-sandbox`. The build removes that file (`packaging/after-pack.cjs`), so
Chromium uses its user-namespace sandbox. `packaging/AppRun` adds `--no-sandbox` only when that cannot work (running as root,
user namespaces disabled, or Ubuntu 23.10+/24.04's AppArmor restriction), and prints a note. `CAVE_SANDBOX=1` never adds it,
`CAVE_SANDBOX=0` always does. On Ubuntu 24.04 the proper alternative is an AppArmor profile that allows `userns` for the AppImage.

## Desktop file and icon

On first run of an **installed** app (and when it is moved, renamed or updated) the app writes
`~/.local/share/applications/cave-notes.desktop` and the icons under `~/.local/share/icons/hicolor/`
(`src/main/appimage-integration.ts`). The launcher declares the Markdown file types (`text/markdown`, `text/x-markdown`), so
Cave Notes appears in **Open With** for `.md` files in the file manager. "Installed" means the AppImage (the launcher starts
the AppImage file) or an unpacked, packaged build (it starts that executable). **Running from a source checkout, as in
development (`npm start`), registers nothing**: no launcher, no icons, no file types. If you do want a checkout registered, run
it once with `--install-desktop-integration`. A launcher it did not write is never replaced. Some file managers need a moment,
or a new login, before they show a changed list.

- Opt out: `CAVE_NO_DESKTOP_INTEGRATION=1`
- Remove and stay removed: run once with `--remove-desktop-integration` (`--install-desktop-integration` undoes it)

The icon in `packaging/icons/` is a placeholder; replace `cave-notes.svg` and regenerate the PNG sizes.
