/**
 * ST-Spellcheck Extension for SillyTavern
 * Checks Brazilian Portuguese and US English at the same time as you type, for people
 * who switch languages mid-sentence. Roleplay-aware, with optional AI polish.
 * @version 2.0.0
 */

import { createFieldChecking, replaceTextRange } from './lib/field-checker.js';
import { createChecker, findMisspellings, findWords, normalizeApostrophes, wordsToLookUp } from './lib/spell-core.js';
import { connectWindowsEngine } from './lib/windows-engine.js';

const MODULE_NAME = 'ST-Spellcheck';
const LOG_PREFIX = `[${MODULE_NAME}]`;

// A word is accepted if any of these accepts it.
const DICTIONARIES = ['pt_BR', 'en_US'];
// Resolved from this file, so the extension works whatever its folder is called.
const EXTENSION_ROOT = new URL('./', import.meta.url);

// Extension settings defaults
const DEFAULT_SETTINGS = {
    enabled: true,
    roleplayAwareMode: true,
    correctionIntensity: 'medium', // 'light', 'medium', 'heavy'
    autoCheckBeforeSend: false,
    customDictionary: [],
    characterSettings: {}, // { characterId: { enabled: boolean } }
    showInlineHighlights: true,
    showLocalButton: false, // The underlines do this job live, so the button is optional
    simpleMode: true, // Just squiggly underlines and right-click, like a browser's spellchecker
};

// State management
let checker = null;
let engine = null; // The Windows helper's connection, or null when using the built-in dictionaries
let engineName = 'Not loaded';
let extensionSettings = null;
let isInitialized = false;
let fieldChecking = null;
let knownNames = new Set(); // Lowercase words from the names in the current chat

/**
 * Log message with extension prefix
 * @param {...any} args - Arguments to log
 */
function log(...args) {
    console.log(LOG_PREFIX, ...args);
}

/**
 * Log error with extension prefix
 * @param {...any} args - Arguments to log
 */
function logError(...args) {
    console.error(LOG_PREFIX, ...args);
}

/**
 * Initialize the extension
 */
async function init() {
    if (isInitialized) {
        log('Already initialized, skipping...');
        return;
    }

    log('Initializing extension...');

    try {
        // Verify SillyTavern is available
        if (typeof SillyTavern === 'undefined' || typeof SillyTavern.getContext !== 'function') {
            throw new Error('SillyTavern global not available. Extension may have loaded before the app.');
        }

        // Get SillyTavern context
        const context = SillyTavern.getContext();

        // Load extension settings
        await loadSettings(context);

        await initializeEngine();
        refreshKnownNames();

        // Register UI elements
        registerUI(context);

        // Register event listeners
        registerEventListeners(context);

        // Register slash commands
        registerSlashCommands(context);

        isInitialized = true;
        log('Extension initialized successfully');
    } catch (error) {
        logError('Failed to initialize extension:', error);
        showToast('ST-Spellcheck failed to initialize. Check console for details.', 'error');
    }
}

/**
 * Load extension settings from SillyTavern
 * @param {object} context - SillyTavern context
 */
async function loadSettings(context) {
    // Initialize settings in extension_settings if not present
    if (!context.extensionSettings[MODULE_NAME]) {
        context.extensionSettings[MODULE_NAME] = { ...DEFAULT_SETTINGS };
    }

    extensionSettings = context.extensionSettings[MODULE_NAME];

    // Merge any missing default settings
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (extensionSettings[key] === undefined) {
            extensionSettings[key] = DEFAULT_SETTINGS[key];
        }
    }

    log('Settings loaded:', extensionSettings);
}

/**
 * Save extension settings
 */
async function saveSettings() {
    const context = SillyTavern.getContext();
    context.extensionSettings[MODULE_NAME] = extensionSettings;
    context.saveSettingsDebounced();
    log('Settings saved');
}

/**
 * Fetch one Hunspell dictionary and load it into the engine.
 * @param {object} factory - hunspell-asm factory
 * @param {string} code - Dictionary folder and file name, such as pt_BR
 */
async function loadDictionary(factory, code) {
    const fetchBytes = async (extension) => {
        const url = new URL(`dictionaries/${code}/${code}.${extension}`, EXTENSION_ROOT);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`${url} returned ${response.status}`);
        return new Uint8Array(await response.arrayBuffer());
    };
    const [aff, dic] = await Promise.all([fetchBytes('aff'), fetchBytes('dic')]);
    return factory.create(factory.mountBuffer(aff, `${code}.aff`), factory.mountBuffer(dic, `${code}.dic`));
}

/**
 * Load the built-in dictionaries. One failing still leaves the other working, but says so.
 */
async function initializeBuiltInDictionaries() {
    try {
        const { loadModule } = await import('./lib/hunspell.bundle.js');
        const factory = await loadModule();
        const results = await Promise.allSettled(DICTIONARIES.map((code) => loadDictionary(factory, code)));
        const spellers = [];
        results.forEach((result, index) => {
            if (result.status === 'fulfilled') {
                spellers.push(result.value);
            } else {
                logError(`Failed to load ${DICTIONARIES[index]}:`, result.reason);
                showToast(`The ${DICTIONARIES[index]} dictionary failed to load, so its words will be flagged.`, 'warning');
            }
        });
        if (spellers.length > 0) {
            checker = createChecker(spellers);
            engineName = 'Built-in dictionaries';
            log(`Loaded ${spellers.length} of ${DICTIONARIES.length} dictionaries`);
        }
    } catch (error) {
        logError('Failed to start the spell check engine:', error);
        showToast('The spell check engine failed to start. Spell check is unavailable.', 'error');
    }
}

/**
 * Use the Windows spell checker when its helper is running, otherwise the built-in dictionaries.
 */
async function initializeEngine() {
    engine = await connectWindowsEngine();
    if (engine) {
        checker = createChecker(engine.spellers);
        engineName = 'Windows spell checker';
        log('Using the Windows spell checker');
    } else {
        await initializeBuiltInDictionaries();
    }
    updateEngineStatus();
}

/**
 * The helper stopped answering, so carry on with the built-in dictionaries.
 * @param {Error} error
 */
async function fallBackToBuiltIn(error) {
    logError('Lost the Windows spell checker:', error);
    engine = null;
    checker = null;
    await initializeBuiltInDictionaries();
    updateEngineStatus();
}

