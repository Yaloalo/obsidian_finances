import {
	App,
	ItemView,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	WorkspaceLeaf,
	setIcon
} from 'obsidian';
import { mount, unmount } from 'svelte';
import FinanceDashboard from './src/FinanceDashboard.svelte';
import { MarkdownFinanceRepository } from './src/markdownRepository';

export const FINANCES_VIEW_TYPE = 'finances-pipeline-view';
export const FINANCES_NAV_VIEW_TYPE = 'finances-nav-view';

interface FinancesPluginSettings {
	rootFolder: string;
}

const DEFAULT_SETTINGS: FinancesPluginSettings = {
	rootFolder: 'finances'
};

function getCurrentYearMonth(): string {
	const now = new Date();
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export class FinancesNavView extends ItemView {
	private plugin: FinancesPipelinePlugin;

	constructor(leaf: WorkspaceLeaf, plugin: FinancesPipelinePlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return FINANCES_NAV_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Finances';
	}

	getIcon(): string {
		return 'pie-chart';
	}

	async onOpen(): Promise<void> {
		this.render();
		// Whenever the user clicks the Finances tab in the left sidebar, open the main pipeline view!
		await this.plugin.activateMainView();
	}

	public render(): void {
		const container = this.contentEl;
		container.empty();
		container.style.padding = '16px';
		container.style.display = 'flex';
		container.style.flexDirection = 'column';
		container.style.gap = '12px';

		const titleEl = container.createDiv();
		titleEl.style.fontWeight = '700';
		titleEl.style.fontSize = '15px';
		titleEl.setText('Finances Pipeline');

		const descEl = container.createDiv();
		descEl.style.fontSize = '12px';
		descEl.style.opacity = '0.75';
		descEl.setText(`Markdown DB stored in ${this.plugin.settings.rootFolder}/YYYY/MM/`);

		const openBtn = container.createEl('button', {
			text: 'Open Monthly Expense Pipeline →'
		});
		openBtn.style.width = '100%';
		openBtn.style.padding = '10px 14px';
		openBtn.style.borderRadius = '10px';
		openBtn.style.fontWeight = '700';
		openBtn.style.fontSize = '13px';
		openBtn.style.cursor = 'pointer';
		openBtn.style.backgroundColor = '#6b846d';
		openBtn.style.color = '#ffffff';
		openBtn.style.border = 'none';
		openBtn.addEventListener('click', () => {
			this.plugin.activateMainView();
		});

		const openNoteBtn = container.createEl('button', {
			text: `📄 Open ${getCurrentYearMonth()} Markdown Note`
		});
		openNoteBtn.style.width = '100%';
		openNoteBtn.style.padding = '8px 12px';
		openNoteBtn.style.borderRadius = '10px';
		openNoteBtn.style.fontWeight = '600';
		openNoteBtn.style.fontSize = '12px';
		openNoteBtn.style.cursor = 'pointer';
		openNoteBtn.addEventListener('click', async () => {
			const ym = getCurrentYearMonth();
			const path = this.plugin.repo.getOverviewFilePath(ym);
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) {
				const leaf = this.app.workspace.getLeaf('tab');
				await leaf.openFile(file);
			}
		});
	}
}

export class FinancesPipelineView extends ItemView {
	private plugin: FinancesPipelinePlugin;
	private componentInstance: Record<string, any> | null = null;
	private currentMonth: string = getCurrentYearMonth();

	constructor(leaf: WorkspaceLeaf, plugin: FinancesPipelinePlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return FINANCES_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Monthly Expense Pipeline';
	}

	getIcon(): string {
		return 'pie-chart';
	}

	async onOpen(): Promise<void> {
		await this.renderView();
	}

	public async ensureRendered(): Promise<void> {
		if (!this.componentInstance || this.contentEl.children.length === 0) {
			await this.renderView();
		} else {
			await this.refreshFromVault();
		}
	}

	public async renderView(): Promise<void> {
		const container = this.contentEl;
		if (this.componentInstance) {
			try {
				unmount(this.componentInstance);
			} catch {
				// ignore unmount error
			}
			this.componentInstance = null;
		}
		container.empty();
		container.addClass('efp-view-container');

		try {
			const initialData = await this.plugin.repo.getDashboardData(this.currentMonth);

			this.componentInstance = mount(FinanceDashboard, {
				target: container,
				props: {
					initialData,
					repo: this.plugin.repo,
					onOpenMarkdown: async (month: string) => {
						this.currentMonth = month;
						const path = this.plugin.repo.getOverviewFilePath(month);
						const file = this.app.vault.getAbstractFileByPath(path);
						if (file instanceof TFile) {
							const leaf = this.app.workspace.getLeaf('tab');
							await leaf.openFile(file);
						}
					}
				}
			});
		} catch (err: unknown) {
			const errMsg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
			console.error('[FinancesPipelineView] Failed to render:', err);
			const errBox = container.createDiv();
			errBox.style.padding = '24px';
			errBox.style.color = '#e03e36';
			errBox.style.fontFamily = 'monospace';
			errBox.style.whiteSpace = 'pre-wrap';
			errBox.setText(`Error loading Monthly Expense Pipeline:\n${errMsg}`);
		}
	}

