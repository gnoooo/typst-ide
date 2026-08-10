import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  formatStepLabel,
  stepNumber,
  inlineIcons,
  renderMarkdown,
} from '../src/js/tutorial.js';
import { highlightTypst, escapeHtml } from '../src/js/tutorial-highlight.js';

const TUTORIAL_DIR = path.resolve(__dirname, '../src/tutorial');

function listMd(lang) {
  return fs
    .readdirSync(path.join(TUTORIAL_DIR, lang))
    .filter((f) => f.endsWith('.md'))
    .sort();
}

describe('tutorial steps', () => {
  it('fr and en define the same numbered steps', () => {
    const fr = listMd('fr');
    const en = listMd('en');
    const numbers = (files) => files.map((f) => f.slice(0, 2));
    expect(numbers(fr)).toEqual(numbers(en));
    expect(fr.length).toBeGreaterThan(0);
  });

  it('steps are numbered 01..N in order', () => {
    const fr = listMd('fr');
    fr.forEach((f, i) => {
      expect(f.startsWith(String(i + 1).padStart(2, '0') + '-')).toBe(true);
    });
  });
});

describe('step labels', () => {
  it('extracts the numeric prefix', () => {
    expect(stepNumber('01-bienvenue')).toBe(1);
    expect(stepNumber('13-keyboard')).toBe(13);
    expect(stepNumber('welcome')).toBeNull();
  });

  it('replaces dashes with spaces and capitalizes', () => {
    expect(formatStepLabel('01-bienvenue')).toBe('Bienvenue');
    expect(formatStepLabel('13-raccourcis-clavier')).toBe('Raccourcis Clavier');
    expect(formatStepLabel('welcome')).toBe('Welcome');
  });
});

describe('tutorial markdown rendering', () => {
  it('converts ^icon^ syntax to material symbol spans', async () => {
    expect(inlineIcons('^folder_open^ ouvre les projets')).toBe(
      '<span class="material-symbols-outlined">folder_open</span> ouvre les projets'
    );
    const html = await renderMarkdown('Cliquez sur ^sticky_note_2^:\n\n```typst\n#underline[test]\n```\n');
    expect(html).toContain('<span class="material-symbols-outlined">sticky_note_2</span>');
    expect(html).toContain('tut-tok-function');
  });

  it('does not expand icons inside code blocks', async () => {
    const html = await renderMarkdown('```typst\n#let x = "^folder_open^"\n```\n');
    expect(html).not.toContain('material-symbols-outlined');
  });

  it('renders tables (keyboard shortcuts step)', async () => {
    const md = '| a | b |\n| --- | --- |\n| 1 | 2 |\n';
    const html = await renderMarkdown(md);
    expect(html).toContain('<table>');
    expect(html).toContain('<td>');
  });

  it('renders strong/em inside list items', async () => {
    const md = '- ^edit_note^ **L\u2019éditeur** (à gauche).\n- *italique* et **gras**.\n';
    const html = await renderMarkdown(md);
    expect(html).toContain('<strong>');
    expect(html).toContain('<em>');
    expect(html).not.toContain('**');
  });
});

describe('typst highlighter', () => {
  it('tokenizes functions, strings, comments and numbers', () => {
    const html = highlightTypst('#set text(size: 12pt) // taille');
    expect(html).toContain('tut-tok-function');
    expect(html).toContain('tut-tok-number');
    expect(html).toContain('tut-tok-comment');
    expect(html).toContain('tut-tok-comment">// taille</span>');
  });

  it('tokenizes strings without touching their content', () => {
    const html = highlightTypst('#import "lib.typ"');
    expect(html).toContain('tut-tok-string');
    expect(html).toContain('&quot;lib.typ&quot;');
  });

  it('keeps markup delimiters (bold/italic markers) visible', () => {
    const html = highlightTypst('*gras* et _italique_');
    expect(html).toContain('tut-tok-strong">*gras*</span>');
    expect(html).toContain('tut-tok-emphasis">_italique_</span>');
  });

  it('escapes HTML', () => {
    const html = highlightTypst('#<table>');
    expect(html).toContain('&lt;table&gt;');
  });

  it('escapes plain text', () => {
    expect(escapeHtml('<a href="x">')).toBe('&lt;a href=&quot;x&quot;&gt;');
  });
});