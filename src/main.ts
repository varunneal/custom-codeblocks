import { Editor, MarkdownView, Plugin } from 'obsidian';
import { registerPaperCodeblock } from './codeblocks/paper';

export default class CustomCodeblocksPlugin extends Plugin {
	async onload() {
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
}