/**
 * Fetch what a check of this text will need. Does nothing for the built-in dictionaries.
 * @param {string} text
 */
async function prepareToCheck(text) {
    if (!engine) return;
    try {
        await engine.prepare(wordsToLookUp(text));
    } catch (error) {
        await fallBackToBuiltIn(error);
    }
}

/**
 * Get suggestions for a word, from whichever engine is active.
 * @param {string} word
 * @returns {Promise<string[]>}
 */
async function getSuggestions(word) {
    if (engine) {
        try {
            await engine.prepareSuggestions(normalizeApostrophes(word));
        } catch (error) {
            await fallBackToBuiltIn(error);
        }
    }
    return checker ? checker.suggest(word) : [];
}

/**
 * Show which engine is in use in the settings panel.
 */
function updateEngineStatus() {
    const status = document.getElementById('st-spellcheck-engine');
    if (status) status.textContent = engineName;
}

/**
 * Show toast notification
 * @param {string} message - Message to display
 * @param {string} type - Toast type: 'success', 'error', 'warning', 'info'
 */
function showToast(message, type = 'info') {
    if (typeof toastr !== 'undefined') {
        toastr[type](message, MODULE_NAME);
    } else {
        log(`[${type.toUpperCase()}]`, message);
    }
}

/**
 * Register UI elements (buttons, settings panel)
 * @param {object} context - SillyTavern context
 */
function registerUI(context) {
    // Add buttons to input area
    addSpellcheckButtons();

    // Add settings panel
    addSettingsPanel();

    log('UI registered');
}

/**
 * Add spell check buttons next to send button
 */
function addSpellcheckButtons() {
    const sendFormContainer = document.getElementById('send_form');
    if (!sendFormContainer) {
        logError('Send form container not found');
        return;
    }

    // Create button container
    const buttonContainer = document.createElement('div');
    buttonContainer.id = 'st-spellcheck-buttons';
    buttonContainer.className = 'st-spellcheck-button-container';

    // Local spell check button
    const spellCheckBtn = document.createElement('div');
    spellCheckBtn.id = 'st-spellcheck-local-btn';
    spellCheckBtn.className = 'st-spellcheck-btn interactable';
    spellCheckBtn.title = 'Local Spell Check (Ctrl+Shift+S)';
    spellCheckBtn.innerHTML = '<span class="st-spellcheck-icon fa-solid fa-spell-check"></span><span class="st-spellcheck-badge" style="display:none;">0</span>';
    spellCheckBtn.addEventListener('click', handleLocalSpellCheck);

    // AI Polish button
    const aiPolishBtn = document.createElement('div');
    aiPolishBtn.id = 'st-spellcheck-ai-btn';
    aiPolishBtn.className = 'st-spellcheck-btn interactable';
    aiPolishBtn.title = 'AI Polish (Ctrl+Shift+P)';
    aiPolishBtn.innerHTML = '<span class="st-spellcheck-icon fa-solid fa-wand-magic-sparkles"></span>';
    aiPolishBtn.addEventListener('click', handleAIPolish);

    buttonContainer.appendChild(spellCheckBtn);
    buttonContainer.appendChild(aiPolishBtn);

    // Insert before send button
    const sendButton = document.getElementById('send_but');
    if (sendButton && sendButton.parentNode) {
        sendButton.parentNode.insertBefore(buttonContainer, sendButton);
    } else {
        sendFormContainer.appendChild(buttonContainer);
    }

    updateButtonVisibility();

    // Add disabled indicator if character has spell check disabled
    updateCharacterDisabledIndicator();
}

/**
 * Add settings panel to Extensions menu
 */
function addSettingsPanel() {
    const settingsHtml = `
    <div id="st-spellcheck-settings" class="st-spellcheck-settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>ST-Spellcheck</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="st-spellcheck-setting">
                    <label class="checkbox_label">
                        <input type="checkbox" id="st-spellcheck-enabled" />
                        <span>Enable ST-Spellcheck</span>
                    </label>
                </div>

                <div class="st-spellcheck-setting">
                    <label class="checkbox_label">
                        <input type="checkbox" id="st-spellcheck-simple" />
                        <span>Simple mode</span>
                    </label>
                    <small class="st-spellcheck-hint">Works like a browser's spellchecker: squiggly underlines and right-click corrections, and nothing else.</small>
                </div>

                <div class="st-spellcheck-setting">
                    <small class="st-spellcheck-hint">Engine: <span id="st-spellcheck-engine">Not loaded</span></small>
                </div>

                <div id="st-spellcheck-advanced">
                <div class="st-spellcheck-setting">
                    <label class="checkbox_label">
                        <input type="checkbox" id="st-spellcheck-roleplay-aware" />
                        <span>Roleplay-Aware Mode</span>
                    </label>
                    <small class="st-spellcheck-hint">Ignores stuttering, ALL CAPS, drawn-out words and emoticons. Words inside *actions* are still checked.</small>
                </div>

                <div class="st-spellcheck-setting">
                    <label class="checkbox_label">
                        <input type="checkbox" id="st-spellcheck-auto-check" />
                        <span>Auto-check before sending</span>
                    </label>
                </div>

                <div class="st-spellcheck-setting">
                    <label class="checkbox_label">
                        <input type="checkbox" id="st-spellcheck-show-local-btn" />
                        <span>Show spell check button in the chat bar</span>
                    </label>
                    <small class="st-spellcheck-hint">Opens the list of corrections and shows how many errors were found. Ctrl+Shift+S and /spellcheck work without it.</small>
                </div>

                <div class="st-spellcheck-setting">
                    <label for="st-spellcheck-intensity">Correction Intensity</label>
                    <select id="st-spellcheck-intensity" class="text_pole">
                        <option value="light">Light - Typos only</option>
                        <option value="medium">Medium - Typos + basic grammar</option>
                        <option value="heavy">Heavy - Full rewrite for flow</option>
                    </select>
                </div>
                </div>

                <hr class="st-spellcheck-divider" />

                <div class="st-spellcheck-setting">
                    <label>Custom Dictionary</label>
                    <div class="st-spellcheck-dictionary-controls">
                        <input type="text" id="st-spellcheck-add-word" class="text_pole" placeholder="Add word..." />
                        <button id="st-spellcheck-add-word-btn" class="menu_button">Add</button>
                    </div>
                    <div id="st-spellcheck-dictionary-list" class="st-spellcheck-word-list"></div>
                    <div class="st-spellcheck-dictionary-actions">
                        <button id="st-spellcheck-import-dict" class="menu_button">Import</button>
                        <button id="st-spellcheck-export-dict" class="menu_button">Export</button>
                        <button id="st-spellcheck-add-names" class="menu_button" title="Add character names from current chat">Add Names</button>
                    </div>
                </div>

                <hr class="st-spellcheck-divider" />

                <div class="st-spellcheck-setting">
                    <label>Per-Character Settings</label>
                    <div id="st-spellcheck-character-toggle" class="st-spellcheck-character-toggle">
                        <span id="st-spellcheck-char-status">No character selected</span>
                        <button id="st-spellcheck-char-toggle-btn" class="menu_button" disabled>Toggle for Character</button>
                    </div>
                </div>
            </div>
        </div>
    </div>
    `;

    // Find extensions settings container
    const extensionsSettings = document.getElementById('extensions_settings');
    if (extensionsSettings) {
        extensionsSettings.insertAdjacentHTML('beforeend', settingsHtml);
        bindSettingsEvents();
        updateSettingsUI();
        updateButtonVisibility();
    } else {
        logError('Extensions settings container not found');
    }
}

