import { App, PluginSettingTab, Setting } from 'obsidian';
import * as path from 'path';
import * as os from 'os';
import type CustomCodeblocksPlugin from './main';

export interface CustomCodeblocksSettings {
	downloadPath: string;
}

export const DEFAULT_SETTINGS: CustomCodeblocksSettings = {
	downloadPath: path.join(os.homedir(), 'Projects', 'literature'),
};

export class CustomCodeblocksSettingTab extends PluginSettingTab {
	plugin: CustomCodeblocksPlugin;

	constructor(app: App, plugin: CustomCodeblocksPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const downloadPathSetting = new Setting(containerEl)
			.setName('Download path')
			.setDesc('Directory where paper PDFs are saved. Use ~ for home directory. Papers are saved to {path}/{note-name}/{paper-title}.pdf.')
			.addText(text => text
				.setPlaceholder(DEFAULT_SETTINGS.downloadPath)
				.setValue(this.plugin.settings.downloadPath)
				.onChange(async (value) => {
					this.plugin.settings.downloadPath = value;
					await this.plugin.saveSettings();
				}));
		downloadPathSetting.settingEl.classList.add('setting-download-path');
	}
}
