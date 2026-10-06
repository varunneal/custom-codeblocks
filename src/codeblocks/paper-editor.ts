import {
	EditorSelection,
	Prec,
	StateField,
	type EditorState,
	type Extension,
	type SelectionRange,
	type Transaction,
} from '@codemirror/state';
import {
	Decoration,
	EditorView,
	keymap,
	ViewPlugin,
	WidgetType,
	type DecorationSet,
	type ViewUpdate,
} from '@codemirror/view';
import { editorInfoField, editorLivePreviewField } from 'obsidian';
import type CustomCodeblocksPlugin from '../main';
import {
	renderPaperCard,
	SEARCH_MATCH_CLASS,
	setPaperCardMatches,
	VISIBLE_PAPER_FIELDS,
	type VisiblePaperField,
} from './paper-card';
import { parsePaperFields, type PaperData, type PaperFieldRanges } from './paper';

interface PaperBlock {
	from: number;
	to: number;
	editPos: number;
	startLine: number;
	endLine: number;
	source: string;
	data: PaperData;
	/** Field value ranges as absolute document positions. */
	fields: PaperFieldRanges;
}

/** Finds the current block for a widget DOM node, so stale widgets never use old positions. */
type BlockResolver = (view: EditorView, dom: HTMLElement) => PaperBlock | undefined;

const WIDGET_CLASS = 'custom-codeblocks-paper-widget';

interface PaperEditorState {
	livePreview: boolean;
	blocks: PaperBlock[];
	decorations: DecorationSet;
}

