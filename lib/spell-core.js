/**
 * Language-independent spell check logic: splitting text into words, deciding which
 * words to skip, and asking the loaded dictionaries about the rest.
 * No DOM access, so it can be tested outside the app.
 */

// A word: letters and combining marks, optionally joined by a hyphen or apostrophe.
// Anything glued to a digit or underscore ("h264", "my_var") is not a word.
const WORD_PATTERN = /(?<![\p{L}\p{N}_])[\p{L}\p{M}]+(?:[-'’][\p{L}\p{M}]+)*(?![\p{L}\p{N}_])/gu;

// Never prose, whatever the mode.
const ALWAYS_PROTECTED = {
    urls: /\bhttps?:\/\/\S+|\bwww\.\S+/giu,
    macros: /\{\{[^}]*\}\}/gu,
    htmlTags: /<\/?[a-z][^>]*>/giu,
    inlineCode: /`[^`\n]*`/gu,
    slashCommand: /^\s*\/\S+/gu,
};

// Deliberate roleplay styling. Words inside *actions* are still prose, so they are checked.
const ROLEPLAY_PROTECTED = {
    // "I-I", "W-what", "N-no"
    stuttering: /(?<![\p{L}\p{N}])(\p{L})-\1/giu,
    // "Please~"
    tildes: /[\p{L}\p{M}]+~/gu,
    // "STOP", "PARE"
    allCaps: /(?<![\p{L}\p{N}])\p{Lu}{3,}(?![\p{L}\p{N}])/gu,
    // "Nooooo", "Pleeease"
    repeatedLetters: /[\p{L}\p{M}]*(\p{L})\1{2,}[\p{L}\p{M}]*/giu,
    // ":D", ";-)", "D:" - only when standing alone, or "Hello:" would hide "Hello"
    emoticons: /(?<![\p{L}\p{N}])(?:[:;8][-']?[)(\[\]DPpOo3<>|/\\]+|[)(\[\]DPpOo][-']?[:;8])(?![\p{L}\p{N}])/gu,
    rpAbbreviations: /(?<![\p{L}\p{N}])(?:RP|OOC|IC|NPC|GM|DM|PC)(?![\p{L}\p{N}])/giu,
};

const MIN_WORD_LENGTH = 3;

/** Lookups a speller must offer. Hunspell instances satisfy this directly. */
/** @typedef {{spell: (word: string) => boolean, suggest: (word: string) => string[]}} Speller */

function normalizeApostrophes(word) {
    return word.replace(/’/g, "'");
}

/**
 * @param {string} text
 * @param {boolean} roleplayAware
 * @returns {{start: number, end: number}[]}
 */
export function findProtectedRanges(text, roleplayAware) {
    const patterns = roleplayAware
        ? [...Object.values(ALWAYS_PROTECTED), ...Object.values(ROLEPLAY_PROTECTED)]
        : Object.values(ALWAYS_PROTECTED);
    const ranges = [];
    for (const pattern of patterns) {
        for (const match of text.matchAll(pattern)) {
            ranges.push({ start: match.index, end: match.index + match[0].length });
        }
    }
    return ranges;
}

/**
 * @param {string} text
 * @returns {{word: string, start: number, end: number}[]}
 */
export function findWords(text) {
    return Array.from(text.matchAll(WORD_PATTERN), (match) => ({
        word: match[0],
        start: match.index,
        end: match.index + match[0].length,
    }));
}

/** Lowercase with accents removed: a missing accent is the most common typo there is. */
function foldForComparison(word) {
    return word.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * Edits needed to get from one word to the other, where swapping two neighbouring letters
 * counts as one edit (Damerau-Levenshtein, restricted form).
 */
function typingDistance(from, to) {
    const a = foldForComparison(from);
    const b = foldForComparison(to);
    const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) rows[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
            }
        }
    }
    return rows[a.length][b.length];
}

/**
 * Combine dictionaries so that a word is correct if ANY of them accepts it.
 * Results are cached: the same words are rechecked on every keystroke.
 * @param {Speller[]} spellers
 */
export function createChecker(spellers) {
    const cache = new Map();

    const inAnyDictionary = (word) => spellers.some((speller) => speller.spell(word));

    const lookUp = (word) => {
        if (inAnyDictionary(word)) return true;
        const parts = word.split(/[-']/).filter(Boolean);
        if (parts.length < 2) return false;
        // "well-known", "guarda-chuva", "dá-me", "d'água": fine if every piece is a word.
        // A lone letter before an apostrophe ("d'", "l'") is an elision, not a word.
        return parts.every((part) => (part.length === 1 && /'/.test(word)) || inAnyDictionary(part));
    };

    return {
        /** @param {string} rawWord */
        isCorrect(rawWord) {
            const word = normalizeApostrophes(rawWord);
            let result = cache.get(word);
            if (result === undefined) {
                result = lookUp(word);
                cache.set(word, result);
            }
            return result;
        },

        /**
         * Suggestions from every dictionary, closest to the typed word first, so "wrold"
         * offers "world" before anything Portuguese, and "voce" offers "você" before
         * anything English. Ties go to the same length ("teh": "the" over "eh"), then to each
         * dictionary's own order.
         * Slower than checking, so only call this when they will be shown.
         * @param {string} rawWord
         * @param {number} limit
         * @returns {string[]}
         */
        suggest(rawWord, limit = 6) {
            const word = normalizeApostrophes(rawWord);
            const candidates = new Map();
            for (const speller of spellers) {
                speller.suggest(word).forEach((suggestion, rank) => {
                    const best = candidates.get(suggestion);
                    if (best === undefined || rank < best.rank) {
                        candidates.set(suggestion, {
                            rank,
                            distance: typingDistance(word, suggestion),
                            lengthDifference: Math.abs(word.length - suggestion.length),
                        });
                    }
                });
            }
            return [...candidates.entries()]
                .sort(([, a], [, b]) => a.distance - b.distance || a.lengthDifference - b.lengthDifference || a.rank - b.rank)
                .slice(0, limit)
                .map(([suggestion]) => suggestion);
        },
    };
}

/**
 * @param {string} text
 * @param {ReturnType<typeof createChecker>} checker
 * @param {object} [options]
 * @param {boolean} [options.roleplayAware]
 * @param {Set<string>} [options.knownWords] Lowercase words to accept: personal dictionary, names.
 * @param {number|null} [options.caret] A word touching this offset is still being typed; skip it.
 * @returns {{word: string, start: number, end: number}[]}
 */
export function findMisspellings(text, checker, { roleplayAware = true, knownWords = new Set(), caret = null } = {}) {
    const protectedRanges = findProtectedRanges(text, roleplayAware);
    const isKnown = (word) => {
        const lower = normalizeApostrophes(word).toLowerCase();
        return knownWords.has(lower) || (lower.endsWith("'s") && knownWords.has(lower.slice(0, -2)));
    };

    return findWords(text).filter(({ word, start, end }) => {
        if (word.length < MIN_WORD_LENGTH) return false;
        if (caret !== null && caret >= start && caret <= end) return false;
        if (protectedRanges.some((range) => start < range.end && end > range.start)) return false;
        return !isKnown(word) && !checker.isCorrect(word);
    });
}
