# Milestone 0: phone spike

Goal: decide whether the shared editor is usable on a phone and whether real-path storage works with Syncthing.
Nothing here is the final app.

## Build and install

    bash apps/mobile/scripts/build-apk.sh --install

Without a USB cable, run it without `--install` and copy `apps/mobile/dist/cave-notes-debug.apk` to the phone.

## Storage (do these first)

1. Open the app, tap **Grant access**, turn on "Allow access to manage all files", come back. The status line should say granted.
2. Set the path to the synced sample folder (default `/storage/emulated/0/Syncthing/BBT`), tap **List**.
3. Open a note, change a word, **Save**. Within a minute or so the change should reach the desktop through Syncthing.
4. Edit the same note on the desktop, wait for the sync, close and reopen it on the phone: the change should be there.
5. Note whether Syncthing ever shows a conflict or a stray hidden `.cave-tmp` file after a save.
6. Open a note in a subfolder (for example `Tasks/`) and a very long one, and note how long opening takes.

## Typing (Gboard, on-screen keyboard only)

For each, write pass or fail and one line about what happened.

1. Type a sentence with autocorrect on; accept a suggestion from the strip; reject one by tapping the original word.
2. Tap in the middle of a word and type; tap at the end of a line and type. Check the cursor does not jump.
3. Long-press to select a word, drag the selection handles, cut, and paste.
4. Start a bullet list: type `- item`, Enter (a new bullet should appear), Enter again (the list should end). Same for `1.`.
5. Type `# Heading`; check the preview hides the markers when the cursor leaves the line.
6. Type `"quoted"` and `it's` (smart quotes), and `--` and `---` (dashes).
7. Type `[[`: does the page-link completion show, and can it be picked with a tap?
8. In a long note, tap a line near the bottom: the keyboard opens and the cursor line must stay visible above it.
9. Rotate the phone with the keyboard open.
10. Use Gboard voice typing for a sentence.
11. Swipe-type (glide) a few words.
12. Check that scrolling with a finger works and does not move the cursor or open the keyboard by mistake.

## Report back

Pass/fail for each item above, the phone model and Android version, and anything that felt wrong even if it didn't fail.