const OPENING_FENCE = /^ {0,3}(`{3,}|~{3,})[\t ]*paper(?:[\t ].*)?$/i;

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findPaperBlocks(state: EditorState): PaperBlock[] {
	const blocks: PaperBlock[] = [];
	const { doc } = state;

	for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber++) {
		const openingLine = doc.line(lineNumber);
		const match = openingLine.text.match(OPENING_FENCE);
		const fence = match?.[1];
		if (!fence) continue;

		const closingFence = new RegExp(
			`^ {0,3}${escapeRegExp(fence[0] ?? '`')}{${fence.length},}[\\t ]*$`,
		);
		for (let closingLineNumber = lineNumber + 1; closingLineNumber <= doc.lines; closingLineNumber++) {
			const closingLine = doc.line(closingLineNumber);
			if (!closingFence.test(closingLine.text)) continue;

			const firstContentLine = doc.line(Math.min(lineNumber + 1, closingLineNumber));
			const contentFrom = firstContentLine.from;
			const contentTo = closingLineNumber > lineNumber + 1
				? doc.line(closingLineNumber - 1).to
				: contentFrom;
			const source = doc.sliceString(contentFrom, contentTo);
			const { data, ranges } = parsePaperFields(source);
			const fields: PaperFieldRanges = {};
			for (const [key, range] of Object.entries(ranges) as Array<[keyof PaperData, { from: number; to: number }]>) {
				fields[key] = { from: contentFrom + range.from, to: contentFrom + range.to };
			}
			blocks.push({
				from: openingLine.from,
				to: closingLine.to,
				editPos: contentFrom + Math.min(7, firstContentLine.length),
				startLine: lineNumber,
				endLine: closingLineNumber,
				source,
				data,
				fields,
			});
			lineNumber = closingLineNumber;
			break;
		}
	}

	return blocks;
}

function selectionTouchesBlock(state: EditorState, block: PaperBlock): boolean {
	return state.selection.ranges.some((range) => range.from <= block.to && range.to >= block.from);
}

function getSourcePath(state: EditorState): string | undefined {
	return state.field(editorInfoField, false)?.file?.path;
}

function enterPaperBlock(view: EditorView, editPos: number): void {
	view.focus();
	view.dispatch({
		selection: EditorSelection.cursor(editPos),
		scrollIntoView: true,
		userEvent: 'select.pointer',
	});
}

class PaperCardWidget extends WidgetType {
	private resizeObserver?: ResizeObserver;

	constructor(
		private readonly plugin: CustomCodeblocksPlugin,
		private readonly block: PaperBlock,
		private readonly resolveBlock: BlockResolver,
		private readonly sourcePath?: string,
	) {
		super();
	}

	// Positions are left out on purpose: edits above the block shift it
	// without a re-render. Handlers look up the current position on use.
	eq(other: PaperCardWidget): boolean {
		return this.block.source === other.block.source
			&& this.sourcePath === other.sourcePath;
	}

	toDOM(view: EditorView): HTMLElement {
		const wrapper = view.dom.ownerDocument.createElement('div');
		wrapper.className = `block-language-paper ${WIDGET_CLASS}`;
		renderPaperCard(this.plugin, this.block.data, wrapper, {
			sourcePath: this.sourcePath,
			onEdit: () => {
				const block = this.resolveBlock(view, wrapper);
				if (block) enterPaperBlock(view, block.editPos);
			},
		});

		const ResizeObserverConstructor = view.dom.ownerDocument.defaultView?.ResizeObserver;
		if (ResizeObserverConstructor) {
			const resizeObserver = new ResizeObserverConstructor(() => view.requestMeasure());
			resizeObserver.observe(wrapper, { box: 'border-box' });
			this.resizeObserver = resizeObserver;
		}
		return wrapper;
	}

	get estimatedHeight(): number {
		return 70;
	}

	destroy(): void {
		this.resizeObserver?.disconnect();
	}
}

function buildDecorations(
	plugin: CustomCodeblocksPlugin,
	resolveBlock: BlockResolver,
	state: EditorState,
	blocks: PaperBlock[],
	livePreview: boolean,
): DecorationSet {
	if (!livePreview) return Decoration.none;

	const sourcePath = getSourcePath(state);
	const ranges = blocks
		.filter((block) => !selectionTouchesBlock(state, block))
		.map((block) => Decoration.replace({
			block: true,
			widget: new PaperCardWidget(plugin, block, resolveBlock, sourcePath),
		}).range(block.from, block.to));
	return Decoration.set(ranges, true);
}

function isLivePreview(state: EditorState): boolean {
	return state.field(editorLivePreviewField, false) ?? false;
}

function createPaperState(
	plugin: CustomCodeblocksPlugin,
	resolveBlock: BlockResolver,
	state: EditorState,
): PaperEditorState {
	const livePreview = isLivePreview(state);
	const blocks = livePreview ? findPaperBlocks(state) : [];
	return {
		livePreview,
		blocks,
		decorations: buildDecorations(plugin, resolveBlock, state, blocks, livePreview),
	};
}

function updatePaperState(
	plugin: CustomCodeblocksPlugin,
	resolveBlock: BlockResolver,
	value: PaperEditorState,
	transaction: Transaction,
): PaperEditorState {
	const livePreview = isLivePreview(transaction.state);
	const blocks = !livePreview
		? []
		: transaction.docChanged || !value.livePreview
			? findPaperBlocks(transaction.state)
			: value.blocks;
	if (
		!transaction.docChanged
		&& transaction.selection === undefined
		&& livePreview === value.livePreview
	) {
		return value;
	}

	return {
		livePreview,
		blocks,
		decorations: buildDecorations(plugin, resolveBlock, transaction.state, blocks, livePreview),
	};
}

function skippedPaperBlock(blocks: PaperBlock[], from: number, to: number): boolean {
	const lower = Math.min(from, to);
	const upper = Math.max(from, to);
	return blocks.some((block) => block.from < upper && block.to > lower);
}

function correctedVerticalRange(
	view: EditorView,
	blocks: PaperBlock[],
	range: SelectionRange,
	forward: boolean,
	extend: boolean,
): SelectionRange | null {
	if (!extend && !range.empty) return null;

	const currentLine = view.state.doc.lineAt(range.head);
	const targetLineNumber = currentLine.number + (forward ? 1 : -1);
	if (targetLineNumber < 1 || targetLineNumber > view.state.doc.lines) return null;
	const targetLine = view.state.doc.line(targetLineNumber);
	const adjacentRenderedBlock = blocks.some((block) => (
		block.startLine <= targetLineNumber
		&& block.endLine >= targetLineNumber
		&& !selectionTouchesBlock(view.state, block)
	));

	const moved = view.moveVertically(range, forward);
	const movedLine = view.state.doc.lineAt(moved.head);
	if (!adjacentRenderedBlock) {
		if (Math.abs(movedLine.number - currentLine.number) <= 1) return null;
		if (!skippedPaperBlock(blocks, range.head, moved.head)) return null;
	}

	const column = range.head - currentLine.from;
	const target = targetLine.from + Math.min(column, targetLine.length);
	return extend
		? EditorSelection.range(range.anchor, target, range.goalColumn)
		: EditorSelection.cursor(target, range.assoc, range.bidiLevel ?? undefined, range.goalColumn);
}

function moveVerticallyAcrossPaper(
	view: EditorView,
	field: StateField<PaperEditorState>,
	forward: boolean,
	extend: boolean,
): boolean {
	const paperState = view.state.field(field);
	if (!paperState.livePreview || paperState.blocks.length === 0) return false;
	const renderedBlocks = paperState.blocks.filter((block) => !selectionTouchesBlock(view.state, block));
	if (renderedBlocks.length === 0) return false;

	const corrected = view.state.selection.ranges.map((range) => (
		correctedVerticalRange(view, renderedBlocks, range, forward, extend)
	));
	if (corrected.some((range) => range === null)) return false;

	view.dispatch({
		selection: EditorSelection.create(corrected as SelectionRange[], view.state.selection.mainIndex),
		scrollIntoView: true,
		userEvent: 'select',
	});
	return true;
}

/**
 * Collects the ranges of Obsidian's in-note search (Cmd+F) highlights that
 * fall inside a block. Obsidian adds them as mark decorations, which cannot
 * draw inside a replaced range, so the card has to draw them itself.
 */
function searchMatchesIn(view: EditorView, from: number, to: number): Array<{ from: number; to: number }> {
	const matches: Array<{ from: number; to: number }> = [];
	for (const source of view.state.facet(EditorView.decorations)) {
		const set = typeof source === 'function' ? source(view) : source;
		set.between(from, to, (matchFrom, matchTo, decoration) => {
			const className = (decoration.spec as { class?: unknown }).class;
			if (matchFrom >= to || matchTo <= from || typeof className !== 'string') return;
			if (className.split(/\s+/).includes(SEARCH_MATCH_CLASS)) {
				matches.push({ from: matchFrom, to: matchTo });
			}
		});
	}
	return matches;
}

function syncSearchMatches(view: EditorView, resolveBlock: BlockResolver): void {
	view.contentDOM.querySelectorAll<HTMLElement>(`.${WIDGET_CLASS}`).forEach((wrapper) => {
		const card = wrapper.querySelector<HTMLElement>('.paper-card');
		if (!card) return;
		const block = resolveBlock(view, wrapper);
		const fieldMatches: Partial<Record<VisiblePaperField, Array<[number, number]>>> = {};
		let hiddenMatch = false;

		for (const match of block ? searchMatchesIn(view, block.from, block.to) : []) {
			let covered = 0;
			for (const field of VISIBLE_PAPER_FIELDS) {
				const range = block?.fields[field];
				if (!range) continue;
				const start = Math.max(match.from, range.from);
				const end = Math.min(match.to, range.to);
				if (end <= start) continue;
				(fieldMatches[field] ??= []).push([start - range.from, end - range.from]);
				covered += end - start;
			}
			if (covered < match.to - match.from) hiddenMatch = true;
		}

		setPaperCardMatches(card, fieldMatches, hiddenMatch);
	});
}

export function createPaperEditorExtension(plugin: CustomCodeblocksPlugin): Extension {
	const resolveBlock: BlockResolver = (view, dom) => {
		const pos = view.posAtDOM(dom);
		return view.state.field(paperField).blocks.find((block) => block.from <= pos && pos <= block.to);
	};

	const paperField = StateField.define<PaperEditorState>({
		create: (state) => createPaperState(plugin, resolveBlock, state),
		update: (value, transaction) => updatePaperState(plugin, resolveBlock, value, transaction),
		provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
	});

	// Runs in the measure write phase, after CodeMirror has drawn the widgets.
	const searchSync = ViewPlugin.fromClass(class {
		private readonly measureKey = {};

		constructor(view: EditorView) {
			this.schedule(view);
		}

		update(update: ViewUpdate): void {
			if (update.transactions.length > 0 || update.viewportChanged) this.schedule(update.view);
		}

		private schedule(view: EditorView): void {
			view.requestMeasure({
				key: this.measureKey,
				read: () => null,
				write: () => syncSearchMatches(view, resolveBlock),
			});
		}
	});

	const verticalNavigation = Prec.highest(keymap.of([
		{
			key: 'ArrowUp',
			run: (view) => moveVerticallyAcrossPaper(view, paperField, false, false),
			shift: (view) => moveVerticallyAcrossPaper(view, paperField, false, true),
		},
		{
			key: 'ArrowDown',
			run: (view) => moveVerticallyAcrossPaper(view, paperField, true, false),
			shift: (view) => moveVerticallyAcrossPaper(view, paperField, true, true),
		},
	]));

	return [paperField, verticalNavigation, searchSync];
}
