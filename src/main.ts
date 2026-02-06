import { Editor, MarkdownView, Plugin } from 'obsidian';
import { registerPaperCodeblock } from './codeblocks/paper';
import { CustomCodeblocksSettings, CustomCodeblocksSettingTab, DEFAULT_SETTINGS } from './settings';

export default class CustomCodeblocksPlugin extends Plugin {
	settings: CustomCodeblocksSettings = DEFAULT_SETTINGS;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new CustomCodeblocksSettingTab(this.app, this));

		registerPaperCodeblock(this);

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
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