/**
 * Bind event listeners to settings controls
 */
function bindSettingsEvents() {
    // Master enable toggle
    const enabledCheckbox = document.getElementById('st-spellcheck-enabled');
    if (enabledCheckbox) {
        enabledCheckbox.addEventListener('change', (e) => {
            extensionSettings.enabled = e.target.checked;
            saveSettings();
            updateButtonVisibility();
            refreshSpellcheckState();
        });
    }

    // Simple mode
    const simpleCheckbox = document.getElementById('st-spellcheck-simple');
    if (simpleCheckbox) {
        simpleCheckbox.addEventListener('change', (e) => {
            extensionSettings.simpleMode = e.target.checked;
            saveSettings();
            updateButtonVisibility();
            scheduleLiveCheck();
        });
    }

    // Roleplay-aware mode
    const roleplayCheckbox = document.getElementById('st-spellcheck-roleplay-aware');
    if (roleplayCheckbox) {
        roleplayCheckbox.addEventListener('change', (e) => {
            extensionSettings.roleplayAwareMode = e.target.checked;
            saveSettings();
            scheduleLiveCheck();
        });
    }

    // Auto-check before send
    const autoCheckCheckbox = document.getElementById('st-spellcheck-auto-check');
    if (autoCheckCheckbox) {
        autoCheckCheckbox.addEventListener('change', (e) => {
            extensionSettings.autoCheckBeforeSend = e.target.checked;
            saveSettings();
        });
    }

    // Local spell check button in the chat bar
    const showLocalButtonCheckbox = document.getElementById('st-spellcheck-show-local-btn');
    if (showLocalButtonCheckbox) {
        showLocalButtonCheckbox.addEventListener('change', (e) => {
            extensionSettings.showLocalButton = e.target.checked;
            saveSettings();
            updateButtonVisibility();
        });
    }

    // Correction intensity
    const intensitySelect = document.getElementById('st-spellcheck-intensity');
    if (intensitySelect) {
        intensitySelect.addEventListener('change', (e) => {
            extensionSettings.correctionIntensity = e.target.value;
            saveSettings();
        });
    }

    // Add word to dictionary
    const addWordBtn = document.getElementById('st-spellcheck-add-word-btn');
    const addWordInput = document.getElementById('st-spellcheck-add-word');
    if (addWordBtn && addWordInput) {
        addWordBtn.addEventListener('click', () => {
            const word = addWordInput.value.trim();
            if (word) {
                addToDictionary(word);
                addWordInput.value = '';
            }
        });
        addWordInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const word = addWordInput.value.trim();
                if (word) {
                    addToDictionary(word);
                    addWordInput.value = '';
                }
            }
        });
    }

    // Import dictionary
    const importBtn = document.getElementById('st-spellcheck-import-dict');
    if (importBtn) {
        importBtn.addEventListener('click', importDictionary);
    }

    // Export dictionary
    const exportBtn = document.getElementById('st-spellcheck-export-dict');
    if (exportBtn) {
        exportBtn.addEventListener('click', exportDictionary);
    }

    // Add character names
    const addNamesBtn = document.getElementById('st-spellcheck-add-names');
    if (addNamesBtn) {
        addNamesBtn.addEventListener('click', addCharacterNames);
    }

    // Character toggle
    const charToggleBtn = document.getElementById('st-spellcheck-char-toggle-btn');
    if (charToggleBtn) {
        charToggleBtn.addEventListener('click', () => {
            toggleCharacterSpellcheck();
            refreshSpellcheckState();
        });
    }
}

/**
 * Update settings UI to reflect current settings
 */
function updateSettingsUI() {
    const enabledCheckbox = document.getElementById('st-spellcheck-enabled');
    if (enabledCheckbox) enabledCheckbox.checked = extensionSettings.enabled;

    const simpleCheckbox = document.getElementById('st-spellcheck-simple');
    if (simpleCheckbox) simpleCheckbox.checked = extensionSettings.simpleMode;

    updateEngineStatus();

    const roleplayCheckbox = document.getElementById('st-spellcheck-roleplay-aware');
    if (roleplayCheckbox) roleplayCheckbox.checked = extensionSettings.roleplayAwareMode;

    const autoCheckCheckbox = document.getElementById('st-spellcheck-auto-check');
    if (autoCheckCheckbox) autoCheckCheckbox.checked = extensionSettings.autoCheckBeforeSend;

    const showLocalButtonCheckbox = document.getElementById('st-spellcheck-show-local-btn');
    if (showLocalButtonCheckbox) showLocalButtonCheckbox.checked = extensionSettings.showLocalButton;

    const intensitySelect = document.getElementById('st-spellcheck-intensity');
    if (intensitySelect) intensitySelect.value = extensionSettings.correctionIntensity;

    updateDictionaryList();
    updateCharacterToggleUI();
}

/**
 * Update the dictionary word list in settings
 */
