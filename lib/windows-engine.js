/**
 * Talks to windows-helper, which answers spelling questions using the Windows spell checker.
 * Answers are cached, so words already seen need no request. Lookups are asynchronous but the
 * checker in spell-core is not, so call prepare() with a text's words before checking it.
 */

const BASE_URL = 'http://127.0.0.1:47921';
const CONNECT_TIMEOUT_MS = 800;
const MAX_WORDS_PER_REQUEST = 5000;

async function post(path, body) {
    const response = await fetch(`${BASE_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body,
    });
    if (!response.ok) throw new Error(`Spell check helper returned ${response.status} for ${path}`);
    return response.text();
}

/**
 * Connect to the helper.
 * @returns {Promise<object|null>} The engine, or null if the helper is not running
 */
export async function connectWindowsEngine() {
    try {
        const response = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS) });
        if (!(await response.text()).startsWith('st-spellcheck-helper')) return null;
    } catch {
        return null;
    }

    const answers = new Map(); // word -> [Portuguese accepts it, English accepts it]
    const suggestions = new Map(); // word -> [Portuguese list, English list]

    const speller = (index) => ({
        // prepare() has already asked about every word the checker will look up
        spell: (word) => answers.get(word)?.[index] ?? true,
        suggest: (word) => suggestions.get(word)?.[index] ?? [],
    });

    return {
        spellers: [speller(0), speller(1)],

        /** @param {string[]} words */
        async prepare(words) {
            const missing = [...new Set(words)].filter((word) => !answers.has(word));
            for (let start = 0; start < missing.length; start += MAX_WORDS_PER_REQUEST) {
                const batch = missing.slice(start, start + MAX_WORDS_PER_REQUEST);
                const lines = (await post('/check', batch.join('\n'))).split('\n');
                batch.forEach((word, index) => {
                    answers.set(word, [lines[index]?.[0] === '1', lines[index]?.[1] === '1']);
                });
            }
        },

        /** @param {string} word */
        async prepareSuggestions(word) {
            if (suggestions.has(word)) return;
            const lists = [[], []];
            for (const line of (await post('/suggest', word)).split('\n')) {
                const [language, suggestion] = line.split('\t');
                if (suggestion) lists[language === 'pt' ? 0 : 1].push(suggestion);
            }
            suggestions.set(word, lists);
        },
    };
}
