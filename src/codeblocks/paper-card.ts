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
	const container = el.createDiv({ cls: 'paper-card' });

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

	container.createEl('div', {
		text: data.title || 'Untitled',
		cls: 'paper-card-title'
	});

	if (data.authors || data.date) {
		let metaText = data.authors || '';
		if (data.date) {
			metaText += metaText ? ` (${data.date})` : data.date;
		}
		container.createEl('div', {
			text: metaText,
			cls: 'paper-card-meta'
		});
	}

	return container;
}
