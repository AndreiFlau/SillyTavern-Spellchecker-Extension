// Runs against the real dictionaries in this repo, loaded through hunspell-asm.
// Needs `npm install` first, because the browser bundle cannot load under Node.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { createChecker, findMisspellings, findWords } from '../lib/spell-core.js';

const root = new URL('../', import.meta.url);
const { loadModule } = createRequire(import.meta.url)('hunspell-asm');
const factory = await loadModule();

function loadDictionary(code) {
    const read = (ext) => new Uint8Array(readFileSync(new URL(`dictionaries/${code}/${code}.${ext}`, root)));
    return factory.create(factory.mountBuffer(read('aff')), factory.mountBuffer(read('dic')));
}

const portuguese = loadDictionary('pt_BR');
const english = loadDictionary('en_US');
const both = createChecker([portuguese, english]);

const flagged = (text, options) => findMisspellings(text, both, options).map((m) => m.word);

test('control: each dictionary alone rejects the other language', () => {
    assert.deepEqual(findMisspellings('hello how you', createChecker([portuguese])).map((m) => m.word), ['hello', 'how', 'you']);
    assert.deepEqual(findMisspellings('olá como você', createChecker([english])).map((m) => m.word), ['olá', 'como', 'você']);
});

test('accepts both languages in one sentence and flags only the typo', () => {
    assert.deepEqual(flagged('hello, how are you olá, como você está xqzwvt'), ['xqzwvt']);
});

test('flags real typos in both languages', () => {
    assert.deepEqual(flagged('recieve the coracao'), ['recieve', 'coracao']);
});

test('accented words are one word, not cut at the accent', () => {
    assert.deepEqual(findWords('você não, ação').map((w) => w.word), ['você', 'não', 'ação']);
    assert.deepEqual(flagged('você não está coração amanhã'), []);
});

test('apostrophes, hyphens and curly quotes', () => {
    assert.deepEqual(flagged("don't it's well-known guarda-chuva dá-me falou-lhe d'água"), []);
    assert.deepEqual(flagged('don’t it’s'), []);
    assert.deepEqual(flagged('well-knwon'), ['well-knwon']);
});

test('words inside *actions* are checked', () => {
    assert.deepEqual(flagged('*she smilse at him*'), ['smilse']);
});

test('roleplay styling is left alone', () => {
    assert.deepEqual(flagged('I-I W-what Nooooo PARE STOP Please~ OOC NPC :D ;-)'), []);
});

test('roleplay styling is checked with the mode off', () => {
    assert.ok(flagged('Nooooo', { roleplayAware: false }).includes('Nooooo'));
});

test('a word before a colon is not hidden by the emoticon rule', () => {
    assert.deepEqual(flagged('helo: wrold;'), ['helo', 'wrold']);
});

test('non-prose is skipped', () => {
    assert.deepEqual(flagged('https://exmaple.com/xqzwvt {{chra}} <spna> `xqzwvt`'), []);
    assert.deepEqual(flagged('/sendas hello'), []);
    assert.deepEqual(flagged('h264 my_vra 10th'), []);
});

test('the word being typed is not flagged until the caret leaves it', () => {
    const text = 'hello xqzw';
    assert.deepEqual(flagged(text, { caret: text.length }), []);
    assert.deepEqual(flagged(text, { caret: 0 }), ['xqzw']);
    assert.deepEqual(flagged(text), ['xqzw']);
});

test('personal dictionary and possessives of known names', () => {
    const knownWords = new Set(['zorvath']);
    assert.deepEqual(flagged('Zorvath Zorvath\'s Tyrone’s', { knownWords }), []);
    assert.deepEqual(flagged('Zorvath'), ['Zorvath']);
});

test('offsets point at the word in the original text', () => {
    const text = 'olá *você* xqzwvt!';
    const [m] = findMisspellings(text, both);
    assert.equal(text.slice(m.start, m.end), 'xqzwvt');
});

test('the best suggestion is the closest word, in whichever language it is', () => {
    for (const [typo, expected] of [['wrold', 'world'], ['voce', 'você'], ['coracao', 'coração'], ['recieve', 'receive'], ['teh', 'the']]) {
        assert.equal(both.suggest(typo)[0], expected, `${typo} -> ${both.suggest(typo)}`);
    }
});

test('suggestions come from both languages without duplicates', () => {
    assert.ok(both.suggest('voce').includes('você'));
    assert.ok(both.suggest('recieve').includes('receive'));
    const list = both.suggest('casa');
    assert.equal(new Set(list).size, list.length);
    assert.ok(both.suggest('voce', 2).length <= 2);
});

test('checking a long message stays fast enough to run on every keystroke', () => {
    const text = 'hello how are you olá como você está '.repeat(300);
    const fresh = createChecker([portuguese, english]);
    const start = performance.now();
    findMisspellings(text, fresh);
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 100, `took ${elapsed} ms for ${text.length} characters`);
});
