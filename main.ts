import {
	App,
	ItemView,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	WorkspaceLeaf
} from 'obsidian';
import { mount, unmount } from 'svelte';
import FinanceDashboard from './src/FinanceDashboard.svelte';
import { MarkdownFinanceRepository } from './src/markdownRepository';

export const FINANCES_VIEW_TYPE = 'finances-pipeline-view';
export const FINANCES_NAV_VIEW_TYPE = 'finances-nav-view';

interface FinancesPluginSettings {
	rootFolder: string;
}

interface MountedDashboardInstance {
	reloadMonth?: (targetMonth?: string) => Promise<void>;
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
	}

	private async openCurrentMonthNote(): Promise<void> {
		const ym = getCurrentYearMonth();
		const path = this.plugin.repo.getOverviewFilePath(ym);
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			const leaf = this.app.workspace.getLeaf('tab');
			await leaf.openFile(file);
		}
	}

	public render(): void {
		const container = this.contentEl;
		container.empty();
		container.addClass('efp-nav-container');

		const titleEl = container.createDiv({ cls: 'efp-nav-title' });
		titleEl.setText('Finances Pipeline');

		const descEl = container.createDiv({ cls: 'efp-nav-desc' });
		descEl.setText(`Markdown DB stored in ${this.plugin.settings.rootFolder}/YYYY/MM/`);

		const openBtn = container.createEl('button', {
			cls: 'efp-nav-open-btn',
			text: 'Open Monthly Expense Pipeline →'
		});
		openBtn.addEventListener('click', () => {
			void this.plugin.activateMainView();
		});

		const openNoteBtn = container.createEl('button', {
			cls: 'efp-nav-note-btn',
			text: `📄 Open ${getCurrentYearMonth()} Markdown Note`
		});
		openNoteBtn.addEventListener('click', () => {
			void this.openCurrentMonthNote();
		});
	}
}

export class FinancesPipelineView extends ItemView {
	private plugin: FinancesPipelinePlugin;
	private componentInstance: MountedDashboardInstance | null = null;
	private currentMonth: string = getCurrentYearMonth();
	private renderPromise: Promise<void> | null = null;

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
		if (this.renderPromise) {
			await this.renderPromise;
			return;
		}
		if (!this.componentInstance || this.contentEl.children.length === 0) {
			await this.renderView();
		} else {
			await this.refreshFromVault();
		}
	}

	private async openMonthNote(month: string): Promise<void> {
		this.currentMonth = month;
		const path = this.plugin.repo.getOverviewFilePath(month);
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			const leaf = this.app.workspace.getLeaf('tab');
			await leaf.openFile(file);
		}
	}

	public async renderView(): Promise<void> {
		if (this.renderPromise) {
			return this.renderPromise;
		}
		this.renderPromise = this.doRenderView().finally(() => {
			this.renderPromise = null;
		});
		return this.renderPromise;
	}

	private async doRenderView(): Promise<void> {
		const container = this.contentEl;

		try {
			const initialData = await this.plugin.repo.getDashboardData(this.currentMonth);

			if (this.componentInstance) {
				try {
					await unmount(this.componentInstance);
				} catch {
					// ignore unmount error
				}
				this.componentInstance = null;
			}
			container.empty();
			container.addClass('efp-view-container');

			this.componentInstance = mount(FinanceDashboard, {
				target: container,
				props: {
					initialData,
					repo: this.plugin.repo,
					onMonthChange: (month: string) => {
						this.currentMonth = month;
					},
					onOpenMarkdown: (month: string) => {
						void this.openMonthNote(month);
					}
				}
			}) as MountedDashboardInstance;
		} catch (err: unknown) {
			const errMsg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
			console.error('[FinancesPipelineView] Failed to render:', err);
			container.empty();
			const errBox = container.createDiv({ cls: 'efp-error-box' });
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
				await unmount(this.componentInstance);
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

		const ribbonEl = this.addRibbonIcon('pie-chart', 'Monthly Expense Pipeline', () => {
			void this.activateMainView();
		});
		ribbonEl.addClass('efp-ribbon-btn');

		this.app.workspace.onLayoutReady(() => {
			void this.initializeWorkspaceViews();
		});

		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				if (leaf && leaf.view instanceof FinancesNavView) {
					void this.activateMainView();
				}
			})
		);

		this.addCommand({
			id: 'open-monthly-expense-pipeline',
			name: 'Open Monthly Expense Pipeline',
			callback: () => {
				void this.activateMainView();
			}
		});

		this.addSettingTab(new FinancesSettingTab(this.app, this));
	}

	private async initializeWorkspaceViews(): Promise<void> {
		await this.ensureLeftNavTab();
		const mainLeaves = this.app.workspace.getLeavesOfType(FINANCES_VIEW_TYPE);
		for (const l of mainLeaves) {
			if (l.view instanceof FinancesPipelineView) {
				await l.view.ensureRendered();
			}
		}
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

	async activateMainView(): Promise<void> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(FINANCES_VIEW_TYPE);

		if (leaves.length > 0) {
			leaf = leaves[0];
		} else {
			leaf = workspace.getLeaf(false);
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
		const loaded = (await this.loadData()) as Partial<FinancesPluginSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
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
