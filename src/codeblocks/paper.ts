import { MarkdownView, Plugin } from 'obsidian';

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

export function registerPaperCodeblock(plugin: Plugin) {
	plugin.registerMarkdownCodeBlockProcessor('paper', (source, el, ctx) => {
		const data = parsePaperContent(source);

		const container = el.createDiv({ cls: 'paper-card' });

		// Click to edit (on the card, but not on links)
		container.addEventListener('click', (e) => {
			if ((e.target as HTMLElement).tagName === 'A') return;

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