function updateDictionaryList() {
    const listContainer = document.getElementById('st-spellcheck-dictionary-list');
    if (!listContainer) return;

    if (extensionSettings.customDictionary.length === 0) {
        listContainer.innerHTML = '<small class="st-spellcheck-hint">No custom words added</small>';
        return;
    }

    listContainer.innerHTML = extensionSettings.customDictionary.map(word => `
        <span class="st-spellcheck-word-tag">
            ${escapeHtml(word)}
            <span class="st-spellcheck-word-remove" data-word="${escapeHtml(word)}">&times;</span>
        </span>
    `).join('');

    // Bind remove events
    listContainer.querySelectorAll('.st-spellcheck-word-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const word = e.target.dataset.word;
            removeFromDictionary(word);
        });
    });
}

/**
 * Update button visibility based on enabled state
 */
function updateButtonVisibility() {
    const buttonContainer = document.getElementById('st-spellcheck-buttons');
    if (buttonContainer) {
        buttonContainer.style.display = extensionSettings.enabled && !extensionSettings.simpleMode ? 'flex' : 'none';
    }
    const advanced = document.getElementById('st-spellcheck-advanced');
    if (advanced) {
        advanced.style.display = extensionSettings.simpleMode ? 'none' : '';
    }
    const localButton = document.getElementById('st-spellcheck-local-btn');
    if (localButton) {
        localButton.style.display = extensionSettings.showLocalButton ? 'flex' : 'none';
    }
}

/**
 * Escape HTML to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Add word to custom dictionary
 * @param {string} word - Word to add
 */
function addToDictionary(word) {
    const normalizedWord = word.toLowerCase().trim();
    if (!normalizedWord) return;

    if (!extensionSettings.customDictionary.includes(normalizedWord)) {
        extensionSettings.customDictionary.push(normalizedWord);
        saveSettings();
        updateDictionaryList();
        scheduleLiveCheck();
        showToast(`"${word}" added to dictionary`, 'success');
    } else {
        showToast(`"${word}" is already in dictionary`, 'info');
    }
}

/**
 * Remove word from custom dictionary
 * @param {string} word - Word to remove
 */
function removeFromDictionary(word) {
    const index = extensionSettings.customDictionary.indexOf(word.toLowerCase());
    if (index > -1) {
        extensionSettings.customDictionary.splice(index, 1);
        saveSettings();
        updateDictionaryList();
        scheduleLiveCheck();
        showToast(`"${word}" removed from dictionary`, 'success');
    }
}

/**
 * Import dictionary from JSON file
 */
function importDictionary() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const data = JSON.parse(text);

            if (Array.isArray(data)) {
                const newWords = data.filter(w => typeof w === 'string' && !extensionSettings.customDictionary.includes(w.toLowerCase()));
                extensionSettings.customDictionary.push(...newWords.map(w => w.toLowerCase()));
                saveSettings();
                updateDictionaryList();
                showToast(`Imported ${newWords.length} words`, 'success');
            } else {
                throw new Error('Invalid format');
            }
        } catch (error) {
            logError('Failed to import dictionary:', error);
            showToast('Failed to import dictionary. Check file format.', 'error');
        }
    };
    input.click();
}

/**
 * Export dictionary to JSON file
 */
function exportDictionary() {
    const data = JSON.stringify(extensionSettings.customDictionary, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'st-spellcheck-dictionary.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Dictionary exported', 'success');
}

/**
 * Add character names from current chat to dictionary
 */
function addCharacterNames() {
    const context = SillyTavern.getContext();
    const names = [];

    // Get current character name
    if (context.name2) {
        names.push(context.name2);
    }

    // Get user name
    if (context.name1) {
        names.push(context.name1);
    }

    // Get names from group members if in group chat
    if (context.groups && context.groupId) {
        const group = context.groups.find(g => g.id === context.groupId);
        if (group && group.members) {
            group.members.forEach(member => {
                const char = context.characters.find(c => c.avatar === member);
                if (char && char.name) {
                    names.push(char.name);
                }
            });
        }
    }

    // Add World Info/Lorebook names if available
    if (context.worldInfo) {
        context.worldInfo.forEach(entry => {
            if (entry.key) {
                // Extract potential names from keys
                const keys = entry.key.split(',').map(k => k.trim());
                keys.forEach(key => {
                    // Only add if it looks like a name (starts with capital, reasonable length)
                    if (key.length > 1 && key.length < 30 && /^[A-Z]/.test(key)) {
                        names.push(key);
                    }
                });
            }
        });
    }

    // Deduplicate and add
    const uniqueNames = [...new Set(names.filter(n => n && n.length > 1))];
    let addedCount = 0;

    uniqueNames.forEach(name => {
        if (!extensionSettings.customDictionary.includes(name.toLowerCase())) {
            extensionSettings.customDictionary.push(name.toLowerCase());
            addedCount++;
        }
    });

    if (addedCount > 0) {
        saveSettings();
        updateDictionaryList();
        showToast(`Added ${addedCount} names to dictionary`, 'success');
    } else {
        showToast('No new names to add', 'info');
    }
}

/**
 * Update character toggle UI
 */
function updateCharacterToggleUI() {
    const context = SillyTavern.getContext();
    const statusSpan = document.getElementById('st-spellcheck-char-status');
    const toggleBtn = document.getElementById('st-spellcheck-char-toggle-btn');

    if (!statusSpan || !toggleBtn) return;

    if (context.characterId === undefined || context.characterId === null) {
        statusSpan.textContent = 'No character selected';
        toggleBtn.disabled = true;
        return;
    }

    const charName = context.name2 || 'Current character';
    const charSettings = extensionSettings.characterSettings[context.characterId];
    const isEnabled = charSettings?.enabled !== false;

    statusSpan.textContent = `${charName}: ${isEnabled ? 'Enabled' : 'Disabled'}`;
    toggleBtn.disabled = false;
    toggleBtn.textContent = isEnabled ? 'Disable for Character' : 'Enable for Character';
}

/**
 * Toggle spell check for current character
 */
function toggleCharacterSpellcheck() {
    const context = SillyTavern.getContext();
    if (context.characterId === undefined || context.characterId === null) return;

    if (!extensionSettings.characterSettings[context.characterId]) {
        extensionSettings.characterSettings[context.characterId] = { enabled: true };
    }

    extensionSettings.characterSettings[context.characterId].enabled =
        !extensionSettings.characterSettings[context.characterId].enabled;

    saveSettings();
    updateCharacterToggleUI();
    updateCharacterDisabledIndicator();

    const isEnabled = extensionSettings.characterSettings[context.characterId].enabled;
    showToast(`Spell check ${isEnabled ? 'enabled' : 'disabled'} for ${context.name2}`, 'success');
}

