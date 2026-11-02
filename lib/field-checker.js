/**
 * Puts spell check underlines on text areas throughout the app.
 *
 * There are two kinds of field. A text area cannot style part of its own text, so each one gets
 * an invisible copy of its text placed exactly over it, with only the underlines showing. The
 * app's rich prompt editors (CodeMirror) redraw their own contents constantly, so those are never
 * touched: the browser's Custom Highlight API paints the underlines over their text instead.
 *
 * Fields are picked up when first focused, as there are over a hundred and most stay hidden.
 */

// Text areas holding code, settings or token lists, where underlines would only be noise.
const TECHNICAL_FIELD = new RegExp([
    'css', 'json', 'schema', 'grammar', 'regex', 'banned', 'negative', 'stopping', 'sequence',
    'prefix', 'suffix', 'separator', 'breaker', 'blacklist', 'token', 'script', 'template',
    'story_string', 'qr--', 'keyprimary', 'keysecondary', 'select2', 'search', 'instruct_',
    'context_example', 'context_chat', 'sd_', 'tt-gp-', 'tags_textarea', 'creator_textarea',
    'character_version', 'delimiter',
].join('|'), 'i');

// The app sets spellcheck="false" on code editors, which is respected. This one copies the value
// from the chat box, so its attribute says nothing about what it holds.
const COPIES_SPELLCHECK_ATTRIBUTE = 'tt-chat-input-editor__textarea';

const CHAT_BOX_ID = 'send_textarea';
const OVERLAY_ID = 'st-spellcheck-highlight-overlay'; // The chat box's overlay
const OVERLAY_CLASS = 'st-spellcheck-highlight-overlay';
const MISSPELLED_CLASS = 'st-spellcheck-misspelled';
const WATCH_INTERVAL_MS = 300;
const MAX_CHECKED_LENGTH = 200000;
const COPIED_STYLES = [
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch', 'fontKerning', 'fontVariant',
    'lineHeight', 'letterSpacing', 'wordSpacing', 'textIndent', 'textTransform', 'textAlign', 'direction',
    'whiteSpace', 'wordBreak', 'overflowWrap', 'tabSize', 'boxSizing',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
];
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
const EDITOR_WRAPPER = '.tt-codemirror-editor';
const EDITOR_CONTENT = '.cm-content';
const EDITOR_LINE = '.cm-line';
const HIGHLIGHT_NAME = 'st-spellcheck-misspelled'; // Styled by ::highlight() in style.css

function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Whether a field should be checked: prose text areas the user can edit.
 * @param {Element} element
 */
export function isCheckableField(element) {
    if (element?.tagName !== 'TEXTAREA' || element.readOnly || element.disabled) return false;
    if (element.id === CHAT_BOX_ID || element.classList.contains(COPIES_SPELLCHECK_ATTRIBUTE)) return true;
    if (element.getAttribute('spellcheck') === 'false') return false;
    return !TECHNICAL_FIELD.test(`${element.id} ${element.className} ${element.getAttribute('name') ?? ''}`);
}

/**
 * Replace part of a text area the way typing would: it stays on the normal Ctrl+Z history, and
 * the app and this extension both see the change.
 * @param {HTMLTextAreaElement} textArea
 * @param {number} start
 * @param {number} end
 * @param {string} text
 */