	public async refreshFromVault(): Promise<void> {
		if (this.componentInstance && typeof this.componentInstance.reloadMonth === 'function') {
			await this.componentInstance.reloadMonth();
		}
	}

	async onClose(): Promise<void> {
		if (this.componentInstance) {
			try {
				unmount(this.componentInstance);
			} catch {
				// ignore
			}
			this.componentInstance = null;
		}
	}
}

export default class FinancesPipelinePlugin extends Plugin {
	public settings: FinancesPluginSettings = DEFAULT_SETTINGS;
	public repo!: MarkdownFinanceRepository;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.repo = new MarkdownFinanceRepository(this.app, this.settings.rootFolder);

		this.registerView(
			FINANCES_VIEW_TYPE,
			(leaf: WorkspaceLeaf) => new FinancesPipelineView(leaf, this)
		);

		this.registerView(
			FINANCES_NAV_VIEW_TYPE,
			(leaf: WorkspaceLeaf) => new FinancesNavView(leaf, this)
		);

		// Left-hand side Ribbon Icon in Obsidian
		const ribbonEl = this.addRibbonIcon('pie-chart', 'Monthly Expense Pipeline', () => {
			this.activateMainView();
		});
		ribbonEl.addClass('efp-ribbon-btn');

		// Also inject a prominent button directly into the left sidebar header next to Search / Files / BeautyTasks
		this.app.workspace.onLayoutReady(async () => {
			await this.ensureLeftNavTab();
			this.injectLeftHeaderButton();
			const mainLeaves = this.app.workspace.getLeavesOfType(FINANCES_VIEW_TYPE);
			for (const l of mainLeaves) {
				if (l.view instanceof FinancesPipelineView) {
					await l.view.ensureRendered();
				}
			}
		});

		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				this.injectLeftHeaderButton();
			})
		);

		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				if (leaf && leaf.view instanceof FinancesNavView) {
					this.activateMainView();
				}
			})
		);

		this.addCommand({
			id: 'open-monthly-expense-pipeline',
			name: 'Open Monthly Expense Pipeline',
			callback: () => {
				this.activateMainView();
			}
		});

		this.addSettingTab(new FinancesSettingTab(this.app, this));
	}

	onunload(): void {
		document.querySelectorAll('.efp-left-quick-btn').forEach((el) => el.remove());
	}

	private async ensureLeftNavTab(): Promise<void> {
		const { workspace } = this.app;
		const existingNav = workspace.getLeavesOfType(FINANCES_NAV_VIEW_TYPE);
		if (existingNav.length === 0) {
			const leftLeaf = workspace.getLeftLeaf(false);
			if (leftLeaf) {
				await leftLeaf.setViewState({
					type: FINANCES_NAV_VIEW_TYPE,
					active: false
				});
			}
		}
	}

	private injectLeftHeaderButton(): void {
		// In case the left sidebar tab header or file explorer header is visible, ensure clean button
		const fileExplorerNav = document.querySelector('.nav-buttons-container');
		if (fileExplorerNav && !fileExplorerNav.querySelector('.efp-left-quick-btn')) {
			const btn = fileExplorerNav.createEl('div', {
				cls: 'clickable-icon nav-action-button efp-left-quick-btn',
				attr: {
					'aria-label': 'Open Monthly Expense Pipeline',
					title: 'Open Monthly Expense Pipeline'
				}
			});
			setIcon(btn, 'pie-chart');
			btn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.activateMainView();
			});
		}
	}

	async activateMainView(): Promise<void> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(FINANCES_VIEW_TYPE);

		if (leaves.length > 0) {
			leaf = leaves[0];
		} else {
			// Always open in the main central rootSplit tab area, never in a sidebar
			leaf = workspace.getLeaf('tab');
			if (leaf) {
				await leaf.setViewState({
					type: FINANCES_VIEW_TYPE,
					active: true
				});
			}
		}

		if (leaf) {
			workspace.setActiveLeaf(leaf, { focus: true });
			await workspace.revealLeaf(leaf);
			if (leaf.view instanceof FinancesPipelineView) {
				await leaf.view.ensureRendered();
			}
		}
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.repo.setRootFolder(this.settings.rootFolder);
	}
}

class FinancesSettingTab extends PluginSettingTab {
	private plugin: FinancesPipelinePlugin;

	constructor(app: App, plugin: FinancesPipelinePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Finances Pipeline Settings' });

		new Setting(containerEl)
			.setName('Finances root folder')
			.setDesc(
				'Root folder in your vault where monthly Markdown files are stored under finances/YYYY/MM/.'
			)
			.addText((text) =>
				text
					.setPlaceholder('finances')
					.setValue(this.plugin.settings.rootFolder)
					.onChange(async (value) => {
						this.plugin.settings.rootFolder = value.trim() || 'finances';
						await this.plugin.saveSettings();
					})
			);
	}
}