/**
 * Update visual indicator when spell check is disabled for character
 */
function updateCharacterDisabledIndicator() {
    const context = SillyTavern.getContext();
    const buttonContainer = document.getElementById('st-spellcheck-buttons');
    if (!buttonContainer) return;

    const isDisabled = !isSpellcheckEnabledForCharacter();

    buttonContainer.classList.toggle('st-spellcheck-char-disabled', isDisabled);
}

/**
 * Check if spell check is enabled for current character
 * @returns {boolean}
 */
function isSpellcheckEnabledForCharacter() {
    const context = SillyTavern.getContext();
    if (context.characterId === undefined || context.characterId === null) return true;

    const charSettings = extensionSettings.characterSettings[context.characterId];
    return charSettings?.enabled !== false;
}

/**
 * Whether spell check is on at all. The app's own Spellcheck setting turns this off too.
 */
function isSpellcheckOn() {
    const appSetting = SillyTavern.getContext().powerUserSettings?.spellcheck_enabled !== false;
    return Boolean(extensionSettings?.enabled && checker && appSetting);
}

/**
 * Check every field already in use again, after something that changes the results.
 */
function scheduleLiveCheck() {
    fieldChecking?.refreshAll();
}

/**
 * Apply the on/off state. The browser's own spellchecker only knows one language, so it has to
 * be off across the app while this one is on, or English gets flagged in every other box.
 */
function refreshSpellcheckState() {
    const appSetting = SillyTavern.getContext().powerUserSettings?.spellcheck_enabled !== false;
    document.body.spellcheck = isSpellcheckOn() ? false : appSetting;
    scheduleLiveCheck();
}

/**
 * Start checking fields as they get focus, beginning with the chat box.
 */
function startFieldChecking() {
    fieldChecking = createFieldChecking({
        isActive: (field) => {
            if (!isSpellcheckOn() || !extensionSettings.showInlineHighlights) return false;
            // The per-character switch is about chatting, so it only covers the chat itself
            const inChat = field.isChatBox || field.element.closest('#chat');
            return !inChat || isSpellcheckEnabledForCharacter();
        },
        prepare: prepareToCheck,
        findMisspellings: (text, caret) => performLocalSpellCheck(text, { caret }).misspellings,
        onChecked: (field) => {
            if (field.isChatBox) updateBadge(field.misspellings.length);
        },
    });

    const chatBox = document.getElementById('send_textarea');
    if (chatBox) {
        chatBox.removeAttribute('spellcheck');
        fieldChecking.attach(chatBox);
    } else {
        logError('send_textarea not found');
    }
    refreshSpellcheckState();

    // The app's handler for its own Spellcheck setting turns the browser's spellchecker back on
    document.getElementById('spellcheck_enabled')?.addEventListener('input', refreshSpellcheckState);
}

/**
 * Collect the names in the current chat, which no dictionary will know.
 */
function refreshKnownNames() {
    const context = SillyTavern.getContext();
    const names = [context.name1, context.name2];
    const group = context.groupId ? context.groups?.find((g) => g.id === context.groupId) : null;
    for (const avatar of group?.members ?? []) {
        names.push(context.characters?.find((c) => c.avatar === avatar)?.name);
    }
    knownNames = new Set(
        names.filter(Boolean).flatMap((name) => findWords(name).map(({ word }) => word.toLowerCase())),
    );
}

/**
 * Register event listeners
 * @param {object} context - SillyTavern context
 */
function registerEventListeners(context) {
    // Listen for character change
    if (context.eventSource) {
        context.eventSource.on(context.eventTypes.CHAT_CHANGED, () => {
            updateCharacterToggleUI();
            updateCharacterDisabledIndicator();
            refreshKnownNames();
            refreshSpellcheckState();
        });

        // Auto-check before send if enabled
        context.eventSource.on(context.eventTypes.MESSAGE_SENDING, async (data) => {
            if (extensionSettings.autoCheckBeforeSend && extensionSettings.enabled && isSpellcheckEnabledForCharacter()) {
                // Only do local spell check for auto-check, not AI polish
                const textArea = document.getElementById('send_textarea');
                if (textArea && textArea.value.trim()) {
                    await prepareToCheck(textArea.value);
                    const result = performLocalSpellCheck(textArea.value);
                    if (result.misspellings.length > 0) {
                        // Show notification but don't block
                        showToast(`Found ${result.misspellings.length} potential misspellings`, 'warning');
                    }
                }
            }
        });
    }

    startFieldChecking();

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Ctrl+Shift+S for local spell check
        if (e.ctrlKey && e.shiftKey && e.key === 'S') {
            e.preventDefault();
            handleLocalSpellCheck();
        }
        // Ctrl+Shift+P for AI polish
        if (e.ctrlKey && e.shiftKey && e.key === 'P') {
            e.preventDefault();
            handleAIPolish();
        }
    });

    // Context menu for adding words to dictionary
    document.addEventListener('contextmenu', handleContextMenu);
}

/**
 * Register slash commands
 * @param {object} context - SillyTavern context
 */
function registerSlashCommands(context) {
    if (context.SlashCommandParser && context.SlashCommand) {
        // /spellcheck command
        context.SlashCommandParser.addCommandObject(context.SlashCommand.fromProps({
            name: 'spellcheck',
            callback: async (args, value) => {
                await handleLocalSpellCheck();
                return '';
            },
            helpString: 'Run local spell check on the current input',
        }));

        // /aipolish command
        context.SlashCommandParser.addCommandObject(context.SlashCommand.fromProps({
            name: 'aipolish',
            callback: async (args, value) => {
                await handleAIPolish();
                return '';
            },
            helpString: 'Run AI polish on the current input',
        }));

        // /addword command
        context.SlashCommandParser.addCommandObject(context.SlashCommand.fromProps({
            name: 'addword',
            callback: (args, value) => {
                if (value) {
                    addToDictionary(value);
                }
                return '';
            },
            helpString: 'Add a word to the spell check dictionary',
        }));
    }
}

