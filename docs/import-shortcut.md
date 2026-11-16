# Happy Wife Import: iOS Shortcut and bookmarklet (v0.2.6)

Happy Wife Helper has no server, so it can't fetch a recipe page by itself. Instead, the recipe is read **on the
recipe page, on the phone**, and handed to the app inside the link's `#fragment`. Browsers never send the fragment
to a server: it goes from Safari straight to the app, which reads it, clears it from the address bar
(`history.replaceState`), validates and sanitizes it, and shows a preview. Nothing is saved until you tap **Save**.

There are three ways in:

| Way | Where it runs | Notes |
| --- | --- | --- |
| **Bookmarklet** "Happy Wife" | Safari (and desktop browsers) | Opens the app in the same Safari tab. About › Import a recipe has the code and steps. |
| **Shortcut** "Happy Wife Import" | Share sheet in Safari | Copies an import link, then opens it. Best for the home-screen app (paste the link into Import there). |
| **Paste** | Recipes › Import | Paste the recipe text, or an import link copied from the bookmarklet or Shortcut. |

## The link format

`<app>#recipes/import/<payload>`, where the payload is:

- `1z.<base64url of deflate-raw JSON>` when the browser has `CompressionStream`, otherwise
- `1j.<base64url JSON>`.

The JSON is `{ v: 1, t: title, u: page url, im: image, s: servings, pt/ct/tt: ISO times, i: [ingredient lines], p: [steps] }`,
or `{ v: 1, t, u, x: "page text" }` when the page has no schema.org Recipe JSON-LD. Payloads are capped at
64,000 characters (the bookmarklet refuses larger ones with an alert); the app caps the inflated JSON at 256 KB,
streams the inflate (so a zip bomb stops at the cap), and caps every field again (80 lines × 300 characters,
60 steps, 160-character title, https links only). All text is cleaned (tags and script blocks dropped,
entities decoded once, invisible and bidi characters removed) and rendered with `textContent` only.

## The Shortcut recipe

Name: **Happy Wife Import**. Four actions:

1. **Receive** *Safari web pages* **input from** *Share Sheet* (If there's no input: *Stop and respond*).
2. **Run JavaScript on** *Shortcut Input* — paste the script printed by
   `node tools/shortcut-js.mjs` (the same extractor as the bookmarklet, ending in `completion(link)`).
3. **If** *JavaScript Result* *has any value*:
   - **Copy** *JavaScript Result* **to Clipboard**
   - **Open** *JavaScript Result* (Open URLs)
   
   **Otherwise**: **Show alert** "That recipe is too large to import. Paste the ingredients instead."
4. **End If**.

Settings (ⓘ): *Show in Share Sheet* on; *Allow Running Scripts* must be allowed the first time it runs
(Settings › Apps › Shortcuts › Advanced › Allow Running Scripts).

The link is copied as well as opened because the home-screen app keeps its own storage, separate from Safari:
Safari opens the import there, and in the home-screen app you open Recipes › Import and paste.

## Exact Mac steps (signing happens on the Mac, never on the box)

1. On Steven's Mac (signed in to the same Apple Account as the iPhone), in Terminal:
   `git -C ~/shopsmartr pull` (or download the repo), then `node tools/shortcut-js.mjs | pbcopy`.
2. Open **Shortcuts** › **File › New Shortcut**, name it **Happy Wife Import**, icon: fork and knife.
3. In the right-hand ⓘ details: turn on **Use as Quick Action** › **Share Sheet**, and **Show in Share Sheet**;
   set *Receive* to **Safari web pages** only.
4. Add **Run JavaScript on Web Page**, input *Shortcut Input*, and replace its sample code with the clipboard (⌘V).
5. Add **If** (*JavaScript Result* › *has any value*); inside it add **Copy to Clipboard** and **Open URLs**
   (both with *JavaScript Result*); in *Otherwise* add **Show Alert** with the text above.
6. Test it: open a recipe page in Safari on the Mac, **Share › Happy Wife Import**. The app should open on the
   preview with the address showing `#recipes/import` only.
7. To share it: right-click the shortcut › **Share › Copy iCloud Link** and send that link to Steven / the family
   (Shortcuts signs it with the Apple Account). For a file instead, **File › Export** (*Anyone*) or in Terminal:
   `shortcuts sign --mode anyone --input "Happy Wife Import.shortcut" --output "Happy Wife Import (signed).shortcut"`.
8. On the iPhone: open the iCloud link › **Add Shortcut**. The first run asks to allow running scripts on the
   recipe site: tap **Allow**.

Don't commit the `.shortcut` file or the iCloud link with anything personal in it; the script itself is in the
repo (`src/importer.js`, `shortcutScript()`).

## Privacy and security

- No network fetch: the app never downloads the recipe page; `connect-src 'self'` in the page's CSP enforces it.
- The fragment never reaches a server (not GitHub Pages, not anyone). It's cleared from the address bar on arrival.
  Safari's own history may still keep the original link (it's on the phone only).
- Imported recipes are stored only on the device (`shopsmartr:userRecipes:v1`) and travel in the full backup file.
