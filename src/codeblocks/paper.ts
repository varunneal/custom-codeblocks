import {
	htmlToMarkdown,
	Notice,
	requestUrl,
	setIcon,
	type RequestUrlResponse,
} from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as zlib from 'zlib';
import * as https from 'https';
import * as http from 'http';
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Electron is provided by Obsidian at runtime.
const { shell } = require('electron') as { shell: { showItemInFolder(fullPath: string): void } };
import type CustomCodeblocksPlugin from '../main';

export interface PaperData {
	title: string;
	authors: string;
	date: string;
	link: string;
}

/** Offsets of each field value, relative to the start of the block source. */
export type PaperFieldRanges = Partial<Record<keyof PaperData, { from: number; to: number }>>;

export function parsePaperFields(source: string): { data: PaperData; ranges: PaperFieldRanges } {
	const data: PaperData = {
		title: '',
		authors: '',
		date: '',
		link: ''
	};
	const ranges: PaperFieldRanges = {};

	let lineStart = 0;
	for (const line of source.split('\n')) {
		const colonIndex = line.indexOf(':');
		if (colonIndex !== -1) {
			const key = line.substring(0, colonIndex).trim().toLowerCase();
			const rawValue = line.substring(colonIndex + 1);
			const value = rawValue.trim();

			if (key in data) {
				const from = lineStart + colonIndex + 1 + (rawValue.length - rawValue.trimStart().length);
				data[key as keyof PaperData] = value;
				ranges[key as keyof PaperData] = { from, to: from + value.length };
			}
		}
		lineStart += line.length + 1;
	}

	return { data, ranges };
}

export function parsePaperContent(source: string): PaperData {
	return parsePaperFields(source).data;
}

function sanitizeFilename(name: string): string {
	return name
		.replace(/[<>:"/\\|?*,;!@#$%^&()[\]{}'`~]/g, '')
		.replace(/\s+/g, '-')
		.replace(/-{2,}/g, '-')
		.replace(/^-|-$/g, '');
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

function probeForCookies(url: string): Promise<{ status: number; cookies: string[] }> {
	return new Promise((resolve, reject) => {
		const parsed = new URL(url);
		const mod = parsed.protocol === 'https:' ? https : http;
		const req = mod.get(url, (res) => {
			const cookies = (res.headers['set-cookie'] ?? []).map(c => c.split(';')[0]!.trim());
			resolve({ status: res.statusCode ?? 0, cookies });
			res.resume();
		});
		req.on('error', reject);
	});
}

async function fetchWithCookieRetry(url: string): Promise<RequestUrlResponse> {
	const probe = await probeForCookies(url);
	if (probe.status === 403 && probe.cookies.length > 0) {
		const response = await requestUrl({
			url,
			headers: { 'Cookie': probe.cookies.join('; ') },
			throw: false,
		});
		if (response.status >= 400) {
			throw new Error(`HTTP ${response.status} after cookie retry`);
		}
		return response;
	}

	return requestUrl({ url });
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

export function getPaperDir(
	plugin: CustomCodeblocksPlugin,
	data: PaperData,
	sourcePath?: string,
): { dir: string; pdfPath: string; mdPath: string } | null {
	const activeFile = plugin.app.workspace.getActiveFile();
	const noteName = sourcePath
		? path.basename(sourcePath, path.extname(sourcePath))
		: activeFile?.basename;
	if (!noteName) return null;

	const paperTitle = sanitizeFilename(data.title || 'Untitled');
	const basePath = expandHome(plugin.settings.downloadPath);
	const dir = path.join(basePath, sanitizeFilename(noteName), paperTitle);
	return { dir, pdfPath: path.join(dir, `${paperTitle}.pdf`), mdPath: path.join(dir, `${paperTitle}.md`) };
}

export function findSavedFile(paths: { dir: string; pdfPath: string; mdPath: string }): string | null {
	if (fs.existsSync(paths.pdfPath)) return paths.pdfPath;
	if (fs.existsSync(paths.mdPath)) return paths.mdPath;
	if (fs.existsSync(paths.dir)) return paths.dir;
	return null;
}

export function setButtonToReveal(btn: HTMLButtonElement): void {
	btn.empty();
	setIcon(btn, 'folder-open');
	btn.setAttribute('aria-label', 'Reveal in file manager');
}

export function revealInFileManager(filepath: string): void {
	shell.showItemInFolder(filepath);
}

export async function downloadPaper(
	plugin: CustomCodeblocksPlugin,
	data: PaperData,
	btn: HTMLButtonElement,
	sourcePath?: string,
): Promise<void> {
	const paths = getPaperDir(plugin, data, sourcePath);
	if (!paths) {
		new Notice('No active note found.');
		return;
	}

	const { dir, pdfPath } = paths;

	const existingFile = findSavedFile(paths);
	if (existingFile) {
		setButtonToReveal(btn);
		new Notice('Existing download found');
		return;
	}

	new Notice(`Downloading ${sanitizeFilename(data.title || 'Untitled')}...`);

	const { pdf: pdfUrl, source: sourceUrl } = getDownloadUrls(data.link);

	try {
		fs.mkdirSync(dir, { recursive: true });

		let savedAsMd = false;
		const downloads: Promise<void>[] = [
			fetchWithCookieRetry(pdfUrl).then(response => {
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
				fetchWithCookieRetry(sourceUrl).then(response => {
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
		setButtonToReveal(btn);
	} catch (err) {
		new Notice(`Download failed: ${err instanceof Error ? err.message : String(err)}`);
	}
}
