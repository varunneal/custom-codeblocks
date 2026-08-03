import {
	MarkdownPreviewRenderer,
	MarkdownView,
	type MarkdownPostProcessorContext,
	type WorkspaceLeaf,
} from 'obsidian';
import type CustomCodeblocksPlugin from '../main';
import { renderPaperCard } from './paper-card';
import { parsePaperContent } from './paper';

function findMarkdownLeaf(plugin: CustomCodeblocksPlugin, sourcePath: string): WorkspaceLeaf | null {
	return plugin.app.workspace.getLeavesOfType('markdown').find((leaf) => (
		leaf.view instanceof MarkdownView && leaf.view.file?.path === sourcePath
	)) ?? null;
}

async function editPaperFromReadingView(
	plugin: CustomCodeblocksPlugin,
	ctx: MarkdownPostProcessorContext,
	lineStart: number,
): Promise<void> {
	const leaf = findMarkdownLeaf(plugin, ctx.sourcePath);
	if (!leaf) return;

	await plugin.app.workspace.revealLeaf(leaf);
	let viewState = leaf.getViewState();
	if (leaf.view instanceof MarkdownView && leaf.view.getMode() === 'preview') {
		viewState = {
			...viewState,
			state: { ...viewState.state, mode: 'source', source: false },
		};
		await leaf.setViewState(viewState);
	}

	if (!(leaf.view instanceof MarkdownView)) return;
	leaf.view.editor.setCursor({ line: lineStart + 1, ch: 7 });
	leaf.view.editor.focus();
}

export function registerPaperReadingProcessor(plugin: CustomCodeblocksPlugin): void {
	const paperProcessor = MarkdownPreviewRenderer.createCodeBlockPostProcessor(
		'paper',
		(source, blockEl, ctx) => {
			const sectionInfo = ctx.getSectionInfo(blockEl);
			renderPaperCard(plugin, parsePaperContent(source), blockEl, {
				sourcePath: ctx.sourcePath,
				onEdit: sectionInfo
					? () => void editPaperFromReadingView(plugin, ctx, sectionInfo.lineStart)
					: undefined,
			});
		},
	);

	plugin.registerMarkdownPostProcessor((el, ctx) => {
		if (el.closest('.markdown-source-view')) return;
		return paperProcessor(el, ctx);
	});
}