export function replaceTextRange(textArea, start, end, text) {
    textArea.focus();
    textArea.setSelectionRange(start, end);
    if (!document.execCommand('insertText', false, text)) {
        textArea.setRangeText(text, start, end, 'end');
        textArea.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

class Field {
    /**
     * @param {HTMLTextAreaElement} element
     * @param {object} hooks - See createFieldChecking
     */
    constructor(element, hooks) {
        this.element = element;
        this.hooks = hooks;
        this.misspellings = [];
        this.typingCaret = null; // Where the caret was after the last edit, while typing there
        this.lastCheckedValue = null;
        this.generation = 0; // Lets a slow check notice that a newer one has replaced it
        this.timer = null;

        this.overlay = document.createElement('div');
        this.overlay.className = OVERLAY_CLASS;
        if (element.id === CHAT_BOX_ID) this.overlay.id = OVERLAY_ID;
        this.overlay.setAttribute('aria-hidden', 'true');
        element.parentElement.insertBefore(this.overlay, element);

        this.resizeObserver = new ResizeObserver(() => this.syncLayout());
        this.resizeObserver.observe(element);
        this.syncLayout();
    }

    get isChatBox() {
        return this.element.id === CHAT_BOX_ID;
    }

    dispose() {
        clearTimeout(this.timer);
        this.generation++;
        this.resizeObserver.disconnect();
        this.overlay.remove();
    }

    /** Keep the overlay exactly over the field, with its text laid out the same way. */
    syncLayout() {
        const { element, overlay } = this;
        const hidden = element.offsetParent === null && window.getComputedStyle(element).position !== 'fixed';
        overlay.style.display = hidden ? 'none' : '';
        if (hidden) return;

        const styles = window.getComputedStyle(element);
        for (const property of COPIED_STYLES) overlay.style[property] = styles[property];
        for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
            overlay.style[`border${side}`] = `${styles[`border${side}Width`]} solid transparent`;
        }

        // offsetTop and friends round to whole pixels, and a fraction is enough to change where text wraps
        const box = element.getBoundingClientRect();
        const parent = overlay.offsetParent;
        const parentBox = parent?.getBoundingClientRect() ?? { top: 0, left: 0 };
        overlay.style.top = `${box.top - parentBox.top - (parent?.clientTop ?? 0) + (parent?.scrollTop ?? 0)}px`;
        overlay.style.left = `${box.left - parentBox.left - (parent?.clientLeft ?? 0) + (parent?.scrollLeft ?? 0)}px`;
        // A scrollbar narrows the field's text but not the overlay's, so leave its width out
        const scrollbarWidth = element.offsetWidth - element.clientWidth
            - parseFloat(styles.borderLeftWidth) - parseFloat(styles.borderRightWidth);
        overlay.style.width = `${box.width - scrollbarWidth}px`;
        overlay.style.height = `${box.height}px`;
        this.syncScroll();
    }

    syncScroll() {
        this.overlay.scrollTop = this.element.scrollTop;
        this.overlay.scrollLeft = this.element.scrollLeft;
    }

    /** Check soon. Typing and the caret moving in one tick collapse into one check. */
    schedule() {
        if (this.timer !== null) return;
        this.timer = setTimeout(() => {
            this.timer = null;
            this.check();
        }, 0);
    }

    async check() {
        const { element, hooks } = this;
        const generation = ++this.generation;
        const text = element.value;
        this.lastCheckedValue = text;

        if (!hooks.isActive(this) || text.length > MAX_CHECKED_LENGTH || !text.trim()) {
            this.misspellings = [];
            this.render('');
            hooks.onChecked(this);
            return;
        }

        await hooks.prepare(text);
        // Typing while that was waiting has already scheduled a newer check
        if (generation !== this.generation || element.value !== text) return;

        // Leave a word alone while it is being typed. Only typing counts: clicking into a flagged
        // word must not hide its underline, or a right-click would remove what it is aiming at.
        const isTyping = document.activeElement === element && element.selectionStart === this.typingCaret;
        if (!isTyping) this.typingCaret = null;
        this.misspellings = hooks.findMisspellings(text, isTyping ? this.typingCaret : null);
        this.syncLayout();
        this.render(text);
        hooks.onChecked(this);
    }

    render(text) {
        const { overlay, misspellings } = this;
        if (!text || misspellings.length === 0) {
            overlay.innerHTML = '';
            return;
        }
        let html = '';
        let lastIndex = 0;
        misspellings.forEach((misspelling, index) => {
            html += escapeHtml(text.substring(lastIndex, misspelling.start));
            html += `<span class="${MISSPELLED_CLASS}" data-index="${index}">${escapeHtml(misspelling.word)}</span>`;
            lastIndex = misspelling.end;
        });
        // The zero-width space gives a trailing newline a line to occupy, as a text area does
        overlay.innerHTML = html + escapeHtml(text.substring(lastIndex)) + ZERO_WIDTH_SPACE;
        this.syncScroll();
    }

    /** Catch what raises no event: moved by other content, shown, hidden, or value set directly. */
    watch() {
        this.syncLayout();
        if (this.element.value !== this.lastCheckedValue) this.schedule();
    }

    /**
     * Swap a misspelled word for a suggestion.
     * @returns {boolean} False if the text has changed since the word was found
     */
    replace(misspelling, suggestion) {
        const { word, start, end } = misspelling;
        if (this.element.value.slice(start, end) !== word) return false;
        replaceTextRange(this.element, start, end, suggestion);
        return true;
    }

    /** The underlined word at a point on screen, found by position as clicks pass through the overlay. */
    misspellingAt(x, y) {
        for (const span of this.overlay.querySelectorAll(`.${MISSPELLED_CLASS}`)) {
            for (const rect of span.getClientRects()) {
                if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
                    return this.misspellings[Number(span.dataset.index)];
                }
            }
        }
        return undefined;
    }
}

