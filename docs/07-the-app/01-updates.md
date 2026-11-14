# Updating the app

A Cave Notes AppImage can look for a newer version of itself and put it in its own place. This page says how that works, what it touches, and how to point it at somewhere other than the project's GitHub page.

## What happens

About once a day (and shortly after the app starts, if a day has passed), Cave Notes asks where its releases are kept whether there is a newer version than the one that runs. Nothing about you, your notes or your computer is sent: it is an ordinary request for a public page.

When there is a newer version, what happens next depends on **Preferences → Updates**:

| Setting | What it does |
|---|---|
| **Install updates by itself** (the default) | Downloads the new AppImage and puts it in place of the old one. A message offers *Restart now*; until then the old version keeps running. |
| **Only tell me** | Says that a newer version exists, with an *Install* button. |
| **Never look** | Does not contact anything. *Check for updates* (in Preferences → Updates and in Help → About) still works whenever you press it. |

## How the file is replaced

The new file is saved **next to the old one**, with a temporary name, then checked:

- it must be as big as the server said it would be, and match its checksum when the source gives one (GitHub does);
- it must really be an AppImage (not an error page);
- the old file is copied into the app's data folder (`previous-appimage/`), one copy, replaced at each update, so that a bad update can be undone by copying it back;
- then the new file is **renamed over the old one**. That is one step for the file system, so there is never a moment with half a file, and the program that is running (which has the old file open) is not disturbed.

The result has **exactly the same file name and place** as before (`Cave_Notes-0.1.0-x86_64.AppImage` stays that, whatever version it now holds), so launchers, shortcuts and "Open With" entries keep working. The folder must be one you can write to; if it is not (for example `/opt`), Cave Notes says so and leaves everything as it was.

Only an AppImage can replace itself. A copy started some other way (from source, or unpacked) is only told that a newer version exists.

Which file of a release is taken: the project makes three kinds of AppImage, which differ in how they start (see [Packaging](02-packaging.md)). Cave Notes picks the same kind as the one that runs, for the same processor.

## Looking somewhere else

**Preferences → Updates → Update address** takes any of these:

- **A GitHub repository**: `https://github.com/owner/name`. Its latest release is used (a release marked as a draft or pre-release is not).
- **A small JSON file** you keep anywhere on the web, with the version and where the AppImage is:

  ```json
  {
    "version": "0.3.0",
    "url": "https://example.org/files/Cave_Notes-0.3.0-x86_64.AppImage",
    "sha256": "…the file's SHA-256, optional but wise…"
  }
  ```

  A relative `url` is read from the JSON file's own address. Use the same file name pattern as the releases, or point `url` at the right kind of AppImage yourself.
- **The address of an AppImage** whose file name has the version in it (`…/Cave_Notes-0.3.0-x86_64.AppImage`).

Addresses must start with `https://` (`http://` is accepted only for this computer itself, to try things out). An empty box means the project's releases.

## When it goes wrong

The message under **Check for updates** says what happened: no network, a repository with no releases, a release with no AppImage of your kind, a file that did not match its checksum. After a failed look the app tries again in an hour; after a successful one, in about a day. **Help → Logs** has the details.

To go back to the previous version, close Cave Notes and copy the file in `previous-appimage/` (inside the app's data folder, shown in Help → Logs → *Open log folder*'s parent) over the AppImage.

## On Android

Android does not let an app replace itself, so the update is two taps instead of none. About once a day, and whenever you press **Check for updates** in *Help → About*, the app looks at the newest release of the project on GitHub for an `.apk` file. When it finds a newer version than the one you have, the About page says so and offers **Install**: that opens the download in the phone's browser, and a tap on the downloaded file installs it over the old one. Your notes, which are files in your folders, are not touched. Android may ask once to let the browser install apps; that permission is the phone's own and can be turned off again afterwards.

An update only installs over the app if both were signed with the same key, so a copy built on another computer cannot update one built on yours: uninstall first (your notes stay where they are) or build both on the same computer.