/**
 * Handle context menu for adding words to dictionary
 * @param {Event} e - Context menu event
 */
function handleContextMenu(e) {
    const field = fieldChecking?.fieldFor(e.target);
    if (!field) return;

    const misspelling = field.misspellingAt(e.clientX, e.clientY);
    if (misspelling) {
        e.preventDefault();
        showWordContextMenu(e, misspelling);
    }
}

/**
 * Show context menu for a misspelled word
 * @param {Event} e - Mouse event
 * @param {object} misspelling - The misspelled word and where it is
 */
async function showWordContextMenu(e, misspelling) {
    const { word } = misspelling;
    // Remove any existing context menu
    const existingMenu = document.querySelector('.st-spellcheck-context-menu');
    if (existingMenu) existingMenu.remove();

    // Get suggestions
    const suggestions = await getSuggestions(word);

    const menu = document.createElement('div');
    menu.className = 'st-spellcheck-context-menu';
    menu.style.left = `${e.pageX}px`;
    menu.style.top = `${e.pageY}px`;

    let menuHtml = '';

    // Suggestions
    if (suggestions.length > 0) {
        suggestions.forEach(suggestion => {
            menuHtml += `<div class="st-spellcheck-menu-item st-spellcheck-suggestion" data-suggestion="${escapeHtml(suggestion)}">${escapeHtml(suggestion)}</div>`;
        });
        menuHtml += '<div class="st-spellcheck-menu-divider"></div>';
    }

    // Add to dictionary option
    menuHtml += `<div class="st-spellcheck-menu-item st-spellcheck-add-dict" data-word="${escapeHtml(word)}">Add "${escapeHtml(word)}" to dictionary</div>`;

    menu.innerHTML = menuHtml;

    // Bind events
    menu.querySelectorAll('.st-spellcheck-suggestion').forEach(item => {
        item.addEventListener('click', () => {
            applySuggestion(e.target, misspelling, item.dataset.suggestion);
            menu.remove();
        });
    });

    menu.querySelector('.st-spellcheck-add-dict').addEventListener('click', () => {
        addToDictionary(word);
        menu.remove();
    });

    // Inside an open dialog, or the dialog would cover it: dialogs sit above the rest of the page
    (e.target.closest('dialog') ?? document.body).appendChild(menu);

    // The chat box sits at the bottom of the window, so open upward when there is no room below
    const { width, height } = menu.getBoundingClientRect();
    // Either way, keep clear of the line that was clicked so the word stays readable
    const lineHeight = parseFloat(window.getComputedStyle(e.target).lineHeight) || 20;
    const below = e.clientY + lineHeight * 0.75;
    if (below + height > window.innerHeight) {
        menu.style.top = `${Math.max(0, e.clientY - height - lineHeight)}px`;
    } else {
        menu.style.top = `${below}px`;
    }
    if (e.clientX + width > window.innerWidth) {
        menu.style.left = `${Math.max(0, e.pageX - width)}px`;
    }

    // Close menu when clicking elsewhere
    const closeMenu = (e) => {
        if (!menu.contains(e.target)) {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

/**
 * Apply a spelling suggestion
 * @param {Element} target - The field the word is in, or an element inside it
 * @param {object} misspelling - The misspelled word and where it is
 * @param {string} suggestion - Suggested replacement
 */
function applySuggestion(target, misspelling, suggestion) {
    const field = fieldChecking?.fieldFor(target);
    if (!field?.replace(misspelling, suggestion)) {
        showToast('The text changed, so the suggestion was not applied.', 'info');
        field?.schedule();
    }
}

/**
 * Handle local spell check button click
 */
async function handleLocalSpellCheck() {
    if (!extensionSettings.enabled) {
        showToast('ST-Spellcheck is disabled', 'warning');
        return;
    }

    if (!isSpellcheckEnabledForCharacter()) {
        showToast('Spell check is disabled for this character', 'info');
        return;
    }

    if (!checker) {
        showToast('Dictionary not loaded. Cannot perform spell check.', 'error');
        return;
    }

    const textArea = document.getElementById('send_textarea');
    if (!textArea || !textArea.value.trim()) {
        showToast('No text to check', 'info');
        return;
    }

    log('Running local spell check...');
    await prepareToCheck(textArea.value);
    const result = performLocalSpellCheck(textArea.value);

    if (result.misspellings.length === 0) {
        showToast('No spelling errors found!', 'success');
        updateBadge(0);
        return;
    }

    // Update badge
    updateBadge(result.misspellings.length);

    // Suggestions are slower than checking, so they are only worked out here and on right-click
    for (const misspelling of result.misspellings) {
        misspelling.suggestions = await getSuggestions(misspelling.word);
    }

    // Show diff preview
    await showSpellCheckPreview(textArea.value, result);
}

/**
 * Perform local spell check on text
 * @param {string} text - Text to check
 * @param {object} [options]
 * @param {number|null} [options.caret] - Offset of a word still being typed, to skip
 * @returns {{misspellings: {word: string, start: number, end: number}[]}} What was found
 */
function performLocalSpellCheck(text, { caret = null } = {}) {
    // Simple mode flags what a browser would: no roleplay exceptions, and names are not special
    const { simpleMode } = extensionSettings;
    const misspellings = findMisspellings(text, checker, {
        roleplayAware: !simpleMode && extensionSettings.roleplayAwareMode,
        knownWords: new Set(simpleMode ? extensionSettings.customDictionary : [...extensionSettings.customDictionary, ...knownNames]),
        caret,
    });
    return { misspellings };
}

/**
 * Update the badge on the spell check button
 * @param {number} count - Number of errors
 */
function updateBadge(count) {
    const badge = document.querySelector('#st-spellcheck-local-btn .st-spellcheck-badge');
    if (badge) {
        badge.textContent = count;
        badge.style.display = count > 0 ? 'inline' : 'none';
    }
}

/**
 * Show spell check preview popup with diff view
 * @param {string} originalText - Original text
 * @param {object} result - Spell check result
 */
async function showSpellCheckPreview(originalText, result) {
    const { misspellings } = result;

    // Build suggested text with auto-corrections
    let suggestedText = originalText;
    const changes = [];

    // Sort misspellings by position (descending) to replace from end
    const sortedMisspellings = [...misspellings].sort((a, b) => b.start - a.start);

    sortedMisspellings.forEach(m => {
        if (m.suggestions.length > 0) {
            const before = suggestedText.substring(0, m.start);
            const after = suggestedText.substring(m.end);
            suggestedText = before + m.suggestions[0] + after;

            changes.push({
                original: m.word,
                suggested: m.suggestions[0],
                start: m.start,
                accepted: true,
            });
        }
    });

    if (changes.length === 0) {
        showToast(`Found ${misspellings.length} unknown word(s), but no suggestions for them.`, 'info');
        return;
    }

    // Show preview popup
    const popupHtml = createDiffPopupHtml(originalText, suggestedText, changes.reverse(), 'Local Spell Check');
    await showDiffPopup(popupHtml, originalText, suggestedText, changes);
}

/**
 * Handle AI Polish button click
 */
async function handleAIPolish() {
    if (!extensionSettings.enabled) {
        showToast('ST-Spellcheck is disabled', 'warning');
        return;
    }

    if (!isSpellcheckEnabledForCharacter()) {
        showToast('Spell check is disabled for this character', 'info');
        return;
    }

    const textArea = document.getElementById('send_textarea');
    if (!textArea || !textArea.value.trim()) {
        showToast('No text to polish', 'info');
        return;
    }

    const context = SillyTavern.getContext();

    // Check if there's a connected model
    if (!context.onlineStatus || context.onlineStatus === 'no_connection') {
        showToast('No AI model connected. Please connect to an API first.', 'error');
        return;
    }

    log('Running AI polish...');
    showToast('Polishing text with AI...', 'info');

    try {
        const originalText = textArea.value;
        const polishedText = await performAIPolish(originalText, context);

        if (polishedText && polishedText !== originalText) {
            // Calculate changes for diff view
            const changes = calculateTextChanges(originalText, polishedText);
            const popupHtml = createDiffPopupHtml(originalText, polishedText, changes, 'AI Polish');
            await showDiffPopup(popupHtml, originalText, polishedText, changes);
        } else if (polishedText === originalText) {
            showToast('Text looks great! No changes needed.', 'success');
        }
    } catch (error) {
        logError('AI Polish failed:', error);
        showToast('AI Polish failed. Check console for details.', 'error');
    }
}

/**
 * Perform AI polish using SillyTavern's API
 * @param {string} text - Text to polish
 * @param {object} context - SillyTavern context
 * @returns {Promise<string>} Polished text
 */
async function performAIPolish(text, context) {
    const intensity = extensionSettings.correctionIntensity.toUpperCase();

    const systemPrompt = `You are a writing assistant. Improve the grammar, punctuation, and flow of the following text while preserving:
- The author's voice and style
- All roleplay conventions (stuttering like "I-I", ellipses "...", action asterisks *like this*, tildes for drawn speech "word~", emphasis through repeated letters)
- Character-specific speech patterns
- Intentional stylistic choices
- ALL CAPS for shouting or emphasis
- The language of each passage. The text may switch languages midway; never translate it.

Return ONLY the corrected text with no explanations, commentary, or markdown formatting.
Correction intensity: ${intensity}
${intensity === 'LIGHT' ? '- Only fix obvious typos and misspellings' : ''}
${intensity === 'MEDIUM' ? '- Fix typos, basic grammar, missing periods, and capitalization' : ''}
${intensity === 'HEAVY' ? '- Full rewrite for improved flow and clarity while preserving meaning' : ''}`;

    if (typeof context.generateRaw === 'function') {
        const result = await context.generateRaw({ prompt: text, systemPrompt });
        return result.trim();
    }

    throw new Error('No generation function available');
}

/**
 * Calculate text changes between original and modified text
 * @param {string} original - Original text
 * @param {string} modified - Modified text
 * @returns {Array} Array of changes
 */
function calculateTextChanges(original, modified) {
    // Simple word-based diff
    const originalWords = original.split(/(\s+)/);
    const modifiedWords = modified.split(/(\s+)/);
    const changes = [];

    // Use LCS-based diff for better results
    const diff = diffArrays(originalWords, modifiedWords);

    diff.forEach(part => {
        if (part.added || part.removed) {
            changes.push({
                original: part.removed ? part.value.join('') : '',
                suggested: part.added ? part.value.join('') : '',
                type: part.added ? 'addition' : 'removal',
                accepted: true,
            });
        }
    });

    return changes;
}

/**
 * Simple array diff using LCS algorithm
 * @param {Array} a - First array
 * @param {Array} b - Second array
 * @returns {Array} Diff result
 */
function diffArrays(a, b) {
    const result = [];
    let i = 0, j = 0;

    while (i < a.length || j < b.length) {
        if (i >= a.length) {
            result.push({ added: true, value: b.slice(j) });
            break;
        }
        if (j >= b.length) {
            result.push({ removed: true, value: a.slice(i) });
            break;
        }

        if (a[i] === b[j]) {
            result.push({ value: [a[i]] });
            i++;
            j++;
        } else {
            // Look ahead to find matches
            let foundInB = b.indexOf(a[i], j);
            let foundInA = a.indexOf(b[j], i);

            if (foundInB === -1 && foundInA === -1) {
                result.push({ removed: true, value: [a[i]] });
                result.push({ added: true, value: [b[j]] });
                i++;
                j++;
            } else if (foundInB === -1 || (foundInA !== -1 && foundInA - i < foundInB - j)) {
                result.push({ added: true, value: [b[j]] });
                j++;
            } else {
                result.push({ removed: true, value: [a[i]] });
                i++;
            }
        }
    }

    return result;
}

/**
 * Create HTML for diff popup
 * @param {string} original - Original text
 * @param {string} suggested - Suggested text
 * @param {Array} changes - Array of changes
 * @param {string} title - Popup title
 * @returns {string} HTML string
 */
function createDiffPopupHtml(original, suggested, changes, title) {
    const hasChanges = changes.length > 0;

    return `
    <div class="st-spellcheck-diff-popup">
        <div class="st-spellcheck-diff-header">
            <h3>${title} Preview</h3>
            <span class="st-spellcheck-change-count">${changes.length} change${changes.length !== 1 ? 's' : ''}</span>
        </div>

        <div class="st-spellcheck-diff-container">
            <div class="st-spellcheck-diff-panel">
                <div class="st-spellcheck-diff-label">Original</div>
                <div class="st-spellcheck-diff-content st-spellcheck-original">${escapeHtml(original)}</div>
            </div>
            <div class="st-spellcheck-diff-panel">
                <div class="st-spellcheck-diff-label">Corrected</div>
                <div class="st-spellcheck-diff-content st-spellcheck-corrected">${createHighlightedDiff(original, suggested)}</div>
            </div>
        </div>

        ${hasChanges ? `
        <div class="st-spellcheck-changes-list">
            <div class="st-spellcheck-changes-header">Individual Changes</div>
            ${changes.map((change, idx) => `
                <label class="st-spellcheck-change-item">
                    <input type="checkbox" class="st-spellcheck-change-checkbox" data-index="${idx}" checked />
                    <span class="st-spellcheck-change-original">${escapeHtml(change.original) || '(none)'}</span>
                    <span class="st-spellcheck-change-arrow">→</span>
                    <span class="st-spellcheck-change-suggested">${escapeHtml(change.suggested) || '(removed)'}</span>
                </label>
            `).join('')}
        </div>
        ` : ''}

        <div class="st-spellcheck-diff-actions">
            ${hasChanges ? `
            <button class="menu_button st-spellcheck-accept-all">Accept All</button>
            <button class="menu_button st-spellcheck-reject-all">Reject All</button>
            <button class="menu_button st-spellcheck-apply-selected">Apply Selected</button>
            ` : ''}
            <button class="menu_button st-spellcheck-cancel">Close</button>
        </div>
    </div>
    `;
}

/**
 * Create highlighted diff HTML
 * @param {string} original - Original text
 * @param {string} suggested - Suggested text
 * @returns {string} HTML with highlights
 */
function createHighlightedDiff(original, suggested) {
    // Simple word-based highlighting
    const origWords = original.split(/(\s+)/);
    const suggWords = suggested.split(/(\s+)/);
    let result = '';
    let i = 0, j = 0;

    while (i < origWords.length || j < suggWords.length) {
        if (i >= origWords.length) {
            result += `<span class="st-spellcheck-diff-added">${escapeHtml(suggWords.slice(j).join(''))}</span>`;
            break;
        }
        if (j >= suggWords.length) {
            break;
        }

        if (origWords[i] === suggWords[j]) {
            result += escapeHtml(suggWords[j]);
            i++;
            j++;
        } else if (origWords[i].match(/^\s+$/) && suggWords[j].match(/^\s+$/)) {
            result += suggWords[j];
            i++;
            j++;
        } else {
            // Check if it's a modification
            const nextOrigMatch = suggWords.indexOf(origWords[i], j);
            const nextSuggMatch = origWords.indexOf(suggWords[j], i);

            if (nextOrigMatch === j + 1 || (nextSuggMatch === -1 && nextOrigMatch !== -1)) {
                // Added word
                result += `<span class="st-spellcheck-diff-added">${escapeHtml(suggWords[j])}</span>`;
                j++;
            } else if (nextSuggMatch === i + 1 || nextOrigMatch === -1) {
                // Removed word (skip in output but could mark)
                i++;
            } else {
                // Modified word
                result += `<span class="st-spellcheck-diff-modified">${escapeHtml(suggWords[j])}</span>`;
                i++;
                j++;
            }
        }
    }

    return result;
}

/**
 * Show diff popup and handle user interactions
 * @param {string} html - Popup HTML
 * @param {string} originalText - Original text
 * @param {string} suggestedText - Suggested text
 * @param {Array} changes - Array of changes
 */
async function showDiffPopup(html, originalText, suggestedText, changes) {
    return new Promise((resolve) => {
        // Create popup overlay
        const overlay = document.createElement('div');
        overlay.className = 'st-spellcheck-overlay';
        overlay.innerHTML = html;
        document.body.appendChild(overlay);

        const textArea = document.getElementById('send_textarea');

        // Bind button events
        const acceptAll = overlay.querySelector('.st-spellcheck-accept-all');
        const rejectAll = overlay.querySelector('.st-spellcheck-reject-all');
        const applySelected = overlay.querySelector('.st-spellcheck-apply-selected');
        const cancel = overlay.querySelector('.st-spellcheck-cancel');

        if (acceptAll) {
            acceptAll.addEventListener('click', () => {
                replaceTextRange(textArea, 0, textArea.value.length, suggestedText);
                showToast(`${changes.length} corrections applied`, 'success');
                overlay.remove();
                resolve(true);
            });
        }

        if (rejectAll) {
            rejectAll.addEventListener('click', () => {
                showToast('All changes rejected', 'info');
                overlay.remove();
                resolve(false);
            });
        }

        if (applySelected) {
            applySelected.addEventListener('click', () => {
                const checkboxes = overlay.querySelectorAll('.st-spellcheck-change-checkbox');
                const selected = changes.filter((_, index) => checkboxes[index]?.checked);

                if (selected.length === 0) {
                    showToast('No changes selected', 'info');
                    overlay.remove();
                    resolve(false);
                    return;
                }

                let appliedText = suggestedText;
                if (selected.length < changes.length) {
                    // AI polish changes come from a diff and have no positions to apply one by one
                    if (selected.some((change) => typeof change.start !== 'number')) {
                        showToast('AI changes can only be accepted together. Use Accept All or Cancel.', 'info');
                        return;
                    }
                    // From the end backward, so earlier offsets stay valid
                    appliedText = [...selected].sort((a, b) => b.start - a.start).reduce((text, change) => (
                        text.slice(0, change.start) + change.suggested + text.slice(change.start + change.original.length)
                    ), originalText);
                }

                replaceTextRange(textArea, 0, textArea.value.length, appliedText);
                showToast(`${selected.length} corrections applied`, 'success');
                overlay.remove();
                resolve(true);
            });
        }

        if (cancel) {
            cancel.addEventListener('click', () => {
                overlay.remove();
                resolve(false);
            });
        }

        // Close on overlay click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.remove();
                resolve(false);
            }
        });

        // Close on Escape
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                overlay.remove();
                document.removeEventListener('keydown', escHandler);
                resolve(false);
            }
        };
        document.addEventListener('keydown', escHandler);
    });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// Export for potential external use
export {
    MODULE_NAME,
    performLocalSpellCheck,
    addToDictionary,
    removeFromDictionary,
};
