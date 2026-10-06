import { Notice, setIcon } from 'obsidian';
import type CustomCodeblocksPlugin from '../main';
import {
	downloadPaper,
	findSavedFile,
	getPaperDir,
	revealInFileManager,
	setButtonToReveal,
	type PaperData,
} from './paper';

export interface PaperCardOptions {
	sourcePath?: string;
	onEdit?: () => void;
}

function isCardAction(target: EventTarget | null): boolean {
	return typeof (target as Element | null)?.closest === 'function'
		&& (target as Element).closest('a, button') !== null;
}

export function renderPaperCard(
	plugin: CustomCodeblocksPlugin,
	data: PaperData,
	el: HTMLElement,
	options: PaperCardOptions = {},
): HTMLElement {
	const container = el.createDiv({ cls: data.link ? 'paper-card has-actions' : 'paper-card' });

	if (options.onEdit) {
		container.tabIndex = 0;
		container.setAttribute('role', 'button');
		container.setAttribute('aria-label', `Edit paper: ${data.title || 'Untitled'}`);
		container.addEventListener('pointerdown', (event) => {
			if (event.button !== 0 || isCardAction(event.target)) return;
			event.preventDefault();
			event.stopPropagation();
			options.onEdit?.();
		});
		container.addEventListener('keydown', (event) => {
			if (event.target !== container || (event.key !== 'Enter' && event.key !== ' ')) return;
			event.preventDefault();
			options.onEdit?.();
		});
	}

	if (data.link) {
		const linkEl = container.createEl('a', {
			href: data.link,
			cls: 'paper-card-link'
		});
		linkEl.setAttr('target', '_blank');
		linkEl.setAttr('rel', 'noopener noreferrer');
		setIcon(linkEl, 'link');

		const downloadBtn = container.createEl('button', {
			cls: 'paper-card-download',
			attr: { 'aria-label': 'Download PDF' }
		});

		const paths = getPaperDir(plugin, data, options.sourcePath);
		const existing = paths ? findSavedFile(paths) : null;
		if (existing) {
			setButtonToReveal(downloadBtn);
		} else {
			setIcon(downloadBtn, 'download');
		}

		downloadBtn.addEventListener('click', (event) => {
			event.stopPropagation();
			const currentPaths = getPaperDir(plugin, data, options.sourcePath);
			const currentFile = currentPaths ? findSavedFile(currentPaths) : null;
			if (currentFile) {
				if (downloadBtn.getAttribute('aria-label') === 'Reveal in file manager') {
					revealInFileManager(currentFile);
				} else {
					setButtonToReveal(downloadBtn);
					new Notice('Existing download found');
				}
				return;
			}
			void downloadPaper(plugin, data, downloadBtn, options.sourcePath);
		});

		const copyBtn = container.createEl('button', {
			cls: 'paper-card-copy',
			attr: { 'aria-label': 'Copy path to clipboard' }
		});
		setIcon(copyBtn, 'copy');
		copyBtn.addEventListener('click', (event) => {
			event.stopPropagation();
			const currentPaths = getPaperDir(plugin, data, options.sourcePath);
			if (currentPaths) {
				void navigator.clipboard.writeText(currentPaths.dir);
				new Notice('Copied path to clipboard');
			}
		});
	}

	const titleEl = container.createDiv({ cls: 'paper-card-title' });
	if (data.title) {
		titleEl.createSpan({ text: data.title, attr: { 'data-paper-field': 'title' } });
	} else {
		titleEl.setText('Untitled');
	}

	if (data.authors || data.date) {
		const metaEl = container.createDiv({ cls: 'paper-card-meta' });
		if (data.authors) {
			metaEl.createSpan({ text: data.authors, attr: { 'data-paper-field': 'authors' } });
		}
		if (data.date) {
			if (data.authors) metaEl.appendText(' (');
			metaEl.createSpan({ text: data.date, attr: { 'data-paper-field': 'date' } });
			if (data.authors) metaEl.appendText(')');
		}
	}

	return container;
}

/** Fields whose values the card shows as text. */
export const VISIBLE_PAPER_FIELDS = ['title', 'authors', 'date'] as const;
export type VisiblePaperField = typeof VISIBLE_PAPER_FIELDS[number];

export const SEARCH_MATCH_CLASS = 'obsidian-search-match-highlight';

/**
 * Marks search matches inside a rendered card. `fieldMatches` holds offsets
 * into each field value. `hiddenMatch` flags a match in text the card does
 * not show (keys, link), which outlines the whole card.
 */
export function setPaperCardMatches(
	card: HTMLElement,
	fieldMatches: Partial<Record<VisiblePaperField, Array<[number, number]>>>,
	hiddenMatch: boolean,
): void {
	const signature = JSON.stringify([fieldMatches, hiddenMatch]);
	if (card.dataset.searchMatches === signature) return;
	card.dataset.searchMatches = signature;
	card.toggleClass('is-search-match', hiddenMatch);

	card.querySelectorAll<HTMLElement>('[data-paper-field]').forEach((fieldEl) => {
		const text = fieldEl.textContent ?? '';
		const matches = (fieldMatches[fieldEl.dataset.paperField as VisiblePaperField] ?? [])
			.slice()
			.sort((a, b) => a[0] - b[0]);
		fieldEl.empty();
		let offset = 0;
		for (const [from, to] of matches) {
			const start = Math.max(from, offset);
			if (to <= start) continue;
			if (start > offset) fieldEl.appendText(text.slice(offset, start));
			fieldEl.createSpan({ cls: `${SEARCH_MATCH_CLASS} paper-card-search-match`, text: text.slice(start, to) });
			offset = to;
		}
		if (offset < text.length) fieldEl.appendText(text.slice(offset));
	});
}
