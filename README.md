# ST-Spellcheck

**Spell check for SillyTavern and TauriTavern that understands Brazilian Portuguese and US English at the same time, for people who switch languages mid-sentence.**

This is a fork of [Cheesedozer/SillyTavern-Spellchecker-Extension](https://github.com/Cheesedozer/SillyTavern-Spellchecker-Extension). A word is only flagged if **both** dictionaries reject it, so `hello, como você está?` comes up clean. The browser's built-in spellchecker only handles one language at a time, and inside TauriTavern's WebView2 no setting changes that.

```
   _____ _______    _____            _ _      _               _
  / ____|__   __|  / ____|          | | |    | |             | |
 | (___    | |____| (___  _ __   ___| | | ___| |__   ___  ___| | __
  \___ \   | |____|\___ \| '_ \ / _ \ | |/ __| '_ \ / _ \/ __| |/ /
  ____) |  | |     ____) | |_) |  __/ | | (__| | | |  __/ (__|   <
 |_____/   |_|    |_____/| .__/ \___|_|_|\___|_| |_|\___|\___|_|\_\
                         | |
                         |_|    v2.0.0 for SillyTavern 1.12.0+
```

---

## Simple mode and the Windows spell checker

**Simple mode** is on by default: squiggly underlines and right-click corrections, like a browser's spellchecker. Untick it in the extension's settings to get the buttons, the roleplay exceptions and AI Polish.

**To use the Windows spell checker** (recommended on Windows), a browser extension needs a small helper, because it cannot reach Windows by itself:

1. Run `windows-helper\build.cmd` once. It builds `st-spellcheck-helper.exe` using a compiler that comes with Windows.
2. Start TauriTavern with `st-spellcheck-helper.exe --run-app`, for example from a desktop shortcut. The helper closes when TauriTavern does.

The settings panel shows which engine is in use. Without the helper the extension uses its built-in dictionaries. The helper only listens on `127.0.0.1`, stores nothing and refuses requests from other web pages. Windows needs both languages installed under Settings > Time & language.

On Wikipedia articles with typos inserted, the Windows checker offered the right word first about 78% of the time against about 71% for the built-in dictionaries, and raised under half as many false alarms in English (1.1% of words against 2.8%). It raised more in Portuguese (2.0% against 1.5%), mostly on technical terms. Both caught about the same share of typos.

## Features

### Two-Mode Spell Checking System

- **Local Spell Check** - Instant, offline spell checking using the real Hunspell engine, compiled to WebAssembly
  - Red underlines as you type, in the chat box
  - Checks Portuguese and English together; nothing leaves your computer
  - Right-click an underlined word to see corrections from both languages, closest first, or add it to your dictionary
  - The names in the current chat are accepted automatically

- **AI Polish** - Use your connected LLM to improve text
  - Enhances grammar, punctuation, and flow
  - Three intensity levels: Light, Medium, Heavy
  - Preserves your unique writing style

### Roleplay-Aware Mode

Intelligently recognizes and preserves common roleplay conventions:

| Pattern | Example | Preserved? |
|---------|---------|------------|
| Stuttering | "I-I didn't mean to..." | Yes |
| Ellipses | "I thought..." | Yes |
| Asterisks around actions | *sighs heavily* | Kept, and the words inside are still checked |
| Tildes | "Please~" | Yes |
| ALL CAPS shouting | "STOP RIGHT THERE!" | Yes |
| Repeated letters | "Nooooo!" | Yes |
| RP abbreviations | "OOC:", "NPC" | Yes |

### Custom Dictionary

- Add any word to your personal dictionary
- Right-click flagged words to instantly add them
- One-click import of character names from current chat
- Support for World Info/Lorebook names
- Import/Export dictionary as JSON for backup

### Preview Before Applying

- Side-by-side diff view showing original vs corrected text
- Individual changes highlighted with color coding
- Checkbox to accept/reject each change individually
- "Accept All" and "Reject All" for quick decisions

### Adjustable Correction Intensity

| Level | Description | Best For |
|-------|-------------|----------|
| Light | Typos and obvious misspellings only | Quick messages |
| Medium | Typos + basic grammar (periods, capitals) | Standard roleplay |
| Heavy | Full rewrite for flow and clarity | Important posts |

### Undo

Every correction goes through the chat box's normal history, so plain Ctrl+Z undoes it.

### Per-Character Settings

- Enable/disable spell check per character card
- Useful for characters with intentional speech quirks
- Visual indicator when spell check is disabled

---

## Screenshots

> *Screenshot: Main buttons next to send button - The spell check and AI polish buttons appear in the input area*

> *Screenshot: Settings panel - Expandable settings in the Extensions menu with all configuration options*

> *Screenshot: Diff preview - Side-by-side comparison with highlighted changes and individual acceptance checkboxes*

> *Screenshot: Context menu - Right-click menu showing spelling suggestions and "Add to dictionary" option*

---

## Installation

### Via Extension Manager (Recommended)

1. Open SillyTavern
2. Go to **Extensions** > **Manage Extensions**
3. Click **Install Extension**
4. Enter the repository URL: `https://github.com/AndreiFlau/SillyTavern-Spellchecker-Extension`
5. Click **Install**
6. Refresh SillyTavern

### Manual Installation

1. Navigate to your SillyTavern installation directory
2. Go to `data/<your-user>/extensions/`
3. Clone or download this repository:
   ```bash
   git clone https://github.com/AndreiFlau/SillyTavern-Spellchecker-Extension.git
   ```
4. Restart SillyTavern

---

## Usage Guide

### Using Local Spell Check

1. Type your message in the input field
2. Click the spell check button (or press `Ctrl+Shift+S`)
3. View the diff preview showing detected errors
4. Accept or reject individual changes
5. Click **Accept All** to apply corrections

### Using AI Polish

1. Type your message in the input field
2. Click the AI polish button (or press `Ctrl+Shift+P`)
3. Wait for your connected AI to process the text
4. Review the suggested improvements in the diff view
5. Accept or reject changes as desired

### Managing Custom Dictionary

**Adding Words:**
- Open **Extensions** > **ST-Spellcheck** settings
- Type a word in the "Add word..." field and click **Add**
- Or right-click any flagged word and select "Add to dictionary"

**Importing Character Names:**
- Click the **Add Names** button in settings
- Automatically imports names from current character, chat participants, and World Info

**Import/Export:**
- Click **Export** to save your dictionary as JSON
- Click **Import** to load a previously exported dictionary

### Adjusting Settings

1. Go to **Extensions** panel
2. Expand **ST-Spellcheck** section
3. Configure options:
   - Toggle master enable/disable
   - Enable/disable Roleplay-Aware Mode
   - Set Correction Intensity
   - Toggle auto-check before sending

---

## Use Case Examples

### 1. Quickly Fixing Typos Before Sending

> You've typed a quick response: "I cant beleive you woudl do taht!"
>
> Click the spell check button > See 4 corrections > Accept All > Sends as "I can't believe you would do that!"

### 2. Polishing a Long Narrative Post

> You've written a paragraph of prose but want it to flow better.
>
> Click AI polish with **Heavy** intensity > AI restructures for better readability while keeping your voice

### 3. Adding Character Names to Dictionary

> Your character "Zyx'thaal" keeps getting flagged as misspelled.
>
> Open settings > Click **Add Names** > Character name automatically added

### 4. Disabling Spell Check for a Character

> Your character "Grok" speaks in broken English: "Me no understand big words!"
>
> Open settings > Click **Disable for Character** > No more false flags for Grok

### 5. Using Light Mode for Quick Checks vs Heavy Mode for Important Posts

> Quick OOC message? Use **Light** intensity - just catches typos.
>
> Writing an important character introduction? Switch to **Heavy** for full polish.

---

## Configuration Reference

| Setting | Description | Default |
|---------|-------------|---------|
| Enable ST-Spellcheck | Master toggle for the extension | Enabled |
| Roleplay-Aware Mode | Preserve stuttering, ellipses, asterisks, etc. | Enabled |
| Auto-check before sending | Automatically run spell check when sending | Disabled |
| Correction Intensity | Light / Medium / Heavy | Medium |
| Custom Dictionary | Personal list of words to ignore | Empty |
| Per-Character Settings | Enable/disable per character card | All enabled |

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+S` | Run Local Spell Check |
| `Ctrl+Shift+P` | Run AI Polish |
| `Ctrl+Z` (in input) | Undo last correction |
| `Escape` | Close diff preview popup |

---

## Slash Commands

| Command | Description |
|---------|-------------|
| `/spellcheck` | Run local spell check on current input |
| `/aipolish` | Run AI polish on current input |
| `/addword [word]` | Add a word to the dictionary |

---

## Troubleshooting

### Dictionary failed to load

**Problem:** "Spell check dictionary failed to load" error appears.

**Solution:**
- Ensure `dictionaries/pt_BR/` and `dictionaries/en_US/` each contain their `.aff` and `.dic` files
- Check browser console for specific error messages
- Try reinstalling the extension

### AI Polish not working

**Problem:** "No AI model connected" error when clicking AI polish.

**Solution:**
- Ensure you have an API configured in SillyTavern (OpenAI, Claude, local model, etc.)
- Check that the API connection is active (green status indicator)
- Verify your API key/endpoint is correct

### Roleplay patterns being flagged

**Problem:** Stuttering like "I-I" is being marked as misspelled.

**Solution:**
- Ensure **Roleplay-Aware Mode** is enabled in settings
- If a specific pattern isn't recognized, add it to your custom dictionary

### Spell check buttons not appearing

**Problem:** The buttons are not visible.

**Solution:**
- Check that the extension is enabled in **Extensions** > **Manage Extensions**
- Ensure **Enable ST-Spellcheck** is toggled on in settings
- Refresh SillyTavern

### Changes not being saved

**Problem:** Settings or dictionary words aren't persisting.

**Solution:**
- Check browser console for storage errors
- Ensure you have sufficient localStorage/IndexedDB space
- Try clearing browser cache and reconfiguring

---

## Changelog

### v2.0.0 (multi-language fork)

- Simple mode, on by default: only squiggly underlines and right-click corrections
- Can use the Windows spell checker through a small helper, falling back to the built-in dictionaries
- The local spell check button is now optional, and off by default: turn it on with **Show spell check button in the chat bar**
- Checks Brazilian Portuguese and US English at the same time
- Replaced Typo.js with Hunspell (WebAssembly): Typo.js could not finish loading the Portuguese dictionary in minutes, Hunspell loads both in under a second
- Fixed the extension failing to load at all (`lib/typo.js` had no ES export)
- Accented words are now one word; previously `você` was cut at the accent
- Words inside `*actions*` are now checked
- Right-click now works, and replaces only the word you clicked
- Apply Selected now applies only what is ticked
- Ctrl+Z is the normal undo again, and no longer discards what you typed since a correction
- Turns off the built-in spellchecker in the chat box while active, and hands it back when disabled
- Fixed the emoticon rule hiding typos before a colon or semicolon (`helo:`)
- Fixed the AI Polish system prompt being lost, and slash commands crashing startup
- Fixed menu text being invisible, and underlines drifting out of line with wrapped or scrolled text

### v1.0.0 (Initial Release)

- Two-mode spell checking: Local (Typo.js) and AI Polish
- Roleplay-aware pattern preservation
- Custom dictionary with import/export
- Diff preview with individual change acceptance
- Three correction intensity levels
- Per-character enable/disable
- Undo functionality (5 states)
- Keyboard shortcuts
- Slash commands

---

## Credits

- **[Cheesedozer](https://github.com/Cheesedozer/SillyTavern-Spellchecker-Extension)** - The original extension
- **[Hunspell](https://hunspell.github.io/)** via **[hunspell-asm](https://github.com/kwonoj/hunspell-asm)** - The spell check engine
- **[VERO](https://pt-br.libreoffice.org/projetos/projeto-vero-verificador-ortografico/)** by Raimundo Moura and team, packaged by **[wooorm/dictionaries](https://github.com/wooorm/dictionaries)** - The pt_BR dictionary
- See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for their licenses
- **[SillyTavern Team](https://github.com/SillyTavern/SillyTavern)** - For the amazing platform and extension API

---

## License

This project is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**.

See the [LICENSE](LICENSE) file for details.

This license was chosen to align with SillyTavern's licensing requirements for official extensions.

---

## Development

The engine bundle and the tests need Node.js:

```
npm install
npm test                # checks the word logic against the real dictionaries
npm run build:engine    # rebuilds lib/hunspell.bundle.js
```

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly with SillyTavern
5. Submit a pull request

---

**Made with love for the SillyTavern community**
