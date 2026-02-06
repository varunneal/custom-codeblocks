import { MarkdownView, Notice, requestUrl } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const { shell } = require('electron') as { shell: { showItemInFolder(fullPath: string): void } };
import type CustomCodeblocksPlugin from '../main';

interface PaperData {
	title: string;
	authors: string;
	date: string;
	link: string;
}

function parsePaperContent(source: string): PaperData {
	const data: PaperData = {
		title: '',
		authors: '',
		date: '',
		link: ''
	};

	const lines = source.split('\n');
	for (const line of lines) {
		const colonIndex = line.indexOf(':');
		if (colonIndex === -1) continue;

		const key = line.substring(0, colonIndex).trim().toLowerCase();
		const value = line.substring(colonIndex + 1).trim();

		if (key in data) {
			data[key as keyof PaperData] = value;
		}
	}

	return data;
}

function sanitizeFilename(name: string): string {
	return name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, ' ').trim();
}

function expandHome(filepath: string): string {
	if (filepath.startsWith('~')) {
		return path.join(os.homedir(), filepath.slice(1));
	}
	return filepath;
}

const DOWNLOAD_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
	<path d="M12 3V15M12 15L7 10M12 15L17 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
	<path d="M4 17V19C4 20.1 4.9 21 6 21H18C19.1 21 20 20.1 20 19V17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const FOLDER_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
	<path d="M2 6C2 4.9 2.9 4 4 4H9L11 6H20C21.1 6 22 6.9 22 8V18C22 19.1 21.1 20 20 20H4C2.9 20 2 19.1 2 18V6Z" stroke="currentColor" stroke-width="2" fill="none"/>
</svg>`;

function getPaperFilepath(plugin: CustomCodeblocksPlugin, data: PaperData): string | null {
	const activeFile = plugin.app.workspace.getActiveFile();
	if (!activeFile) return null;

	const noteName = activeFile.basename;
	const paperTitle = sanitizeFilename(data.title || 'Untitled');
	const basePath = expandHome(plugin.settings.downloadPath);
	const dir = path.join(basePath, sanitizeFilename(noteName));
	return path.join(dir, `${paperTitle}.pdf`);
}

function setButtonToFinder(btn: HTMLButtonElement, filepath: string) {
	btn.innerHTML = FOLDER_SVG;
	btn.setAttribute('aria-label', 'Reveal in Finder');
}

async function downloadPaper(plugin: CustomCodeblocksPlugin, data: PaperData, btn: HTMLButtonElement): Promise<void> {
	const filepath = getPaperFilepath(plugin, data);
	if (!filepath) {
		new Notice('No active note found.');
		return;
	}

	if (fs.existsSync(filepath)) {
		shell.showItemInFolder(filepath);
		return;
	}

	new Notice(`Downloading ${sanitizeFilename(data.title || 'Untitled')}...`);

	try {
		const response = await requestUrl({ url: data.link });
		const dir = path.dirname(filepath);
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(filepath, Buffer.from(response.arrayBuffer));
		new Notice(`Saved: ${filepath}`);
		setButtonToFinder(btn, filepath);
	} catch (err) {
		new Notice(`Download failed: ${err instanceof Error ? err.message : String(err)}`);
	}
}

export function registerPaperCodeblock(plugin: CustomCodeblocksPlugin) {
	plugin.registerMarkdownCodeBlockProcessor('paper', (source, el, ctx) => {
		const data = parsePaperContent(source);

		const container = el.createDiv({ cls: 'paper-card' });

		// Click to edit (on the card, but not on links/buttons)
		container.addEventListener('click', (e) => {
			const target = e.target as HTMLElement;
			if (target.tagName === 'A' || target.tagName === 'BUTTON' || target.closest('button')) return;

			const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
			if (!view) return;

			const sectionInfo = ctx.getSectionInfo(el);
			if (!sectionInfo) return;

			const editor = view.editor;
			editor.setCursor({ line: sectionInfo.lineStart + 1, ch: 7 });
			editor.focus();
		});

		// PDF icon in top right
		if (data.link) {
			const linkEl = container.createEl('a', {
				href: data.link,
				cls: 'paper-card-link'
			});
			linkEl.setAttr('target', '_blank');
			linkEl.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
				<path d="M6 2C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2H6Z" stroke="currentColor" stroke-width="2" fill="none"/>
				<path d="M14 2V8H20" stroke="currentColor" stroke-width="2" fill="none"/>
				<text x="12" y="17" text-anchor="middle" font-size="6" font-weight="bold" fill="currentColor">PDF</text>
			</svg>`;

			// Download / Open in Finder button
			const downloadBtn = container.createEl('button', {
				cls: 'paper-card-download',
				attr: { 'aria-label': 'Download PDF' }
			});

			const filepath = getPaperFilepath(plugin, data);
			if (filepath && fs.existsSync(filepath)) {
				setButtonToFinder(downloadBtn, filepath);
			} else {
				downloadBtn.innerHTML = DOWNLOAD_SVG;
			}

			downloadBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				const currentPath = getPaperFilepath(plugin, data);
				if (currentPath && fs.existsSync(currentPath)) {
					shell.showItemInFolder(currentPath);
				} else {
					downloadPaper(plugin, data, downloadBtn);
				}
			});
		}

		// Title
		container.createEl('div', {
			text: data.title || 'Untitled',
			cls: 'paper-card-title'
		});

		// Metadata line (authors + date)
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
	});
}
