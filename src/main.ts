import { Editor, MarkdownView, Plugin } from 'obsidian';
import { createPaperEditorExtension } from './codeblocks/paper-editor';
import { registerPaperReadingProcessor } from './codeblocks/paper-reading';
import { CustomCodeblocksSettings, CustomCodeblocksSettingTab, DEFAULT_SETTINGS } from './settings';

export default class CustomCodeblocksPlugin extends Plugin {
	settings: CustomCodeblocksSettings = DEFAULT_SETTINGS;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new CustomCodeblocksSettingTab(this.app, this));

		registerPaperReadingProcessor(this);
		this.registerEditorExtension(createPaperEditorExtension(this));

		this.addCommand({
			id: 'insert-paper',
			name: 'Insert paper',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				const cursor = editor.getCursor();
				const template = [
					'```paper',
					'title: ',
					'authors: ',
					'date: ',
					'link: ',
					'```'
				].join('\n');
				editor.replaceSelection(template);
				// Position cursor after "title: "
				editor.setCursor({ line: cursor.line + 1, ch: 7 });
			}
		});
	}

	async loadSettings() {
		const savedSettings = await this.loadData() as Partial<CustomCodeblocksSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, savedSettings);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