/** All the rich editors' underlines, as the browser takes one set per highlight name. */
const editorHighlights = new Map();

function publishEditorHighlights() {
    if (typeof Highlight === 'undefined') return;
    const highlight = new Highlight();
    for (const ranges of editorHighlights.values()) {
        for (const range of ranges) highlight.add(range);
    }
    CSS.highlights.set(HIGHLIGHT_NAME, highlight);
}

/** A rich prompt editor. Only ever reads its text, and edits by the same route as typing. */
class EditorField {
    /**
     * @param {HTMLElement} content - The editor's .cm-content element
     * @param {object} hooks - See createFieldChecking
     */
    constructor(content, hooks) {
        this.element = content;
        this.hooks = hooks;
        this.isChatBox = false;
        this.misspellings = [];
        this.typingCaret = null;
        this.generation = 0;
        this.timer = null;

        // The editor rewrites its lines on every edit, and as it scrolls lines into view
        this.observer = new MutationObserver(() => this.schedule());
        this.observer.observe(content, { childList: true, subtree: true, characterData: true });
        this.onInput = () => {
            this.typingCaret = this.caret();
            this.schedule();
        };
        content.addEventListener('input', this.onInput);
    }

    dispose() {
        clearTimeout(this.timer);
        this.generation++;
        this.observer.disconnect();
        this.element.removeEventListener('input', this.onInput);
        editorHighlights.delete(this);
        publishEditorHighlights();
    }

    /** Its observer sees every change, so there is nothing to catch up on. */
    watch() {}

    syncLayout() {}

    syncScroll() {}

    schedule() {
        if (this.timer !== null) return;
        this.timer = setTimeout(() => {
            this.timer = null;
            this.check();
        }, 0);
    }

    lines() {
        return [...this.element.querySelectorAll(EDITOR_LINE)];
    }

    /** Where the caret is, as a line and an offset within it. Null without a plain caret here. */
    caret() {
        const selection = window.getSelection();
        if (!selection?.isCollapsed || !selection.focusNode || !this.element.contains(selection.focusNode)) return null;
        const node = selection.focusNode;
        const line = (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.closest(EDITOR_LINE);
        if (!line) return null;
        const before = document.createRange();
        before.setStart(line, 0);
        before.setEnd(node, selection.focusOffset);
        return { line: this.lines().indexOf(line), offset: before.toString().length };
    }

    /** A DOM range for part of a line, whose text may be split across several elements. */
    rangeInLine(line, start, end) {
        const range = document.createRange();
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        let position = 0;
        let placedStart = false;
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const next = position + node.length;
            if (!placedStart && start < next) {
                range.setStart(node, start - position);
                placedStart = true;
            }
            if (placedStart && end <= next) {
                range.setEnd(node, end - position);
                return range;
            }
            position = next;
        }
        return null;
    }

    async check() {
        const { element, hooks } = this;
        const generation = ++this.generation;
        const textOf = () => this.lines().map((line) => line.textContent).join('\n');
        const text = textOf();

        if (!hooks.isActive(this) || !text.trim()) {
            this.misspellings = [];
            editorHighlights.delete(this);
            publishEditorHighlights();
            return;
        }

        await hooks.prepare(text);
        // An edit while that was waiting has already scheduled a newer check
        if (generation !== this.generation || textOf() !== text) return;

        // Leave a word alone while it is being typed, as text areas do
        const caret = this.caret();
        const isTyping = document.activeElement === element && caret !== null && this.typingCaret !== null
            && caret.line === this.typingCaret.line && caret.offset === this.typingCaret.offset;
        if (!isTyping) this.typingCaret = null;

        this.misspellings = this.lines().flatMap((line, index) => {
            const found = hooks.findMisspellings(line.textContent, isTyping && caret.line === index ? caret.offset : null);
            return found.map((misspelling) => ({ ...misspelling, range: this.rangeInLine(line, misspelling.start, misspelling.end) }));
        }).filter((misspelling) => misspelling.range);

        editorHighlights.set(this, this.misspellings.map((misspelling) => misspelling.range));
        publishEditorHighlights();
    }

