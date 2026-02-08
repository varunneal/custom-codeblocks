import { MarkdownView, Plugin } from 'obsidian';
import hljs from 'highlight.js/lib/core';
import python from 'highlight.js/lib/languages/python';

// Register only Python for smaller bundle
hljs.registerLanguage('python', python);

export function registerPythonCodeblock(plugin: Plugin) {
	plugin.registerMarkdownCodeBlockProcessor('python', (source, el, ctx) => {
		const container = el.createDiv({ cls: 'python-codeblock' });

		// Click to edit
		container.addEventListener('click', () => {
			const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
			if (!view) return;

			const sectionInfo = ctx.getSectionInfo(el);
			if (!sectionInfo) return;

			const editor = view.editor;
			// Position cursor at the first line of code (after ```python)
			editor.setCursor({ line: sectionInfo.lineStart + 1, ch: 0 });
			editor.focus();
		});

		const pre = container.createEl('pre');
		const code = pre.createEl('code', { cls: 'hljs language-python' });

		// Highlight the code
		const highlighted = hljs.highlight(source, { language: 'python' });
		code.innerHTML = highlighted.value;
	});
}
