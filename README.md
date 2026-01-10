# ST-Spellcheck

**A lightweight, on-demand spelling and grammar checking tool for roleplay and creative writing in SillyTavern.**

```
   _____ _______    _____            _ _      _               _
  / ____|__   __|  / ____|          | | |    | |             | |
 | (___    | |____| (___  _ __   ___| | | ___| |__   ___  ___| | __
  \___ \   | |____|\___ \| '_ \ / _ \ | |/ __| '_ \ / _ \/ __| |/ /
  ____) |  | |     ____) | |_) |  __/ | | (__| | | |  __/ (__|   <
 |_____/   |_|    |_____/| .__/ \___|_|_|\___|_| |_|\___|\___|_|\_\
                         | |
                         |_|    v1.0.0 for SillyTavern 1.12.0+
```

---

## Features

### Two-Mode Spell Checking System

- **Local Spell Check** - Instant, offline spell checking using Typo.js with Hunspell dictionaries
  - Zero latency, works without internet
  - Detects misspellings with intelligent suggestions
  - Right-click to see corrections or add words to dictionary

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
| Action asterisks | *sighs heavily* | Yes |
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

### Undo Functionality

- Stores last 5 text states
- "Undo" restores previous version
- Keyboard shortcut: `Ctrl+Z` in input field

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
4. Enter the repository URL: `https://github.com/SillyTavern/ST-Spellcheck`
5. Click **Install**
6. Refresh SillyTavern

### Manual Installation

1. Navigate to your SillyTavern installation directory
2. Go to `data/<your-user>/extensions/`
3. Clone or download this repository:
   ```bash
   git clone https://github.com/SillyTavern/ST-Spellcheck.git
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
- Ensure the `dictionaries/en_US/` folder contains `en_US.aff` and `en_US.dic` files
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

- **[Typo.js](https://github.com/cfinke/Typo.js)** by Christopher Finke - Hunspell dictionary spell checking
- **[Hunspell Dictionaries](https://hunspell.github.io/)** - en_US dictionary files
- **[SillyTavern Team](https://github.com/SillyTavern/SillyTavern)** - For the amazing platform and extension API

---

## License

This project is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**.

See the [LICENSE](LICENSE) file for details.

This license was chosen to align with SillyTavern's licensing requirements for official extensions.

---

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly with SillyTavern
5. Submit a pull request

---

**Made with love for the SillyTavern community**