    /**
     * Swap a misspelled word for a suggestion, through the editor's normal handling of typing.
     * @returns {boolean} False if the text has changed since the word was found
     */
    replace(misspelling, suggestion) {
        if (misspelling.range.toString() !== misspelling.word) return false;
        this.element.focus();
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(misspelling.range.cloneRange());
        return document.execCommand('insertText', false, suggestion);
    }

    misspellingAt(x, y) {
        return this.misspellings.find(({ range }) => [...range.getClientRects()].some(
            (rect) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom,
        ));
    }
}

/**
 * Whether this is a rich editor over a field that should be checked. The text area it replaced
 * is still there, hidden, right before it, and says what the editor is for.
 * @param {Element} element
 */
function isCheckableEditor(element) {
    if (!element?.matches?.(EDITOR_CONTENT) || element.getAttribute('aria-readonly') === 'true') return false;
    const wrapper = element.closest(EDITOR_WRAPPER);
    if (!wrapper) return false;
    // The expanded editor moves the editor into a popup, away from its text area. Only fields
    // with an expand button get there, and those hold prose.
    if (!wrapper.previousElementSibling && wrapper.closest('dialog')) return true;
    return isCheckableField(wrapper.previousElementSibling);
}

/**
 * Start watching the page for fields to check.
 * @param {object} hooks
 * @param {(field: Field) => boolean} hooks.isActive - Whether this field should be checked now
 * @param {(text: string) => Promise<void>} hooks.prepare - Fetch what checking this text needs
 * @param {(text: string, caret: number|null) => object[]} hooks.findMisspellings
 * @param {(field: Field) => void} hooks.onChecked - Called after each check of a field
 */
export function createFieldChecking(hooks) {
    const fields = new Map();

    const attach = (element) => {
        if (fields.has(element)) return fields.get(element);
        let field = null;
        if (isCheckableField(element)) field = new Field(element, hooks);
        else if (isCheckableEditor(element)) field = new EditorField(element, hooks);
        if (!field) return null;
        fields.set(element, field);
        field.schedule();
        return field;
    };

    document.addEventListener('focusin', (event) => {
        const field = attach(event.target);
        if (field) {
            // An attribute of its own would turn the browser's spellchecker back on here
            if (event.target.tagName === 'TEXTAREA' && event.target.getAttribute('spellcheck') === 'true') event.target.spellcheck = false;
            field.schedule();
        }
    });
    document.addEventListener('focusout', (event) => fields.get(event.target)?.schedule());

    // Through jQuery, as the app often changes fields with .trigger('input'), which only it can see
    window.$(document).on('input', 'textarea', (event) => {
        const field = attach(event.target);
        if (!field) return;
        const { selectionStart, selectionEnd } = event.target;
        field.typingCaret = selectionStart === selectionEnd ? selectionStart : null;
        field.schedule();
    });

    // Moving the caret off a word finishes it
    document.addEventListener('selectionchange', () => fields.get(document.activeElement)?.schedule());

    document.addEventListener('scroll', (event) => {
        const field = fields.get(event.target);
        if (field) {
            field.syncScroll();
        } else {
            // Something around the fields scrolled, which can carry them along
            fields.forEach((f) => f.syncLayout());
        }
    }, { capture: true, passive: true });
    window.addEventListener('resize', () => fields.forEach((field) => field.syncLayout()));

    // Fields can be removed from the page without notice, and some changes raise no event
    setInterval(() => {
        fields.forEach((field, element) => {
            if (!element.isConnected) {
                field.dispose();
                fields.delete(element);
                return;
            }
            field.watch();
        });
    }, WATCH_INTERVAL_MS);

    return {
        attach,
        // A right-click in a rich editor lands on an element inside it
        fieldFor: (element) => fields.get(element) ?? fields.get(element?.closest?.(EDITOR_CONTENT)),
        refreshAll: () => fields.forEach((field) => field.schedule()),
    };
}
