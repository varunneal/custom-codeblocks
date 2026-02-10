import { MarkdownView, Notice, requestUrl, htmlToMarkdown } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as zlib from 'zlib';
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
	return name.replace(/[<>:"/\\|?*]/g, '-').replace(/\s+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
}

function expandHome(filepath: string): string {
	if (filepath.startsWith('~')) {
		return path.join(os.homedir(), filepath.slice(1));
	}
	return filepath;
}

function parseArxivId(url: string): string | null {
	const match = url.match(/arxiv\.org\/(?:abs|pdf|src|e-print)\/([^\s?#]+?)(?:\.pdf)?$/);
	return match?.[1] ?? null;
}

function getDownloadUrls(link: string): { pdf: string; source: string | null } {
	const id = parseArxivId(link);
	if (id) {
		return {
			pdf: `https://arxiv.org/pdf/${id}`,
			source: `https://arxiv.org/e-print/${id}`,
		};
	}
	return { pdf: link, source: null };
}

function extractTexFromTarball(buffer: Buffer, dir: string): void {
	let data: Buffer;
	try {
		data = zlib.gunzipSync(buffer);
	} catch {
		// Not gzipped — might be raw TeX
		const text = buffer.toString('utf-8', 0, Math.min(buffer.length, 1024));
		if (text.includes('\\document') || text.includes('\\begin') || text.includes('\\input')) {
			fs.writeFileSync(path.join(dir, 'main.tex'), buffer);
		}
		return;
	}

	// Check if it's a tar archive (tar magic at offset 257)
	const magic = data.toString('utf-8', 257, 262);
	if (magic !== 'ustar') {
		// Decompressed but not tar — likely a single TeX file
		const text = data.toString('utf-8', 0, Math.min(data.length, 1024));
		if (text.includes('\\document') || text.includes('\\begin') || text.includes('\\input')) {
			fs.writeFileSync(path.join(dir, 'main.tex'), data);
		}
		return;
	}

	// Parse tar (512-byte header blocks)
	let offset = 0;
	while (offset + 512 <= data.length) {
		const header = data.subarray(offset, offset + 512);
		// Empty block signals end of archive
		if (header.every(b => b === 0)) break;

		const nameRaw = header.subarray(0, 100).toString('utf-8');
		const name = nameRaw.replace(/\0.*$/, '');

		const sizeOctal = header.subarray(124, 136).toString('utf-8').replace(/\0.*$/, '').trim();
		const size = parseInt(sizeOctal, 8) || 0;

		offset += 512; // move past header

		const ext = path.extname(name).toLowerCase();
		const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.eps', '.pdf'];
		if (size > 0 && ['.tex', '.bbl', ...imageExts].includes(ext)) {
			const content = data.subarray(offset, offset + size);
			let outPath: string;
			if (imageExts.includes(ext)) {
				const imagesDir = path.join(dir, 'images');
				fs.mkdirSync(imagesDir, { recursive: true });
				outPath = path.join(imagesDir, path.basename(name));
			} else {
				outPath = path.join(dir, path.basename(name));
			}
			fs.writeFileSync(outPath, content);
		}

		// Advance past data blocks (padded to 512-byte boundary)
		offset += Math.ceil(size / 512) * 512;
	}
}

const DOWNLOAD_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
	<path d="M12 3V15M12 15L7 10M12 15L17 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
	<path d="M4 17V19C4 20.1 4.9 21 6 21H18C19.1 21 20 20.1 20 19V17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const FOLDER_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
	<path d="M2 6C2 4.9 2.9 4 4 4H9L11 6H20C21.1 6 22 6.9 22 8V18C22 19.1 21.1 20 20 20H4C2.9 20 2 19.1 2 18V6Z" stroke="currentColor" stroke-width="2" fill="none"/>
</svg>`;

function getPaperDir(plugin: CustomCodeblocksPlugin, data: PaperData): { dir: string; pdfPath: string; mdPath: string } | null {
	const activeFile = plugin.app.workspace.getActiveFile();
	if (!activeFile) return null;

	const noteName = activeFile.basename;
	const paperTitle = sanitizeFilename(data.title || 'Untitled');
	const basePath = expandHome(plugin.settings.downloadPath);
	const dir = path.join(basePath, sanitizeFilename(noteName), paperTitle);
	return { dir, pdfPath: path.join(dir, `${paperTitle}.pdf`), mdPath: path.join(dir, `${paperTitle}.md`) };
}

function findSavedFile(paths: { pdfPath: string; mdPath: string }): string | null {
	if (fs.existsSync(paths.pdfPath)) return paths.pdfPath;
	if (fs.existsSync(paths.mdPath)) return paths.mdPath;
	return null;
}

function setButtonToFinder(btn: HTMLButtonElement, filepath: string) {
	btn.innerHTML = FOLDER_SVG;
	btn.setAttribute('aria-label', 'Reveal in Finder');
}

async function downloadPaper(plugin: CustomCodeblocksPlugin, data: PaperData, btn: HTMLButtonElement): Promise<void> {
	const paths = getPaperDir(plugin, data);
	if (!paths) {
		new Notice('No active note found.');
		return;
	}

	const { dir, pdfPath } = paths;

	const existingFile = findSavedFile(paths);
	if (existingFile) {
		shell.showItemInFolder(existingFile);
		return;
	}

	new Notice(`Downloading ${sanitizeFilename(data.title || 'Untitled')}...`);

	const { pdf: pdfUrl, source: sourceUrl } = getDownloadUrls(data.link);

	try {
		fs.mkdirSync(dir, { recursive: true });

		let savedAsMd = false;
		const downloads: Promise<void>[] = [
			requestUrl({ url: pdfUrl }).then(response => {
				const buf = Buffer.from(response.arrayBuffer);
				if (buf.length >= 4 && buf.toString('utf-8', 0, 4) === '%PDF') {
					fs.writeFileSync(pdfPath, buf);
				} else {
					// Not a PDF — convert HTML to markdown
					const html = buf.toString('utf-8');
					const md = htmlToMarkdown(html);
					const mdPath = pdfPath.replace(/\.pdf$/, '.md');
					fs.writeFileSync(mdPath, md);
					savedAsMd = true;
				}
			}),
		];

		if (sourceUrl) {
			downloads.push(
				requestUrl({ url: sourceUrl }).then(response => {
					extractTexFromTarball(Buffer.from(response.arrayBuffer), dir);
				}).catch((err) => {
					console.warn('TeX source fetch failed:', err);
				})
			);
		}

		await Promise.all(downloads);

		const texFiles = fs.readdirSync(dir).filter(f => f.endsWith('.tex'));
		if (savedAsMd) {
			new Notice(`Saved as Markdown: ${pdfPath.replace(/\.pdf$/, '.md')}`);
		} else if (texFiles.length > 0) {
			new Notice(`Saved PDF + ${texFiles.length} .tex file(s) to ${dir}`);
		} else {
			new Notice(`Saved: ${pdfPath}`);
		}
		setButtonToFinder(btn, savedAsMd ? pdfPath.replace(/\.pdf$/, '.md') : pdfPath);
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

			const paths = getPaperDir(plugin, data);
			const existing = paths ? findSavedFile(paths) : null;
			if (existing) {
				setButtonToFinder(downloadBtn, existing);
			} else {
				downloadBtn.innerHTML = DOWNLOAD_SVG;
			}

			downloadBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				const currentPaths = getPaperDir(plugin, data);
				const currentFile = currentPaths ? findSavedFile(currentPaths) : null;
				if (currentFile) {
					shell.showItemInFolder(currentFile);
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
